import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const apiVersion = '2022-11-28';
const historyLimit = 28;
const runSearchLimit = 100;
const metrics = [
  ['first-contentful-paint', 'FCP'],
  ['largest-contentful-paint', 'LCP'],
  ['speed-index', 'SI'],
  ['total-blocking-time', 'TBT'],
  ['cumulative-layout-shift', 'CLS']
];

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  if (!ordered.length) return undefined;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function formatValue(metric, value) {
  return metric === 'cumulative-layout-shift'
    ? value.toFixed(3)
    : `${Math.round(value)} ms`;
}

function formatDelta(metric, current, baseline) {
  if (!Number.isFinite(baseline)) return '—';
  const difference = current - baseline;
  const sign = difference > 0 ? '+' : '';
  const value = `${sign}${formatValue(metric, difference)}`;
  if (baseline === 0) return `${value} (percentage n/a: baseline zero)`;
  const percentage = (difference / Math.abs(baseline)) * 100;
  const percentageSign = percentage > 0 ? '+' : '';
  return `${value} (${percentageSign}${percentage.toFixed(1)}%)`;
}

function getResults(summary) {
  return new Map(
    (summary?.results ?? []).map((result) => [
      `${result.route}\u0000${result.formFactor}`,
      result
    ])
  );
}

function isCompleteSummary(summary) {
  if (summary?.schemaVersion !== 1 || summary.complete !== true || !Array.isArray(summary.results)) {
    return false;
  }
  const slots = new Set(summary.results.map((result) => `${result.route}\u0000${result.formFactor}`));
  const routes = new Set(summary.results.map((result) => result.route));
  return summary.coverage?.routeCount === 4 &&
    summary.coverage?.runCount === 3 &&
    summary.coverage?.measurementCount === 24 &&
    summary.results.length === 8 &&
    slots.size === 8 &&
    routes.size === 4 &&
    summary.results.every((result) =>
    result.route &&
    ['mobile', 'desktop'].includes(result.formFactor) &&
    metrics.every(([key]) => Number.isFinite(result.values?.[key]))
  );
}

function referenceIsReady(reference) {
  return isCompleteSummary(reference) &&
    reference.source?.branch === 'main' &&
    ['schedule', 'workflow_dispatch'].includes(reference.source?.eventName) &&
    Boolean(reference.source?.runUrl);
}

function sameMeasurementEnvironment(current, baseline) {
  return ['runner', 'lighthouse', 'chrome', 'ruby', 'jekyll', 'node'].every((key) =>
    current.environment?.[key] &&
    current.environment[key] === baseline.environment?.[key]
  );
}

async function githubRequest(path, token) {
  const response = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': apiVersion
    },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`GitHub Actions API returned HTTP ${response.status} for ${path}.`);
  }
  return response;
}

