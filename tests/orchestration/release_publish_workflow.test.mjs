import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('release workflow is manual, main-only, serialized, and read-only while disabled', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/release-publish.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^name: "Release Publish"$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /^      version:$/m);
  assert.match(workflow, /^  release-publish:\n    name: "Release Publish"$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /group: release-publish\n  cancel-in-progress: false/);
  assert.match(workflow, /checks: read/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write/);
  assert.match(workflow, /Checked-out revision:.*git rev-parse HEAD/);
  assert.match(workflow, /python3 scripts\/orchestration\/release_publish\.py --version "\$VERSION"/);
  assert.doesNotMatch(workflow, /workflow_call:|schedule:|pull_request:|--force|--admin|pdf|upload-artifact/i);
});
