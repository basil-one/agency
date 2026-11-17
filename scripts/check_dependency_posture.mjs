const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };

function escapeMarkdown(value) {
  return String(value ?? 'unknown').replace(/[|`<>]/g, '\\$&');
}

function sanitizeDiagnostic(value, token) {
  if (typeof value !== 'string') return '';
  return value
    .replaceAll(token, '[REDACTED]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
    .replace(/[\\|`<>[\]{}*_!#]/g, '\\$&');
}

async function getApiErrorDetails(response, token) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  const message = sanitizeDiagnostic(body?.message, token);
  const rawDocumentationUrl = body?.documentation_url;
  let documentationUrl = '';
  if (typeof rawDocumentationUrl === 'string') {
    try {
      const url = new URL(rawDocumentationUrl);
      if (
        url.protocol === 'https:' &&
        ['docs.github.com', 'github.com'].includes(url.hostname)
      ) {
        documentationUrl = `${url.origin}${url.pathname}`;
      }
    } catch {
      documentationUrl = '';
    }
  }
  const requestId = response.headers?.get?.('x-github-request-id') ?? '';
  const safeRequestId = /^[a-zA-Z0-9-]{1,100}$/.test(requestId)
    ? requestId
    : '';
  return { message, documentationUrl, requestId: safeRequestId };
}

async function checkDependencyPosture({
  apiUrl,
  repository,
  token,
  fetchImpl = fetch
}) {
  const lines = ['# Dependency Security', '', '## Outcome', ''];
  if (!token || !/^[^/]+\/[^/]+$/.test(repository ?? '')) {
    lines.push('**Unknown — GitHub API credentials or repository are unavailable.**');
    return {
      status: 'unknown',
      alerts: [],
      detail: 'GitHub API credentials or repository are unavailable',
      markdown: lines.join('\n')
    };
  }

  const alerts = [];
  try {
    for (let page = 1; page <= 100; page += 1) {
      const url = new URL(
        `/repos/${repository}/dependabot/alerts`,
        apiUrl
      );
      url.search = new URLSearchParams({
        state: 'open',
        per_page: '100',
        page: String(page)
      });
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: ['Bearer', token].join(' '),
          'X-GitHub-Api-Version': '2022-11-28'
        },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) {
        const errorDetails = await getApiErrorDetails(response, token);
        const detail = `GitHub Dependabot alerts API returned HTTP ${response.status}${errorDetails.message ? `: ${errorDetails.message}` : ''}`;
        lines.push(`**Unknown — ${detail}.**`);
        if (errorDetails.documentationUrl) {
          lines.push(`- Documentation: ${errorDetails.documentationUrl}`);
        }
        if (errorDetails.requestId) {
          lines.push(`- GitHub request ID: ${errorDetails.requestId}.`);
        }
        return {
          status: 'unknown',
          alerts: [],
          detail: [
            detail,
            errorDetails.documentationUrl
              ? `Documentation: ${errorDetails.documentationUrl}`
              : '',
            errorDetails.requestId
              ? `GitHub request ID: ${errorDetails.requestId}`
              : ''
          ].filter(Boolean).join('\n'),
          markdown: lines.join('\n')
        };
      }
      const pageAlerts = await response.json();
      if (!Array.isArray(pageAlerts)) {
        lines.push('**Unknown — GitHub returned an unreadable Dependabot alert response.**');
        return {
          status: 'unknown',
          alerts: [],
          detail: 'GitHub returned an unreadable Dependabot alert response',
          markdown: lines.join('\n')
        };
      }
      alerts.push(...pageAlerts);
      if (pageAlerts.length < 100) break;
      if (page === 100) {
        lines.push('**Unknown — alert pagination exceeded the 100-page safety limit.**');
        return {
          status: 'unknown',
          alerts: [],
          detail: 'Alert pagination exceeded the 100-page safety limit',
          markdown: lines.join('\n')
        };
      }
    }
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    lines.push(`**Unknown — GitHub Dependabot alerts API ${reason}.**`);
    return {
      status: 'unknown',
      alerts: [],
      detail: `GitHub Dependabot alerts API ${reason}`,
      markdown: lines.join('\n')
    };
  }

  const reviewAlerts = alerts.filter((alert) => {
    const severity = alert.security_advisory?.severity;
    return severityRank[severity] === undefined || severityRank[severity] >= 1;
  });
  const lowAlerts = alerts.filter(
    (alert) => alert.security_advisory?.severity === 'low'
  );
  const status = reviewAlerts.length ? 'review' : 'passed';
  const detail = status === 'passed'
    ? 'No open medium-or-higher Dependabot alerts'
    : `${reviewAlerts.length} open alert(s) are medium-or-higher or have unknown severity`;
  lines.push(
    status === 'passed'
      ? '**Posture checked — no open medium-or-higher Dependabot alerts.**'
      : `**Review needed — ${reviewAlerts.length} open alert(s) are medium-or-higher or have unknown severity.**`,
    '',
    `- Open alerts checked across enabled dependency ecosystems: ${alerts.length}.`,
    `- Open low-severity alerts: ${lowAlerts.length}.`
  );
  for (const alert of reviewAlerts.slice(0, 20)) {
    const packageName = escapeMarkdown(alert.dependency?.package?.name);
    const severity = escapeMarkdown(alert.security_advisory?.severity);
    const manifest = escapeMarkdown(alert.dependency?.manifest_path);
    const link = Number.isInteger(alert.number)
      ? ` [alert ${alert.number}](${`https://github.com/${repository}/security/dependabot/${alert.number}`})`
      : '';
    lines.push(`- ${severity}: \`${packageName}\` in \`${manifest}\`${link}.`);
  }
  if (reviewAlerts.length > 20) {
    lines.push(`- ${reviewAlerts.length - 20} additional alerts omitted; review the repository's Dependabot alerts.`);
  }
  lines.push(
    '',
    'This daily repository posture uses open Dependabot alerts across enabled ecosystems; the PR check separately reviews only the proposed dependency diff.'
  );
  return {
    status,
    alerts,
    reviewAlerts: reviewAlerts.length,
    lowAlerts: lowAlerts.length,
    detail,
    markdown: lines.join('\n')
  };
}

async function main() {
  const result = await checkDependencyPosture({
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN
  });
  process.stdout.write(`${result.markdown}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.markdown}\n`);
  }
  if (process.env.DEPENDENCY_POSTURE_FILE) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      process.env.DEPENDENCY_POSTURE_FILE,
      `${JSON.stringify({
        status: result.status,
        detail: result.detail,
        openAlerts: result.alerts.length,
        reviewAlerts: result.reviewAlerts ?? 0,
        lowAlerts: result.lowAlerts ?? 0
      }, null, 2)}\n`
    );
  }
  if (result.status !== 'passed') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export { checkDependencyPosture };
