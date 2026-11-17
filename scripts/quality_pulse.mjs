import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dimensions = [
  { name: 'Site Build Integrity', file: 'site-build-integrity.yml' },
  { name: 'Link Integrity', file: 'link-integrity.yml' },
  { name: 'SEO Integrity', file: 'seo-integrity.yml' },
  { name: 'Source Quality', file: 'source-quality.yml' },
  { name: 'Dependency Security', file: 'dependency-security.yml' },
  { name: 'Rendered Site Integrity', file: 'rendered-site-integrity.yml' },
  { name: 'Performance Integrity', file: 'performance-integrity.yml' }
];

const cutoffTime = '18:00:00Z';
const priorDays = 90;
const staleAfterDays = 2;

function utcDate(value) {
  return value.toISOString().slice(0, 10);
}

function dateDaysAgo(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return utcDate(value);
}

function timestamp(value) {
  if (!value) return 'time unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? 'time unavailable'
    : `${parsed.toISOString().replace('T', ' ').replace(/Z$/, ' UTC')}`;
}

function runTime(run) {
  if (run.completionEvidence?.completedAt) {
    return `Completed ${timestamp(run.completionEvidence.completedAt)}`;
  }
  if (run.run_started_at) return `Started ${timestamp(run.run_started_at)}`;
  if (run.created_at) return `Created ${timestamp(run.created_at)}`;
  return 'run time unavailable';
}

function runLink(run) {
  return run?.html_url ?? '';
}

function completionEvidenceFromJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { status: 'unknown', reason: 'No workflow job completion records were returned.' };
  }
  if (jobs.some((job) => job.status !== 'completed')) {
    return { status: 'incomplete', reason: 'One or more workflow jobs are still incomplete.' };
  }
  const executedJobs = jobs.filter((job) => job.conclusion !== 'skipped');
  if (executedJobs.length === 0) {
    return { status: 'unknown', reason: 'No workflow job ran to completion.' };
  }
  if (executedJobs.some((job) => !['success', 'neutral', 'failure', 'timed_out', 'cancelled'].includes(job.conclusion))) {
    return { status: 'unknown', reason: 'Workflow job conclusions are unavailable or invalid.' };
  }
  const completionTimes = executedJobs.map((job) =>
    typeof job.completed_at === 'string' ? Date.parse(job.completed_at) : Number.NaN
  );
  if (completionTimes.some((value) => !Number.isFinite(value))) {
    return { status: 'unknown', reason: 'Workflow job completion timestamps are unavailable or invalid.' };
  }
  const completedAt = new Date(Math.max(...completionTimes)).toISOString();
  return {
    status: 'completed',
    completedAt,
    successful: executedJobs.every((job) => ['success', 'neutral'].includes(job.conclusion))
  };
}