async function loadDailyHistory() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    return {
      status: 'unavailable',
      reason: 'GitHub Actions read access is unavailable in this run.',
      summaries: [],
      skipped: []
    };
  }

  const repoPath = repository.split('/').map(encodeURIComponent).join('/');
  const workflowPath = encodeURIComponent('performance-integrity.yml');
  const runsPath = `/repos/${repoPath}/actions/workflows/${workflowPath}/runs?branch=main&event=schedule&status=completed&per_page=100`;
  const summaries = [];
  const skipped = [];

  try {
    const runsResponse = await githubRequest(runsPath, token);
    const runsData = await runsResponse.json();
    const runs = (runsData.workflow_runs ?? [])
      .filter((run) =>
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        run.event === 'schedule' &&
        run.head_branch === 'main'
      )
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
      .slice(0, runSearchLimit);

    for (const run of runs) {
      try {
        const artifactsPath = `/repos/${repoPath}/actions/runs/${run.id}/artifacts?per_page=100`;
        const artifactsResponse = await githubRequest(artifactsPath, token);
        const artifactData = await artifactsResponse.json();
        const artifact = artifactData.artifacts?.find((item) =>
          item.name === 'performance-summary' &&
          !item.expired &&
          item.size_in_bytes <= 1_000_000
        );
        if (!artifact) {
          skipped.push(`run ${run.id}: summary artifact unavailable or expired`);
          continue;
        }

        const archiveResponse = await githubRequest(
          `/repos/${repoPath}/actions/artifacts/${artifact.id}/zip`,
          token
        );
        const archive = Buffer.from(await archiveResponse.arrayBuffer());
        if (archive.length > 1_000_000) {
          skipped.push(`run ${run.id}: summary artifact exceeded the size limit`);
          continue;
        }

        const directory = mkdtempSync(join(tmpdir(), 'agency-performance-history-'));
        try {
          const archivePath = join(directory, 'summary.zip');
          writeFileSync(archivePath, archive);
          const contents = execFileSync(
            'unzip',
            ['-p', archivePath, 'performance-summary.json'],
            { encoding: 'utf8', maxBuffer: 1_000_000 }
          );
          const summary = JSON.parse(contents);
          if (
            !isCompleteSummary(summary) ||
            summary.source?.eventName !== 'schedule' ||
            summary.source?.branch !== 'main' ||
            String(summary.source?.runId) !== String(run.id)
          ) {
            skipped.push(`run ${run.id}: summary provenance or coverage did not match`);
            continue;
          }
          summaries.push(summary);
          if (summaries.length === historyLimit) break;
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      } catch (error) {
        skipped.push(`run ${run.id}: ${error.message}`);
      }
    }

    return {
      status: summaries.length === historyLimit ? 'available' : 'collecting_history',
      reason: summaries.length === historyLimit
        ? undefined
        : `Only ${summaries.length} of ${historyLimit} recent complete daily-main summaries are available.`,
      summaries,
      skipped,
      searchedRuns: runs.length
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error.message,
      summaries: [],
      skipped
    };
  }
}

function summarizeRolling(history) {
  const keys = new Set();
  for (const summary of history.summaries) {
    for (const key of getResults(summary).keys()) keys.add(key);
  }
  return new Map([...keys].map((key) => {
    const perSummary = history.summaries
      .map((summary) => getResults(summary).get(key))
      .filter(Boolean);
    const route = perSummary.at(-1)?.route;
    const formFactor = perSummary.at(-1)?.formFactor;
    const values = {};
    for (const [metric] of metrics) {
      values[metric] = median(perSummary.map((result) => result.values[metric]));
    }
    return [key, { route, formFactor, values, sampleCount: perSummary.length }];
  }));
}

function conditionDifferences(current, baseline) {
  const differences = [];
  for (const [key, label] of Object.entries({
    runner: 'runner',
    lighthouse: 'Lighthouse',
    chrome: 'Chrome',
    ruby: 'Ruby',
    jekyll: 'Jekyll',
    node: 'Node'
  })) {
    if (current.environment?.[key] !== baseline.environment?.[key]) {
      differences.push(`${label} version/environment differs`);
    }
  }
  const currentScripts = new Map((current.externalScripts ?? []).map((script) => [script.source, script]));
  const baselineScripts = new Map((baseline.externalScripts ?? []).map((script) => [script.source, script]));
  for (const source of new Set([...currentScripts.keys(), ...baselineScripts.keys()])) {
    const now = currentScripts.get(source);
    const then = baselineScripts.get(source);
    if (!now || !then || now.successful !== then.successful || now.samples !== then.samples) {
      differences.push(`${source} load outcome differs`);
    } else if (
      Number.isFinite(now.medianTransferBytes) &&
      Number.isFinite(then.medianTransferBytes) &&
      Math.abs(now.medianTransferBytes - then.medianTransferBytes) >
        Math.max(16 * 1024, then.medianTransferBytes * 0.1)
    ) {
      differences.push(`${source} transfer size differs`);
    }
  }
  return differences;
}

function getCurrentSummary(reportDirectory) {
  try {
    const summary = JSON.parse(readFileSync(join(reportDirectory, 'performance-summary.json'), 'utf8'));
    return isCompleteSummary(summary) ? summary : undefined;
  } catch {
    return undefined;
  }
}

