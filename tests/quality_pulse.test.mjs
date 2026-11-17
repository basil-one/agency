import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDependencyPosture,
  buildPulse,
  completionEvidenceFromJobs,
  describePerformanceComparison,
  evaluateRuns,
  formatTrendDelta,
  homepageTrendRows,
  isPerformanceComparison,
  renderPerformanceTrends,
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
const performanceComparison = {
  schemaVersion: 1,
  fixedReference: { available: true, runUrl: 'https://github.com/basil-one/agency/actions/runs/99' },
  history: { status: 'available', availableDailySamples: 28, requiredDailySamples: 28 },
  comparisons: [
    {
      route: '/',
      formFactor: 'mobile',
      deltas: {
        'largest-contentful-paint': {
          fixed: { absolute: 1500, percentage: 10 },
          rolling: { absolute: -200, percentage: -5 }
        },
        'total-blocking-time': {
          fixed: { absolute: 25, percentage: null },
          rolling: { absolute: 5, percentage: 2 }
        }
      }
    },
    {
      route: '/',
      formFactor: 'desktop',
      deltas: {
        'largest-contentful-paint': {
          fixed: { absolute: -100, percentage: -4 },
          rolling: { absolute: 200, percentage: 8 }
        }
      }
    },
    {
      route: '/not-the-homepage/',
      formFactor: 'mobile',
      deltas: {
        'largest-contentful-paint': {
          fixed: { absolute: 999, percentage: 999 },
          rolling: { absolute: 999, percentage: 999 }
        }
      }
    }
  ]
};

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
      if (path.endsWith('/actions/workflows/site-build-integrity.yml/runs')) {
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
    /\| Site Build Integrity \| Fresh — passed \| Completed 2026-11-16 17:59:00\.000 UTC \|/
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
      if (path.endsWith('/actions/workflows/site-build-integrity.yml/runs')) {
        return { ok: true, json: async () => ({ workflow_runs: [passingRun] }) };
      }
      if (path.endsWith('/actions/runs/123/jobs')) {
        return { ok: false, status: 403 };
      }
      return { ok: true, json: async () => ({ workflow_runs: [] }) };
    }
  });
  assert.match(markdown, /\| Site Build Integrity \| Unknown completion time \| Started 2026-11-16 06:24:05\.000 UTC \|/);
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
    { name: 'Site Build Integrity', result: evaluateRuns([passingRun], date, undefined, jobsCompletedBeforeCutoff) },
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
      fixedReference: {
        available: false,
        reason: 'No versioned successful main reference has been established.'
      },
      history: { status: 'collecting', availableDailySamples: 4, requiredDailySamples: 28 }
    }),
    'Fixed reference: pending; rolling baseline: collecting 4/28'
  );
  assert.equal(
    describePerformanceComparison({
      fixedReference: { available: true },
      history: { status: 'available', availableDailySamples: 28, requiredDailySamples: 28 }
    }),
    'Fixed reference: available; rolling baseline: available 28/28'
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

test('homepage trends render only representative measures and linked source evidence', () => {
  const markdown = renderPerformanceTrends({
    state: 'fresh',
    trends: {
      state: 'fresh',
      measurementDate: date,
      comparison: performanceComparison,
      runUrl: 'https://github.com/basil-one/agency/actions/runs/123',
      artifactUrl: 'https://github.com/basil-one/agency/actions/runs/123/artifacts/456'
    }
  }).join('\n');
  assert.match(markdown, /Measurement — 2026-11-16 UTC \(fresh scheduled run\)/);
  assert.match(markdown, /Fixed reference: available; rolling baseline: available 28\/28/);
  assert.match(markdown, /\| Mobile LCP \| \+1\.50 s \(\+10\.0%\) \| -200 ms \(-5\.0%\) \|/);
  assert.match(markdown, /\| Mobile TBT \| \+25 ms \| \+5 ms \(\+2\.0%\) \|/);
  assert.match(markdown, /\| Desktop LCP \| -100 ms \(-4\.0%\) \| \+200 ms \(\+8\.0%\) \|/);
  assert.doesNotMatch(markdown, /999/);
  assert.match(markdown, /[Ll]ower is better/);
  assert.match(markdown, /\[Performance Integrity run\]\(https:\/\/github\.com\/basil-one\/agency\/actions\/runs\/123\)/);
  assert.match(markdown, /\[comparison artifact\]\(https:\/\/github\.com\/basil-one\/agency\/actions\/runs\/123\/artifacts\/456\)/);
  assert.match(markdown, /\[fixed reference run\]\(https:\/\/github\.com\/basil-one\/agency\/actions\/runs\/99\)/);
});

test('trend delta formatting uses stored values and never calculates a zero-baseline percentage', () => {
  assert.equal(formatTrendDelta({ absolute: 25, percentage: null }), '+25 ms');
  assert.equal(formatTrendDelta({ absolute: -1_250, percentage: -10 }), '-1.25 s (-10.0%)');
  assert.equal(formatTrendDelta(null), '—');
});

test('fixed-only, rolling-only, and unavailable trend references stay distinct', () => {
  const fixedOnly = structuredClone(performanceComparison);
  fixedOnly.fixedReference = { available: true };
  fixedOnly.history = { status: 'collecting', availableDailySamples: 4, requiredDailySamples: 28 };
  for (const comparison of fixedOnly.comparisons) {
    for (const deltas of Object.values(comparison.deltas)) deltas.rolling = null;
  }
  let output = renderPerformanceTrends({
    trends: { state: 'fresh', measurementDate: date, comparison: fixedOnly }
  }).join('\n');
  assert.match(output, /Fixed reference: available; rolling baseline: collecting 4\/28/);
  assert.match(output, /\| Mobile LCP \| \+1\.50 s \(\+10\.0%\) \| — \|/);

  const rollingOnly = structuredClone(performanceComparison);
  rollingOnly.fixedReference = { available: false, reason: 'No versioned successful main reference has been established.' };
  for (const comparison of rollingOnly.comparisons) {
    for (const deltas of Object.values(comparison.deltas)) deltas.fixed = null;
  }
  output = renderPerformanceTrends({
    trends: { state: 'fresh', measurementDate: date, comparison: rollingOnly }
  }).join('\n');
  assert.match(output, /Fixed reference: pending; rolling baseline: available 28\/28/);
  assert.match(output, /\| Mobile LCP \| — \| -200 ms \(-5\.0%\) \|/);

  const noBaselines = structuredClone(rollingOnly);
  noBaselines.fixedReference = { available: false, reason: 'The versioned reference uses a different tool or runner environment.' };
  noBaselines.history = { status: 'unavailable' };
  output = renderPerformanceTrends({
    trends: { state: 'fresh', measurementDate: date, comparison: noBaselines }
  }).join('\n');
  assert.match(output, /Fixed reference: incompatible; rolling baseline: unavailable/);
  assert.match(output, /\| Mobile LCP \| — \| — \|/);
  assert.equal(
    describePerformanceComparison({
      fixedReference: { available: true },
      history: { status: 'available', availableDailySamples: 4, requiredDailySamples: 28 }
    }),
    'Fixed reference: available; rolling baseline: unknown'
  );
});

test('missing homepage route or metric never borrows another route or invents deltas', () => {
  const comparison = structuredClone(performanceComparison);
  comparison.comparisons = comparison.comparisons.filter((item) => item.route !== '/');
  assert.deepEqual(homepageTrendRows(comparison), []);
  let output = renderPerformanceTrends({
    trends: { state: 'fresh', measurementDate: date, comparison }
  }).join('\n');
  assert.match(output, /\| Homepage metrics \| — \| — \|/);

  comparison.comparisons = [{
    route: '/',
    formFactor: 'mobile',
    deltas: { 'largest-contentful-paint': { fixed: null, rolling: null } }
  }];
  assert.deepEqual(homepageTrendRows(comparison).map((row) => row.label), ['Mobile LCP']);
  output = renderPerformanceTrends({
    trends: { state: 'fresh', measurementDate: date, comparison }
  }).join('\n');
  assert.match(output, /\| Mobile LCP \| — \| — \|/);
  assert.doesNotMatch(output, /\| Desktop LCP \|/);
});

test('prior trends are dated, while non-successful performance evidence has no deltas', () => {
  const priorOutput = renderPerformanceTrends({
    trends: {
      state: 'prior',
      measurementDate: '2026-11-15',
      comparison: performanceComparison
    }
  }).join('\n');
  assert.match(priorOutput, /Prior successful measurement — 2026-11-15; not today's verification/);

  for (const [state, label] of [
    ['failed', 'Fresh — failed'],
    ['skipped', 'Skipped'],
    ['missing', 'Missing'],
    ['late', 'Late'],
    ['unknown', 'Unknown outcome']
  ]) {
    const summary = renderPulse({
      date,
      generatedAt: `${date}T18:17:00Z`,
      results: [{
        name: 'Performance Integrity',
        result: {
          state,
          label,
          detail: 'No successful current measurement is established.',
          trends: {
            state,
            measurementDate: date,
            comparison: performanceComparison,
            reason: `today's Performance Integrity result is ${label.toLowerCase()}; no successful current trend is shown`
          }
        }
      }]
    });
    assert.match(summary, /Performance comparison unavailable/);
    assert.doesNotMatch(summary, /\| Mobile LCP \|/);
    assert.doesNotMatch(summary, /fresh scheduled run/);
  }
});

test('performance comparison artifact schema is checked before rendering', () => {
  assert.equal(isPerformanceComparison(performanceComparison), true);
  assert.equal(isPerformanceComparison({ schemaVersion: 1, comparisons: [] }), false);
  assert.equal(isPerformanceComparison({ ...performanceComparison, schemaVersion: 2 }), false);
});

test('Pulse loads a valid comparison artifact and keeps failed or unavailable artifacts out of trends', async () => {
  const successRun = {
    ...passingRun,
    id: 700,
    html_url: 'https://github.com/basil-one/agency/actions/runs/700'
  };
  const successfulJobs = {
    total_count: 1,
    jobs: [{ status: 'completed', conclusion: 'success', completed_at: `${date}T06:26:00Z` }]
  };
  const buildWithArtifact = async ({ artifactResponse, artifactJson = performanceComparison, conclusion = 'success' }) => {
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/actions/workflows/performance-integrity.yml/runs')) {
        return { ok: true, json: async () => ({ workflow_runs: [{ ...successRun, conclusion }] }) };
      }
      if (path.endsWith('/actions/runs/700/jobs')) {
        return { ok: true, json: async () => successfulJobs };
      }
      if (path.endsWith('/actions/runs/700/artifacts')) return artifactResponse;
      if (path.endsWith('/actions/artifacts/456/zip')) {
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, json: async () => ({ workflow_runs: [] }) };
    };
    return buildPulse({
      apiUrl: 'https://api.github.com',
      repository: 'basil-one/agency',
      token: 'test-token',
      date,
      generatedAt: `${date}T18:17:00Z`,
      fetchImpl,
      unzipImpl: () => JSON.stringify(artifactJson)
    });
  };

  const valid = await buildWithArtifact({
    artifactResponse: {
      ok: true,
      json: async () => ({ artifacts: [{ name: 'performance-summary', expired: false, id: 456 }] })
    }
  });
  assert.match(valid, /\| Mobile LCP \| \+1\.50 s/);
  assert.match(valid, /actions\/runs\/700\/artifacts\/456/);

  const malformed = await buildWithArtifact({
    artifactResponse: {
      ok: true,
      json: async () => ({ artifacts: [{ name: 'performance-summary', expired: false, id: 456 }] })
    },
    artifactJson: { schemaVersion: 1, comparisons: [] }
  });
  assert.match(malformed, /comparison artifact unavailable or invalid/);
  assert.doesNotMatch(malformed, /\| Mobile LCP \|/);

  const expired = await buildWithArtifact({
    artifactResponse: {
      ok: true,
      json: async () => ({ artifacts: [{ name: 'performance-summary', expired: true, id: 456 }] })
    }
  });
  assert.match(expired, /artifact is missing or expired/);
  assert.doesNotMatch(expired, /\| Mobile LCP \|/);

  const inaccessible = await buildWithArtifact({
    artifactResponse: { ok: false, status: 403 }
  });
  assert.match(inaccessible, /Artifacts API returned HTTP 403/);
  assert.doesNotMatch(inaccessible, /\| Mobile LCP \|/);

  const failedMeasurement = await buildWithArtifact({
    artifactResponse: { ok: true, json: async () => ({ artifacts: [] }) },
    conclusion: 'failure'
  });
  assert.match(failedMeasurement, /Performance Integrity result is fresh — failed/);
  assert.doesNotMatch(failedMeasurement, /\| Mobile LCP \|/);
});
