import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDependencyPosture,
  buildPulse,
  completionEvidenceFromJobs,
  describePerformanceComparison,
  evaluateRuns,
  renderPulse
} from '../scripts/quality_pulse.mjs';

const date = '2026-11-16';
const passingRun = {
  created_at: `${date}T06:24:00Z`,
  updated_at: `${date}T06:26:00Z`,
  run_started_at: `${date}T06:24:05Z`,
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/basil-one/agency/actions/runs/123',
  id: 123
};
const jobsCompletedBeforeCutoff = new Map([
  [123, completionEvidenceFromJobs([
    { status: 'completed', conclusion: 'success', completed_at: `${date}T06:26:00Z` }
  ])]
]);

test('daily scheduled main run completed before cutoff is fresh', () => {
  const result = evaluateRuns([passingRun], date, undefined, jobsCompletedBeforeCutoff);
  assert.equal(result.state, 'fresh');
  assert.equal(result.label, 'Fresh — passed');
  assert.equal(result.run.id, 123);
  assert.equal(result.run.completionEvidence.completedAt, `${date}T06:26:00.000Z`);
});

test('failed and intentionally skipped runs remain distinct', () => {
  assert.equal(
    evaluateRuns([{ ...passingRun, conclusion: 'failure' }], date).state,
    'failed'
  );
  assert.equal(
    evaluateRuns([{ ...passingRun, conclusion: 'skipped' }], date).state,
    'skipped'
  );
});

test('completed job evidence after cutoff is late; run started before cutoff', () => {
  const completedAfterCutoff = new Map([
    [123, completionEvidenceFromJobs([
      { status: 'completed', conclusion: 'success', completed_at: `${date}T18:01:00Z` }
    ])]
  ]);
  assert.equal(
    evaluateRuns([passingRun], date, undefined, completedAfterCutoff).state,
    'late'
  );
  assert.equal(
    evaluateRuns([passingRun], date, undefined, jobsCompletedBeforeCutoff).state,
    'fresh'
  );
});

test('incomplete workflow runs are not fresh', () => {
  assert.equal(
    evaluateRuns([{ ...passingRun, status: 'in_progress', conclusion: null }], date, undefined, jobsCompletedBeforeCutoff).state,
    'late'
  );
});

test('completed run without valid job completion metadata is unknown, not late or green', () => {
  for (const jobs of [
    [],
    [{ status: 'in_progress', conclusion: null, completed_at: null }],
    [{ status: 'completed', conclusion: 'success', completed_at: null }],
    [{ status: 'completed', conclusion: 'success', completed_at: 'not-a-timestamp' }]
  ]) {
    const evidence = new Map([[123, completionEvidenceFromJobs(jobs)]]);
    const result = evaluateRuns([passingRun], date, undefined, evidence);
    assert.equal(result.state, 'unknown');
    assert.match(result.label, /Unknown completion time/);
    assert.match(result.detail, /not marked fresh/);
  }
});

test('a successful workflow run with a failed job is not marked fresh', () => {
  const failedJob = new Map([
    [123, completionEvidenceFromJobs([
      { status: 'completed', conclusion: 'failure', completed_at: `${date}T06:26:00Z` }
    ])]
  ]);
  assert.equal(evaluateRuns([passingRun], date, undefined, failedJob).state, 'unknown');
});

test('Pulse uses actual job completion time, not workflow updated_at', async () => {
  const markdown = await buildPulse({
    apiUrl: 'https://api.github.com',
    repository: 'basil-one/agency',
    token: 'test-token',
    date,
    generatedAt: `${date}T18:17:00Z`,
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/actions/workflows/build-integrity.yml/runs')) {
        return {
          ok: true,
          json: async () => ({ workflow_runs: [{
            ...passingRun,
            updated_at: `${date}T18:04:00Z`
          }] })
        };
      }
      if (path.endsWith('/actions/runs/123/jobs')) {
        return {
          ok: true,
          json: async () => ({
            total_count: 1,
            jobs: [{
              status: 'completed',
              conclusion: 'success',
              completed_at: `${date}T17:59:00Z`
            }]
          })
        };
      }
      return { ok: true, json: async () => ({ workflow_runs: [] }) };
    }
  });
  assert.match(
    markdown,
    /\| Build Integrity \| Fresh — passed \| Completed 2026-11-16 17:59:00\.000 UTC \|/
  );
});

test('Pulse reports unknown when completion-time job metadata is inaccessible', async () => {
  const markdown = await buildPulse({
    apiUrl: 'https://api.github.com',
    repository: 'basil-one/agency',
    token: 'test-token',
    date,
    generatedAt: `${date}T18:17:00Z`,
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/actions/workflows/build-integrity.yml/runs')) {
        return { ok: true, json: async () => ({ workflow_runs: [passingRun] }) };
      }
      if (path.endsWith('/actions/runs/123/jobs')) {
        return { ok: false, status: 403 };
      }
      return { ok: true, json: async () => ({ workflow_runs: [] }) };
    }
  });
  assert.match(markdown, /\| Build Integrity \| Unknown completion time \| Started 2026-11-16 06:24:05\.000 UTC \|/);
  assert.match(markdown, /Jobs API returned HTTP 403/);
  assert.match(markdown, /Review required/);
});

