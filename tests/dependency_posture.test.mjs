import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDependencyPosture } from '../scripts/check_dependency_posture.mjs';

const options = {
  apiUrl: 'https://api.github.com',
  repository: 'basil-one/agency',
  token: 'test-token'
};

test('daily dependency posture passes only after readable empty alert response', async () => {
  const result = await checkDependencyPosture({
    ...options,
    fetchImpl: async () => ({
      ok: true,
      json: async () => []
    })
  });
  assert.equal(result.status, 'passed');
  assert.match(result.markdown, /no open medium-or-higher Dependabot alerts/);
});

test('medium-or-higher and unknown severity alerts require review', async () => {
  const result = await checkDependencyPosture({
    ...options,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [
        {
          number: 7,
          dependency: {
            package: { name: 'example-package' },
            manifest_path: 'Gemfile.lock'
          },
          security_advisory: { severity: 'high' }
        }
      ]
    })
  });
  assert.equal(result.status, 'review');
  assert.match(result.markdown, /example-package/);
  assert.match(result.markdown, /alert 7/);
});

test('API permission failures are unknown and never green', async () => {
  const result = await checkDependencyPosture({
    ...options,
    fetchImpl: async () => ({ ok: false, status: 403 })
  });
  assert.equal(result.status, 'unknown');
  assert.match(result.markdown, /Unknown — GitHub Dependabot alerts API returned HTTP 403/);
});

test('API failures report sanitized GitHub diagnostics without exposing response data', async () => {
  let requestedUrl;
  let requestedOptions;
  const result = await checkDependencyPosture({
    ...options,
    fetchImpl: async (url, requestOptions) => {
      requestedUrl = url;
      requestedOptions = requestOptions;
      return {
        ok: false,
        status: 400,
        json: async () => ({
          message: `Invalid request: ${options.token}\nplease retry`,
          documentation_url: 'https://docs.github.com/rest/repos/repos#list-repository-dependabot-alerts?secret=value',
          sensitive_field: 'must not be logged'
        }),
        headers: {
          get: (name) => name === 'x-github-request-id' ? 'ABCD-1234' : null
        }
      };
    }
  });

  assert.equal(result.status, 'unknown');
  assert.match(result.detail, /HTTP 400/);
  assert.ok(result.detail.includes('Invalid request: \\[REDACTED\\] please retry'));
  assert.match(result.detail, /Documentation: https:\/\/docs\.github\.com\/rest\/repos\/repos/);
  assert.match(result.detail, /GitHub request ID: ABCD-1234/);
  assert.doesNotMatch(result.detail, /test-token|sensitive_field|must not be logged|secret=value/);
  assert.equal(requestedUrl.href, 'https://api.github.com/repos/basil-one/agency/dependabot/alerts?state=open&per_page=100&page=1');
  assert.equal(requestedOptions.headers.Accept, 'application/vnd.github+json');
  assert.equal(requestedOptions.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(requestedOptions.headers.Authorization, ['Bearer', 'test-token'].join(' '));
});
