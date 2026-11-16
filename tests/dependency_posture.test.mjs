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
