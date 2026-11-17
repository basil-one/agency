import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflows = [
  ['site-build-integrity.yml', 'build', 'Site Build Integrity'],
  ['link-integrity.yml', 'links', 'Link Integrity'],
  ['seo-integrity.yml', 'seo', 'SEO Integrity'],
  ['source-quality.yml', 'lint', 'Source Quality'],
  ['dependency-security.yml', 'dependency-review', 'Dependency Security'],
  ['rendered-site-integrity.yml', 'browser-smoke', 'Rendered Site Integrity']
];

test('required PR checks are emitted by their substantive workflow jobs', async () => {
  for (const [file, jobId, displayName] of workflows) {
    const yaml = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert.match(yaml, /^on:\n  pull_request:\n    branches: \[main\]$/m, `${file} runs for PRs to main`);

    const jobsStart = yaml.indexOf('\njobs:\n') + '\njobs:\n'.length;
    const jobs = yaml.slice(jobsStart);
    const jobHeaders = [...jobs.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)];
    assert.ok(jobHeaders.some(([header]) => header === `  ${jobId}:`), `${file} defines ${jobId}`);
    assert.doesNotMatch(jobs, /^  bridge-[a-z0-9-]+:/m, `${file} has no bridge jobs`);
    const namedJobs = [...jobs.matchAll(/^    name: (.+)$/gm)].map(([, name]) => name);
    assert.equal(namedJobs.filter((name) => name === displayName).length, 1, `${file} emits one canonical job`);

    const header = jobHeaders.find(([line]) => line === `  ${jobId}:`);
    const nextHeader = jobHeaders.find(([, , offset]) => offset > header.index);
    const job = jobs.slice(header.index, nextHeader?.index ?? jobs.length);
    assert.match(job, new RegExp(`^    name: ${displayName.replaceAll(' ', '\\s+')}$`, 'm'));
    assert.match(job, /^    steps:\s*$/m, `${jobId} has substantive steps`);
    assert.doesNotMatch(job, /^    needs:/m, `${jobId} is not a proxy job`);

    const condition = job.match(/^    if: (.+)$/m)?.[1];
    if (jobId === 'dependency-review') {
      assert.equal(condition, "github.event_name == 'pull_request'");
    } else {
      assert.equal(condition, undefined, `${jobId} cannot be skipped by a job condition`);
    }
  }
});
