import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCompleteSummary } from '../site/compare_performance.mjs';
import {
  formatPerformanceValue,
  performanceBudgets,
  performanceMeasurementContexts
} from '../site/performance_policy.mjs';

const dimensions = [
  ['common-code-quality', 'Common: Code Quality'],
  ['common-coherence-integrity', 'Common: Coherence Integrity'],
  ['common-dependency-security', 'Common: Dependency Security'],
  ['site-build-integrity', 'Site: Build Integrity'],
  ['site-link-integrity', 'Site: Link Integrity'],
  ['site-seo-integrity', 'Site: SEO Integrity'],
  ['site-rendering-integrity', 'Site: Rendering Integrity'],
  ['site-performance-integrity', 'Site: Performance Integrity']
];

function performanceFinding(violation, confirmed) {
  const { route, formFactor, metric, criterion, value, confirmationValue,
    limit, referenceValue, delta, deltaPercentage } = violation ?? {};
  if (!validText(route, 240) || !Object.hasOwn(performanceBudgets[formFactor] ?? {}, metric) ||
      !Number.isFinite(value) || (confirmed && !Number.isFinite(confirmationValue))) return undefined;

  const initial = formatPerformanceValue(metric, value);
  const measurement = confirmed
    ? `${initial} initially, ${formatPerformanceValue(metric, confirmationValue)} confirmed`
    : `${initial} initially`;
  if (criterion === 'absolute' && Number.isFinite(limit)) {
    return `${route} (${formFactor}) ${metric}: ${measurement} vs ${formatPerformanceValue(metric, limit)} limit`;
  }
  if (criterion === 'reference-deterioration' && metric === 'largest-contentful-paint' &&
      [referenceValue, delta, deltaPercentage].every(Number.isFinite)) {
    return `${route} (${formFactor}) LCP: ${measurement} vs reference ${formatPerformanceValue(metric, referenceValue)} (Δ ${formatPerformanceValue(metric, delta)}, ${deltaPercentage > 0 ? '+' : ''}${deltaPercentage.toFixed(1)}%)`;
  }
  return undefined;
}

function performanceFindings(violations, confirmed) {
  if (!Array.isArray(violations)) return [];
  const findings = [];
  for (const violation of violations) {
    const finding = performanceFinding(violation, confirmed);
    if (finding) findings.push(finding);
    if (findings.length === 3) break;
  }
  return findings;
}

function performancePolicyResult(result, policy) {
  if (policy?.status === 'failed') {
    const findings = performanceFindings(policy.confirmedViolations, true);
    if (!findings.length) return unavailable(result, 'The policy reported failure without valid confirmed violations. Inspect the confirmation step.');
    return {
      state: 'failed',
      detail: `Confirmed performance violations: ${findings.join('; ')}. Correct the affected profiles and rerun Performance Integrity.`
    };
  }
  if (['incomplete', 'confirmation-required', 'pending'].includes(policy?.status)) {
    const reason = boundedText(policy.confirmationReason, 300) ?? 'required confirmation evidence is unavailable';
    const findings = performanceFindings(policy.confirmations ?? policy.initialViolations, false);
    const affected = findings.length ? ` Affected profiles: ${findings.join('; ')}.` : '';
    return {
      state: 'incomplete',
      detail: `Performance confirmation incomplete (${reason}).${affected} Rerun Performance Integrity to complete confirmation.`
    };
  }
  if (policy?.status !== 'passed') {
    return unavailable(result, 'The final performance assessment is missing or invalid. Inspect the measurement or confirmation step.');
  }
  return result.state === 'failed'
    ? { ...result, detail: 'The policy reported no confirmed violation, but another required step failed. Inspect the failed step.' }
    : result;
}