test('missing today reports prior verification separately from stale data', () => {
  const prior = {
    ...passingRun,
    created_at: '2026-11-15T06:24:00Z',
    updated_at: '2026-11-15T06:26:00Z',
    run_started_at: '2026-11-15T06:24:05Z'
  };
  assert.equal(evaluateRuns([prior], date).state, 'prior');
  const stale = {
    ...prior,
    created_at: '2026-11-10T06:24:00Z',
    updated_at: '2026-11-10T06:26:00Z',
    run_started_at: '2026-11-10T06:24:05Z'
  };
  assert.equal(evaluateRuns([stale], date).state, 'stale');
  assert.equal(evaluateRuns([], date).state, 'missing');
});

test('partial pulse highlights missing coverage and exact run evidence', () => {
  const results = [
    { name: 'Build Integrity', result: evaluateRuns([passingRun], date, undefined, jobsCompletedBeforeCutoff) },
    { name: 'Link Integrity', result: evaluateRuns([], date) },
    {
      name: 'SEO Integrity',
      result: { state: 'unknown', label: 'Unknown / API inaccessible', detail: 'HTTP 403; no result is inferred.' }
    }
  ];
  const summary = renderPulse({
    date,
    generatedAt: `${date}T10:17:00Z`,
    results
  });
  assert.match(summary, /^# Quality Pulse\n/);
  assert.doesNotMatch(summary, /Agency Quality Pulse/);
  assert.match(summary, /Review required — 2 of 3 dimensions/);
  assert.match(summary, /Missing/);
  assert.match(summary, /Unknown \/ API inaccessible/);
  assert.match(summary, /actions\/runs\/123/);
  assert.match(summary, /late or missing runs are not replaced with prior green results/);
});

test('permission-denied Actions API is reported as unknown, not passed', async () => {
  const markdown = await buildPulse({
    apiUrl: 'https://api.github.com',
    repository: 'basil-one/agency',
    token: 'test-token',
    date,
    generatedAt: `${date}T10:17:00Z`,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({})
    })
  });
  assert.match(markdown, /Unknown \/ API inaccessible/);
  assert.match(markdown, /HTTP 403/);
  assert.match(markdown, /Review required/);
});

test('dependency posture artifacts keep API denial, findings, and clean checks distinct', () => {
  const run = evaluateRuns([passingRun], date, undefined, jobsCompletedBeforeCutoff);
  const unknown = applyDependencyPosture(run, {
    status: 'unknown',
    detail: 'Dependabot alerts API returned HTTP 403'
  });
  assert.equal(unknown.state, 'unknown');
  assert.match(unknown.label, /API inaccessible/);
  assert.match(unknown.detail, /no result is inferred/);

  const review = applyDependencyPosture(run, {
    status: 'review',
    detail: '3 open alerts need review'
  });
  assert.equal(review.state, 'failed');
  assert.match(review.label, /review required/);

  const passed = applyDependencyPosture(run, { status: 'passed' });
  assert.equal(passed.state, 'fresh');
  assert.match(passed.detail, /none met the review threshold/);
});

test('performance baseline details distinguish pending and available comparisons', () => {
  assert.equal(
    describePerformanceComparison({
      fixedReference: { available: false },
      history: { status: 'collecting', availableDailySamples: 4, requiredDailySamples: 28 }
    }),
    'fixed reference: pending reviewed main anchor; rolling baseline: collecting (4/28)'
  );
  assert.equal(
    describePerformanceComparison({
      fixedReference: { available: true },
      history: { status: 'available', availableDailySamples: 28, requiredDailySamples: 28 }
    }),
    'fixed reference: available; rolling baseline: available (28/28)'
  );
});

test('prior performance evidence can show its fixed and rolling state without claiming a fresh measurement', () => {
  const run = {
    ...passingRun,
    created_at: '2026-11-15T06:24:00Z',
    updated_at: '2026-11-15T06:26:00Z',
    run_started_at: '2026-11-15T06:24:05Z'
  };
  const result = evaluateRuns([run], date);
  result.baseline = 'fixed reference: pending reviewed main anchor; rolling baseline: collecting (4/28)';
  const summary = renderPulse({
    date,
    generatedAt: `${date}T18:17:00Z`,
    results: [{ name: 'Performance Integrity', result }]
  });
  assert.match(summary, /Prior verification/);
  assert.match(summary, /fixed reference: pending reviewed main anchor/);
  assert.match(summary, /do not treat it as today's check/);
});
