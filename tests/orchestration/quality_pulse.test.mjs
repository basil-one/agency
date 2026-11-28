import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDependencyPosture,
  buildOrchestratedPulse,
  describePerformanceComparison,
  formatTrendDelta,
  homepageTrendRows,
  isPerformanceComparison,
  renderPerformanceTrends,
  renderPulse
} from '../../scripts/orchestration/quality_pulse.mjs';

const date = '2026-11-16';
const runId = '888';
const runUrl = `https://github.com/basil-one/agency/actions/runs/${runId}`;
const needs = Object.fromEntries([
  'common-code-quality',
  'common-coherence-integrity',
  'common-dependency-security',
  'site-build-integrity',
  'site-link-integrity',
  'site-seo-integrity',
  'site-rendering-integrity',
  'site-performance-integrity'
].map((jobId) => [jobId, {
  result: 'success',
  ...(jobId === 'site-link-integrity' ? { outputs: { status: 'success' } } : {})
}]));
const performanceComparison = {
  schemaVersion: 1,
  policy: {
    status: 'passed',
    initialViolations: [],
    confirmations: [],
    confirmedViolations: []
  },
  fixedReference: {
    available: true,
    runUrl: 'https://github.com/basil-one/agency/actions/runs/99'
  },
  history: {
    status: 'available',
    availableDailySamples: 28,
    requiredDailySamples: 28,
    searchedRuns: 28,
    reason: null,
    skipped: [],
    provenance: []
  },
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

function artifactHarness({
  comparison = performanceComparison,
  summaryEvent = 'schedule',
  branch = 'main',
  summarySha = 'revision-123',
  missingArtifacts = false
} = {}) {
  const performanceSummary = {
    complete: true,
    capturedAt: `${date}T06:30:00.000Z`,
    source: {
      eventName: summaryEvent,
      branch,
      sha: summarySha,
      runId
    }
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/actions/runs/888/artifacts')) {
      if (missingArtifacts) return { ok: true, json: async () => ({ artifacts: [] }) };
      const artifactName = parsed.searchParams.get('name');
      const id = artifactName === 'performance-summary' ? 456 : 457;
      return {
        ok: true,
        json: async () => ({ artifacts: [{ name: artifactName, expired: false, id }] })
      };
    }
    if (/\/actions\/artifacts\/(456|457)\/zip$/.test(parsed.pathname)) {
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };
  const unzipImpl = (_command, args) => {
    if (args.at(-1) === 'performance-comparison.json') return JSON.stringify(comparison);
    if (args.at(-1) === 'performance-summary.json') return JSON.stringify(performanceSummary);
    if (args.at(-1) === 'dependency-posture.json') {
      return JSON.stringify({ status: 'passed', detail: 'No open medium-or-higher alerts' });
    }
    throw new Error(`Unexpected artifact file: ${args.at(-1)}`);
  };
  return { fetchImpl, unzipImpl };
}

function buildCycle(overrides = {}) {
  const { fetchImpl, unzipImpl } = artifactHarness(overrides);
  return buildOrchestratedPulse({
    apiUrl: 'https://api.github.com',
    repository: 'basil-one/agency',
    token: 'test-token',
    needs,
    runId,
    runUrl,
    date,
    generatedAt: `${date}T06:40:00Z`,
    sourceRevision: 'revision-123',
    fetchImpl,
    unzipImpl,
    ...overrides
  });
}

test('Pulse escapes Markdown delimiters in evidence details', () => {
  const markdown = renderPulse({
    date,
    generatedAt: `${date}T18:17:00Z`,
    runUrl,
    results: [{
      name: 'Site: Build Integrity',
      result: {
        state: 'failed',
        label: 'Failed',
        detail: String.raw`untrusted\| detail`
      }
    }]
  });
  assert.ok(markdown.includes(String.raw`untrusted\\\| detail`));
});

test('dependency posture keeps unavailable evidence, findings, and clean checks distinct', () => {
  const passed = { state: 'passed', label: 'Passed' };
  const unknown = applyDependencyPosture(passed, {
    status: 'unknown',
    detail: 'Dependabot alerts API returned HTTP 403'
  });
  assert.equal(unknown.state, 'unknown');
  assert.match(unknown.detail, /no result is inferred/);

  const review = applyDependencyPosture(passed, {
    status: 'review',
    detail: '3 open alerts need review'
  });
  assert.equal(review.state, 'failed');

  const clean = applyDependencyPosture(passed, { status: 'passed' });
  assert.deepEqual(clean, passed);

  const knownFinding = {
    state: 'failed',
    label: 'Failed',
    detail: 'An open dependency review finding needs attention.'
  };
  assert.equal(
    applyDependencyPosture(knownFinding, { status: 'unknown' }).state,
    'failed'
  );
  assert.equal(
    applyDependencyPosture(knownFinding, { status: 'passed' }).state,
    'failed'
  );
});

test('homepage trends use only available homepage values and compatible history', () => {
  assert.equal(isPerformanceComparison(performanceComparison), true);
  assert.equal(isPerformanceComparison({ schemaVersion: 1, comparisons: [] }), false);
  assert.equal(
    describePerformanceComparison({
      fixedReference: { available: true },
      history: { status: 'available', availableDailySamples: 4, requiredDailySamples: 28 }
    }),
    'Fixed reference: available; rolling baseline: unknown'
  );
  assert.equal(formatTrendDelta({ absolute: 25, percentage: null }), '+25 ms');
  assert.equal(formatTrendDelta(null), '—');

  const markdown = renderPerformanceTrends({
    state: 'passed',
    trends: {
      measurementDate: date,
      comparison: performanceComparison,
      artifactUrl: `${runUrl}/artifacts/456`
    }
  }).join('\n');
  assert.match(markdown, /\| Mobile LCP \| \+1\.50 s \(\+10\.0%\) \| -200 ms \(-5\.0%\) \|/);
  assert.match(markdown, /\| Mobile TBT \| \+25 ms \| \+5 ms \(\+2\.0%\) \|/);
  assert.doesNotMatch(markdown, /999/);

  const missingHomepage = structuredClone(performanceComparison);
  missingHomepage.comparisons = missingHomepage.comparisons.filter((item) => item.route !== '/');
  assert.deepEqual(homepageTrendRows(missingHomepage), []);
});

test('orchestrated Pulse reports same-cycle outcomes and validated evidence', async () => {
  const pulse = await buildCycle();

  assert.equal(pulse.successful, true);
  assert.equal(pulse.completed, true);
  assert.match(pulse.markdown, /All 8 dimensions passed in this cycle/);
  assert.match(pulse.markdown, /\*\*Validator revision:\*\* `revision-123`/);
  assert.match(pulse.markdown, /\*\*Cycle:\*\* \[workflow run\]\(https:\/\/github\.com\/basil-one\/agency\/actions\/runs\/888\)/);
  assert.match(pulse.markdown, /\| Site: Build Integrity \| Passed \| — \|/);
  assert.equal((pulse.markdown.match(/\[workflow run\]/g) ?? []).length, 1);
  assert.match(pulse.markdown, /actions\/runs\/888\/artifacts\/456/);
  assert.match(pulse.markdown, /actions\/runs\/888\/artifacts\/457/);
  assert.match(pulse.markdown, /\| Mobile LCP \| \+1\.50 s/);

  const manual = await buildCycle({
    eventName: 'workflow_dispatch',
    branch: 'copilot/change',
    summaryEvent: 'workflow_dispatch'
  });
  assert.match(manual.markdown, /manually dispatched cycle/);

  const advisoryNeeds = {
    ...needs,
    'site-link-integrity': {
      result: 'success',
      outputs: { status: 'advisory' }
    }
  };
  const advisory = await buildCycle({ needs: advisoryNeeds });
  assert.equal(advisory.successful, false);
  assert.equal(advisory.completed, true);
  assert.match(advisory.markdown, /Cycle successful with advisories/);
  assert.match(advisory.markdown, /Site: Link Integrity — Advisory/);

  const failedComparison = structuredClone(performanceComparison);
  failedComparison.policy = {
    status: 'failed',
    confirmedViolations: [{
      route: '/know-your-patterns/',
      formFactor: 'mobile',
      metric: 'total-blocking-time',
      criterion: 'absolute',
      value: 337,
      confirmationValue: 321,
      limit: 300
    }]
  };
  const failed = await buildCycle({
    needs: { ...needs, 'site-performance-integrity': { result: 'failure' } },
    comparison: failedComparison
  });
  assert.equal(failed.successful, false);
  assert.match(failed.markdown, /Site: Performance Integrity \| Failed/);
  assert.match(failed.markdown, /337 ms initially, 321 ms confirmed vs 300 ms limit/);
  assert.match(failed.markdown, /correct the affected route\/profile/);

  const failedWithoutEvidence = await buildCycle({
    needs: { ...needs, 'site-performance-integrity': { result: 'failure' } },
    missingArtifacts: true
  });
  assert.match(failedWithoutEvidence.markdown, /performance-summary artifact is missing or expired/);
  assert.equal(
    (failedWithoutEvidence.markdown.match(/performance-summary artifact is missing or expired/g) ?? []).length,
    1
  );
  assert.match(
    failedWithoutEvidence.markdown,
    /Performance comparison unavailable: see Findings for the captured performance detail/
  );
});

test('Pulse preserves failed, skipped, cancelled, missing, and unknown job outcomes', async () => {
  const incomplete = await buildCycle({
    needs: {
      'common-code-quality': { result: 'failure' },
      'common-coherence-integrity': { result: 'skipped' },
      'common-dependency-security': { result: 'skipped' },
      'site-build-integrity': { result: 'failure' },
      'site-link-integrity': { result: 'skipped' },
      'site-seo-integrity': { result: 'cancelled' },
      'site-rendering-integrity': { result: 'skipped' },
      'site-performance-integrity': { result: 'skipped' }
    }
  });
  assert.equal(incomplete.successful, false);
  assert.equal(incomplete.completed, false);
  assert.match(incomplete.markdown, /Cycle incomplete — 8 of 8 dimensions/);
  assert.match(incomplete.markdown, /\| Common: Code Quality \| Failed \|/);
  assert.match(incomplete.markdown, /\| Site: Link Integrity \| Skipped \|/);
  assert.match(incomplete.markdown, /\| Site: SEO Integrity \| Incomplete \/ cancelled \|/);

  const missing = await buildCycle({
    needs: {},
    fetchImpl: async () => {
      throw new Error('No artifact should be requested for an unexecuted job');
    }
  });
  assert.equal(missing.successful, false);
  assert.match(missing.markdown, /\| Site: Build Integrity \| Missing \|/);
  assert.match(missing.markdown, /Inspect the orchestration run and confirm the missing check was invoked/);

  const unknownLink = await buildCycle({
    needs: { 'site-link-integrity': { result: 'success' } },
    fetchImpl: async () => {
      throw new Error('No artifact should be requested for an unexecuted job');
    }
  });
  assert.match(unknownLink.markdown, /\| Site: Link Integrity \| Unknown \/ link evidence unavailable \|/);
});

test('missing same-cycle artifacts remain unknown rather than successful', async () => {
  const pulse = await buildCycle({ missingArtifacts: true });

  assert.equal(pulse.successful, false);
  assert.match(pulse.markdown, /\| Common: Dependency Security \| Unknown \/ posture artifact unavailable \|/);
  assert.match(pulse.markdown, /\| Site: Performance Integrity \| Unknown \/ performance evidence unavailable \|/);
  assert.match(pulse.markdown, /no clean result is inferred/);
  assert.match(pulse.markdown, /no comparison is inferred/);

  const mismatched = await buildCycle({ summarySha: 'another-revision' });
  assert.equal(mismatched.successful, false);
  assert.match(mismatched.markdown, /Unknown \/ performance evidence unavailable/);
  assert.doesNotMatch(mismatched.markdown, /\| Mobile LCP \|/);
});
