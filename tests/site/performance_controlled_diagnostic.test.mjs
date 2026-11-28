import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { assessPerformance, performanceBudgets } from '../../scripts/site/performance_policy.mjs';
import { buildLighthouseArgs } from '../../scripts/site/measure_performance.mjs';

function runLighthouse(args, chromePath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      resolve('node_modules/lighthouse/cli/index.js'),
      ...args
    ], {
      env: { ...process.env, CHROME_PATH: chromePath },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Lighthouse exited with code ${code}.\n${stderr}`));
    });
  });
}

test('controlled Lighthouse still measures and blocks a first-party TBT regression', {
  timeout: 180_000
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agency-controlled-performance-'));
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Controlled performance fixture</title>
<script async src="https://www.googletagmanager.com/gtag/js?id=diagnostic"></script>
<script defer src="/assets/regression.js"></script>
</head><body><main>First-party controlled measurement fixture</main></body></html>`;
  const javascript = `fetch('/executed', { cache: 'no-store' });
setTimeout(() => {
  const end = performance.now() + 1800;
  while (performance.now() < end) {}
  document.body.dataset.regressionComplete = 'true';
}, 250);`;
  let firstPartyExecutionObserved = false;
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(html);
    } else if (request.url === '/assets/regression.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(javascript);
    } else if (request.url === '/executed') {
      firstPartyExecutionObserved = true;
      response.writeHead(204);
      response.end();
    } else {
      response.writeHead(404);
      response.end();
    }
  });

  try {
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolvePromise);
    });
    const address = server.address();
    const reportPath = join(directory, 'controlled-regression.json');
    await runLighthouse(buildLighthouseArgs({
      url: `http://127.0.0.1:${address.port}/`,
      outputPath: reportPath,
      formFactor: 'mobile',
      measurementContext: 'pr-controlled'
    }), chromium.executablePath());

    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const requests = report.audits['network-requests']?.details?.items;
    assert.ok(Array.isArray(requests), 'Lighthouse must include network request evidence');
    assert.equal(firstPartyExecutionObserved, true, 'first-party JavaScript must execute in the browser');
    assert.ok(requests.some((request) =>
      request.url.endsWith('/assets/regression.js') &&
      request.resourceType === 'Script' &&
      request.statusCode === 200 &&
      request.transferSize > 0
    ), 'first-party regression script must be included in Lighthouse network evidence');
    const analyticsRequests = requests.filter((request) =>
      request.url.includes('googletagmanager.com/gtag/js')
    );
    assert.ok(analyticsRequests.length > 0, 'controlled report must retain blocked analytics request evidence');
    assert.ok(analyticsRequests.every((request) =>
      request.statusCode === -1 && request.transferSize === 0
    ), 'controlled Lighthouse must block analytics script execution without transfer');

    const tbt = report.audits['total-blocking-time']?.numericValue;
    assert.ok(Number.isFinite(tbt), 'Lighthouse must report numeric TBT');
    const assessment = assessPerformance([{
      route: '/',
      formFactor: 'mobile',
      values: {
        'largest-contentful-paint': report.audits['largest-contentful-paint']?.numericValue,
        'total-blocking-time': tbt,
        'cumulative-layout-shift': report.audits['cumulative-layout-shift']?.numericValue
      }
    }], [], false, 'No controlled reference is available.');

    assert.ok(tbt > performanceBudgets.mobile['total-blocking-time'],
      `expected induced first-party TBT > ${performanceBudgets.mobile['total-blocking-time']} ms; received ${tbt} ms`);
    assert.equal(assessment.status, 'confirmation-required');
    assert.equal(assessment.initialViolations[0].criterion, 'absolute');
    process.stdout.write(`Controlled first-party diagnostic: TBT ${Math.round(tbt)} ms; safeguard ${assessment.status}.\n`);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
    rmSync(directory, { recursive: true, force: true });
  }
});
