import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { discoverHtmlRoutes, responsiveViewports, selectResponsiveRoutes, selectSmokeRoutes } from '../../scripts/site/routes.js';
import { summarizeRendering } from '../../scripts/site/summarize_rendering.mjs';

const routes = {
  smoke: ['/', '/reflections/'],
  axe: ['/', '/reflections/', '/plain.html'],
  responsive: ['/', '/consulting/']
};
const sourceSha = 'a'.repeat(40);
const smoke = (route) => `${route} is present in generated output and loads`;
const axe = (route) => `${route} has no detectable accessibility violations`;
const responsive = (route, width) => `Responsive usability: ${route} at ${width}px`;
const spec = (title, status = 'passed', scanned = false, diagnostic) => ({
  title,
  tests: [{
    annotations: scanned ? [{ type: 'axe-scan-complete' }] : [],
    results: status === 'no result' ? [] : [{ status, error: diagnostic && { message: diagnostic } }]
  }]
});

function expectedSpecs({ smoke: smokeRoutes, axe: axeRoutes, responsive: responsiveRoutes }) {
  return [
    ...smokeRoutes.map((route) => spec(smoke(route))),
    ...axeRoutes.map((route) => spec(axe(route), 'passed', true)),
    ...responsiveRoutes.flatMap((route) =>
      responsiveViewports.map((width) => spec(responsive(route, width))))
  ];
}

const report = (specs) => JSON.stringify({ suites: [{ suites: [{ specs }] }] });
const summarize = (specs, overrides = {}) => summarizeRendering({
  reportContents: report(specs), expectedRoutes: routes,
  sourceSha, buildOutcome: 'success', svgOutcome: 'success', smokeOutcome: 'success', ...overrides
});

test('reports the complete generated-route, axe and viewport evidence', () => {
  const result = summarize(expectedSpecs(routes));
  assert.equal(result.failed, false);
  assert.match(result.markdown, new RegExp(sourceSha));
  assert.match(result.markdown, /Smoke routes .*2\/2 passed/);
  assert.match(result.markdown, /SVG assets \*\*passed\*\*/);
  assert.match(result.markdown, /3\/3 scans completed/);
  assert.match(result.markdown, /320, 768, 1280 px.*6\/6 passed/);
});

test('missing, duplicate, unexpected and unscanned cases fail closed', () => {
  const specs = expectedSpecs(routes).filter(({ title }) => title !== responsive('/consulting/', 768));
  specs.push(spec(smoke('/')), spec(responsive('/other/', 320)));
  specs.find((item) => item.title === axe('/')).tests[0].annotations = [];
  const result = summarize(specs);
  assert.equal(result.failed, true);
  assert.match(result.markdown, /Duplicate case/);
  assert.match(result.markdown, /Missing case: Responsive usability: \/consulting\/ at 768px/);
  assert.match(result.markdown, /Unexpected case.*other/);
  assert.match(result.markdown, /Missing completed axe scan/);
});

test('reports failures and real diagnostics alongside skipped and unfinished cases', () => {
  const specs = expectedSpecs(routes);
  specs[0] = spec(smoke('/'), 'failed', false, 'Expected HTTP 200; received HTTP 404');
  specs[specs.findIndex(({ title }) => title === responsive('/', 320))] = spec(responsive('/', 320), 'skipped');
  specs[specs.findIndex(({ title }) => title === responsive('/', 768))] = spec(responsive('/', 768), 'interrupted');
  const result = summarize(specs, { buildOutcome: 'failure', smokeOutcome: 'cancelled' });
  assert.equal(result.failed, true);
  assert.match(result.markdown, /Browser suite \*\*cancelled\*\*/);
  assert.match(result.markdown, /Expected HTTP 200; received HTTP 404/);
  assert.match(result.markdown, /1 skipped, 1 incomplete/);
});

test('a green browser step cannot hide partial coverage, report-level errors or a failed SVG check', () => {
  const partial = summarize([spec(smoke('/')), spec(axe('/'), 'passed', true), spec(responsive('/', 320))]);
  assert.equal(partial.failed, true);
  assert.match(partial.markdown, /Missing case: \/plain\.html has no detectable accessibility violations/);
  assert.match(partial.markdown, /Missing case: Responsive usability: \/ at 768px/);

  const specs = expectedSpecs(routes);
  const reportContents = JSON.stringify({ suites: [{ specs }], errors: [{ message: 'Browser worker could not finish' }] });
  const reportError = summarize(specs, { reportContents });
  assert.equal(reportError.failed, true);
  assert.match(reportError.markdown, /Browser worker could not finish/);
  const svgError = summarize(specs, { svgOutcome: 'failure' });
  assert.equal(svgError.failed, true);
  assert.match(svgError.markdown, /SVG assets \*\*failed\*\*/);
});

test('unavailable, empty and malformed reports cannot pass a green browser step', () => {
  for (const reportContents of [undefined, '{', JSON.stringify({ suites: [] })]) {
    assert.equal(summarize([], { reportContents }).failed, true);
  }
  const malformed = summarize([], { reportContents: JSON.stringify({ suites: [{ specs: 'bad' }] }) });
  assert.match(malformed.markdown, /report malformed/);
  const noRoutes = summarize(expectedSpecs(routes), { expectedRoutes: undefined });
  assert.equal(noRoutes.failed, true);
  assert.match(noRoutes.markdown, /Expected routes are unavailable/);
});

test('the CLI writes evidence and rejects missing coverage even after Playwright success', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agency-rendering-test-'));
  try {
    const site = join(directory, '_site');
    mkdirSync(join(site, 'reflections', 'current'), { recursive: true });
    writeFileSync(join(site, 'index.html'), '');
    writeFileSync(join(site, 'plain.html'), '');
    writeFileSync(join(site, 'reflections', 'current', 'index.html'),
      '<section id="reflection"><time datetime="2026-01-02"></time></section>');
    const generated = {
      smoke: selectSmokeRoutes(site),
      axe: discoverHtmlRoutes(site),
      responsive: selectResponsiveRoutes(site)
    };
    const resultsFile = join(directory, 'playwright.json');
    const summaryFile = join(directory, 'summary.md');
    const run = (specs) => {
      writeFileSync(resultsFile, report(specs));
      return spawnSync(process.execPath, [resolve('scripts/site/summarize_rendering.mjs')], {
        encoding: 'utf8',
        env: {
          ...process.env, RESULTS_FILE: resultsFile, GITHUB_STEP_SUMMARY: summaryFile,
          SITE_DIRECTORY: site, SOURCE_SHA: sourceSha, BUILD_OUTCOME: 'success',
          SVG_OUTCOME: 'success', SMOKE_OUTCOME: 'success'
        }
      });
    };
    assert.equal(run(expectedSpecs(generated)).status, 0);
    assert.equal(run([spec(smoke('/'))]).status, 1);
    assert.match(readFileSync(summaryFile, 'utf8'), /Missing case/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
