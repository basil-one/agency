import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRendering } from '../../scripts/site/summarize_rendering.mjs';

const successfulReport = {
  suites: [{
    specs: [
      {
        title: '/ is present in generated output and loads',
        tests: [{ results: [{ status: 'passed' }] }]
      },
      {
        title: '/ has no detectable accessibility violations',
        tests: [{
          annotations: [{ type: 'axe-scan-complete' }],
          results: [{ status: 'passed' }]
        }]
      },
      {
        title: 'Responsive usability: / at 320px',
        tests: [{ results: [{ status: 'passed' }] }]
      }
    ]
  }]
};

test('summary reports build, SVG, route, axe, and responsive coverage', () => {
  const summary = summarizeRendering({
    buildOutcome: 'success',
    svgOutcome: 'success',
    smokeOutcome: 'success',
    report: successfulReport
  });

  assert.equal(summary.failed, false);
  assert.match(summary.markdown, /Production build: \*\*passed\*\*/);
  assert.match(summary.markdown, /SVG assets: \*\*passed\*\*/);
  assert.match(summary.markdown, /Smoke routes: \*\*1\/1 passed/);
  assert.match(summary.markdown, /Axe scans: \*\*1\/1 completed/);
  assert.match(summary.markdown, /Responsive checks: \*\*1\/1 passed.*1 route and 1 viewport \(320px\)/);
  assert.match(summary.markdown, /Coverage verification: \*\*complete\*\*/);
});

test('missing and malformed reports are unavailable, not zero coverage', () => {
  const missing = summarizeRendering({
    buildOutcome: 'success',
    svgOutcome: 'success',
    smokeOutcome: 'success',
    reportUnavailableReason: 'Playwright JSON report was unreadable or malformed'
  });

  assert.equal(missing.failed, true);
  assert.match(missing.markdown, /Browser evidence: \*\*unavailable\*\*/);
  assert.match(missing.markdown, /Coverage verification: \*\*incomplete\*\*/);
  assert.doesNotMatch(missing.markdown, /0\/0/);

  const malformed = summarizeRendering({
    buildOutcome: 'success',
    svgOutcome: 'success',
    smokeOutcome: 'success',
    report: { suites: [null] }
  });
  assert.equal(malformed.failed, true);
  assert.match(malformed.markdown, /Browser evidence: \*\*unavailable\*\*/);
});

test('missing axe completion and malformed responsive cases are incomplete coverage', () => {
  const report = structuredClone(successfulReport);
  report.suites[0].specs[1].tests[0].annotations = [];
  report.suites[0].specs[2].title = 'Responsive usability: /';
  const summary = summarizeRendering({
    buildOutcome: 'success',
    svgOutcome: 'success',
    smokeOutcome: 'success',
    report
  });

  assert.equal(summary.failed, true);
  assert.match(summary.markdown, /0\/1 completed/);
  assert.match(summary.markdown, /Coverage verification: \*\*incomplete\*\*/);
});

test('failed and interrupted browser cases retain useful details and distinct outcomes', () => {
  const report = structuredClone(successfulReport);
  report.suites[0].specs[0].tests[0].results[0] = {
    status: 'failed',
    error: { message: 'Expected /origin/ to return HTTP 200; received HTTP 404' }
  };
  report.suites[0].specs[2].tests[0].results[0] = { status: 'interrupted' };
  const summary = summarizeRendering({
    buildOutcome: 'success',
    svgOutcome: 'success',
    smokeOutcome: 'failure',
    report
  });

  assert.equal(summary.failed, true);
  assert.match(summary.markdown, /Browser suite: \*\*failed\*\*/);
  assert.match(summary.markdown, /received HTTP 404/);
  assert.match(summary.markdown, /not completed/);
});
