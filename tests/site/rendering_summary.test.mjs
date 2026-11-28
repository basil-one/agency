import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRendering } from '../../scripts/site/summarize_rendering.mjs';

const successfulReport = {
  stats: { duration: 1200 },
  suites: [{
    specs: [
      {
        title: '/ is present in generated output and loads',
        tests: [{ results: [{ status: 'passed', duration: 100 }] }]
      },
      {
        title: '/ has no detectable accessibility violations',
        tests: [{
          annotations: [{ type: 'axe-scan-complete' }],
          results: [{ status: 'passed', duration: 200 }]
        }]
      },
      {
        title: 'Responsive usability: / at 320px',
        tests: [{
          annotations: [
            { type: 'responsive-hit-area', description: 'navigation:main nav:44.0x44.0' },
            { type: 'responsive-hit-area', description: 'footer:origin:48.0x48.0' }
          ],
          results: [{ status: 'passed', duration: 300 }]
        }]
      }
    ]
  }]
};

test('summary reports route, accessibility, responsive, and hit-area evidence', () => {
  const summary = summarizeRendering({
    buildOutcome: 'success',
    smokeOutcome: 'success',
    report: successfulReport
  });

  assert.equal(summary.failed, false);
  assert.match(summary.markdown, /Smoke routes selected.*1/);
  assert.match(summary.markdown, /Full-site axe accessibility.*1\/1 scans completed/);
  assert.match(summary.markdown, /Responsive usability:.*320px/);
  assert.match(summary.markdown, /navigation.*44×44px/);
  assert.match(summary.markdown, /footer.*48×48px/);
});

test('missing report after a successful browser step fails coverage without claiming zero results', () => {
  const summary = summarizeRendering({
    buildOutcome: 'success',
    smokeOutcome: 'success',
    reportUnavailableReason: 'Playwright JSON report was unreadable or malformed'
  });

  assert.equal(summary.failed, true);
  assert.match(summary.markdown, /not available/);
  assert.match(summary.markdown, /unavailable, not zero/);
  assert.match(summary.markdown, /failed verification/);

  const malformed = summarizeRendering({
    buildOutcome: 'success',
    smokeOutcome: 'success',
    report: { suites: [null] }
  });
  assert.equal(malformed.failed, true);
  assert.match(malformed.markdown, /unreadable or malformed/);
});

test('missing accessibility or malformed responsive cases fail coverage verification', () => {
  const report = structuredClone(successfulReport);
  report.suites[0].specs[1].tests[0].annotations = [];
  report.suites[0].specs[2].title = 'Responsive usability: /';
  const summary = summarizeRendering({
    buildOutcome: 'success',
    smokeOutcome: 'success',
    report
  });

  assert.equal(summary.failed, true);
  assert.match(summary.markdown, /Coverage verification: \*\*failed\*\*/);
  assert.match(summary.markdown, /0\/1 scans completed/);
});

test('failed and incomplete browser results retain the original failure details', () => {
  const report = structuredClone(successfulReport);
  report.suites[0].specs[0].tests[0].results[0] = {
    status: 'failed',
    error: { message: 'Expected /origin/ to return HTTP 200; received HTTP 404' }
  };
  report.suites[0].specs[2].tests[0].results[0] = { status: 'interrupted' };
  const summary = summarizeRendering({
    buildOutcome: 'success',
    smokeOutcome: 'failure',
    report
  });

  assert.equal(summary.failed, false);
  assert.match(summary.markdown, /Browser suite.*failed/);
  assert.match(summary.markdown, /received HTTP 404/);
  assert.match(summary.markdown, /interrupted/);
});