function evaluateRuns(runs, date, cutoff = cutoffTime, completionByRunId = new Map()) {
  const dailyRuns = runs
    .filter((run) => run.created_at?.slice(0, 10) === date)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const cutoffAt = new Date(`${date}T${cutoff}`);
  const today = dailyRuns[0];
  if (today) {
    const todayEvidenceRun = {
      ...today,
      completionEvidence: completionByRunId.get(today.id)
    };
    if (today.conclusion === 'failure' || today.conclusion === 'timed_out') {
      return {
        state: 'failed',
        label: 'Fresh — failed',
        run: todayEvidenceRun,
        detail: 'Open the workflow run for findings and the next corrective action.'
      };
    }
    if (today.conclusion === 'cancelled') {
      return {
        state: 'failed',
        label: 'Cancelled',
        run: todayEvidenceRun,
        detail: 'The scheduled verification was cancelled; inspect the run and rerun if appropriate.'
      };
    }
    if (today.conclusion === 'skipped') {
      return {
        state: 'skipped',
        label: 'Skipped',
        run: todayEvidenceRun,
        detail: 'The daily verification was skipped; confirm whether the skip was intentional.'
      };
    }
    if (today.status !== 'completed') {
      return {
        state: 'late',
        label: 'Late / incomplete',
        run: todayEvidenceRun,
        detail: `The scheduled run was still ${today.status ?? 'incomplete'} at the ${cutoff} cutoff.`
      };
    }
    if (today.conclusion === 'success') {
      const completion = completionByRunId.get(today.id);
      if (completion?.status !== 'completed' || completion.successful !== true) {
        return {
          state: 'unknown',
          label: 'Unknown completion time',
          run: today,
          detail: `${completion?.reason ?? 'Workflow job completion evidence does not establish a successful finished check'} The run is not marked fresh.`
        };
      }
      if (Date.parse(completion.completedAt) > cutoffAt.valueOf()) {
        return {
          state: 'late',
          label: 'Late',
          run: todayEvidenceRun,
          detail: `The latest workflow job completed after the ${cutoff} cutoff; today's result is late.`
        };
      }
      return {
        state: 'fresh',
        label: 'Fresh — passed',
        run: todayEvidenceRun,
        detail: 'All workflow jobs completed by the cutoff.'
      };
    }
    return {
      state: 'unknown',
      label: 'Unknown outcome',
      run: todayEvidenceRun,
      detail: `The workflow reported ${today.conclusion ?? 'no conclusion'}; inspect the run.`
    };
  }

  const previous = runs
    .filter(
      (run) =>
        run.conclusion === 'success' &&
        run.created_at?.slice(0, 10) < date
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!previous) {
    return {
      state: 'missing',
      label: 'Missing',
      detail: 'No scheduled main run today or earlier successful verification was found.'
    };
  }
  const ageDays = Math.floor(
    (Date.parse(`${date}T00:00:00Z`) -
      Date.parse(`${previous.created_at.slice(0, 10)}T00:00:00Z`)) /
      86_400_000
  );
  if (ageDays <= staleAfterDays) {
    return {
      state: 'prior',
      label: 'Prior verification',
      run: { ...previous, completionEvidence: completionByRunId.get(previous.id) },
      detail: `No fresh run today. Last successful verification was ${ageDays} day(s) earlier; do not treat it as today's check.`
    };
  }
  return {
    state: 'stale',
    label: 'Stale',
    run: { ...previous, completionEvidence: completionByRunId.get(previous.id) },
    detail: `No fresh run today. Last successful verification was ${ageDays} days earlier; inspect schedule health and rerun.`
  };
}

async function fetchRuns({ apiUrl, repository, workflow, token, date, fetchImpl }) {
  if (!token) throw new Error('GitHub Actions read token is unavailable');
  const url = new URL(
    `/repos/${repository}/actions/workflows/${workflow.file}/runs`,
    apiUrl
  );
  url.search = new URLSearchParams({
    branch: 'main',
    event: 'schedule',
    created: `${dateDaysAgo(date, priorDays)}..${date}`,
    per_page: '100',
    sort: 'created',
    direction: 'desc'
  });
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: ['Bearer', token].join(' '),
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.workflow_runs)) {
    throw new Error('GitHub Actions API returned an unreadable workflow-run list');
  }
  return data.workflow_runs;
}

async function fetchRunCompletion({ apiUrl, repository, runId, token, fetchImpl }) {
  const url = new URL(
    `/repos/${repository}/actions/runs/${runId}/jobs`,
    apiUrl
  );
  url.search = new URLSearchParams({ per_page: '100', page: '1' });
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: ['Bearer', token].join(' '),
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    return { status: 'unknown', reason: `GitHub Actions Jobs API returned HTTP ${response.status}.` };
  }
  const data = await response.json();
  if (
    !Array.isArray(data.jobs) ||
    !Number.isInteger(data.total_count) ||
    data.total_count > data.jobs.length
  ) {
    return { status: 'unknown', reason: 'GitHub Actions Jobs API returned incomplete job records.' };
  }
  return completionEvidenceFromJobs(data.jobs);
}

