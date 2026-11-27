import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflows = [
  ['common-code-quality.yml', 'common-code-quality', 'Common: Code Quality'],
  ['common-coherence-integrity.yml', 'common-coherence-integrity', 'Common: Coherence Integrity'],
  ['common-dependency-security.yml', 'common-dependency-security-review', 'Common: Dependency Security'],
  ['site-build-integrity.yml', 'site-build-integrity', 'Site: Build Integrity'],
  ['site-link-integrity.yml', 'site-link-integrity', 'Site: Link Integrity'],
  ['site-seo-integrity.yml', 'site-seo-integrity', 'Site: SEO Integrity'],
  ['site-rendering-integrity.yml', 'site-rendering-integrity', 'Site: Rendering Integrity'],
  ['site-performance-integrity.yml', 'site-performance-integrity', 'Site: Performance Integrity']
];

test('required PR checks are emitted by their substantive workflow jobs', async () => {
  for (const [file, jobId, displayName] of workflows) {
    const yaml = await readFile(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8');
    const triggers = file === 'site-performance-integrity.yml'
      ? /^on:\n  pull_request:\n    branches: \[main\]\n  workflow_dispatch:\n    inputs:\n      measurement_context:[\s\S]*?  workflow_call:/m
      : /^on:\n  pull_request:\n    branches: \[main\]\n  workflow_dispatch:\n  workflow_call:/m;
    assert.match(yaml, triggers, `${file} preserves its PR and callable entry points`);

    const jobsStart = yaml.indexOf('\njobs:\n') + '\njobs:\n'.length;
    const jobs = yaml.slice(jobsStart);
    const jobHeaders = [...jobs.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)];
    assert.ok(jobHeaders.some(([header]) => header === `  ${jobId}:`), `${file} defines ${jobId}`);
    assert.doesNotMatch(jobs, /^  bridge-[a-z0-9-]+:/m, `${file} has no bridge jobs`);
    const namedJobs = [...jobs.matchAll(/^    name: (.+)$/gm)]
      .map(([, name]) => name.replace(/^["']|["']$/g, ''));
    assert.equal(namedJobs.filter((name) => name === displayName).length, 1, `${file} emits one canonical job`);

    const header = jobHeaders.find(([line]) => line === `  ${jobId}:`);
    const nextHeader = jobHeaders.find(([, , offset]) => offset > header.index);
    const job = jobs.slice(header.index, nextHeader?.index ?? jobs.length);
    const jobName = job.match(/^    name: (.+)$/m)?.[1]?.replace(/^["']|["']$/g, '');
    assert.equal(jobName, displayName);
    assert.match(job, /^    steps:\s*$/m, `${jobId} has substantive steps`);
    assert.doesNotMatch(job, /^    needs:/m, `${jobId} is not a proxy job`);

    const condition = job.match(/^    if: (.+)$/m)?.[1];
    if (jobId === 'common-dependency-security-review') {
      assert.equal(condition, "github.event_name == 'pull_request'");
    } else {
      assert.equal(condition, undefined, `${jobId} cannot be skipped by a job condition`);
    }
  }
});
