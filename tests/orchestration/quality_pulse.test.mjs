import assert from 'node:assert/strict';
import { basename } from 'node:path';
import test from 'node:test';
import { buildOrchestratedPulse } from '../../scripts/orchestration/quality_pulse.mjs';

const runId = '888';
const runUrl = `https://github.com/basil-one/agency/actions/runs/${runId}`;
const revision = 'b'.repeat(40);
const mainSha = 'a'.repeat(40);
const date = '2026-11-28';
const jobIds = [
  'common-code-quality', 'common-coherence-integrity', 'common-dependency-security',
  'site-build-integrity', 'site-link-integrity', 'site-seo-integrity', 'site-rendering-integrity',
  'site-performance-integrity'
];
const job = (result = 'success', status) => ({ result, outputs: { status } });
const posture = (status, detail) => ({ status, detail });

const performanceJob = 'site-performance-integrity';
const performanceArtifact = 'performance-summary';
const performanceFiles = ({ context = 'full-experience', source = {}, policy = { status: 'passed' } } = {}) => {
  const results = ['/', '/know-your-patterns/', '/reflections/', '/origin/'].flatMap((route) =>
    ['mobile', 'desktop'].map((formFactor) => ({
      route, formFactor, values: {
        'first-contentful-paint': 500,
        'largest-contentful-paint': 1200,
        'speed-index': 600,
        'total-blocking-time': 100,
        'cumulative-layout-shift': 0
      }
    }))
  );
  return {
    'performance-summary.json': {
      schemaVersion: 1, complete: true, capturedAt: `${date}T06:30:00Z`,
      conditions: { measurementContext: context },
      source: { eventName: 'schedule', branch: 'main', runId, runUrl, sha: revision, ...source },
      coverage: { routeCount: 4, runCount: 3, measurementCount: 24 },
      results
    },
    'performance-comparison.json': {
      schemaVersion: 1, measurementContext: context, policy,
      fixedReference: { available: true, runUrl: 'https://github.com/basil-one/agency/actions/runs/456' },
      history: { status: 'available', availableDailySamples: 28, requiredDailySamples: 28 },
      comparisons: results.map((result) => ({
        ...result,
        deltas: {
          'largest-contentful-paint': { fixed: { absolute: 100, percentage: 10 }, rolling: { absolute: -250 } },
          'total-blocking-time': { fixed: { absolute: 0, percentage: null } }
        }
      }))
    }
  };
};

function fixture({ needs = {}, artifacts = {}, metadata = {}, eventName = 'schedule', branch = 'main' } = {}) {
  const requests = [];
  const names = Object.keys(artifacts);
  const pulse = () => buildOrchestratedPulse({
    needs, eventName, branch, runId, runUrl, validatorRevision: revision, token: 'fixture',
    apiUrl: 'https://api.github.com', repository: 'basil-one/agency',
    fetchImpl: async (url) => {
      const name = url.searchParams.get('name');
      requests.push(url.pathname);
      if (name) {
        assert.match(url.pathname, new RegExp(`/actions/runs/${runId}/artifacts$`));
        if (artifacts[name] === 'denied') return { ok: false, status: 403 };
        const id = names.indexOf(name) + 1;
        const overrides = metadata[name] ?? {};
        const entries = Array.isArray(overrides) ? overrides : [overrides];
        return {
          ok: true,
          json: async () => ({ artifacts: id > 0 ? entries.map((entry) => ({ name, id, expired: false, ...entry })) : [] })
        };
      }
      assert.match(url.pathname, /\/actions\/artifacts\/\d+\/zip$/);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    },
    unzipImpl: (_command, args) => {
      const name = basename(args[1], '.zip');
      const file = args[2];
      const content = name === performanceArtifact ? artifacts[name][file] : artifacts[name];
      return JSON.stringify(content);
    }
  });
  return { pulse, requests };
}

const result = (pulse, id) => pulse.results.find((result) => result.id === id);

