import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const metrics = [
  ['first-contentful-paint', 'FCP'],
  ['largest-contentful-paint', 'LCP'],
  ['speed-index', 'SI'],
  ['total-blocking-time', 'TBT'],
  ['cumulative-layout-shift', 'CLS']
];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function trimSentenceEnd(value) {
  return value?.replace(/[.!?]+$/, '') ?? '';
}

function routeLabel(route) {
  if (route === '/') return 'Home';
  if (route === '/know-your-patterns/') return 'Know Your Patterns';
  if (route === '/reflections/') return 'Reflections';
  return 'Latest reflection';
}

function formatValue(metric, value) {
  if (!Number.isFinite(value)) return 'unavailable';
  if (metric === 'cumulative-layout-shift') return value.toFixed(3);
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function formatDelta(metric, current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return '—';
  const difference = current - baseline;
  const sign = difference > 0 ? '+' : '';
  const absolute = metric === 'cumulative-layout-shift'
    ? `${sign}${difference.toFixed(3)}`
    : Math.abs(difference) >= 1_000
      ? `${sign}${(difference / 1_000).toFixed(2)} s`
      : `${sign}${Math.round(difference)} ms`;
  if (baseline === 0) return `${absolute} (percentage n/a)`;
  const percent = (difference / Math.abs(baseline)) * 100;
  return `${absolute} (${percent > 0 ? '+' : ''}${percent.toFixed(1)}%)`;
}

function statusOf(inputs, key) {
  return inputs.steps?.[key] || 'not run';
}

function diagnosticStatus(inputs) {
  const status = statusOf(inputs, 'diagnostic');
  return status === 'success' ? 'passed' : status;
}

function failedStepNames(inputs) {
  const names = {
    tests: 'performance tests',
    classify: 'changed-file classification',
    ruby: 'Ruby setup',
    node: 'Node setup',
    build: 'site build',
    dependencies: 'browser test dependency installation',
    chromium: 'Chromium installation',
    history: 'daily-main history lookup',
    measure: 'Lighthouse measurement',
    comparison: 'baseline comparison',
    confirmation: 'required performance confirmation',
    evaluation: 'performance safeguard evaluation',
    diagnostic: 'missing-route diagnostic',
    reports: 'raw report upload',
    confirmation_reports: 'confirmation report upload',
    summary: 'summary artifact upload'
  };
  return Object.entries(names)
    .filter(([key]) => statusOf(inputs, key) === 'failure')
    .map(([, name]) => name);
}

function baselineLines(comparison) {
  if (!comparison) {
    return [
      '- **Fixed reference:** unavailable; comparison did not produce a readable result.',
      '- **Rolling daily-main baseline:** unavailable; comparison did not produce a readable result.',
      '- No comparison/deltas available yet.'
    ];
  }
  const fixed = comparison.fixedReference;
  const history = comparison.history ?? {};
  const fixedStatus = fixed?.available
    ? `[available](${fixed.runUrl})`
    : fixed?.reason?.includes('different measurement context')
      ? 'not comparable; measurement context differs'
      : fixed?.reason?.includes('pr-controlled context')
        ? 'pending controlled reference review; absolute budgets remain active'
        : fixed?.reason?.includes('different tool')
          ? 'not comparable; tool or runner environment differs'
      : 'pending confirmation and review of a complete successful `main` measurement';
  let rollingStatus;
  if (history.status === 'available' && history.availableDailySamples >= history.requiredDailySamples) {
    rollingStatus = `${history.availableDailySamples}/${history.requiredDailySamples} compatible successful daily-main runs available`;
  } else if (history.status === 'unavailable') {
    rollingStatus = `unavailable${history.reason ? ` (${trimSentenceEnd(history.reason)})` : ''}`;
  } else {
    rollingStatus = `collecting (${history.availableDailySamples ?? 0}/${history.requiredDailySamples ?? 28})`;
  }
  const lines = [
    `- **Fixed reference:** ${fixedStatus}.`,
    `- **Rolling daily-main baseline:** ${rollingStatus}.`
  ];
  if (comparison.deltasAvailable) {
    lines.push('- Rolling deltas are informational; fixed-reference LCP deterioration and absolute mobile/desktop budgets are evaluated separately.');
  } else if (history.status === 'unavailable') {
    lines.push('- No comparison/deltas available; inspect the history lookup details below and rerun when access is restored.');
  } else {
    lines.push('- No comparison/deltas available yet; absolute budgets remain active while the fixed-reference LCP gate is pending.');
  }
  return lines;
}

function representativeTable(summary) {
  const results = new Map((summary?.results ?? []).map((result) => [
    `${result.route}\u0000${result.formFactor}`,
    result
  ]));
  const routes = [...new Set((summary?.results ?? []).map((result) => result.route))];
  if (!routes.length) return [];
  return [
    '',
    '| Page | Mobile LCP | Desktop LCP | Mobile TBT |',
    '| --- | ---: | ---: | ---: |',
    ...routes.map((route) => {
      const mobile = results.get(`${route}\u0000mobile`);
      const desktop = results.get(`${route}\u0000desktop`);
      return `| ${routeLabel(route)} | ${formatValue('largest-contentful-paint', mobile?.values?.['largest-contentful-paint'])} | ${formatValue('largest-contentful-paint', desktop?.values?.['largest-contentful-paint'])} | ${formatValue('total-blocking-time', mobile?.values?.['total-blocking-time'])} |`;
    })
  ];
}

function deltaTable(comparison) {
  if (!comparison?.deltasAvailable || !comparison.comparisons?.length) return [];
  const rows = comparison.comparisons.map((result) => {
    const fixed = result.fixedReference;
    const rolling = result.rollingBaseline;
    const lcp = result.values?.['largest-contentful-paint'];
    const tbt = result.values?.['total-blocking-time'];
    return `| ${routeLabel(result.route)} | ${result.formFactor} | ${formatDelta('largest-contentful-paint', lcp, fixed?.['largest-contentful-paint'])} | ${formatDelta('largest-contentful-paint', lcp, rolling?.['largest-contentful-paint'])} | ${formatDelta('total-blocking-time', tbt, fixed?.['total-blocking-time'])} | ${formatDelta('total-blocking-time', tbt, rolling?.['total-blocking-time'])} |`;
  });
  return [
    '',
    '| Page | Profile | Fixed LCP Δ | Rolling LCP Δ | Fixed TBT Δ | Rolling TBT Δ |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...rows
  ];
}

function performanceSafeguardLines(policy) {
  if (!policy) {
    return ['- **Not established:** safeguard evidence is unavailable; no performance pass is inferred.'];
  }
  const lines = [
    policy.status === 'passed'
      ? '- **Passed:** no confirmed absolute-budget or substantial compatible-reference LCP violation.'
      : policy.status === 'failed'
        ? '- **Failed:** one or more performance violations were confirmed.'
        : policy.status === 'incomplete'
          ? `- **Not passed:** required confirmation is incomplete (${policy.confirmationReason ?? 'reason unavailable'}).`
          : '- **Pending:** initial route/profile violations require confirmation.'
  ];
  for (const violation of policy.confirmations ?? policy.initialViolations ?? []) {
    const profile = `\`${violation.route}\` / ${violation.formFactor}`;
    const initial = formatValue(violation.metric, violation.value);
    const confirmed = Number.isFinite(violation.confirmationValue)
      ? `; confirmation ${formatValue(violation.metric, violation.confirmationValue)}`
      : '';
    const result = violation.result ?? 'confirmation required';
    if (violation.criterion === 'absolute') {
      lines.push(`- ${profile}: ${violation.metric} ${initial} vs ${formatValue(violation.metric, violation.limit)} absolute limit${confirmed}; ${result}.`);
    } else {
      lines.push(`- ${profile}: LCP ${initial} vs fixed reference ${formatValue(violation.metric, violation.referenceValue)}; delta ${formatValue(violation.metric, violation.delta)} (+${violation.deltaPercentage.toFixed(1)}%); both >${formatValue(violation.metric, violation.minimumMilliseconds)} and >${violation.minimumPercentage}% required${confirmed}; ${result}.`);
    }
  }
  if (policy.referenceReason) {
    const reason = policy.referenceReason.replace(
      /;\s*absolute budgets remain (?:active|enforced)\.?$/i,
      ''
    );
    lines.push(`- Relative deterioration gate unavailable: ${reason}; absolute budgets remain enforced.`);
  }
  if (['failed', 'incomplete'].includes(policy.status)) {
    lines.push('- Next step: review the route/profile reports, correct the confirmed regression, or restore complete confirmation evidence.');
  } else if (policy.status === 'passed' && policy.confirmations?.length) {
    lines.push('- Initial variation was not confirmed; no safeguard failure was raised.');
  }
  return lines;
}

function technicalDetails(summary, comparison, inputs) {
  const lines = [
    '<details>',
    '<summary>Technical details</summary>',
    '',
    '### Reported route/profile metrics',
    ''
  ];
  if (summary?.results?.length) {
    if (summary.complete !== true) lines.push('Partial measurement data only; the full route/profile set was not completed.', '');
    lines.push(
      '| Page | Profile | FCP | LCP | Speed Index | TBT | CLS |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: |'
    );
    for (const result of summary.results) {
      lines.push(`| ${routeLabel(result.route)} | ${result.formFactor} | ${formatValue('first-contentful-paint', result.values?.['first-contentful-paint'])} | ${formatValue('largest-contentful-paint', result.values?.['largest-contentful-paint'])} | ${formatValue('speed-index', result.values?.['speed-index'])} | ${formatValue('total-blocking-time', result.values?.['total-blocking-time'])} | ${formatValue('cumulative-layout-shift', result.values?.['cumulative-layout-shift'])} |`);
    }
    const latestReflection = summary.results.find(
      (result) => routeLabel(result.route) === 'Latest reflection'
    );
    if (latestReflection) {
      lines.push('', `- Latest reflection route: \`${latestReflection.route}\` (selected dynamically).`);
    }
  } else {
    lines.push('No complete route/profile metric table is available.');
  }
  if (summary) {
    const env = summary.environment ?? {};
    const conditions = summary.conditions ?? {};
    lines.push(
      '',
      '### Environment and conditions',
      '',
      `- Lighthouse ${env.lighthouse ?? 'unknown'}; ${env.chrome ?? 'Chrome version unknown'}; Node ${env.node ?? 'unknown'}; ${env.ruby ?? 'Ruby version unknown'}; ${env.jekyll ?? 'Jekyll version unknown'}; runner ${env.runner ?? 'unknown'}.`,
      `- ${conditions.site ?? 'Site build conditions unavailable'}; context: ${conditions.measurementContext ?? 'unknown'}; mobile: ${conditions.mobile ?? 'unknown'}; desktop: ${conditions.desktop ?? 'unknown'}; external analytics scripts blocked: ${conditions.externalAnalyticsScriptsBlocked === true ? 'yes' : conditions.externalAnalyticsScriptsBlocked === false ? 'no' : 'unknown'}; Analytics URL patterns blocked: ${(conditions.analyticsBlockedUrlPatterns ?? []).join(', ') || 'unknown'}; Analytics collection blocked: ${conditions.analyticsCollectionBlocked === true ? 'yes' : 'unknown'}; lab-only: ${conditions.labOnly === true ? 'yes' : 'unknown'}.`,
      `- Captured: ${summary.capturedAt ?? 'unknown'}; source SHA: \`${summary.source?.sha ?? 'unknown'}\`; source run: ${summary.source?.runUrl ?? 'not available'}.`,
      `- Timing: ${Number.isFinite(summary.timing?.measurementSeconds) ? `${summary.timing.measurementSeconds.toFixed(1)} seconds for measurement` : 'measurement duration unavailable'}; total Actions duration is shown in the run overview.`
    );
    if (summary.firstPartyAssets?.length) {
      lines.push('', '### First-party assets', '');
      for (const asset of summary.firstPartyAssets) {
        lines.push(`- \`${asset.path}\` — ${Number.isFinite(asset.bytes) ? `${(asset.bytes / 1024).toFixed(1)} KiB` : 'size unavailable'}.`);
      }
    } else {
      lines.push('', '- First-party asset inventory is unavailable.');
    }
    lines.push('', '### External scripts', '');
    if (summary.externalScripts?.length) {
      for (const script of summary.externalScripts) {
        const transfer = Number.isFinite(script.medianTransferBytes)
          ? `; median transfer ${(script.medianTransferBytes / 1024).toFixed(1)} KiB`
          : '';
        lines.push(`- \`${script.source}\` — ${script.successful}/${script.samples} requests succeeded${transfer}.`);
      }
    } else {
      lines.push('- No external scripts were observed in the generated pages.');
    }
  }
  if (comparison) {
    lines.push(
      '',
      '### Baseline provenance and diagnostics',
      '',
      `- Fixed reference: ${comparison.fixedReference?.available ? comparison.fixedReference.runUrl : trimSentenceEnd(comparison.fixedReference?.reason) || 'unavailable'}.`,
      `- Rolling history: ${comparison.history?.status ?? 'unavailable'}; ${comparison.history?.availableDailySamples ?? 0}/${comparison.history?.requiredDailySamples ?? 28} compatible summaries; ${trimSentenceEnd(comparison.history?.reason) || 'no additional history diagnostic'}.`
    );
    for (const item of (comparison.history?.skipped ?? []).slice(0, 5)) {
      lines.push(`- History lookup detail: ${item}.`);
    }
    lines.push('', '- Evidence sources: generated `_site` pages, Lighthouse JSON for measurements/network observations/tool versions, and the Actions workflow run for step outcomes and diagnostic status.');
    for (const source of (comparison.history?.provenance ?? []).slice(0, 28)) {
      lines.push(`- Rolling source: [run ${source.runId}](${source.runUrl}) — ${source.capturedAt}, commit \`${source.sha}\`.`);
    }
    if (comparison.conditions?.length) {
      lines.push(`- Conditions differing from available baseline(s): ${comparison.conditions.join('; ')}.`);
    }
  }
  const diagnostic = diagnosticStatus(inputs);
  lines.push('', `- Controlled missing-route diagnostic: ${diagnostic}.`);
  const failures = failedStepNames(inputs);
  if (failures.length) lines.push(`- Failed operation(s): ${failures.join(', ')}.`);
  lines.push('', '</details>');
  return lines;
}

function renderPerformanceSummary(inputs) {
  const summary = inputs.summary;
  const comparison = inputs.comparison;
  const skipped = inputs.skip?.measurement === true;
  const measure = statusOf(inputs, 'measure');
  const job = inputs.jobStatus ?? 'unknown';
  const failures = failedStepNames(inputs);
  const lines = [
    '# Site: Performance Integrity',
    ''
  ];
  if (skipped) {
    lines.push(
      '**Lighthouse measurement intentionally skipped**',
      '',
      '- Informational lab measurement; this is not a performance pass, field Core Web Vitals result, or regression gate.',
      `- Selected measurement context: **${inputs.measurementContext ?? 'unknown'}**; Lighthouse was not run.`,
      `- Reason: ${inputs.skip.reason ?? 'the classifier found only changes outside generated-site performance inputs'}.`,
      `- Changed paths (${inputs.skip.paths?.length ?? 0}): ${inputs.skip.paths?.length ? inputs.skip.paths.map((path) => `\`${path}\``).join(', ') : 'none reported'}.`,
      '- Lighthouse samples collected: **0**.',
      '- No metrics, baseline comparison, or artifacts were produced.',
      '- Next step: the next daily `main` run performs the full post-merge measurement.'
    );
    return lines.join('\n');
  }

  const complete = measure === 'success' &&
    summary?.complete === true &&
    summary.coverage?.routeCount === 4 &&
    summary.coverage?.runCount === 3 &&
    summary.coverage?.measurementCount === 24;
  const measurementFailed = measure === 'failure';
  const policyStatus = comparison?.policy?.status;
  const statusText = complete
    ? `**Measurement completed — 24/24 Lighthouse samples${policyStatus ? `; safeguard ${policyStatus}` : ''}${job === 'failure' && policyStatus === 'passed' ? '; a later workflow operation failed' : ''}**`
    : measurementFailed
      ? '**Measurement failed or incomplete**'
      : '**Measurement failed or incomplete — no complete measurement was produced**';
  lines.push(
    statusText,
    '',
    complete
    ? '- Three fresh-browser Lighthouse runs are summarized by route/profile medians. Absolute mobile/desktop budgets apply; substantial LCP deterioration is checked against a compatible reviewed fixed reference. Rolling history is informational.'
    : '- No complete measurement or safeguard pass is reported. Partial output and missing confirmation evidence are not treated as clean.',
    `- Run: \`${inputs.eventName ?? 'unknown'}\` on ref \`${inputs.ref ?? 'unknown'}\`; job status: ${job}.`
  );
  const measurementContext = summary?.conditions?.measurementContext ?? inputs.measurementContext;
  if (measurementContext) {
    lines.push(`- Measurement context: **${measurementContext}**; only same-context references and history are eligible for comparison.`);
  }
  if (complete) {
    lines.push(`- Coverage: ${summary.coverage.routeCount} generated routes × mobile/desktop × ${summary.coverage.runCount} runs.`);
    if (Number.isFinite(summary.timing?.measurementSeconds)) {
      lines.push(`- Measurement runtime: ${summary.timing.measurementSeconds.toFixed(1)} seconds; total job duration is available in the Actions run overview.`);
    }
  } else {
    lines.push('- Complete sample count: **unavailable**; no zero or partial count is inferred.');
  }
  if (failures.length) {
    lines.push(`- **Investigate:** ${failures.join(', ')} failed; [open this workflow run](${inputs.runUrl ?? ''}) for logs.`);
  } else if (!complete) {
    lines.push(`- **Investigate:** inspect the relevant Actions step in [this workflow run](${inputs.runUrl ?? ''}); the measurement is not reported as successful.`);
  }

  lines.push('', '## Findings', '');
  lines.push(...baselineLines(comparison));
  lines.push(...performanceSafeguardLines(comparison?.policy));
  if (comparison?.deltasAvailable) {
    lines.push(...deltaTable(comparison));
  } else if (complete) {
    lines.push(...representativeTable(summary));
  }

  lines.push('', '## Evidence', '');
  lines.push(`- Controlled missing-route diagnostic: **${diagnosticStatus(inputs)}**.`);
  if (inputs.reports?.outcome === 'success' && inputs.reports.url) {
    lines.push(`- [Raw Lighthouse reports](${inputs.reports.url}) — 14-day retention.`);
  } else {
    lines.push(`- Raw Lighthouse reports unavailable (${inputs.reports?.outcome ?? 'not uploaded'}); inspect the upload step in [the workflow run](${inputs.runUrl ?? ''}).`);
  }
  if (inputs.machineArtifact?.outcome === 'success' && inputs.machineArtifact.url) {
    const artifactLabel = inputs.machineArtifact.hasComparison
      ? 'Machine-readable summary and comparison'
      : 'Machine-readable performance summary (comparison unavailable)';
    lines.push(`- [${artifactLabel}](${inputs.machineArtifact.url}) — 90-day retention.`);
  } else {
    lines.push(`- Machine-readable summary/comparison artifact unavailable (${inputs.machineArtifact?.outcome ?? 'not uploaded'}); inspect the upload step in [the workflow run](${inputs.runUrl ?? ''}).`);
  }
  if (inputs.confirmationReports?.outcome === 'success' && inputs.confirmationReports.url) {
    lines.push(`- [Three-run confirmation reports](${inputs.confirmationReports.url}) — affected route/profile measurements.`);
  } else if (['incomplete', 'confirmation-required'].includes(policyStatus)) {
    lines.push(`- Confirmation reports unavailable (${inputs.confirmationReports?.outcome ?? 'not completed'}); the safeguard is not passed.`);
  }

  lines.push('', ...technicalDetails(summary, comparison, inputs));
  return lines.join('\n');
}

