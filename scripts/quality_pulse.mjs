import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dimensions = [
  { name: 'Build Integrity', file: 'build-integrity.yml' },
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
  return timestamp(run.completed_at ?? run.created_at);
}

function runLink(run) {
  return run.html_url ?? '';
}

function evaluateRuns(runs, date, cutoff = cutoffTime) {
  const dailyRuns = runs
    .filter((run) => run.created_at?.slice(0, 10) === date)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const cutoffAt = new Date(`${date}T${cutoff}`);
  const today = dailyRuns[0];
  if (today) {
    if (today.conclusion === 'failure' || today.conclusion === 'timed_out') {
      return {
        state: 'failed',
        label: 'Fresh — failed',
        run: today,
        detail: 'Open the workflow run for findings and the next corrective action.'
      };
    }
    if (today.conclusion === 'cancelled') {
      return {
        state: 'failed',
        label: 'Cancelled',
        run: today,
        detail: 'The scheduled verification was cancelled; inspect the run and rerun if appropriate.'
      };
    }
    if (today.conclusion === 'skipped') {
      return {
        state: 'skipped',
        label: 'Skipped',
        run: today,
        detail: 'The daily verification was skipped; confirm whether the skip was intentional.'
      };
    }
    if (today.status !== 'completed') {
      return {
        state: 'late',
        label: 'Late / incomplete',
        run: today,
        detail: `The scheduled run was still ${today.status ?? 'incomplete'} at the ${cutoff} cutoff.`
      };
    }
    if (today.conclusion === 'success') {
      if (
        !today.completed_at ||
        Number.isNaN(Date.parse(today.completed_at)) ||
        Date.parse(today.completed_at) > cutoffAt.valueOf()
      ) {
        return {
          state: 'late',
          label: 'Late',
          run: today,
          detail: `The successful run completed after the ${cutoff} cutoff; today's result is late.`
        };
      }
      return {
        state: 'fresh',
        label: 'Fresh — passed',
        run: today,
        detail: 'Daily scheduled verification completed before the cutoff.'
      };
    }
    return {
      state: 'unknown',
      label: 'Unknown outcome',
      run: today,
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
      run: previous,
      detail: `No fresh run today. Last successful verification was ${ageDays} day(s) earlier; do not treat it as today's check.`
    };
  }
  return {
    state: 'stale',
    label: 'Stale',
    run: previous,
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
  return `${result.detail} Fixed-reference and rolling-baseline state is available only in the linked run summary.`;
}

function describePerformanceComparison(comparison) {
  if (!comparison) {
    return 'fixed reference: unavailable; rolling baseline: unavailable';
  }
  const fixed = comparison.fixedReference;
  const fixedState = fixed?.available
    ? 'available'
    : fixed?.reason?.includes('different tool')
      ? 'not comparable (tool or runner differs)'
      : 'pending reviewed main anchor';
  const history = comparison.history ?? {};
  const rollingState = history.status === 'available'
    ? `available (${history.availableDailySamples ?? 0}/${history.requiredDailySamples ?? 28})`
    : history.status === 'unavailable'
      ? 'unavailable'
      : `collecting (${history.availableDailySamples ?? 0}/${history.requiredDailySamples ?? 28})`;
  return `fixed reference: ${fixedState}; rolling baseline: ${rollingState}`;
}

async function fetchPerformanceComparison({
  apiUrl,
  repository,
  token,
  runId,
  fetchImpl
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
  artifactsUrl.search = new URLSearchParams({ name: 'performance-summary', per_page: '100' });
  const listResponse = await fetchImpl(artifactsUrl, {
    headers,
    signal: AbortSignal.timeout(15_000)
  });
  if (!listResponse.ok) throw new Error(`Artifacts API returned HTTP ${listResponse.status}`);
  const artifact = (await listResponse.json()).artifacts?.find(
    (item) => item.name === 'performance-summary' && !item.expired
  );
  if (!artifact) throw new Error('90-day performance summary artifact is missing or expired');
  const downloadUrl = new URL(
    `/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
    apiUrl
  );
  const downloadResponse = await fetchImpl(downloadUrl, {
    headers,
    signal: AbortSignal.timeout(30_000)
  });
  if (!downloadResponse.ok) {
    throw new Error(`Performance summary artifact download returned HTTP ${downloadResponse.status}`);
  }
  const archive = Buffer.from(await downloadResponse.arrayBuffer());
  if (archive.length > 10 * 1024 * 1024) {
    throw new Error('Performance summary artifact exceeded the 10 MB safety limit');
  }
  const directory = mkdtempSync(join(tmpdir(), 'agency-quality-pulse-'));
  const archivePath = join(directory, 'performance-summary.zip');
  try {
    writeFileSync(archivePath, archive);
    const json = execFileSync(
      'unzip',
      ['-p', archivePath, 'performance-comparison.json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return JSON.parse(json);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function renderPulse({ date, generatedAt, results, cutoff = cutoffTime }) {
  const needsReview = results.filter((item) => item.result.state !== 'fresh');
  const aggregate = needsReview.length
    ? `Review required — ${needsReview.length} of ${results.length} dimensions are not freshly successful.`
    : `All ${results.length} dimensions have fresh successful scheduled checks.`;
  const lines = [
    '# Agency Quality Pulse',
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
  fetchImpl = fetch
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
        return {
          name: dimension.name,
          result: evaluateRuns(runs, date, cutoffTime)
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
    ['fresh', 'failed'].includes(performance.result.state)
  ) {
    try {
      const comparison = await fetchPerformanceComparison({
        apiUrl,
        repository,
        token,
        runId: performance.result.run.id,
        fetchImpl
      });
      performance.result.baseline = describePerformanceComparison(comparison);
    } catch (error) {
      performance.result.baseline = `fixed reference: unknown; rolling baseline: unknown (${error.message})`;
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

export { buildPulse, describePerformanceComparison, evaluateRuns, renderPulse };