function performanceDetail(result) {
  if (result.state === 'fresh') {
    return `Lighthouse measurement executed; ${result.baseline ?? 'fixed-reference and rolling-baseline state are in the linked run summary.'}`;
  }
  if (result.state === 'failed') {
    return `Measurement failed or a later step failed; ${result.baseline ?? 'inspect the linked summary for measurement and baseline state.'}`;
  }
  if (result.state === 'skipped') {
    return 'Measurement was skipped; no current samples or comparison are claimed.';
  }
  return `${result.detail} ${result.baseline ? `Baseline: ${result.baseline}.` : 'Fixed-reference and rolling-baseline state is available only in the linked run summary.'}`;
}

function describePerformanceComparison(comparison) {
  if (!comparison) {
    return 'fixed reference: unknown; rolling baseline: unknown';
  }
  const fixed = comparison.fixedReference;
  const fixedState = fixed?.available === true
    ? 'available'
    : typeof fixed?.reason !== 'string'
      ? 'unknown'
      : /different tool|runner environment/i.test(fixed.reason)
        ? 'incompatible'
        : /no versioned successful main reference/i.test(fixed.reason)
          ? 'pending'
          : 'unknown';
  const rollingState = rollingBaselineState(comparison.history ?? {});
  return `Fixed reference: ${fixedState}; rolling baseline: ${rollingState}`;
}

function rollingBaselineState(history) {
  const validCounts = Number.isInteger(history.availableDailySamples) &&
    Number.isInteger(history.requiredDailySamples) &&
    history.requiredDailySamples === 28 &&
    history.availableDailySamples >= 0 &&
    history.availableDailySamples <= history.requiredDailySamples;
  if (!validCounts) return 'unknown';
  if (history.status === 'available') {
    return history.availableDailySamples === 28 ? 'available 28/28' : 'unknown';
  }
  if (['collecting_history', 'collecting'].includes(history.status)) {
    return history.availableDailySamples < 28
      ? `collecting ${history.availableDailySamples}/28`
      : 'unknown';
  }
  if (history.status === 'unavailable') {
    return history.availableDailySamples === 0 ? 'unavailable' : 'unknown';
  }
  return 'unknown';
}

function isPerformanceComparison(value) {
  return Boolean(value?.schemaVersion === 1 &&
    value.fixedReference &&
    typeof value.fixedReference === 'object' &&
    value.history &&
    typeof value.history === 'object' &&
    Array.isArray(value.comparisons));
}

function formatTrendDelta(delta) {
  if (!delta || typeof delta !== 'object') return '—';
  const absolute = Number.isFinite(delta.absolute)
    ? `${delta.absolute > 0 ? '+' : ''}${Math.abs(delta.absolute) >= 1_000
      ? `${(delta.absolute / 1_000).toFixed(2)} s`
      : `${Math.round(delta.absolute)} ms`}`
    : undefined;
  const percentage = Number.isFinite(delta.percentage)
    ? `(${delta.percentage > 0 ? '+' : ''}${delta.percentage.toFixed(1)}%)`
    : undefined;
  return [absolute, percentage].filter(Boolean).join(' ') || '—';
}

function homepageTrendRows(comparison) {
  const homepage = comparison.comparisons.find((item) => item.route === '/');
  if (!homepage) return [];
  const fixedAvailable = comparison.fixedReference.available === true;
  const rollingAvailable = rollingBaselineState(comparison.history) === 'available 28/28';
  const measures = [
    ['mobile', 'largest-contentful-paint', 'Mobile LCP'],
    ['mobile', 'total-blocking-time', 'Mobile TBT'],
    ['desktop', 'largest-contentful-paint', 'Desktop LCP']
  ];
  return measures.flatMap(([formFactor, metric, label]) => {
    const result = comparison.comparisons.find(
      (item) => item.route === homepage.route && item.formFactor?.toLowerCase() === formFactor
    );
    if (!result || !Object.hasOwn(result.deltas ?? {}, metric)) return [];
    return [{
      label,
      fixed: fixedAvailable ? formatTrendDelta(result.deltas?.[metric]?.fixed) : '—',
      rolling: rollingAvailable ? formatTrendDelta(result.deltas?.[metric]?.rolling) : '—'
    }];
  });
}

