import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverHtmlRoutes, responsiveViewports, selectResponsiveRoutes, selectSmokeRoutes } from './routes.js';

const routeSuffix = ' is present in generated output and loads';
const axeSuffix = ' has no detectable accessibility violations';
const responsivePrefix = 'Responsive usability: ';

function browserTests(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => {
      if (typeof spec.title !== 'string' || !Array.isArray(spec.tests)) throw new Error('invalid spec');
      return spec.tests.map((test) => {
        const attempt = test.results?.at(-1);
        const status = attempt?.status;
        return {
          title: spec.title,
          status: ['passed', 'failed', 'timedOut', 'skipped'].includes(status) ? status : 'incomplete',
          scanned: test.annotations?.some(({ type }) => type === 'axe-scan-complete') ?? false,
          diagnostic: attempt?.error?.message ?? attempt?.errors?.[0]?.message
        };
      });
    }),
    ...browserTests(suite.suites ?? [])
  ]);
}

function coverage(tests, expectedRoutes) {
  const { smoke, axe, responsive } = expectedRoutes ?? {};
  if (![smoke, axe, responsive].every((routes) => routes?.length)) {
    return { lines: [], issues: ['Expected routes are unavailable. Verify the generated site.'] };
  }
  const groups = [
    { label: 'Smoke routes', titles: smoke.map((route) => route + routeSuffix),
      accepts: (title) => title.endsWith(routeSuffix) },
    { label: 'Axe scans', titles: axe.map((route) => route + axeSuffix),
      accepts: (title) => title.endsWith(axeSuffix), needsScan: true },
    { label: 'Responsive', titles: responsive.flatMap((route) =>
        responsiveViewports.map((width) => `${responsivePrefix}${route} at ${width}px`)),
      accepts: (title) => title.startsWith(responsivePrefix) }
  ];
  const lines = [];
  const issues = [];
  for (const { label, titles, accepts, needsScan } of groups) {
    const expected = new Set(titles);
    const observed = new Set();
    const cases = tests.filter(({ title }) => accepts(title));
    for (const { title, scanned } of cases) {
      if (!expected.has(title)) issues.push(`Unexpected case: ${title}.`);
      if (observed.has(title)) issues.push(`Duplicate case: ${title}.`);
      if (needsScan && !scanned) issues.push(`Missing completed axe scan: ${title}.`);
      observed.add(title);
    }
    const missing = titles.filter((title) => !observed.has(title));
    issues.push(...missing.map((title) => `Missing case: ${title}.`));
    const count = (states) => cases.filter(({ status }) => states.includes(status)).length;
    const scans = needsScan ? `${cases.filter(({ scanned }) => scanned).length}/${titles.length} scans completed · ` : '';
    const viewports = label === 'Responsive' ? ` (${responsiveViewports.join(', ')} px)` : '';
    lines.push(`- ${label}${viewports} — ${scans}${count(['passed'])}/${titles.length} passed, ${count(['failed', 'timedOut'])} failed, ${count(['skipped'])} skipped, ${count(['incomplete'])} incomplete, ${missing.length} missing.`);
  }
  return { lines, issues };
}

function stepOutcome(outcome) {
  return ({ success: 'passed', failure: 'failed', skipped: 'skipped', cancelled: 'cancelled' })[outcome] ?? 'unknown';
}

function summarizeRendering({ reportContents, expectedRoutes, sourceSha, buildOutcome, svgOutcome, smokeOutcome }) {
  const lines = [
    '# Site: Rendering Integrity', '',
    `- Checked-out revision: \`${sourceSha ?? 'unavailable'}\`.`,
    `- Production build **${stepOutcome(buildOutcome)}** · SVG assets **${stepOutcome(svgOutcome)}** · Browser suite **${stepOutcome(smokeOutcome)}**.`
  ];
  const format = (failed) => ({ markdown: `${lines.join('\n')}\n`, failed });
  let tests;
  let report;
  try {
    report = JSON.parse(reportContents);
    tests = browserTests(report.suites);
  } catch {
    lines.push(`- Browser evidence **unavailable** (${reportContents === undefined ? 'report missing' : 'report malformed'}). Inspect the browser step.`);
    return format(true);
  }

  const { lines: counts, issues } = coverage(tests, expectedRoutes);
  lines.push(...counts);
  const nonPassing = tests.filter(({ status }) => status !== 'passed');
  const reportError = report.errors?.[0]?.message;
  if (issues.length || nonPassing.length || report.errors?.length) {
    lines.push('', '### Findings');
    for (const issue of issues.slice(0, 8)) lines.push(`- ${issue}`);
    for (const { title, status, diagnostic } of nonPassing.slice(0, 8)) {
      lines.push(`- **${status}** — ${title}`);
      if (typeof diagnostic === 'string') lines.push(`  ${diagnostic.slice(0, 1200).replace(/\n/g, '\n  ')}`);
    }
    if (typeof reportError === 'string') lines.push(`- ${reportError.slice(0, 1200)}`);
    lines.push('- See the browser step for the complete diagnostics.');
  }
  return format([buildOutcome, svgOutcome, smokeOutcome].some((outcome) => outcome !== 'success') ||
    issues.length > 0 || nonPassing.length > 0 || Boolean(report.errors?.length));
}

function main() {
  let reportContents;
  let expectedRoutes;
  if (process.env.RESULTS_FILE) {
    try {
      reportContents = readFileSync(process.env.RESULTS_FILE, 'utf8');
    } catch {
      // A missing report is incomplete evidence.
    }
  }
  try {
    const directory = resolve(process.env.SITE_DIRECTORY ?? '_site');
    expectedRoutes = {
      smoke: selectSmokeRoutes(directory),
      axe: discoverHtmlRoutes(directory),
      responsive: selectResponsiveRoutes(directory)
    };
  } catch {
    // Report available browser findings even if route discovery fails.
  }
  const { markdown, failed } = summarizeRendering({
    reportContents, expectedRoutes, sourceSha: process.env.SOURCE_SHA,
    buildOutcome: process.env.BUILD_OUTCOME, svgOutcome: process.env.SVG_OUTCOME,
    smokeOutcome: process.env.SMOKE_OUTCOME
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

export { summarizeRendering };
