import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildComparison,
  isCompleteSummary,
  referenceIsReady
} from '../scripts/compare_performance.mjs';

const metricKeys = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'speed-index',
  'total-blocking-time',
  'cumulative-layout-shift'
];

function makeSummary({
  eventName = 'schedule',
  branch = 'main',
  lcp = 1_000,
  capturedAt = '2026-11-16T00:00:00.000Z',
  reviewAssessment
} = {}) {
  const routes = ['/', '/know-your-patterns/', '/reflections/', '/reflections/latest/'];
  return {
    schemaVersion: 1,
    complete: true,
    capturedAt,
    source: {
      eventName,
      branch,
      sha: 'abc123',
      runId: '123',
      runUrl: 'https://github.com/basil-one/agency/actions/runs/123'
    },
    coverage: {
      routeCount: 4,
      runCount: 3,
      measurementCount: 24
    },
    environment: {
      runner: 'ubuntu-24.04',
      lighthouse: '13.6.0',
      chrome: '159.0.8154.6',
      ruby: '3.3.13',
      jekyll: '3.10.0',
      node: 'v22.23.4'
    },
    externalScripts: [{
      source: 'https://www.googletagmanager.com/gtag/js',
      samples: 8,
      successful: 8,
      medianTransferBytes: 180_000
    }],
    reviewAssessment,
    results: routes.flatMap((route) =>
      ['mobile', 'desktop'].map((formFactor) => ({
        route,
        formFactor,
        values: Object.fromEntries(metricKeys.map((key) => [
          key,
          key === 'largest-contentful-paint'
            ? lcp
            : key === 'cumulative-layout-shift'
              ? 0
              : 500
        ]))
      }))
    )
  };
}

function makeHistory(summaries, status) {
  return {
    status: status ?? (summaries.length === 28 ? 'available' : 'collecting_history'),
    summaries,
    skipped: []
  };
}

test('requires a complete four-route, three-run summary', () => {
  const summary = makeSummary();
  assert.equal(isCompleteSummary(summary), true);
  assert.equal(referenceIsReady(summary), true);
  assert.equal(isCompleteSummary({ ...summary, coverage: { ...summary.coverage, measurementCount: 8 } }), false);
  assert.equal(referenceIsReady(makeSummary({ eventName: 'pull_request', branch: 'copilot/change' })), false);
});

test('reports unavailable fixed and rolling baselines without fabricating deltas', () => {
  const current = makeSummary({ eventName: 'pull_request', branch: 'copilot/change', lcp: 1_200 });
  const { lines, comparison } = buildComparison(
    current,
    { schemaVersion: 1, status: 'pending' },
    makeHistory([])
  );
  const report = lines.join('\n');

  assert.match(report, /\*\*Fixed reference:\*\* pending first reviewed successful main measurement/);
  assert.match(report, /\*\*Rolling daily-main baseline:\*\* collecting \(0\/28 compatible successful daily-main runs\)/);
  assert.match(report, /No comparison\/deltas available yet/);
  assert.doesNotMatch(report, /^\| `\//m);
  assert.equal(comparison.fixedReference.available, false);
  assert.equal(comparison.deltasAvailable, false);
  assert.equal(comparison.comparisons[0].rollingBaseline, null);
});

test('reports unavailable history without disguising an API error as collecting', () => {
  const history = {
    ...makeHistory([], 'unavailable'),
    reason: 'GitHub Actions API returned HTTP 403.',
    skipped: ['history permission denied']
  };
  const { lines, comparison } = buildComparison(
    makeSummary({ eventName: 'pull_request', branch: 'copilot/change' }),
    undefined,
    history
  );
  const report = lines.join('\n');

  assert.match(report, /\*\*Rolling daily-main baseline:\*\* unavailable \(GitHub Actions API returned HTTP 403\)\./);
  assert.match(report, /\*\*History lookup details:\*\* history permission denied/);
  assert.doesNotMatch(report, /collecting \(0\/28/);
  assert.equal(comparison.history.status, 'unavailable');
  assert.equal(comparison.deltasAvailable, false);
});

test('renders a comparison table when the fixed reference is available', () => {
  const fixed = makeSummary({ lcp: 1_000 });
  const { lines, comparison } = buildComparison(
    makeSummary({ eventName: 'pull_request', branch: 'copilot/change', lcp: 1_200 }),
    fixed,
    makeHistory([])
  );

  assert.match(lines.join('\n'), /^\| Route \| Profile \| Fixed Δ/m);
  assert.match(lines.join('\n'), /^\| `\/` \| mobile \|/m);
  assert.equal(comparison.fixedReference.available, true);
  assert.equal(comparison.deltasAvailable, true);
});

test('compares against 28 matching daily-main summaries without applying a performance threshold', () => {
  const prior = Array.from({ length: 28 }, (_, index) =>
    makeSummary({
      lcp: 1_000 + index,
      capturedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString()
    })
  );
  const current = makeSummary({ eventName: 'schedule', branch: 'main', lcp: 1_600 });
  const fixed = makeSummary({ lcp: 1_000 });
  const { lines, comparison } = buildComparison(current, fixed, makeHistory(prior));
  const report = lines.join('\n');

  assert.equal(comparison.history.provenance.length, 28);
  assert.equal(comparison.history.requiredDailySamples, 28);
  assert.match(report, /28\/28 compatible successful daily-main runs; available/);
  assert.match(report, /\+587 ms \(\+57\.9%\)/);
  assert.match(report, /do not fail this workflow/);
  assert.equal(comparison.deltasAvailable, true);
});

test('does not compare with history collected under different tools', () => {
  const prior = Array.from({ length: 28 }, (_, index) => {
    const summary = makeSummary({
      capturedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString()
    });
    summary.environment.chrome = 'different-version';
    return summary;
  });
  const { lines, comparison } = buildComparison(
    makeSummary({ eventName: 'pull_request', branch: 'copilot/change', lcp: 1_200 }),
    undefined,
    makeHistory(prior)
  );

  assert.match(lines.join('\n'), /0\/28 compatible successful daily-main runs\)/);
  assert.equal(comparison.history.provenance.length, 0);
  assert.equal(comparison.comparisons[0].rollingBaseline, null);
});