function describePerformanceComparison(comparison) {
  const fixed = comparison.fixedReference;
  const fixedState = fixed?.available === true
    ? 'available'
    : typeof fixed?.reason !== 'string'
      ? 'unknown'
      : /different tool|runner environment/i.test(fixed.reason)
        ? 'incompatible'
        : /no (?:versioned successful|complete reviewed successful) main reference/i.test(fixed.reason)
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
    (value.measurementContext === undefined || value.measurementContext === performanceMeasurementContexts.full) &&
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
  const fixedAvailable = comparison.fixedReference.available === true;
  const rollingAvailable = rollingBaselineState(comparison.history) === 'available 28/28';
  const measures = [
    ['mobile', 'largest-contentful-paint', 'Mobile LCP'],
    ['mobile', 'total-blocking-time', 'Mobile TBT'],
    ['desktop', 'largest-contentful-paint', 'Desktop LCP']
  ];
  return measures.flatMap(([formFactor, metric, label]) => {
    const result = comparison.comparisons.find(
      (item) => item?.route === '/' && String(item.formFactor).toLowerCase() === formFactor
    );
    if (!result || !Object.hasOwn(result.deltas ?? {}, metric)) return [];
    return [{
      label,
      fixed: fixedAvailable ? formatTrendDelta(result.deltas?.[metric]?.fixed) : '—',
      rolling: rollingAvailable ? formatTrendDelta(result.deltas?.[metric]?.rolling) : '—'
    }];
  });
}

const successfulStates = ['passed', 'advisory'];
const statuses = {
  passed: 'Passed', advisory: 'Advisory', failed: 'Failed', unknown: 'Unknown',
  missing: 'Missing', skipped: 'Skipped', cancelled: 'Cancelled',
  incomplete: 'Incomplete'
};

function jobResult(job) {
  if (!job) return { state: 'missing', detail: 'No result from the job in this cycle.' };
  switch (job.result) {
    case 'success': return { state: 'passed' };
    case 'failure': return { state: 'failed', detail: 'Inspect the failed job.' };
    case 'skipped': return { state: 'skipped', detail: 'Confirm the skip was intentional.' };
    case 'cancelled': return { state: 'cancelled', detail: 'Rerun the incomplete check.' };
    default: return { state: 'unknown', detail: 'Job outcome is unrecognized.' };
  }
}

function validText(text, limit) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= limit;
}

