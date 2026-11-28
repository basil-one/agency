import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderPerformanceSummary } from '../../scripts/site/render_performance_summary.mjs';

const routes = ['/', '/know-your-patterns/', '/reflections/', '/reflections/example/'];
const metrics = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'speed-index',
  'total-blocking-time',
  'cumulative-layout-shift'
];

function makeSummary() {
  return {
    complete: true,
    capturedAt: '2026-11-16T17:00:00.000Z',
    source: { sha: 'abc123', runUrl: 'https://github.com/basil-one/agency/actions/runs/99' },
    coverage: { routeCount: 4, runCount: 3, measurementCount: 24 },
    timing: { measurementSeconds: 264.1 },
    environment: {
      lighthouse: '13.6.0',
      chrome: 'Google Chrome for Testing 159.0.8154.6',
      node: 'v22.23.4',
      ruby: 'ruby 3.3.13 (2026-10-23 revision af48f08f21) [x86_64-linux]',
      jekyll: 'jekyll 3.10.0',
      runner: 'ubuntu-24.04'
    },
    conditions: {
      site: 'Jekyll production build served locally',
      mobile: 'Lighthouse default mobile configuration',
      desktop: 'Lighthouse desktop preset',
      measurementContext: 'full-experience',
      externalAnalyticsScriptsBlocked: false,
      analyticsCollectionBlocked: true,
      labOnly: true
    },
    firstPartyAssets: [{ path: 'assets/site.css', bytes: 2048 }],
    externalScripts: [{
      source: 'https://www.googletagmanager.com/gtag/js',
      samples: 8,
      successful: 8,
      medianTransferBytes: 180_000
    }],
    results: routes.flatMap((route) =>
      ['mobile', 'desktop'].map((formFactor) => ({
        route,
        formFactor,
        values: Object.fromEntries(metrics.map((metric) => [
          metric,
          metric === 'cumulative-layout-shift'
            ? 0.125
            : metric === 'largest-contentful-paint'
              ? formFactor === 'mobile' ? 1_234 : 567
              : metric === 'total-blocking-time'
                ? 89
                : 456
        ]))
      }))
    )
  };
}

function makeComparison({ available = false, historyStatus = 'collecting_history' } = {}) {
  const summary = makeSummary();
  return {
    deltasAvailable: available,
    policy: {
      status: 'passed',
      initialViolations: [],
      confirmations: [],
      confirmedViolations: []
    },
    fixedReference: available
      ? { available: true, runUrl: 'https://github.com/basil-one/agency/actions/runs/88' }
      : { available: false, reason: 'No versioned successful main reference has been established.' },
    history: {
      status: historyStatus,
      availableDailySamples: historyStatus === 'available' ? 28 : 0,
      requiredDailySamples: 28,
      reason: historyStatus === 'unavailable' ? 'GitHub Actions API returned HTTP 403.' : undefined,
      skipped: historyStatus === 'unavailable' ? ['history permission denied'] : [],
      provenance: []
    },
    comparisons: summary.results.map((result) => ({
      ...result,
      fixedReference: available ? Object.fromEntries(metrics.map((metric) => [metric, result.values[metric] - 100])) : null,
      rollingBaseline: available ? Object.fromEntries(metrics.map((metric) => [metric, result.values[metric] - 200])) : null
    }))
  };
}

function makeInputs(overrides = {}) {
  return {
    summary: makeSummary(),
    comparison: makeComparison(),
    jobStatus: 'success',
    eventName: 'pull_request',
    ref: 'copilot/change',
    measurementContext: 'full-experience',
    runUrl: 'https://github.com/basil-one/agency/actions/runs/99',
    skip: { measurement: false, paths: [] },
    reports: { outcome: 'success', url: 'https://github.com/basil-one/agency/actions/runs/99/artifacts/1' },
    machineArtifact: { outcome: 'success', url: 'https://github.com/basil-one/agency/actions/runs/99/artifacts/2' },
    steps: { measure: 'success', diagnostic: 'success', reports: 'success', summary: 'success' },
    ...overrides
  };
}

