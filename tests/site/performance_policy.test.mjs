import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessPerformance,
  finalizePerformanceAssessment,
  lcpDeteriorationPolicy,
  median,
  performanceBudgets,
  selectMeasurementProfiles
} from '../../scripts/site/performance_policy.mjs';

function result(route = '/', formFactor = 'mobile', values = {}) {
  return {
    route,
    formFactor,
    values: {
      'largest-contentful-paint': 1_000,
      'total-blocking-time': 50,
      'cumulative-layout-shift': 0,
      ...values
    }
  };
}

function assess(results, referenceResults = [], referenceAvailable = false) {
  return assessPerformance(
    results,
    referenceResults,
    referenceAvailable,
    referenceAvailable ? undefined : 'Reviewed fixed reference is unavailable.'
  );
}

function confirmation(results) {
  return {
    complete: true,
    coverage: {
      runCount: 3,
      routeProfiles: results.length,
      measurementCount: results.length * 3
    },
    results
  };
}

test('uses three-run medians and strict profile-specific absolute budget boundaries', () => {
  assert.equal(median([3_001, 2_999, 3_000]), 3_000);
  for (const formFactor of ['mobile', 'desktop']) {
    for (const [metric, limit] of Object.entries(performanceBudgets[formFactor])) {
      assert.equal(
        assess([result('/', formFactor, { [metric]: limit })]).status,
        'passed',
        `${formFactor} ${metric} at its limit`
      );
      assert.equal(
        assess([result('/', formFactor, { [metric]: limit + 0.001 })]).status,
        'confirmation-required',
        `${formFactor} ${metric} above its limit`
      );
    }
  }
});

test('requires both strict LCP deterioration thresholds against a compatible fixed reference', () => {
  const reference = [result('/', 'mobile', { 'largest-contentful-paint': 1_000 })];
  for (const value of [
    1_000 + lcpDeteriorationPolicy.minimumMilliseconds,
    1_000 * (1 + lcpDeteriorationPolicy.minimumPercentage / 100)
  ]) {
    assert.equal(
      assess([result('/', 'mobile', { 'largest-contentful-paint': value })], reference, true)
        .initialViolations.some(({ criterion }) => criterion === 'reference-deterioration'),
      false
    );
  }
  assert.equal(
    assess(
      [result('/', 'mobile', { 'largest-contentful-paint': 1_501 })],
      reference,
      true
    ).initialViolations[0].criterion,
    'reference-deterioration'
  );
});

test('absolute budgets remain active when the reference is unavailable', () => {
  const assessment = assess([
    result('/', 'mobile', { 'total-blocking-time': 301 })
  ]);
  assert.equal(assessment.status, 'confirmation-required');
  assert.equal(assessment.referenceAvailable, false);
  assert.equal(assessment.initialViolations[0].criterion, 'absolute');
});

test('confirmation measurement selection is restricted to unique generated profiles', () => {
  const routes = ['/', '/moves/'];
  assert.equal(selectMeasurementProfiles(routes).length, 4);
  assert.deepEqual(
    selectMeasurementProfiles(routes, [{ route: '/moves/', formFactor: 'mobile' }]),
    [{ route: '/moves/', formFactor: 'mobile' }]
  );
  for (const invalid of [
    [],
    [{ route: '/missing/', formFactor: 'mobile' }],
    [{ route: '/', formFactor: 'tablet' }],
    [{ route: '/', formFactor: 'mobile' }, { route: '/', formFactor: 'mobile' }],
    [null]
  ]) {
    assert.throws(() => selectMeasurementProfiles(routes, invalid));
  }
});

test('three new compatible measurements confirm or clear each initial route-profile violation', () => {
  const assessment = assess([
    result('/moves/', 'mobile', { 'total-blocking-time': 301 }),
    result('/lenses/', 'desktop', { 'cumulative-layout-shift': 0.101 })
  ]);
  assert.deepEqual(assessment.confirmationProfiles, [
    { route: '/moves/', formFactor: 'mobile' },
    { route: '/lenses/', formFactor: 'desktop' }
  ]);

  const final = finalizePerformanceAssessment(
    assessment,
    confirmation([
      result('/moves/', 'mobile', { 'total-blocking-time': 301 }),
      result('/lenses/', 'desktop', { 'cumulative-layout-shift': 0.1 })
    ]),
    { compatible: true }
  );
  assert.equal(final.status, 'failed');
  assert.deepEqual(final.confirmations.map(({ result: outcome }) => outcome), [
    'confirmed',
    'unconfirmed'
  ]);
});

test('missing, incompatible, incomplete, or mismatched confirmation never passes', () => {
  const initial = assess([
    result('/', 'mobile', { 'total-blocking-time': 301 })
  ]);
  for (const [summary, options] of [
    [undefined, { compatible: false, reason: 'Confirmation run failed.' }],
    [confirmation([]), { compatible: true, reason: 'Affected profile was omitted.' }],
    [confirmation([result()]), { compatible: false, reason: 'Environment changed.' }],
    [{
      ...confirmation([result()]),
      coverage: { runCount: 2, routeProfiles: 1, measurementCount: 2 }
    }, { compatible: true, reason: 'Only two measurements completed.' }]
  ]) {
    const final = finalizePerformanceAssessment(initial, summary, options);
    assert.equal(final.status, 'incomplete');
    assert.equal(final.confirmations[0].result, 'incomplete');
    assert.match(final.confirmationReason, /failed|omitted|changed|measurements/);
  }
});