function boundedText(value, limit) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function validSha(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function linkResult(job, result) {
  const status = job?.outputs?.status;
  if (status === 'failure') {
    return {
      state: 'failed',
      detail: 'Confirmed link defects. Inspect the audit report.' +
        (job.result === 'cancelled' ? ' The job was cancelled after the audit.'
          : job.result !== 'failure' ? ' Job and audit outcomes disagree.' : '')
    };
  }
  if (result.state === 'passed' && status === 'success') return result;
  if (result.state === 'passed' && status === 'advisory') {
    return { state: 'advisory', detail: 'Review uncertain external responses in the audit report.' };
  }
  if (result.state === 'failed' && [undefined, '', 'incomplete'].includes(status)) {
    return { state: 'incomplete', detail: 'Link evidence is incomplete. Inspect the job and rerun.' };
  }
  return ['passed', 'failed'].includes(result.state)
    ? { state: 'unknown', detail: 'Job and link-audit outcomes are missing or disagree.' }
    : result;
}

async function readArtifact({
  apiUrl, repository, token, runId, branch, validatorRevision, fetchImpl, unzipImpl
}, name, fileNames = [`${name}.json`]) {
  if (!token) throw new Error('GitHub Actions read token is unavailable');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: ['Bearer', token].join(' '),
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const endpoint = new URL(`/repos/${repository}/actions/runs/${runId}/artifacts`, apiUrl);
  endpoint.search = new URLSearchParams({ name, per_page: '100' });
  const list = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(15_000) });
  if (!list.ok) throw new Error(`Artifacts API returned HTTP ${list.status}`);
  const { artifacts } = await list.json();
  if (!Array.isArray(artifacts)) throw new Error('Artifacts API returned an unreadable artifact list');
  const matches = artifacts.filter((item) => item?.name === name && item.expired === false);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id < 1) {
    throw new Error(`${name} artifact is missing, expired or ambiguous`);
  }
  const { id, workflow_run: source, size_in_bytes: archiveSize } = matches[0];
  if (source && (
    String(source.id) !== String(runId) ||
    source.head_branch !== branch ||
    source.head_sha !== validatorRevision
  )) {
    throw new Error(`${name} artifact came from a different cycle, branch or revision`);
  }
  const artifactUrl = `https://github.com/${repository}/actions/runs/${runId}/artifacts/${id}`;

  const archiveLimit = 10 * 1024 * 1024;
  if (archiveSize > archiveLimit) throw new Error(`${name} archive exceeded 10 MB`);
  const download = await fetchImpl(new URL(`/repos/${repository}/actions/artifacts/${id}/zip`, apiUrl), {
    headers, signal: AbortSignal.timeout(30_000)
  });
  if (!download.ok) throw new Error(`${name} download returned HTTP ${download.status}`);
  const archive = Buffer.from(await download.arrayBuffer());
  if (archive.length > archiveLimit) throw new Error(`${name} archive exceeded 10 MB`);
  const directory = mkdtempSync(join(tmpdir(), 'agency-quality-pulse-'));
  try {
    const path = join(directory, `${name}.zip`);
    writeFileSync(path, archive);
    const files = fileNames.map((fileName) => JSON.parse(unzipImpl('unzip', ['-p', path, fileName], {
      encoding: 'utf8', maxBuffer: 1_000_000, stdio: ['ignore', 'pipe', 'ignore']
    })));
    return { artifactUrl, files };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function unavailable(result, detail) {
  return {
    ...result,
    state: successfulStates.includes(result.state) ? 'unknown' : result.state,
    detail: [successfulStates.includes(result.state) ? undefined : result.detail, detail]
      .filter(Boolean).join(' ')
  };
}

async function dependencyResult(result, cycle) {
  if (!['passed', 'failed'].includes(result.state)) return result;
  try {
    const { artifactUrl, files: [posture] } = await readArtifact(cycle, 'dependency-posture');
    const detail = boundedText(posture?.detail, 2000);
    switch (posture?.status) {
      case 'passed': return {
        ...result, artifactUrl,
        detail: result.state === 'failed'
          ? 'Posture reported a pass despite the failed job. Inspect the failed step.'
          : detail ?? 'No open Dependabot alerts met the review threshold.'
      };
      case 'review': return {
        state: 'failed', artifactUrl,
        detail: detail ?? 'Review the Dependabot findings.'
      };
      case 'unknown': return {
        state: 'unknown', artifactUrl,
        detail: (detail ?? 'Dependency posture is unavailable.') +
          (result.state === 'passed' ? ' Job succeeded despite the unknown API outcome.' : '')
      };
      default: throw new Error('invalid posture outcome');
    }
  } catch (error) {
    return unavailable(result, `Dependency posture unavailable (${error.message}).`);
  }
}

async function performanceResult(result, cycle) {
  if (!['passed', 'failed'].includes(result.state)) return result;
  try {
    const { artifactUrl, files: [comparison, summary] } = await readArtifact(
      cycle, 'performance-summary', ['performance-comparison.json', 'performance-summary.json']
    );
    const { measurementContext = performanceMeasurementContexts.full } = summary?.conditions ?? {};
    if (
      !isPerformanceComparison(comparison) ||
      !isCompleteSummary(summary) ||
      measurementContext !== performanceMeasurementContexts.full ||
      summary.source?.eventName !== cycle.eventName ||
      summary.source?.branch !== cycle.branch ||
      !validSha(cycle.validatorRevision) || summary.source?.sha !== cycle.validatorRevision ||
      String(summary.source?.runId) !== String(cycle.runId)
    ) throw new Error('context or cycle provenance does not match');
    const measurementDate = summary.capturedAt?.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(measurementDate ?? '')) {
      throw new Error('measurement date is unavailable');
    }

    const outcome = performancePolicyResult(result, comparison.policy);
    return outcome.state === 'passed'
      ? { ...outcome, artifactUrl, comparison, measurementDate }
      : { ...outcome, artifactUrl };
  } catch (error) {
    return unavailable(result, `Performance evidence unavailable (${error.message}). Inspect the measurement or confirmation step.`);
  }
}