test('puts completed informational outcome first and summarizes representative LCP/TBT by page', () => {
  const report = renderPerformanceSummary(makeInputs());

  assert.match(report, /^# Site: Performance Integrity\n\n\*\*Measurement completed — 24\/24 Lighthouse samples; safeguard passed\*\*/);
  assert.match(
    report,
    /Three fresh-browser Lighthouse runs are summarized by route\/profile medians\. Absolute mobile\/desktop budgets apply/
  );
  assert.match(report, /\*\*Passed:\*\* no confirmed absolute-budget or substantial compatible-reference LCP violation/);
  assert.match(report, /\| Home \| 1\.23 s \| 567 ms \| 89 ms \|/);
  assert.match(report, /\| Know Your Patterns \|/);
  assert.match(report, /\| Reflections \|/);
  assert.match(report, /\| Latest reflection \| 1\.23 s \| 567 ms \| 89 ms \|/);
  assert.match(report, /Technical details/);
  assert.match(report, /\| Page \| Profile \| FCP \| LCP \| Speed Index \| TBT \| CLS \|/);
  assert.match(
    report,
    /Lighthouse 13\.6\.0; Google Chrome for Testing 159\.0\.8154\.6; Node v22\.23\.4; ruby 3\.3\.13 .*; jekyll 3\.10\.0; runner ubuntu-24\.04\./
  );
  assert.doesNotMatch(report, /Chrome Google Chrome|Ruby ruby|Jekyll jekyll/);
  assert.match(report, /\| Latest reflection \| mobile \|/);
  assert.match(
    report,
    /Latest reflection route: `\/reflections\/example\/` \(selected dynamically\)\./
  );
  assert.match(report, /264\.1 seconds/);
  assert.match(report, /Measurement context: \*\*full-experience\*\*; only same-context references and history are eligible/);
  assert.match(report, /context: full-experience; mobile: Lighthouse default mobile configuration; desktop: Lighthouse desktop preset; external analytics scripts blocked: no/);
});

test('renders controlled context explicitly without implying external analytics scripts ran', () => {
  const summary = makeSummary();
  summary.conditions.measurementContext = 'pr-controlled';
  summary.conditions.externalAnalyticsScriptsBlocked = true;
  summary.conditions.analyticsBlockedUrlPatterns = [
    '*google-analytics.com/*/collect*',
    '*googletagmanager.com/*',
    '*google-analytics.com/*',
    '*doubleclick.net/*'
  ];
  const report = renderPerformanceSummary(makeInputs({ summary }));

  assert.match(report, /Measurement context: \*\*pr-controlled\*\*/);
  assert.match(report, /context: pr-controlled; mobile: Lighthouse default mobile configuration; desktop: Lighthouse desktop preset; external analytics scripts blocked: yes; Analytics URL patterns blocked: .*googletagmanager\.com/);
});

test('reports an unavailable controlled reference without relative deltas or weakening budgets', () => {
  const summary = makeSummary();
  summary.conditions.measurementContext = 'pr-controlled';
  const comparison = makeComparison();
  comparison.fixedReference.reason =
    'No reviewed successful main reference is available for the pr-controlled context; absolute budgets remain active.';
  comparison.policy.referenceReason =
    'No reviewed successful main reference is available for the pr-controlled context; absolute budgets remain active.';
  const report = renderPerformanceSummary(makeInputs({
    summary,
    comparison
  }));

  assert.match(report, /pending controlled reference review; absolute budgets remain active/);
  assert.match(report, /Relative deterioration gate unavailable: No reviewed successful main reference is available for the pr-controlled context; absolute budgets remain enforced/);
  assert.match(report, /Absolute mobile\/desktop budgets apply/);
  assert.doesNotMatch(report, /^\| Page \| Profile \| Fixed LCP/m);
});

test('offers controlled measurement only as an explicit manual option and defaults it to full experience', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/site-performance-integrity.yml', import.meta.url),
    'utf8'
  );

  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      measurement_context:[\s\S]*?default: full-experience[\s\S]*?options:\n          - full-experience\n          - pr-controlled/);
  assert.match(workflow, /github\.event_name == 'pull_request' && 'pr-controlled'/);
  assert.match(workflow, /site-performance-reference-controlled\.json/);
});

