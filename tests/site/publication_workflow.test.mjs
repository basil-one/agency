import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/site-publish.yml', import.meta.url),
  'utf8'
);

test('Site: Publish runs only for main pushes or manual main recovery', () => {
  assert.match(workflow, /^name: "Site: Publish"$/m);
  assert.match(workflow, /^on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:$/m);
  assert.doesNotMatch(workflow, /^  (?:pull_request|workflow_call|schedule):/m);
  assert.match(workflow, /^    if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(
    workflow,
    /^    if: github\.ref == 'refs\/heads\/main' && needs\.site-publish-build\.outputs\.source_sha == github\.sha$/m
  );
  assert.match(workflow, /group: github-pages\n  cancel-in-progress: false/);
});

test('Site: Publish builds the frozen production site from the triggering revision', () => {
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /uses: actions\/checkout@v5\n        with:\n          ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false/);
  assert.match(workflow, /ruby-version: '3\.3'\n          bundler-cache: true\n        env:\n          BUNDLE_FROZEN: 'true'/);
  assert.match(workflow, /run: bundle exec jekyll build --trace\n        env:\n          JEKYLL_ENV: production/);
  assert.match(workflow, /run: test -s _site\/CNAME/);
  assert.match(
    workflow,
    /source_sha="\$\(git rev-parse HEAD\)"\n          test "\$source_sha" = "\$GITHUB_SHA"\n          echo "sha=\$source_sha" >> "\$GITHUB_OUTPUT"/
  );
});

test('Site: Publish uses one named Pages artifact and least-privilege job permissions', () => {
  assert.match(workflow, /  site-publish-build:\n    name: Build site/);
  assert.match(workflow, /  site-publish-deploy:\n    name: Deploy site/);
  assert.match(workflow, /    permissions:\n      contents: read\n      pages: read/);
  assert.match(
    workflow,
    /uses: actions\/upload-pages-artifact@v5\n        with:\n          name: github-pages\n          path: _site/
  );
  assert.match(workflow, /needs: site-publish-build\n    permissions:\n      contents: read\n      pages: write\n      id-token: write/);
  assert.match(workflow, /environment:\n      name: github-pages/);
  assert.match(workflow, /uses: actions\/deploy-pages@v5\n        with:\n          artifact_name: github-pages/);
  assert.doesNotMatch(workflow, /actions\/download-artifact/);
});

test('Site: Publish refuses stale or non-main output immediately before deployment', () => {
  const deployJob = workflow.split('  site-publish-deploy:\n')[1];
  const deployAction = deployJob.indexOf('uses: actions/deploy-pages@v5');
  const latestMainCheck = deployJob.indexOf('name: Verify source is still the latest main revision');

  assert.ok(latestMainCheck >= 0 && latestMainCheck < deployAction);
  assert.match(deployJob.slice(latestMainCheck, deployAction), /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(deployJob.slice(latestMainCheck, deployAction), /test "\$SOURCE_SHA" = "\$GITHUB_SHA"/);
  assert.match(deployJob.slice(latestMainCheck, deployAction), /gh api "repos\/\$GITHUB_REPOSITORY\/commits\/main" --jq \.sha/);
  assert.match(deployJob.slice(latestMainCheck, deployAction), /test "\$current_sha" = "\$SOURCE_SHA"/);
  assert.match(deployJob.slice(latestMainCheck, deployAction), /GH_TOKEN: \$\{\{ github\.token \}\}/);
});