function getHistory() {
  const historyPath = resolve(
    process.env.PERFORMANCE_HISTORY_PATH ?? join(tmpdir(), 'performance-history.json')
  );
  try {
    const history = JSON.parse(readFileSync(historyPath, 'utf8'));
    if (
      ['available', 'collecting_history', 'unavailable'].includes(history.status) &&
      Array.isArray(history.summaries) &&
      Array.isArray(history.skipped)
    ) {
      return history;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function buildComparison(current, reference, history) {
  const compatibleHistory = history.summaries.filter((summary) =>
    sameMeasurementEnvironment(current, summary)
  );
  const comparisonHistory = {
    ...history,
    status: history.status === 'unavailable'
      ? 'unavailable'
      : compatibleHistory.length === historyLimit
        ? 'available'
        : 'collecting_history',
    reason: history.status === 'unavailable'
      ? history.reason
      : compatibleHistory.length === historyLimit
        ? undefined
        : `${compatibleHistory.length} of ${historyLimit} recent successful daily-main summaries match the current tool and runner versions.`
  };
  comparisonHistory.summaries = compatibleHistory;
  const rolling = compatibleHistory.length === historyLimit
    ? summarizeRolling(comparisonHistory)
    : new Map();
  const currentResults = getResults(current);
  const referenceReady = referenceIsReady(reference) ? reference : undefined;
  const readyReference = referenceReady &&
    sameMeasurementEnvironment(current, referenceReady)
    ? referenceReady
    : undefined;
  const referenceResults = getResults(readyReference);
  const historyProvenance = compatibleHistory.map((summary) => ({
    runId: summary.source.runId,
    runUrl: summary.source.runUrl,
    capturedAt: summary.capturedAt,
    sha: summary.source.sha
  }));
  const deltasAvailable = Boolean(readyReference || rolling.size);
  const historyReason = comparisonHistory.reason?.replace(/[.!?]+$/, '') ?? 'history lookup failed';
  const lines = [
    '',
    '## Baseline comparison',
    '',
    `- **Run:** ${current.source.eventName} on \`${current.source.branch ?? 'unknown'}\`; ${current.coverage.routeCount} routes × mobile/desktop × ${current.coverage.runCount} runs; tools: Lighthouse ${current.environment.lighthouse}, Chrome ${current.environment.chrome}, Node ${current.environment.node}.`,
    `- **Fixed reference:** ${readyReference
      ? `[successful main run](${readyReference.source.runUrl})`
      : referenceReady
        ? 'not comparable; tool or runner versions differ from the versioned reference'
        : 'pending first reviewed successful main measurement'}.`,
    `- **Rolling daily-main baseline:** ${comparisonHistory.status === 'unavailable'
      ? `unavailable (${historyReason})`
      : comparisonHistory.status === 'available'
        ? `${historyLimit}/${historyLimit} compatible successful daily-main runs; available`
        : `collecting (${compatibleHistory.length}/${historyLimit} compatible successful daily-main runs)`}.`,
    '- Deltas are descriptive only; they do not fail this workflow or establish a performance-quality verdict.'
  ];
  if (deltasAvailable) {
    lines.push('- A dash means no matching route/profile baseline metric is available (for example, when the latest reflection route changes).');
  }
  if (historyProvenance.length) {
    const newest = historyProvenance[0];
    const oldest = historyProvenance.at(-1);
    lines.push(
      `- **Rolling sample sources:** ${historyProvenance.length} matching daily-main summaries, from [${newest.runId}](${newest.runUrl}) (${newest.capturedAt}) through [${oldest.runId}](${oldest.runUrl}) (${oldest.capturedAt}); full provenance is in the summary artifact.`
    );
  }
  if (history.skipped?.length) {
    lines.push(`- **History lookup details:** ${history.skipped.slice(0, 3).join('; ')}.`);
  }
  const rows = [];

  for (const [slot, result] of currentResults) {
    const fixedResult = referenceResults.get(slot);
    const rollingResult = rolling.get(slot);
    const fixedDeltas = metrics.map(([metric]) =>
      fixedResult ? formatDelta(metric, result.values[metric], fixedResult.values[metric]) : '—'
    );
    const rollingDeltas = metrics.map(([metric]) =>
      rollingResult ? formatDelta(metric, result.values[metric], rollingResult.values[metric]) : '—'
    );
    rows.push(
      `| \`${result.route}\` | ${result.formFactor} | ${fixedDeltas.join(' · ')} | ${rollingDeltas.join(' · ')} |`
    );

  }

  if (rows.length && deltasAvailable) {
    lines.push(
      '',
      '| Route | Profile | Fixed Δ (FCP · LCP · SI · TBT · CLS) | Rolling Δ (same order) |',
      '| --- | --- | --- | --- |',
      ...rows
    );
  } else {
    lines.push('', '- No comparison/deltas available yet.');
  }

  const comparisons = [referenceReady, ...history.summaries].filter(Boolean);
  const differences = [...new Set(comparisons.flatMap((baseline) => conditionDifferences(current, baseline)))];
  if (differences.length) {
    lines.push(`- **Conditions to consider:** ${differences.join('; ')}.`);
  } else if (comparisons.length) {
    lines.push('- **Conditions:** tool versions, runner and observed external-script load outcomes match available references.');
  } else {
    lines.push('- **Conditions:** no reference is available for environment or external-script comparison.');
  }

  const comparison = {
    schemaVersion: 1,
    history: {
      status: comparisonHistory.status,
      availableDailySamples: compatibleHistory.length,
      requiredDailySamples: historyLimit,
      searchedRuns: history.searchedRuns ?? null,
      reason: comparisonHistory.reason,
      skipped: history.skipped,
      provenance: historyProvenance
    },
    fixedReference: readyReference
      ? { available: true, runUrl: readyReference.source.runUrl }
      : {
          available: false,
          reason: referenceReady
            ? 'The versioned reference uses a different tool or runner environment.'
            : 'No versioned successful main reference has been established.'
        },
    deltasAvailable,
    comparisons: [...currentResults].map(([slot, result]) => {
      const fixedResult = referenceResults.get(slot);
      const rollingResult = rolling.get(slot);
      const deltas = Object.fromEntries(metrics.map(([metric]) => [
        metric,
        {
          fixed: fixedResult ? {
            absolute: result.values[metric] - fixedResult.values[metric],
            percentage: fixedResult.values[metric] === 0
              ? null
              : ((result.values[metric] - fixedResult.values[metric]) / Math.abs(fixedResult.values[metric])) * 100
          } : null,
          rolling: rollingResult ? {
            absolute: result.values[metric] - rollingResult.values[metric],
            percentage: rollingResult.values[metric] === 0
              ? null
              : ((result.values[metric] - rollingResult.values[metric]) / Math.abs(rollingResult.values[metric])) * 100
          } : null
        }
      ]));
      return {
        route: result.route,
        formFactor: result.formFactor,
        values: result.values,
        fixedReference: fixedResult ? fixedResult.values : null,
        rollingBaseline: rollingResult ? rollingResult.values : null,
        rollingSampleCount: rollingResult?.sampleCount ?? 0,
        deltas
      };
    })
  };
  return { lines, comparison };
}

async function main() {
  if (process.argv.includes('--load-history')) {
    const history = await loadDailyHistory();
    const historyPath = resolve(
      process.env.PERFORMANCE_HISTORY_PATH ?? join(tmpdir(), 'performance-history.json')
    );
    writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
    process.stdout.write(
      `Daily-main history: ${history.status}; ${history.summaries.length} complete summaries available.\n`
    );
    return;
  }

  const reportDirectory = resolve(
    process.env.PERFORMANCE_REPORT_DIR ?? resolve(process.cwd(), 'performance-reports')
  );
  const summaryPath = join(reportDirectory, 'performance-summary.json');
  const summary = getCurrentSummary(reportDirectory);
  if (!summary) {
    const line = '- Baseline comparison unavailable: measurement did not produce a complete summary; inspect the measurement step and any partial JSON artifacts.';
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`, { flag: 'a' });
    }
    process.stdout.write(`${line}\n`);
    return;
  }

  const referencePath = resolve(
    process.env.PERFORMANCE_REFERENCE_PATH ?? '.github/performance-reference.json'
  );
  let reference;
  try {
    reference = JSON.parse(readFileSync(referencePath, 'utf8'));
  } catch {
    reference = undefined;
  }
  const history = getHistory() ?? {
    status: 'unavailable',
    reason: 'Daily-main history lookup did not produce a readable result.',
    summaries: [],
    skipped: []
  };
  const { lines, comparison } = buildComparison(summary, reference, history);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(reportDirectory, 'performance-comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `deltas_available=${comparison.deltasAvailable}\nhistory_status=${comparison.history.status}\nhistory_count=${comparison.history.availableDailySamples}\n`,
      { flag: 'a' }
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, { flag: 'a' });
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { buildComparison, isCompleteSummary, referenceIsReady };
