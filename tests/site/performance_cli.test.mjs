import assert from 'node:assert/strict';
import test from 'node:test';
import { getFlags } from 'lighthouse/cli/cli-flags.js';
import { buildLighthouseArgs } from '../../scripts/site/measure_performance.mjs';
import { analyticsBlockPatterns } from '../../scripts/site/performance_policy.mjs';

function parsedArgs(formFactor, measurementContext) {
  const args = buildLighthouseArgs({
    url: 'http://127.0.0.1:4000/',
    outputPath: '/tmp/performance-report.json',
    formFactor,
    measurementContext
  });
  return { args, flags: getFlags(args, { noExitOnFailure: true }) };
}

test('passes every controlled blocking pattern to Lighthouse as repeated options', () => {
  const { args, flags } = parsedArgs('mobile', 'pr-controlled');
  const expected = analyticsBlockPatterns('pr-controlled');

  assert.deepEqual(flags.blockedUrlPatterns, expected);
  assert.equal(args.filter((argument) => argument === '--blocked-url-patterns').length, expected.length);
  assert.equal(flags._[0], 'http://127.0.0.1:4000/');
  assert.equal(flags.outputPath, '/tmp/performance-report.json');
  assert.equal(flags.preset, undefined);
});

test('full-experience retains external scripts and desktop preset parsing', () => {
  const { args, flags } = parsedArgs('desktop', 'full-experience');
  const expected = analyticsBlockPatterns('full-experience');

  assert.deepEqual(flags.blockedUrlPatterns, expected);
  assert.equal(args.filter((argument) => argument === '--blocked-url-patterns').length, 1);
  assert.equal(flags.preset, 'desktop');
});

test('rejects unknown form factors and measurement contexts before Lighthouse runs', () => {
  assert.throws(
    () => buildLighthouseArgs({
      url: 'http://127.0.0.1:4000/',
      outputPath: '/tmp/performance-report.json',
      formFactor: 'tablet',
      measurementContext: 'pr-controlled'
    }),
    /Unknown Lighthouse form factor/
  );
  assert.throws(
    () => buildLighthouseArgs({
      url: 'http://127.0.0.1:4000/',
      outputPath: '/tmp/performance-report.json',
      formFactor: 'mobile',
      measurementContext: 'unknown'
    }),
    /Unknown performance measurement context/
  );
});
