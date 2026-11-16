import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertSuccessfulPrerequisite } from '../scripts/verify_required_check.mjs';

const workflows = [
  ['site-build-integrity.yml', 'Site Build Integrity', 'bridge-site-build-integrity', 'Site Build Integrity', 'Build integrity', 'build'],
  ['link-integrity.yml', 'Link Integrity', 'bridge-link-integrity', 'Link Integrity', 'Link integrity', 'links'],
  ['seo-integrity.yml', 'SEO Integrity', 'bridge-seo-integrity', 'SEO Integrity', 'SEO integrity', 'seo'],
  ['source-quality.yml', 'Source Quality', 'bridge-source-quality', 'Source Quality', 'Source quality', 'lint'],
  ['dependency-security.yml', 'Dependency Security', 'bridge-dependency-security', 'Dependency Security', 'Dependency security', 'dependency-review'],
  ['rendered-site-integrity.yml', 'Rendered Site Integrity', 'bridge-rendered-site-integrity', 'Rendered Site Integrity', 'Rendered-site integrity', 'browser-smoke']
];

test('canonical bridge checks depend on their original PR validation jobs', async () => {
  for (const [file, workflowName, bridgeId, context, legacyName, prerequisite] of workflows) {
    const yaml = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    const start = yaml.indexOf(`  ${bridgeId}:\n`);
    assert.notEqual(start, -1, `${file} defines ${bridgeId}`);
    const nextJobPattern = /\n  [a-z0-9-]+:\n/g;
    nextJobPattern.lastIndex = start + 1;
    const nextJob = nextJobPattern.exec(yaml)?.index;
    const job = yaml.slice(start, nextJob);

    assert.match(yaml, new RegExp(`^name: ${workflowName}$`, 'm'));
    assert.match(yaml, new RegExp(`^    name: ${legacyName}$`, 'm'));
    assert.match(job, new RegExp(`^    name: ${context.replaceAll(' ', '\\s+')}$`, 'm'));
    assert.match(job, new RegExp(`^    needs: ${prerequisite}$`, 'm'));
    assert.match(job, /^    if: always\(\) && github\.event_name == 'pull_request'$/m);
    assert.match(job, new RegExp(`PREREQUISITE_RESULT: \\$\\{\\{ needs\\.${prerequisite}\\.result \\}\\}`));
    assert.match(job, /node scripts\/verify_required_check\.mjs/);
  }
});

test('bridge prerequisite check accepts success only', () => {
  assert.doesNotThrow(() => assertSuccessfulPrerequisite('success'));
  for (const result of ['failure', 'skipped', 'cancelled', 'timed_out', null, undefined]) {
    assert.throws(() => assertSuccessfulPrerequisite(result), /expected 'success'/);
  }
});
