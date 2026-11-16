import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPulse,
  describePerformanceComparison,
  evaluateRuns,
  renderPulse
} from '../scripts/quality_pulse.mjs';

const date = '2026-11-16';
const passingRun = {
  created_at: `${date}T06:24:00Z`,
  updated_at: `${date}T06:26:00Z`,
  completed_at: `${date}T06:26:00Z`,
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/basil-one/agency/actions/runs/123',
  id: 123
};

test('daily scheduled main run completed before cutoff is fresh', () => {
  const result = evaluateRuns([passingRun], date);
  assert.equal(result.state, 'fresh');
  assert.equal(result.label, 'Fresh — passed');
  assert.equal(result.run.id, 123);
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

test('late and incomplete runs do not become fresh', () => {
  assert.equal(
    evaluateRuns([
      { ...passingRun, completed_at: `${date}T18:01:00Z` }
    ], date).state,
    'late'
  );
  assert.equal(
    evaluateRuns([{ ...passingRun, status: 'in_progress', conclusion: null }], date).state,
    'late'
  );
});

test('missing today reports prior verification separately from stale data', () => {
  const prior = {
    ...passingRun,
    created_at: '2026-11-15T06:24:00Z',
    completed_at: '2026-11-15T06:26:00Z'
  };
  assert.equal(evaluateRuns([prior], date).state, 'prior');
  const stale = {
    ...prior,
    created_at: '2026-11-10T06:24:00Z',
    completed_at: '2026-11-10T06:26:00Z'
  };
  assert.equal(evaluateRuns([stale], date).state, 'stale');
  assert.equal(evaluateRuns([], date).state, 'missing');
});

test('partial pulse highlights missing coverage and exact run evidence', () => {
  const results = [
    { name: 'Build Integrity', result: evaluateRuns([passingRun], date) },
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