async function dimensionResult(id, job, cycle) {
  const result = jobResult(job);
  switch (id) {
    case 'common-dependency-security': return dependencyResult(result, cycle);
    case 'site-link-integrity': return linkResult(job, result);
    case 'site-performance-integrity': return performanceResult(result, cycle);
    default: return result;
  }
}

function markdownText(value) {
  return value.replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/https?:|[&<>\\`*_[\]|~@]/gi, (match) =>
      match.length > 1 ? `${match.slice(0, -1)}&#58;` : `&#${match.charCodeAt(0)};`);
}

function renderPulse(results, { runUrl, eventName, branch, validatorRevision, repository }) {
  const passed = results.filter((item) => item.state === 'passed').length;
  const advisories = results.filter((item) => item.state === 'advisory').length;
  const attention = results.length - passed - advisories;
  const outcome = attention ? `Review required for ${attention} of ${results.length} checks.`
    : advisories ? `Cycle passed with advisories (${advisories} of ${results.length} checks).`
      : `All ${passed} checks passed.`;
  const lines = [
    '# Quality Pulse', '',
    `[Cycle](${runUrl}) · ${markdownText(eventName)} on ${markdownText(branch)} · revision ${markdownText(validatorRevision ?? 'unavailable')}`,
    '', `**${outcome}**`, '',
    '| Check | Outcome | Evidence and findings |',
    '| --- | --- | --- |'
  ];
  for (const item of results) {
    const detail = boundedText(item.detail, 8500);
    const evidence = [detail && markdownText(detail), item.artifactUrl && `[Artifact](${item.artifactUrl})`].filter(Boolean);
    lines.push(`| ${item.name} | ${statuses[item.state]} | ${evidence.join(' · ') || '—'} |`);
  }

  const performance = results.find((item) => item.id === 'site-performance-integrity');
  if (performance?.comparison) {
    const { comparison, measurementDate } = performance;
    const fixed = comparison.fixedReference.runUrl;
    const runPrefix = `https://github.com/${repository}/actions/runs/`;
    const fixedSource = comparison.fixedReference.available && typeof fixed === 'string' &&
      fixed.startsWith(runPrefix) && /^\d+$/.test(fixed.slice(runPrefix.length)) && fixed !== runUrl
      ? ` · [Fixed reference run](${fixed})` : '';
    lines.push(
      '', '## Performance trends', '',
      `Full-experience homepage, ${measurementDate} UTC. ${describePerformanceComparison(comparison)}${fixedSource}.`,
      'Positive deltas mean higher values. Rolling history is informational.', '',
      '| Measure | Fixed Δ | Rolling Δ |', '| --- | --- | --- |'
    );
    const rows = homepageTrendRows(comparison);
    if (!rows.length) lines.push('| Homepage metrics | — | — |');
    for (const row of rows) lines.push(`| ${row.label} | ${row.fixed} | ${row.rolling} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function buildOrchestratedPulse({
  needs = {}, eventName = 'schedule', branch = 'main', fetchImpl = fetch,
  unzipImpl = execFileSync, ...options
}) {
  const cycle = { ...options, eventName, branch, fetchImpl, unzipImpl };
  const results = await Promise.all(dimensions.map(async ([id, name]) => ({
    id, name, ...await dimensionResult(id, needs?.[id], cycle)
  })));
  return {
    results,
    markdown: renderPulse(results, cycle),
    successful: results.every((item) => successfulStates.includes(item.state))
  };
}

async function main() {
  const pulse = await buildOrchestratedPulse({
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    needs: JSON.parse(process.env.PULSE_RESULTS_JSON ?? '{}'),
    runId: process.env.PULSE_RUN_ID,
    runUrl: process.env.PULSE_RUN_URL,
    eventName: process.env.PULSE_EVENT_NAME,
    branch: process.env.PULSE_RUN_BRANCH,
    validatorRevision: process.env.PULSE_SOURCE_REVISION
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, pulse.markdown);
  process.stdout.write(pulse.markdown);
  if (!pulse.successful) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}

export { buildOrchestratedPulse };
