import { appendFileSync, readFileSync } from 'node:fs';

function outcome(value) {
  if (value === 'success') return 'passed';
  if (value === 'failure') return 'failed';
  if (value === 'skipped') return 'skipped';
  if (value === 'cancelled') return 'not completed';
  return 'unknown';
}

function collectTests(suites, tests) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const result = test.results?.at(-1);
        const status = result?.status;
        tests.push({
          title: spec.title,
          status: ['passed', 'failed', 'timedOut', 'skipped'].includes(status)
            ? status
            : 'not completed',
          annotations: test.annotations ?? [],
          axeScanned: test.annotations?.some(
            (annotation) => annotation.type === 'axe-scan-complete'
          ) ?? false,
          diagnostic: [...new Set([
            result?.error?.message,
            ...(result?.errors ?? []).map((error) => error.message)
          ].filter(Boolean))].join('\n')
        });
      }
    }
    collectTests(suite.suites ?? [], tests);
  }
}

function readTestResults(report) {
  if (!Array.isArray(report?.suites)) {
    return { tests: [], reason: 'Playwright JSON report has no suite list' };
  }
  const tests = [];
  try {
    collectTests(report.suites, tests);
  } catch {
    return { tests: [], reason: 'Playwright JSON report was unreadable or malformed' };
  }
  return { tests };
}

function statusCounts(tests) {
  return {
    passed: tests.filter((test) => test.status === 'passed').length,
    failed: tests.filter((test) => ['failed', 'timedOut'].includes(test.status)).length,
    skipped: tests.filter((test) => test.status === 'skipped').length,
    incomplete: tests.filter((test) => test.status === 'not completed').length
  };
}

function summarizeRendering({
  buildOutcome,
  svgOutcome,
  smokeOutcome,
  report,
  reportUnavailableReason
}) {
  const parsedReport = report !== undefined
    ? readTestResults(report)
    : {
        tests: [],
        reason: reportUnavailableReason ?? 'Playwright JSON report was not produced'
      };
  const { tests } = parsedReport;
  reportUnavailableReason = parsedReport.reason ?? reportUnavailableReason;

  const lines = [
    '# Site: Rendering Integrity',
    '',
    `- Production build: **${outcome(buildOutcome)}**.`,
    `- SVG assets: **${outcome(svgOutcome)}**.`,
    `- Browser suite: **${outcome(smokeOutcome)}**.`
  ];
  let failed = [buildOutcome, svgOutcome, smokeOutcome].some((value) => value !== 'success');

  if (reportUnavailableReason) {
    lines.push(`- Browser evidence: **unavailable** (${reportUnavailableReason}).`);
    if (smokeOutcome === 'success') {
      lines.push('- Coverage verification: **incomplete**; the browser step passed without a usable report.');
      failed = true;
    }
  } else {
    const routeTests = tests.filter(
      (test) => test.title.endsWith('is present in generated output and loads')
    );
    const axeTests = tests.filter(
      (test) => test.title.endsWith('has no detectable accessibility violations')
    );
    const responsiveTests = tests.filter(
      (test) => test.title.startsWith('Responsive usability: ')
    );
    const responsiveCases = responsiveTests.map((test) =>
      test.title.match(/^Responsive usability: (.+) at (\d+)px$/)
    ).filter(Boolean);
    const responsiveRoutes = [...new Set(responsiveCases.map((match) => match[1]))].sort();
    const responsiveViewports = [...new Set(responsiveCases.map((match) => Number(match[2])))]
      .sort((a, b) => a - b);
    const routeCounts = statusCounts(routeTests);
    const axeCounts = statusCounts(axeTests);
    const responsiveCounts = statusCounts(responsiveTests);
    const scansCompleted = axeTests.filter((test) => test.axeScanned).length;
    lines.push(
      `- Smoke routes: **${routeCounts.passed}/${routeTests.length} passed, ${routeCounts.failed} failed, ${routeCounts.skipped} skipped, ${routeCounts.incomplete} incomplete**.`,
      `- Axe scans: **${scansCompleted}/${axeTests.length} completed; ${axeCounts.passed} passed, ${axeCounts.failed} failed, ${axeCounts.skipped} skipped, ${axeCounts.incomplete} incomplete**.`,
      `- Responsive checks: **${responsiveCounts.passed}/${responsiveTests.length} passed, ${responsiveCounts.failed} failed, ${responsiveCounts.skipped} skipped, ${responsiveCounts.incomplete} incomplete** across ${responsiveRoutes.length} route${responsiveRoutes.length === 1 ? '' : 's'} and ${responsiveViewports.length} viewport${responsiveViewports.length === 1 ? '' : 's'} (${responsiveViewports.length ? responsiveViewports.map((width) => `${width}px`).join(', ') : 'unavailable'}).`
    );

    const coverageComplete = routeTests.length > 0 &&
      axeTests.length > 0 &&
      scansCompleted === axeTests.length &&
      axeCounts.skipped === 0 &&
      axeCounts.incomplete === 0 &&
      responsiveTests.length > 0 &&
      responsiveCases.length === responsiveTests.length &&
      responsiveCounts.skipped === 0 &&
      responsiveCounts.incomplete === 0 &&
      routeCounts.skipped === 0 &&
      routeCounts.incomplete === 0;
    const failedTests = tests.filter((test) => ['failed', 'timedOut'].includes(test.status));
    if (failedTests.length) failed = true;
    if (!coverageComplete) {
      lines.push('- Coverage verification: **incomplete**; route, accessibility, responsive cases, and completed axe scans are required.');
      failed = true;
    } else {
      lines.push('- Coverage verification: **complete**.');
    }
  }

  const nonPassingTests = tests.filter((test) => test.status !== 'passed');
  if (nonPassingTests.length > 0) {
    lines.push('', '### Browser findings');
    for (const test of nonPassingTests) {
      lines.push(`- **${test.status}:** \`${test.title}\`.`);
      if (test.diagnostic) {
        lines.push(...test.diagnostic.split('\n').map((line) => `  ${line}`));
      }
    }
  }

  return { markdown: `${lines.join('\n')}\n`, failed };
}

function main() {
  let report;
  let reportUnavailableReason;
  try {
    report = JSON.parse(readFileSync(process.env.RESULTS_FILE, 'utf8'));
  } catch {
    reportUnavailableReason = 'Playwright JSON report was unreadable or malformed';
  }
  const summary = summarizeRendering({
    buildOutcome: process.env.BUILD_OUTCOME,
    svgOutcome: process.env.SVG_OUTCOME,
    smokeOutcome: process.env.SMOKE_OUTCOME,
    report,
    reportUnavailableReason
  });
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.markdown);
  if (summary.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}

export { summarizeRendering };