test('reports eight same-cycle checks in order and links the cycle and each artifact once', async () => {
  const needs = Object.fromEntries(jobIds.map((id) => [id, job()]));
  needs['site-link-integrity'] = job('success', 'advisory');
  const artifacts = {
    'dependency-posture': posture('passed'),
    [performanceArtifact]: performanceFiles({ source: { eventName: 'workflow_dispatch', branch: 'review' } })
  };
  const pulse = await fixture({ needs, artifacts, eventName: 'workflow_dispatch', branch: 'review' }).pulse();
  assert.equal(pulse.successful, true);
  assert.deepEqual(pulse.results.map(({ id }) => id), jobIds);
  assert.equal(result(pulse, 'site-link-integrity').state, 'advisory');
  assert.equal(pulse.results.filter(({ state }) => state === 'passed').length, 7);
  assert.equal(pulse.markdown.split(`[Cycle](${runUrl})`).length - 1, 1);
  assert.equal(pulse.markdown.split(result(pulse, performanceJob).artifactUrl).length - 1, 1);
  assert.match(pulse.markdown, new RegExp(`workflow&#95;dispatch on review · revision ${revision}`));
  assert.match(pulse.markdown, /Cycle passed with advisories \(1 of 8 checks\)/);
  assert.match(pulse.markdown, /Fixed reference: available; rolling baseline: available 28\/28/);
  assert.match(pulse.markdown, /\| Mobile LCP \| \+100 ms \(\+10\.0%\) \| -250 ms \|/);
  assert.match(pulse.markdown, /\| Mobile TBT \| 0 ms \| — \|/);
  assert.match(pulse.markdown, /\| Desktop LCP \|/);
  assert.doesNotMatch(pulse.markdown, /\| \/method\//);
});

test('missing, cancelled, skipped, failed and unknown job outcomes stay distinct', async () => {
  const needs = {
    'common-code-quality': job('failure'), 'site-build-integrity': job('cancelled'),
    'site-seo-integrity': job('skipped'), 'site-rendering-integrity': job('invalid')
  };
  const { pulse, requests } = fixture({ needs });
  const outcome = await pulse();
  assert.equal(outcome.successful, false);
  for (const [id, state] of [
    ['common-code-quality', 'failed'], ['site-build-integrity', 'cancelled'],
    ['site-seo-integrity', 'skipped'], ['site-rendering-integrity', 'unknown'],
    ['common-coherence-integrity', 'missing']
  ]) assert.equal(result(outcome, id).state, state);
  assert.deepEqual(requests, []);
});

test('site link defects take precedence over a contradictory or cancelled job', async () => {
  const id = 'site-link-integrity';
  for (const [jobState, status, expected] of [
    ['success', 'failure', 'failed'], ['cancelled', 'failure', 'failed'],
    ['failure', 'incomplete', 'incomplete'], ['success', undefined, 'unknown'],
    ['success', 'advisory', 'advisory']
  ]) {
    const pulse = await fixture({ needs: { [id]: job(jobState, status) } }).pulse();
    assert.equal(result(pulse, id).state, expected);
  }
});

test('posture distinguishes API unknown, review findings and contradictory jobs', async () => {
  const id = 'common-dependency-security';
  const denied = 'GitHub Dependabot alerts API returned HTTP 403: `access denied` <review>|retry [artifact](https://example.test).';
  for (const [jobState, evidence, state, detail] of [
    ['success', posture('passed'), 'passed', /No open Dependabot/],
    ['failure', posture('review', 'One high alert.'), 'failed', /One high alert/],
    ['success', posture('review', 'One high alert.'), 'failed', /One high alert/],
    ['failure', posture('unknown', denied), 'unknown', /HTTP 403/],
    ['success', posture('unknown', denied), 'unknown', /Job succeeded despite the unknown API outcome/],
    ['failure', posture('passed'), 'failed', /despite the failed job/],
    ['failure', undefined, 'failed', /artifact is missing/],
    ['success', 'denied', 'unknown', /Artifacts API returned HTTP 403/]
  ]) {
    const artifacts = evidence === undefined ? {} : { 'dependency-posture': evidence };
    const pulse = await fixture({ needs: { [id]: job(jobState) }, artifacts }).pulse();
    assert.equal(result(pulse, id).state, state);
    assert.match(pulse.markdown, detail);
    if (evidence?.status === 'unknown') {
      assert.match(pulse.markdown, /&#96;access denied&#96; &#60;review&#62;&#124;retry &#91;artifact&#93;\(https&#58;\/\/example/);
      assert.doesNotMatch(pulse.markdown, /<review>|\[artifact\]\(https:/);
      assert.match(pulse.markdown, /\[Artifact\]\(https:\/\/github\.com/);
    }
  }
});

test('performance requires full-experience evidence, a complete matching cycle and a final pass', async () => {
  for (const alteration of [
    { context: 'pr-controlled' }, { source: { runId: '999' } },
    { source: { sha: mainSha } }, { source: { branch: 'other' } },
    { source: { eventName: 'workflow_dispatch' } }, { policy: {} }
  ]) {
    const pulse = await fixture({
      needs: { [performanceJob]: job() },
      artifacts: { [performanceArtifact]: performanceFiles(alteration) }
    }).pulse();
    assert.equal(result(pulse, performanceJob).state, 'unknown');
    assert.doesNotMatch(pulse.markdown, /\| Mobile LCP \|/);
  }
  const files = performanceFiles();
  files['performance-comparison.json'].measurementContext = 'pr-controlled';
  const wrongComparison = await fixture({
    needs: { [performanceJob]: job() }, artifacts: { [performanceArtifact]: files }
  }).pulse();
  assert.equal(result(wrongComparison, performanceJob).state, 'unknown');

  files['performance-comparison.json'].measurementContext = 'full-experience';
  files['performance-summary.json'].results.pop();
  const incomplete = await fixture({
    needs: { [performanceJob]: job() }, artifacts: { [performanceArtifact]: files }
  }).pulse();
  assert.equal(result(incomplete, performanceJob).state, 'unknown');
});

test('artifact must be unique, unexpired, bounded and from the same checkout when metadata is present', async () => {
  const needs = { [performanceJob]: job() };
  const artifacts = { [performanceArtifact]: performanceFiles() };
  const source = { id: runId, head_branch: 'main', head_sha: revision };
  for (const [metadata, expected] of [
    [{ workflow_run: source }, 'passed'],
    [{ workflow_run: { ...source, id: '999' } }, 'unknown'],
    [{ workflow_run: { ...source, head_branch: 'other' } }, 'unknown'],
    [{ workflow_run: { ...source, head_sha: mainSha } }, 'unknown'],
    [{ expired: true }, 'unknown'], [[{ id: 10 }, { id: 11 }], 'unknown'],
    [{ size_in_bytes: 11 * 1024 * 1024 }, 'unknown']
  ]) {
    const options = { needs, artifacts, metadata: { [performanceArtifact]: metadata } };
    assert.equal(result(await fixture(options).pulse(), performanceJob).state, expected);
  }
  for (const [conclusion, expected] of [['success', 'unknown'], ['failure', 'failed']]) {
    const missing = await fixture({ needs: { [performanceJob]: job(conclusion) } }).pulse();
    assert.equal(result(missing, performanceJob).state, expected);
    assert.match(missing.markdown, /artifact is missing/);
  }
});

test('legacy unlabelled summaries remain full-experience and baselines stay separate', async () => {
  const files = performanceFiles({ context: undefined });
  delete files['performance-summary.json'].conditions;
  const comparison = files['performance-comparison.json'];
  delete comparison.measurementContext;
  comparison.history = { status: 'collecting_history', availableDailySamples: 2, requiredDailySamples: 28 };
  const read = () => fixture({ needs: { [performanceJob]: job() }, artifacts: { [performanceArtifact]: files } }).pulse();
  const fixedOnly = await read();
  assert.match(fixedOnly.markdown, /Fixed reference: available; rolling baseline: collecting 2\/28/);
  assert.match(fixedOnly.markdown, /\| Mobile LCP \| \+100 ms \(\+10\.0%\) \| — \|/);
  comparison.history = { status: 'available', availableDailySamples: 28, requiredDailySamples: 28 };
  comparison.fixedReference = { available: false, reason: 'No complete reviewed successful main reference is available.' };
  const rollingOnly = await read();
  assert.match(rollingOnly.markdown, /Fixed reference: pending; rolling baseline: available 28\/28/);
  assert.match(rollingOnly.markdown, /\| Mobile LCP \| — \| -250 ms \|/);
  comparison.comparisons = comparison.comparisons.filter(({ route }) => route !== '/');
  assert.match((await read()).markdown, /\| Homepage metrics \| — \| — \|/);
});

test('confirmed performance defects survive a green job and their actionable evidence appears once', async () => {
  const policy = { status: 'failed', confirmedViolations: [{
    route: '/origin/', formFactor: 'mobile', metric: 'largest-contentful-paint',
    criterion: 'absolute', value: 3600, confirmationValue: 3200, limit: 3000
  }, {
    route: '/origin/', formFactor: 'mobile', metric: 'largest-contentful-paint',
    criterion: 'reference-deterioration', value: 3600, confirmationValue: 3200,
    referenceValue: 2400, delta: 1200, deltaPercentage: 50
  }] };
  const artifacts = { [performanceArtifact]: performanceFiles({ policy }) };
  const pulse = await fixture({ needs: { [performanceJob]: job() }, artifacts }).pulse();
  assert.equal(result(pulse, performanceJob).state, 'failed');
  assert.match(pulse.markdown, /3\.20 s confirmed vs 3\.00 s limit/);
  assert.match(pulse.markdown, /reference 2\.40 s \(Δ 1\.20 s, \+50\.0%\)/);
  assert.equal(pulse.markdown.match(/Confirmed performance violation/g)?.length, 1);
  for (const policy of [
    { status: 'failed', confirmedViolations: [{}] }, { status: 'passed' }
  ]) {
    const value = await fixture({
      needs: { [performanceJob]: job('failure') },
      artifacts: { [performanceArtifact]: performanceFiles({ policy }) }
    }).pulse();
    assert.equal(result(value, performanceJob).state, 'failed');
    assert.doesNotMatch(value.markdown, /\| Mobile LCP \|/);
  }
});

test('incomplete performance confirmation retains bounded affected profiles without claiming failure', async () => {
  const initialViolations = Array.from({ length: 4 }, (_, index) => ({
    route: `/affected-${index}/`, formFactor: 'mobile', metric: 'largest-contentful-paint',
    criterion: 'absolute', value: 3600, limit: 3000
  }));
  for (const [jobState, status] of [['failure', 'incomplete'], ['success', 'confirmation-required']]) {
    const pulse = await fixture({
      needs: { [performanceJob]: job(jobState) },
      artifacts: {
        [performanceArtifact]: performanceFiles({
          policy: { status, confirmationReason: 'Repeat samples missing.', initialViolations }
        })
      }
    }).pulse();
    assert.equal(result(pulse, performanceJob).state, 'incomplete');
    assert.match(pulse.markdown, /Repeat samples missing.*Affected profiles: \/affected-0\/ \(mobile\).*3\.60 s initially vs 3\.00 s limit/);
    assert.match(pulse.markdown, /affected-2/);
    assert.doesNotMatch(pulse.markdown, /affected-3|Confirmed performance violations|## Performance trends/);
    assert.equal(pulse.markdown.match(/Performance confirmation incomplete/g)?.length, 1);
  }
});