function renderPerformanceTrends(result) {
  const trends = result?.trends;
  const lines = [
    '## Performance Trends',
    '',
    'Lower is better for these lab metrics; positive deltas mean a higher measured value. Comparisons are informational and do not establish a sustained direction.'
  ];
  const canShowComparison = ['fresh', 'prior'].includes(trends?.state) &&
    isPerformanceComparison(trends?.comparison) &&
    /^\d{4}-\d{2}-\d{2}$/.test(trends.measurementDate ?? '');
  if (!canShowComparison) {
    const reason = trends?.reason ??
      (trends?.comparison
        ? 'the measurement is not a dated successful current or prior run'
        : 'no successful measurement evidence is available.');
    lines.push('', `Performance comparison unavailable: ${reason}`);
    if (trends?.runUrl) lines.push(`Source: [Performance Integrity run](${trends.runUrl}).`);
    if (trends?.baseline) lines.push(`Baselines: ${trends.baseline}.`);
    return lines;
  }

  const measurement = trends.state === 'prior'
    ? `Prior successful measurement — ${trends.measurementDate}; not today's verification.`
    : `Measurement — ${trends.measurementDate} UTC (fresh scheduled run).`;
  lines.push(
    '',
    `**${measurement}**`,
    `**Baselines:** ${describePerformanceComparison(trends.comparison)}.`
  );
  const sources = [];
  if (trends.runUrl) sources.push(`[Performance Integrity run](${trends.runUrl})`);
  if (trends.artifactUrl) sources.push(`[comparison artifact](${trends.artifactUrl})`);
  const fixedRunUrl = trends.comparison.fixedReference?.runUrl;
  if (fixedRunUrl) sources.push(`[fixed reference run](${fixedRunUrl})`);
  if (sources.length) lines.push(`**Evidence:** ${sources.join(' · ')}.`);
  lines.push(
    '',
    '| Measure | vs. fixed reference | vs. rolling baseline |',
    '| --- | --- | --- |'
  );
  const rows = homepageTrendRows(trends.comparison);
  if (rows.length) {
    for (const row of rows) lines.push(`| ${row.label} | ${row.fixed} | ${row.rolling} |`);
  } else {
    lines.push('| Homepage metrics | — | — |');
  }
  lines.push('', 'Other pages and full metric details are in the linked Performance Integrity summary.');
  return lines;
}