function main() {
  const reportDirectory = resolve(process.env.PERFORMANCE_REPORT_DIR ?? 'performance-reports');
  const summary = readJson(join(reportDirectory, 'performance-summary.json'));
  const comparison = readJson(join(reportDirectory, 'performance-comparison.json'));
  let changedPaths = [];
  try {
    changedPaths = JSON.parse(process.env.CHANGED_PATHS ?? '[]');
  } catch {
    changedPaths = [];
  }
  const inputs = {
    summary,
    comparison,
    jobStatus: process.env.JOB_STATUS,
    eventName: process.env.TRIGGER_NAME,
    ref: process.env.TRIGGER_REF,
    measurementContext: process.env.PERFORMANCE_CONTEXT,
    runUrl: process.env.RUN_URL,
    skip: {
      measurement: process.env.SKIP_MEASUREMENT === 'true',
      reason: process.env.SKIP_REASON,
      paths: changedPaths
    },
    reports: { outcome: process.env.REPORTS_OUTCOME, url: process.env.REPORTS_URL },
    machineArtifact: {
      outcome: process.env.SUMMARY_OUTCOME,
      url: process.env.SUMMARY_URL,
      hasComparison: Boolean(comparison)
    },
    steps: Object.fromEntries([
      'tests', 'classify', 'ruby', 'node', 'build', 'dependencies', 'chromium',
      'history', 'measure', 'comparison', 'confirmation', 'evaluation',
      'diagnostic', 'reports', 'confirmation_reports', 'summary'
    ].map((key) => [key, process.env[`STEP_${key.toUpperCase()}`]]))
  };
  const markdown = `${renderPerformanceSummary(inputs)}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
  process.stdout.write(markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}

export {
  formatDelta,
  formatValue,
  performanceSafeguardLines,
  renderPerformanceSummary,
  routeLabel
};
