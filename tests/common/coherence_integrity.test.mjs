import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const capabilities = [
  ['Common: Code Quality', 'common-code-quality.yml', 'common-code-quality'],
  ['Common: Coherence Integrity', 'common-coherence-integrity.yml', 'common-coherence-integrity'],
  ['Common: Dependency Security', 'common-dependency-security.yml', 'common-dependency-security'],
  ['Site: Build Integrity', 'site-build-integrity.yml', 'site-build-integrity'],
  ['Site: Link Integrity', 'site-link-integrity.yml', 'site-link-integrity'],
  ['Site: SEO Integrity', 'site-seo-integrity.yml', 'site-seo-integrity'],
  ['Site: Rendering Integrity', 'site-rendering-integrity.yml', 'site-rendering-integrity'],
  ['Site: Performance Integrity', 'site-performance-integrity.yml', 'site-performance-integrity']
];
const publicationCapability = ['Site: Publish', 'site-publish.yml'];

function read(repository, path) {
  const file = join(repository, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function repositoryFiles(repository, directory) {
  const root = join(repository, directory);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? repositoryFiles(repository, path) : [path];
  });
}

function collectCoherenceFailures(repository) {
  const failures = [];
  const workflowDirectory = join(repository, '.github/workflows');
  const expectedWorkflowFiles = [
    ...capabilities.map(([, file]) => file),
    'quality-pulse.yml',
    publicationCapability[1],
    'release-publish.yml'
  ].sort();
  const actualWorkflowFiles = readdirSync(workflowDirectory)
    .filter((file) => file.endsWith('.yml'))
    .sort();
  if (JSON.stringify(actualWorkflowFiles) !== JSON.stringify(expectedWorkflowFiles)) {
    failures.push('workflow inventory differs from the canonical Common/Site set');
  }

  const stance = read(repository, '.github/QUALITY.md') ?? '';
  const capabilitySection = stance.match(
    /^## Capabilities in Operation\n([\s\S]*?)(?=\n## )/m
  )?.[1] ?? '';
  const documentedCapabilities = [...capabilitySection.matchAll(
    /^\| \[((?:Common|Site): [^\]]+)\]\(workflows\/([a-z-]+\.yml)\)/gm
  )].map(([, name, file]) => [name, file]);
  if (JSON.stringify(documentedCapabilities) !== JSON.stringify(
    [...capabilities.map(([name, file]) => [name, file]), publicationCapability]
  )) {
    failures.push('quality capability table differs from the canonical order');
  }
  if (!stance.includes('| [Release Publish](workflows/release-publish.yml)')) {
    failures.push('release publication is missing from the capability table');
  }
  const release = read(repository, '.github/workflows/release-publish.yml') ?? '';
  if (!release.startsWith('name: "Release Publish"\n') ||
      !release.includes('  release-publish:\n    name: "Release Publish"')) {
    failures.push('release publication identity is not canonical');
  }
  const orchestration = read(repository, '.github/workflows/quality-pulse.yml') ?? '';
  const childJobs = [...orchestration.matchAll(
    /^  ((?:common|site)-[a-z-]+):\n    name: "((?:Common|Site): [^"]+)"\n    uses: \.\/\.github\/workflows\/([a-z-]+\.yml)$/gm
  )].map(([, id, name, file]) => [name, file, id]);
  if (JSON.stringify(childJobs) !== JSON.stringify(capabilities)) {
    failures.push('Quality Pulse jobs do not match the canonical ordered inventory');
  }
  const needsSection = orchestration.match(/^\s+needs:\n([\s\S]*?)^\s+runs-on:/m)?.[1] ?? '';
  const needs = [...needsSection.matchAll(/^      - ([a-z-]+)$/gm)].map(([, id]) => id);
  if (JSON.stringify(needs) !== JSON.stringify(capabilities.map(([, , id]) => id))) {
    failures.push('Quality Pulse needs list does not include every canonical check in order');
  }
  if (!orchestration.includes('PULSE_RESULTS_JSON: ${{ toJSON(needs) }}')) {
    failures.push('Quality Pulse does not pass same-cycle job evidence to its summarizer');
  }

  for (const [name, file, jobId] of capabilities) {
    const workflow = read(repository, `.github/workflows/${file}`);
    if (!workflow) {
      failures.push(`canonical workflow is missing: ${file}`);
      continue;
    }
    if (!workflow.startsWith(`name: "${name}"\n`)) {
      failures.push(`workflow identity is not canonical: ${file}`);
    }
    if (!/^on:\n  pull_request:\n    branches: \[main\]\n  workflow_dispatch:\n  workflow_call:$/m.test(workflow)) {
      failures.push(`workflow triggers are incomplete: ${file}`);
    }
    if (!workflow.includes(`    name: "${name}"`)) {
      failures.push(`canonical job check name is missing: ${file}`);
    }
    if (file === 'common-dependency-security.yml') {
      if (!workflow.includes('  common-dependency-security-review:') ||
        !workflow.includes('  common-dependency-security-posture:')) {
        failures.push('dependency security roles do not use qualified job IDs');
      }
    } else if (!workflow.includes(`  ${jobId}:\n    name: "${name}"`)) {
      failures.push(`canonical job ID is missing: ${file}`);
    }
  }

  const directories = ['scripts/common', 'scripts/site', 'scripts/orchestration',
    'tests/common', 'tests/site', 'tests/orchestration'];
  for (const path of directories) {
    if (!existsSync(join(repository, path))) failures.push(`domain directory is missing: ${path}`);
  }
  for (const path of [
    'scripts/common/dependency_posture.mjs',
    'scripts/site/check_links.py',
    'scripts/site/check_seo.py',
    'scripts/site/routes.js',
    'scripts/site/measure_performance.mjs',
    'scripts/orchestration/quality_pulse.mjs',
    'tests/orchestration/test_release_publish.py',
    'tests/site/browser/smoke.spec.js'
  ]) {
    if (!existsSync(join(repository, path))) failures.push(`owned implementation path is missing: ${path}`);
  }
  if (existsSync(join(repository, 'tests/site/browser/site-routes.js'))) {
    failures.push('production route definitions remain under browser tests');
  }
  const codeExtensions = /\.(?:mjs|js|py|sh)$/;
  const scriptPaths = repositoryFiles(repository, 'scripts').filter((path) => codeExtensions.test(path));
  const testPaths = repositoryFiles(repository, 'tests').filter((path) => /\.(?:mjs|js|py)$/.test(path));
  const scriptFiles = scriptPaths.map((path) => join(repository, path));
  for (const path of scriptPaths) {
    if (path.split('/').length < 3) {
      failures.push(`production code must be placed under a scripts domain: ${path}`);
    } else if (!['common', 'site', 'orchestration'].includes(path.split('/')[1])) {
      failures.push(`production code has no canonical domain owner: ${path}`);
    }
  }
  for (const path of testPaths) {
    if (path.split('/').length < 3) {
      failures.push(`test code must be placed under a tests domain: ${path}`);
    } else if (!['common', 'site', 'orchestration'].includes(path.split('/')[1])) {
      failures.push(`test code has no canonical domain owner: ${path}`);
    }
  }
  for (const file of scriptFiles) {
    const source = readFileSync(file, 'utf8');
    const path = relative(repository, file).split('\\').join('/');
    if (
      /(?:from|import)\s+['"][^'"]*tests\//.test(source) ||
      /^\s*(?:from\s+tests(?:\.|\s+import)|import\s+tests(?:\.|,|\s|$))/m.test(source)
    ) {
      failures.push(`production code imports test-owned support: ${path}`);
    }
  }

  const config = read(repository, '_config.yml') ?? '';
  if (!/^\s+- scripts$/m.test(config) || !/^\s+- tests$/m.test(config) ||
      !/^\s+- CHANGELOG\.md$/m.test(config)) {
    failures.push('Jekyll does not exclude the changelog and repository scripts and tests');
  }

  const packageJson = read(repository, 'package.json');
  let packageScripts = {};
  try {
    packageScripts = JSON.parse(packageJson ?? '').scripts ?? {};
  } catch {
    failures.push('package.json scripts are not valid JSON');
  }
  if (!packageScripts['test:coherence-integrity']?.includes('tests/common/coherence_integrity.test.mjs')) {
    failures.push('coherence contract test is not wired to an npm command');
  }
  if (!packageScripts['test:performance-policy']?.includes('tests/site/performance_policy.test.mjs')) {
    failures.push('performance policy tests are not wired to an npm command');
  }
  if (!packageScripts['test:required-checks']?.includes('tests/orchestration/release_publish_workflow.test.mjs') ||
      !packageScripts['test:required-checks']?.includes('test_release_publish.py') ||
      !read(repository, '.github/workflows/common-code-quality.yml')?.includes('run: npm run test:required-checks')) {
    failures.push('release publication tests are not wired to Common: Code Quality');
  }
  if (!packageScripts['test:required-checks']?.includes('tests/site/publication_workflow.test.mjs')) {
    failures.push('Site publication workflow tests are not wired to an npm command');
  }
  if (!read(repository, '.github/workflows/common-code-quality.yml')?.includes(
    'run: npm run test:required-checks'
  )) {
    failures.push('Site publication workflow tests are not wired to Common: Code Quality');
  }
  const performanceWorkflow = read(repository, '.github/workflows/site-performance-integrity.yml') ?? '';
  if (!performanceWorkflow.includes('PERFORMANCE_REFERENCE_PATH: .github/site-performance-reference.json')) {
    failures.push('performance workflow does not use the canonical domain reference');
  }
  if (
    !performanceWorkflow.includes('Confirm initially violating route profiles') ||
    !performanceWorkflow.includes('compare_performance.mjs --finalize') ||
    !performanceWorkflow.includes('PERFORMANCE_PROFILES_JSON:')
  ) {
    failures.push('performance workflow does not measure and enforce route/profile confirmation');
  }
  const confirmationStep = performanceWorkflow.split('id: confirmation')[1]?.split(
    '- name: Enforce confirmed performance safeguards'
  )[0] ?? '';
  if (!confirmationStep.includes('GITHUB_SHA: ${{ github.sha }}')) {
    failures.push('performance confirmation does not preserve the checked-out source revision');
  }
  if (
    !existsSync(join(repository, '.github/site-performance-reference.json')) ||
    existsSync(join(repository, '.github/performance-reference.json'))
  ) {
    failures.push('site performance reference filename is not canonical');
  }
  const workflowContents = actualWorkflowFiles.map((file) => [
    file,
    read(repository, `.github/workflows/${file}`) ?? ''
  ]);
  for (const [file, workflow] of workflowContents) {
    if (
      !['quality-pulse.yml', 'site-publish.yml'].includes(file) &&
      /uses:\s+actions\/checkout@/.test(workflow) &&
      (!workflow.includes('git rev-parse HEAD') || !workflow.includes('Checked-out revision:'))
    ) {
      failures.push(`checked-out revision is not reported by ${file}`);
    }
    for (const [, , discoveryDirectory] of workflow.matchAll(
      /\bunittest\s+discover\s+-s\s+(['"]?)([^'"\s]+)\1/g
    )) {
      if (!existsSync(join(repository, discoveryDirectory))) {
        failures.push(`unittest discovery directory is missing: ${file} references ${discoveryDirectory}`);
      }
    }
  }
  if (
    !orchestration.includes('git rev-parse HEAD') ||
    !orchestration.includes('PULSE_SOURCE_REVISION:') ||
    !read(repository, 'scripts/orchestration/quality_pulse.mjs')?.includes('Validator revision:')
  ) {
    failures.push('Quality Pulse summary does not report its validator revision');
  }

  const referencedText = [
    packageJson ?? '',
    ...workflowContents.map(([, workflow]) => workflow),
    stance,
    read(repository, '.github/CONVENTIONS.md') ?? '',
    read(repository, 'AGENTS.md') ?? ''
  ].join('\n');
  for (const [, path] of referencedText.matchAll(/(?:^|[\s("'`])((?:scripts|tests)\/[\w./-]+\.(?:mjs|js|py|spec\.js|yml|md))/gm)) {
    if (!existsSync(join(repository, path))) failures.push(`repository reference does not resolve: ${path}`);
  }
  for (const [, moduleName] of referencedText.matchAll(/\bpython3?\s+-m\s+(scripts(?:\.[A-Za-z_][\w]*)+)/g)) {
    const modulePath = `${moduleName.replaceAll('.', '/')}.py`;
    if (!existsSync(join(repository, modulePath))) failures.push(`Python module reference does not resolve: ${moduleName}`);
  }

  const actionVersions = new Map();
  for (const file of actualWorkflowFiles) {
    const workflow = read(repository, `.github/workflows/${file}`) ?? '';
    for (const [, action, version] of workflow.matchAll(/^\s*(?:-\s*)?uses:\s+([^@\s]+)@([^\s#]+)/gm)) {
      const versions = actionVersions.get(action) ?? new Set();
      versions.add(version);
      actionVersions.set(action, versions);
    }
  }
  for (const [action, versions] of actionVersions) {
    if (versions.size > 1) failures.push(`external action version is inconsistent: ${action}`);
  }
  return failures;
}

function fixture(mutator) {
  const directory = mkdtempSync(join(tmpdir(), 'agency-coherence-'));
  for (const path of ['.github/workflows', 'scripts', 'tests/common', 'tests/site',
    'tests/orchestration']) {
    cpSync(join(root, path), join(directory, path), { recursive: true });
  }
  for (const path of ['.github/QUALITY.md', '.github/CONVENTIONS.md', '_config.yml',
    'package.json', 'playwright.config.js', 'AGENTS.md']) {
    cpSync(join(root, path), join(directory, path), { recursive: true });
  }
  try {
    mutator(directory);
    return collectCoherenceFailures(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('repository satisfies the canonical Common and Site coherence contracts', () => {
  assert.deepEqual(collectCoherenceFailures(root), []);
});

test('rejects a reordered or incomplete capability inventory', () => {
  const failures = fixture((directory) => {
    const file = join(directory, '.github/QUALITY.md');
    const first = '| [Common: Code Quality](workflows/common-code-quality.yml)';
    const second = '| [Common: Coherence Integrity](workflows/common-coherence-integrity.yml)';
    const lines = readFileSync(file, 'utf8').split('\n');
    const firstIndex = lines.findIndex((line) => line.startsWith(first));
    const secondIndex = lines.findIndex((line) => line.startsWith(second));
    [lines[firstIndex], lines[secondIndex]] = [lines[secondIndex], lines[firstIndex]];
    writeFileSync(file, lines.join('\n'));
  });
  assert.ok(failures.includes('quality capability table differs from the canonical order'));
});

test('rejects a noncanonical workflow identity or job ID', () => {
  const failures = fixture((directory) => {
    const file = join(directory, '.github/workflows/common-code-quality.yml');
    const content = readFileSync(file, 'utf8');
    writeFileSync(file, content.replace('  common-code-quality:', '  code-quality:'));
  });
  assert.ok(failures.includes('canonical job ID is missing: common-code-quality.yml'));
});

test('rejects missing release identity, test wiring, or changelog exclusion', () => {
  const missingIdentity = fixture((directory) => {
    const file = join(directory, '.github/workflows/release-publish.yml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('  release-publish:', '  publish:'));
  });
  assert.ok(missingIdentity.includes('release publication identity is not canonical'));

  const missingTests = fixture((directory) => {
    const file = join(directory, 'package.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('test_release_publish.py', 'missing.py'));
  });
  assert.ok(missingTests.includes('release publication tests are not wired to Common: Code Quality'));

  const missingTestFile = fixture((directory) => {
    rmSync(join(directory, 'tests/orchestration/test_release_publish.py'));
  });
  assert.ok(missingTestFile.includes('owned implementation path is missing: tests/orchestration/test_release_publish.py'));

  const missingExclusion = fixture((directory) => {
    const file = join(directory, '_config.yml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('  - CHANGELOG.md\n', ''));
  });
  assert.ok(missingExclusion.includes('Jekyll does not exclude the changelog and repository scripts and tests'));
});

test('rejects missing Site production paths and production imports from tests', () => {
  const missingPath = fixture((directory) => {
    rmSync(join(directory, 'scripts/site/routes.js'));
  });
  assert.ok(missingPath.includes('owned implementation path is missing: scripts/site/routes.js'));

  const crossedOwnership = fixture((directory) => {
    const file = join(directory, 'scripts/site/routes.js');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nimport '../tests/site/test_links.py';\n`);
  });
  assert.ok(crossedOwnership.includes('production code imports test-owned support: scripts/site/routes.js'));
});

test('rejects root-level scripts and tests, Python test imports, and missing discovery directories', () => {
  const rootScript = fixture((directory) => {
    writeFileSync(join(directory, 'scripts/extra.mjs'), 'export {};\n');
  });
  assert.ok(rootScript.includes('production code must be placed under a scripts domain: scripts/extra.mjs'));

  const rootTest = fixture((directory) => {
    writeFileSync(join(directory, 'tests/extra.test.mjs'), 'import test from "node:test";\n');
  });
  assert.ok(rootTest.includes('test code must be placed under a tests domain: tests/extra.test.mjs'));

  const pythonTestImport = fixture((directory) => {
    const file = join(directory, 'scripts/site/check_links.py');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nfrom tests.site import test_links\n`);
  });
  assert.ok(pythonTestImport.includes('production code imports test-owned support: scripts/site/check_links.py'));

  const missingDiscoveryDirectory = fixture((directory) => {
    const file = join(directory, '.github/workflows/site-link-integrity.yml');
    const content = readFileSync(file, 'utf8');
    writeFileSync(file, content.replace('tests/site', 'tests/missing'));
  });
  assert.ok(missingDiscoveryDirectory.includes(
    'unittest discovery directory is missing: site-link-integrity.yml references tests/missing'
  ));
});

test('rejects unresolved command references and inconsistent external action versions', () => {
  const missingReference = fixture((directory) => {
    const file = join(directory, 'package.json');
    const content = readFileSync(file, 'utf8');
    writeFileSync(file, content.replace(
      'scripts/site/measure_performance.mjs',
      'scripts/site/missing_measurement.mjs'
    ));
  });
  assert.ok(missingReference.includes('repository reference does not resolve: scripts/site/missing_measurement.mjs'));

  const inconsistentAction = fixture((directory) => {
    const file = join(directory, '.github/workflows/site-link-integrity.yml');
    const content = readFileSync(file, 'utf8');
    writeFileSync(file, content.replace('actions/checkout@v5', 'actions/checkout@v4'));
  });
  assert.ok(inconsistentAction.includes('external action version is inconsistent: actions/checkout'));
});