test('reports pending fixed anchor and collecting rolling history without an empty comparison table', () => {
  const comparison = makeComparison();
  comparison.policy.referenceReason =
    'No reviewed successful main reference is available; absolute budgets remain active.';
  const report = renderPerformanceSummary(makeInputs({ comparison }));

  assert.match(report, /Fixed reference:\*\* pending confirmation and review of a complete successful `main` measurement/);
  assert.match(report, /Rolling daily-main baseline:\*\* collecting \(0\/28\)/);
  assert.match(report, /Rolling history is informational/);
  assert.match(report, /Relative deterioration gate unavailable: No reviewed successful main reference is available; absolute budgets remain enforced\./);
  assert.doesNotMatch(report, /^\| Page \| Profile \| Fixed LCP/m);
});

test('reports confirmed violations with route, profile, criterion, measurements, and next action', () => {
  const comparison = makeComparison();
  comparison.policy = {
    status: 'failed',
    initialViolations: [{
      route: '/know-your-patterns/',
      formFactor: 'mobile',
      criterion: 'absolute',
      metric: 'total-blocking-time',
      value: 337,
      limit: 300
    }],
    confirmations: [{
      route: '/know-your-patterns/',
      formFactor: 'mobile',
      criterion: 'absolute',
      metric: 'total-blocking-time',
      value: 337,
      limit: 300,
      confirmationValue: 321,
      result: 'confirmed'
    }],
    confirmedViolations: []
  };
  const report = renderPerformanceSummary(makeInputs({ comparison, jobStatus: 'failure' }));

  assert.match(report, /safeguard failed/);
  assert.match(report, /`\/know-your-patterns\/` \/ mobile: total-blocking-time 337 ms vs 300 ms absolute limit; confirmation 321 ms; confirmed/);
  assert.match(report, /correct the confirmed regression/);
});

test('renders route/profile-specific deltas and matching baseline provenance when available', () => {
  const report = renderPerformanceSummary(makeInputs({
    comparison: makeComparison({ available: true, historyStatus: 'available' })
  }));

  assert.match(report, /Fixed reference:\*\* \[available\]/);
  assert.match(report, /28\/28 compatible successful daily-main runs available/);
  assert.match(report, /^\| Home \| mobile \| \+100 ms \(\+8\.8%\) \| \+200 ms \(\+19\.3%\)/m);
  assert.match(report, /^\| Latest reflection \| mobile \|/m);
  assert.doesNotMatch(report, /Latest reflection \(\/reflections\/example\/\)/);
  assert.match(report, /Fixed TBT Δ/);
});

test('preserves a history lookup error and does not mislabel it as collecting', () => {
  const report = renderPerformanceSummary(makeInputs({
    comparison: makeComparison({ historyStatus: 'unavailable' })
  }));

  assert.match(report, /Rolling daily-main baseline:\*\* unavailable \(GitHub Actions API returned HTTP 403\)/);
  assert.match(report, /history permission denied/);
  assert.doesNotMatch(report, /collecting \(0\/28\)/);
});

