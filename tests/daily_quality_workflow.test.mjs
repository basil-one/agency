import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowDirectory = new URL('../.github/workflows/', import.meta.url);
const children = [
  ['site-build-integrity.yml', 'site-build'],
  ['link-integrity.yml', 'link'],
  ['seo-integrity.yml', 'seo'],
  ['source-quality.yml', 'source-quality'],
  ['dependency-security.yml', 'dependency-security'],
  ['rendered-site-integrity.yml', 'rendered-site'],
  ['performance-integrity.yml', 'performance']
];

test('one daily workflow owns the schedule and fans out to all seven reusable checks', async () => {
  const files = await readdir(workflowDirectory);
  const scheduled = [];
  for (const file of files.filter((name) => name.endsWith('.yml'))) {
    const yaml = await readFile(new URL(file, workflowDirectory), 'utf8');
    if (/^  schedule:/m.test(yaml)) scheduled.push(file);
  }
  assert.deepEqual(scheduled, ['quality-pulse.yml']);

  const orchestrator = await readFile(new URL('quality-pulse.yml', workflowDirectory), 'utf8');
  assert.match(orchestrator, /cron: '17 3 \* \* \*'/);
  assert.match(orchestrator, /^  workflow_dispatch:$/m);
  for (const [file, jobId] of children) {
    const child = await readFile(new URL(file, workflowDirectory), 'utf8');
    assert.match(child, /^  workflow_call:$/m, `${file} can be called`);
    assert.doesNotMatch(child, /^  schedule:$/m, `${file} has no independent daily schedule`);
    assert.match(orchestrator, new RegExp(`^  ${jobId}:\\n    name: .+\\n    uses: \\.\\/\\.github\\/workflows\\/${file}$`, 'm'));
  }
});

test('Pulse waits for every substantive result and preserves least-privilege permissions', async () => {
  const orchestrator = await readFile(new URL('quality-pulse.yml', workflowDirectory), 'utf8');
  const pulse = orchestrator.slice(orchestrator.indexOf('\n  pulse:\n'));
  assert.match(pulse, /if: \$\{\{ always\(\) && !cancelled\(\) \}\}/);
  for (const [, jobId] of children) {
    assert.match(pulse, new RegExp(`^      - ${jobId}$`, 'm'));
  }
  assert.match(pulse, /PULSE_RESULTS_JSON: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(pulse, /actions: read/);
  assert.match(pulse, /contents: read/);
  assert.match(orchestrator, /dependency-security:\n    name: Dependency Security\n    uses: \.\/\.github\/workflows\/dependency-security\.yml\n    permissions:\n      contents: read\n      vulnerability-alerts: read/);
  assert.match(orchestrator, /performance:\n    name: Performance Integrity\n    uses: \.\/\.github\/workflows\/performance-integrity\.yml\n    with:\n      caller_event_name: \$\{\{ github\.event_name \}\}\n    permissions:\n      actions: read\n      contents: read/);
  assert.match(orchestrator, /group: daily-quality-\$\{\{ github\.ref \}\}\n  cancel-in-progress: false/);
  for (const [file, group] of [
    ['performance-integrity.yml', 'performance-integrity'],
    ['rendered-site-integrity.yml', 'rendered-site-integrity']
  ]) {
    const yaml = await readFile(new URL(file, workflowDirectory), 'utf8');
    assert.match(yaml, new RegExp(
      `group: ${group}-\\$\\{\\{ github\\.workflow \\}\\}-\\$\\{\\{ github\\.ref \\}\\}\\n  cancel-in-progress: true`
    ));
  }
});