async function fetchArtifactJson({
  apiUrl,
  repository,
  token,
  runId,
  artifactName,
  fileName,
  fetchImpl,
  includeMetadata = false,
  unzipImpl = execFileSync
}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: ['Bearer', token].join(' '),
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const artifactsUrl = new URL(
    `/repos/${repository}/actions/runs/${runId}/artifacts`,
    apiUrl
  );
  artifactsUrl.search = new URLSearchParams({ name: artifactName, per_page: '100' });
  const listResponse = await fetchImpl(artifactsUrl, {
    headers,
    signal: AbortSignal.timeout(15_000)
  });
  if (!listResponse.ok) throw new Error(`Artifacts API returned HTTP ${listResponse.status}`);
  const artifact = (await listResponse.json()).artifacts?.find(
    (item) => item.name === artifactName && !item.expired
  );
  if (!artifact) throw new Error(`${artifactName} artifact is missing or expired`);
  if (!Number.isInteger(artifact.id)) throw new Error(`${artifactName} artifact ID is invalid`);
  const downloadUrl = new URL(
    `/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
    apiUrl
  );
  const downloadResponse = await fetchImpl(downloadUrl, {
    headers,
    signal: AbortSignal.timeout(30_000)
  });
  if (!downloadResponse.ok) {
    throw new Error(`${artifactName} artifact download returned HTTP ${downloadResponse.status}`);
  }
  const archive = Buffer.from(await downloadResponse.arrayBuffer());
  if (archive.length > 10 * 1024 * 1024) {
    throw new Error(`${artifactName} artifact exceeded the 10 MB safety limit`);
  }
  const directory = mkdtempSync(join(tmpdir(), 'agency-quality-pulse-'));
  const archivePath = join(directory, `${artifactName}.zip`);
  try {
    writeFileSync(archivePath, archive);
    const json = unzipImpl(
      'unzip',
      ['-p', archivePath, fileName],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const data = JSON.parse(json);
    return includeMetadata ? { data, artifact } : data;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function applyDependencyPosture(result, posture) {
  if (posture.status === 'unknown') {
    return {
      ...result,
      state: 'unknown',
      label: 'Unknown / API inaccessible',
      detail: `${posture.detail ?? 'Dependency posture could not be read'}; no result is inferred.`
    };
  }
  if (posture.status === 'review') {
    return {
      ...result,
      state: 'failed',
      label: 'Fresh — review required',
      detail: `${posture.detail}; open the linked run for alert findings.`
    };
  }
  if (posture.status === 'passed' && result.state === 'fresh') {
    return {
      ...result,
      detail: 'Open Dependabot alerts were checked across enabled ecosystems; none met the review threshold.'
    };
  }
  return result;
}

function renderPulse({ date, generatedAt, results, cutoff = cutoffTime }) {
  const needsReview = results.filter((item) => item.result.state !== 'fresh');
  const aggregate = needsReview.length
    ? `Review required — ${needsReview.length} of ${results.length} dimensions are not freshly successful.`
    : `All ${results.length} dimensions have fresh successful scheduled checks.`;
  const lines = [
    '# Quality Pulse',
    '',
    `**Reporting date:** ${date} UTC  ·  **Generated:** ${timestamp(generatedAt)}  ·  **Cutoff:** ${date} ${cutoff}`,
    '',
    `**Outcome:** ${aggregate} This is an informational review summary, not a required PR check or remediation verdict.`,
    '',
    '## Findings',
    ''
  ];
  if (needsReview.length) {
    for (const item of needsReview) {
      const state = item.result.state;
      const action = state === 'failed'
        ? 'Open the run and address the reported failure.'
        : state === 'unknown'
          ? 'Check Actions/API access and inspect the last available workflow run.'
          : state === 'missing' || state === 'stale'
            ? 'Check whether the scheduled workflow ran; dispatch it manually if needed.'
              : state === 'prior'
                ? "Check today's schedule; an earlier pass is not today's verification."
              : state === 'skipped'
                ? 'Confirm the skip is expected and arrange a full verification if not.'
              : 'Wait for completion or inspect the late run; rerun if it does not finish.';
      lines.push(`- **${item.name} — ${item.result.label}:** ${item.result.detail} ${action}`);
    }
  } else {
    lines.push('No material failures or missing coverage were reported.');
  }
  const performance = results.find((item) => item.name === 'Performance Integrity');
  lines.push('', ...renderPerformanceTrends(performance?.result), '');
  lines.push(
    '',
    '## Evidence',
    '',
    '| Dimension | Outcome | Measurement / run time (UTC) | Source / run | Useful detail or next action |',
    '| --- | --- | --- | --- | --- |'
  );
  for (const item of results) {
    const result = item.result;
    const source = result.run && runLink(result.run)
      ? `[main scheduled run](${runLink(result.run)})`
      : 'No run link available';
    const detail = item.name === 'Performance Integrity'
      ? performanceDetail(result)
      : result.detail;
    lines.push(
      `| ${item.name} | ${result.label} | ${result.run ? runTime(result.run) : 'not measured today'} | ${source} | ${detail.replace(/\|/g, '\\|')} |`
    );
  }
  lines.push(
    '',
    `Daily workflow runs are queried from \`main\` with \`schedule\` provenance. Runs must complete by ${cutoff} UTC to count as fresh; late or missing runs are not replaced with prior green results.`
  );
  return `${lines.join('\n')}\n`;
}

