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

function read(repository, path) {
  const file = join(repository, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function collectCoherenceFailures(repository) {
  const failures = [];
  const workflowDirectory = join(repository, '.github/workflows');
  const expectedWorkflowFiles = [...capabilities.map(([, file]) => file), 'quality-pulse.yml'].sort();
  const actualWorkflowFiles = readdirSync(workflowDirectory)
    .filter((file) => file.endsWith('.yml'))
    .sort();
  if (JSON.stringify(actualWorkflowFiles) !== JSON.stringify(expectedWorkflowFiles)) {
    failures.push('workflow inventory differs from the canonical Common/Site set');
  }

  const stance = read(repository, '.github/QUALITY.md') ?? '';
  const documentedCapabilities = [...stance.matchAll(
    /^\| \[((?:Common|Site): [^\]]+)\]\(workflows\/([a-z-]+\.yml)\)/gm
  )].map(([, name, file]) => [name, file]);
  if (JSON.stringify(documentedCapabilities) !== JSON.stringify(
    capabilities.map(([name, file]) => [name, file])
  )) {
    failures.push('quality capability table differs from the canonical order');
  }
  if (!stance.includes('Coherence creates capacity.')) {
    failures.push('quality stance omits the coherence commitment');
  }
  if (!stance.includes('A cycle with advisories') || !stance.includes('not reported as an unconditional pass')) {
    failures.push('quality stance does not distinguish advisory cycles from unconditional passes');
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
    'tests/site/browser/smoke.spec.js'
  ]) {
    if (!existsSync(join(repository, path))) failures.push(`owned implementation path is missing: ${path}`);
  }
  if (existsSync(join(repository, 'tests/site/browser/site-routes.js'))) {
    failures.push('production route definitions remain under browser tests');
  }
  const scriptFiles = [];
  for (const domain of ['common', 'site', 'orchestration']) {
    for (const entry of readdirSync(join(repository, 'scripts', domain), { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:mjs|js|py)$/.test(entry.name)) {
        scriptFiles.push(join(repository, 'scripts', domain, entry.name));
      }
    }
  }
  for (const file of scriptFiles) {
    if (/(?:from|import)\s+['"][^'"]*tests\//.test(readFileSync(file, 'utf8'))) {
      failures.push(`production code imports test-owned support: ${relative(repository, file)}`);
    }
  }

  const config = read(repository, '_config.yml') ?? '';
  if (!/^\s+- scripts$/m.test(config) || !/^\s+- tests$/m.test(config)) {
    failures.push('Jekyll does not exclude repository scripts and tests');
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
  const referencedText = [
    packageJson ?? '',
    ...actualWorkflowFiles.map((file) => read(repository, `.github/workflows/${file}`) ?? ''),
    stance,
    read(repository, '.github/CONVENTIONS.md') ?? ''
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
    'package.json', 'playwright.config.js']) {
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