test('does not report complete sample counts from partial measurement data', () => {
  const summary = makeSummary();
  summary.complete = false;
  summary.coverage.measurementCount = 12;
  summary.results = summary.results.slice(0, 4);
  const report = renderPerformanceSummary(makeInputs({
    summary,
    comparison: undefined,
    steps: { measure: 'success', diagnostic: 'skipped' }
  }));

  assert.match(report, /\*\*Measurement failed or incomplete/);
  assert.match(report, /No complete measurement or safeguard pass is reported/);
  assert.doesNotMatch(report, /Measurements were collected/);
  assert.match(report, /Complete sample count: \*\*unavailable\*\*/);
  assert.doesNotMatch(report, /24\/24 Lighthouse samples|12\/24/);
  assert.match(report, /Partial measurement data only/);
});

test('links only successful uploads and identifies missing artifacts for investigation', () => {
  const report = renderPerformanceSummary(makeInputs({
    reports: { outcome: 'failure' },
    machineArtifact: { outcome: 'skipped' }
  }));

  assert.doesNotMatch(report, /Raw Lighthouse reports\]\(/);
  assert.doesNotMatch(report, /Machine-readable summary and comparison\]\(/);
  assert.match(report, /Raw Lighthouse reports unavailable/);
  assert.match(report, /Machine-readable summary\/comparison artifact unavailable/);
  assert.match(report, /\[the workflow run\]\(https:\/\/github.com\/basil-one\/agency\/actions\/runs\/99\)/);
});

test('does not imply a comparison file exists when only the summary was produced', () => {
  const report = renderPerformanceSummary(makeInputs({
    comparison: undefined
  }));

  assert.match(report, /Machine-readable performance summary \(comparison unavailable\)/);
});

test('reports reflection, license-only, and mixed safe skips neutrally without measurement claims', () => {
  for (const { reason, paths } of [
    {
      reason: 'all changes are text-only Markdown reflections',
      paths: ['_reflections/new.md']
    },
    {
      reason: 'all changed files are Jekyll-excluded license files',
      paths: ['LICENSES/MIT.txt']
    },
    {
      reason: 'all changed files are Jekyll-excluded license files or text-only Markdown reflections',
      paths: ['LICENSES/MIT.txt', '_reflections/new.md']
    }
  ]) {
    const report = renderPerformanceSummary(makeInputs({
      summary: undefined,
      comparison: undefined,
      skip: { measurement: true, reason, paths },
      measurementContext: 'pr-controlled',
      reports: { outcome: 'skipped' },
      machineArtifact: { outcome: 'skipped' },
      steps: { measure: 'skipped' }
    }));

    assert.match(report, /^# Site: Performance Integrity\n\n\*\*Lighthouse measurement intentionally skipped\*\*/);
    assert.match(report, new RegExp(`Reason: ${reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(report, /Selected measurement context: \*\*pr-controlled\*\*; Lighthouse was not run/);
    assert.match(report, /Lighthouse samples collected: \*\*0\*\*/);
    assert.match(report, /No metrics, baseline comparison, or artifacts were produced/);
    assert.doesNotMatch(report, /24\/24|Mobile LCP|Fixed LCP Δ/);
  }
});

test('reports measurement failure and incomplete setup without fabricated counts or artifact links', () => {
  const report = renderPerformanceSummary(makeInputs({
    summary: undefined,
    comparison: undefined,
    jobStatus: 'failure',
    runUrl: 'https://github.com/basil-one/agency/actions/runs/99',
    reports: { outcome: 'skipped' },
    machineArtifact: { outcome: 'skipped' },
    steps: { tests: 'failure', measure: 'skipped', diagnostic: 'skipped' }
  }));

  assert.match(report, /\*\*Measurement failed or incomplete/);
  assert.match(report, /No complete measurement or safeguard pass is reported/);
  assert.doesNotMatch(report, /Measurements were collected/);
  assert.match(report, /Complete sample count: \*\*unavailable\*\*/);
  assert.match(report, /performance tests failed/);
  assert.doesNotMatch(report, /24\/24 Lighthouse samples/);
  assert.doesNotMatch(report, /artifacts\/[12]/);
});