async function buildPulse({
  apiUrl,
  repository,
  token,
  date,
  generatedAt = new Date().toISOString(),
  fetchImpl = fetch,
  unzipImpl = execFileSync
}) {
  const results = await Promise.all(
    dimensions.map(async (dimension) => {
      try {
        const runs = await fetchRuns({
          apiUrl,
          repository,
          workflow: dimension,
          token,
          date,
          fetchImpl
        });
        const todayRun = runs
          .filter((run) => run.created_at?.slice(0, 10) === date)
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
        const previousRun = runs
          .filter(
            (run) =>
              run.conclusion === 'success' &&
              run.created_at?.slice(0, 10) < date
          )
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
        const evidenceRun = todayRun ?? previousRun;
        const completionByRunId = new Map();
        if (evidenceRun?.id && evidenceRun.status === 'completed') {
          completionByRunId.set(
            evidenceRun.id,
            await fetchRunCompletion({
              apiUrl,
              repository,
              runId: evidenceRun.id,
              token,
              fetchImpl
            })
          );
        }
        return {
          name: dimension.name,
          result: evaluateRuns(runs, date, cutoffTime, completionByRunId)
        };
      } catch (error) {
        return {
          name: dimension.name,
          result: {
            state: 'unknown',
            label: 'Unknown / API inaccessible',
            detail: `${error.message}; no result is inferred.`
          }
        };
      }
    })
  );
  const performance = results.find((item) => item.name === 'Performance Integrity');
  if (
    performance?.result.run?.id &&
    performance.result.run.status === 'completed' &&
    ['fresh', 'prior'].includes(performance.result.state) &&
    performance.result.run.conclusion === 'success'
  ) {
    try {
      const { data: comparison, artifact } = await fetchArtifactJson({
        apiUrl,
        repository,
        token,
        runId: performance.result.run.id,
        artifactName: 'performance-summary',
        fileName: 'performance-comparison.json',
        fetchImpl,
        includeMetadata: true,
        unzipImpl
      });
      if (!isPerformanceComparison(comparison)) {
        throw new Error('performance-comparison.json has an unsupported or incomplete structure');
      }
      const measurementDate = performance.result.run.created_at?.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(measurementDate ?? '')) {
        throw new Error('Performance Integrity run has no valid measurement date');
      }
      performance.result.baseline = describePerformanceComparison(comparison);
      performance.result.trends = {
        state: performance.result.state,
        measurementDate,
        comparison,
        runUrl: runLink(performance.result.run),
        artifactUrl: `https://github.com/${repository}/actions/runs/${performance.result.run.id}/artifacts/${artifact.id}`
      };
    } catch (error) {
      performance.result.baseline = `fixed reference: unknown; rolling baseline: unknown`;
      performance.result.trends = {
        reason: `comparison artifact unavailable or invalid (${error.message})`,
        baseline: performance.result.baseline,
        runUrl: runLink(performance.result.run)
      };
    }
  } else if (performance) {
    const result = performance.result;
    performance.result.trends = {
      reason: result.state === 'prior'
        ? 'no prior successful comparison artifact is available'
        : `today's Performance Integrity result is ${result.label.toLowerCase()}; no successful current trend is shown`,
      runUrl: runLink(result.run)
    };
  }
  const dependency = results.find((item) => item.name === 'Dependency Security');
  if (
    dependency?.result.run?.id &&
    dependency.result.run.status === 'completed' &&
    ['success', 'failure'].includes(dependency.result.run.conclusion)
  ) {
    try {
      const posture = await fetchArtifactJson({
        apiUrl,
        repository,
        token,
        runId: dependency.result.run.id,
        artifactName: 'dependency-posture',
        fileName: 'dependency-posture.json',
        fetchImpl
      });
      dependency.result = applyDependencyPosture(dependency.result, posture);
    } catch (error) {
      dependency.result = {
        ...dependency.result,
        state: 'unknown',
        label: 'Unknown / posture artifact unavailable',
        detail: `${error.message}; no clean dependency result is inferred.`
      };
    }
  }
  return renderPulse({ date, generatedAt, results });
}

async function main() {
  const date = process.env.PULSE_DATE ?? utcDate(new Date());
  const markdown = await buildPulse({
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    date,
    generatedAt: process.env.PULSE_GENERATED_AT ?? new Date().toISOString()
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
  process.stdout.write(markdown);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

export {
  applyDependencyPosture,
  buildPulse,
  completionEvidenceFromJobs,
  describePerformanceComparison,
  evaluateRuns,
  formatTrendDelta,
  homepageTrendRows,
  isPerformanceComparison,
  renderPerformanceTrends,
  renderPulse
};
