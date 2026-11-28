import { appendFileSync, readFileSync } from 'node:fs';

function outcome(value) {
  if (value === 'success') return 'passed';
  if (value === 'failure') return 'failed';
  return 'not completed';
}

function collectTests(suites, tests) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const result = test.results?.at(-1);
        tests.push({
          title: spec.title,
          status: result?.status ?? 'not completed',
          duration: result?.duration,
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
  return {
    tests,
    duration: report.stats?.duration ?? report.duration,
    reason: tests.length ? undefined : 'Playwright JSON report contained no test cases'
  };
}

function statusCounts(tests) {
  return {
    passed: tests.filter((test) => test.status === 'passed').length,
    failed: tests.filter((test) => !['passed', 'skipped', 'not completed'].includes(test.status)).length,
    skipped: tests.filter((test) => test.status === 'skipped').length,
    incomplete: tests.filter((test) => test.status === 'not completed').length
  };
}

function smallestHitArea(hitAreas, region) {
  return hitAreas
    .filter((area) => area.startsWith(`${region}:`))
    .map((area) => {
      const match = area.match(/^([^:]+):(.+):([\d.]+)x([\d.]+)$/);
      return match
        ? { label: match[2], width: Number(match[3]), height: Number(match[4]) }
        : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => left.width * left.height - right.width * right.height)[0];
}

function summarizeRendering({ buildOutcome, smokeOutcome, report, reportUnavailableReason }) {
  const parsedReport = report !== undefined
    ? readTestResults(report)
    : {
        tests: [],
        reason: reportUnavailableReason ??
          'Playwright JSON report was not produced; the build or browser test step may not have completed'
      };
  const { tests, duration: playwrightDuration } = parsedReport;
  reportUnavailableReason = parsedReport.reason ?? reportUnavailableReason;

  const lines = [
    '# Site: Rendering Integrity',
    '',
    `- Production build (GitHub step \`Build site\`): **${outcome(buildOutcome)}**.`,
    `- Browser suite (GitHub step \`Run rendered-site smoke tests\`): **${outcome(smokeOutcome)}**.`
  ];
  let failed = false;

  if (reportUnavailableReason) {
    lines.push(
      `- Smoke route checks: **not available** (${reportUnavailableReason})`,
      `- Responsive usability: **not available** (${reportUnavailableReason}); route counts, viewport counts, and duration are unavailable, not zero.`,
      `- Full-site axe results: **not available** (${reportUnavailableReason})`,
      '- Route counts and Playwright duration are unavailable, not zero.'
    );
    if (smokeOutcome === 'success') {
      lines.push('- Coverage results: **failed verification**; the browser step succeeded but its Playwright report has no usable test cases.');
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
    const browserCounts = statusCounts(tests);
    const scansCompleted = axeTests.filter((test) => test.axeScanned).length;
    const responsiveDuration = responsiveTests.reduce(
      (total, test) => total + (test.duration ?? 0),
      0
    );
    const responsiveDurationCount = responsiveTests.filter(
      (test) => Number.isFinite(test.duration)
    ).length;
    const hitAreas = responsiveTests.flatMap((test) =>
      test.annotations
        .filter((annotation) => annotation.type === 'responsive-hit-area')
        .map((annotation) => annotation.description)
    );
    const navigationTarget = smallestHitArea(hitAreas, 'navigation');
    const footerTarget = smallestHitArea(hitAreas, 'footer');
    const noAxeViolations = axeTests.length > 0 &&
      scansCompleted === axeTests.length &&
      axeCounts.passed === axeTests.length;
    const responsiveSummary = responsiveTests.length === 0
      ? '- Responsive usability: **not available** (Playwright report contains no responsive cases; the browser step may not have reached that test file); route counts, viewport counts, and duration are unavailable, not zero.'
      : `- Responsive usability: **${responsiveCounts.passed}/${responsiveTests.length} passed, ${responsiveCounts.failed} failed, ${responsiveCounts.skipped} skipped, ${responsiveCounts.incomplete} not completed** across ${responsiveRoutes.length ? responsiveRoutes.map((route) => `\`${route}\``).join(', ') : 'unavailable routes'} at ${responsiveViewports.length ? responsiveViewports.map((width) => `${width}px`).join(', ') : 'unavailable viewports'}; checked document/main overflow, control visibility/bounds, and navigation/footer operability; sum of individual test durations: **${responsiveDurationCount ? `${(responsiveDuration / 1000).toFixed(1)}s` : 'unavailable'}**.`;

    lines.push(
      `- Smoke routes selected (from Playwright route test cases): **${routeTests.length}**; route checks **${routeCounts.passed}/${routeTests.length} passed, ${routeCounts.failed} failed, ${routeCounts.skipped} skipped, ${routeCounts.incomplete} not completed** (reflection dates use Jekyll-rendered \`<time datetime>\`).`,
      responsiveSummary,
      `- Smallest measured link targets (Playwright touch emulation, CSS pixels; measurement only, not a pass/fail threshold): navigation **${navigationTarget ? `${navigationTarget.width}×${navigationTarget.height}px (${navigationTarget.label})` : 'unavailable'}**; footer **${footerTarget ? `${footerTarget.width}×${footerTarget.height}px (${footerTarget.label})` : 'unavailable'}**.`,
      `- Full-site axe accessibility (generated HTML route test cases from \`_site\`): **${scansCompleted}/${axeTests.length} scans completed; ${axeCounts.passed} passed, ${axeCounts.failed} failed, ${axeCounts.skipped} skipped, ${axeCounts.incomplete} not completed${noAxeViolations ? '; no violations detected' : ''}**.`,
      `- Browser tests overall: **${browserCounts.passed} passed, ${browserCounts.failed} failed, ${browserCounts.skipped} skipped, ${browserCounts.incomplete} not completed** (${tests.length} total).`,
      `- Playwright duration (from JSON report): **${Number.isFinite(playwrightDuration) ? `${(playwrightDuration / 1000).toFixed(1)}s` : 'not available in report'}**.`,
      '- Sources: smoke and axe route cases come from generated `_site` HTML discovery; responsive routes/viewports come from the test matrix and latest reflection discovery; counts, statuses, target measurements, and durations come from Playwright JSON; build and browser outcomes come from GitHub steps.'
    );

    if (
      routeTests.length === 0 ||
      axeTests.length === 0 ||
      scansCompleted !== axeTests.length ||
      responsiveTests.length === 0 ||
      responsiveCases.length !== responsiveTests.length
    ) {
      lines.push('- Coverage verification: **failed**; the report must contain smoke and responsive cases, every responsive case must identify its route and viewport, and every generated HTML route case must record a completed axe scan.');
      failed = true;
    }
  }

  const failedTests = tests.filter((test) => test.status !== 'passed');
  if (failedTests.length > 0) {
    lines.push('', '### Non-passing browser tests');
    for (const test of failedTests) {
      lines.push(`- **${test.status}:** \`${test.title}\`.`);
      if (test.diagnostic) {
        lines.push(...test.diagnostic.split('\n').map((line) => `  ${line}`));
      }
    }
    lines.push('- See the exact GitHub step **Run rendered-site smoke tests** for full Playwright/axe diagnostics and stack traces.');
  } else if (reportUnavailableReason) {
    lines.push('- Inspect the exact GitHub step **Run rendered-site smoke tests** for Playwright output and report-generation errors.');
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
