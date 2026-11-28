import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { classifyChanges } from '../../scripts/site/classify_performance_skip.mjs';

function reflection(slug, body = 'Editorial reflection text.') {
  return `---
layout: reflection
title: ${slug}
subtitle: An editorial subtitle.
description: >-
  An editorial description.
published: 2026-11-16
revised: null
permalink: /reflections/${slug}/
css_id: reflection-${slug}
---

${body}
`;
}

function commit(cwd, message) {
  execFileSync('git', ['add', '-A'], { cwd });
  execFileSync('git', ['-c', 'user.name=Classifier test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', message], {
    cwd,
    stdio: 'ignore'
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

function writeFiles(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    const destination = join(cwd, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

function scenario({ base = {}, head = {}, intermediate = [], remove = [], rename, eventName = 'pull_request' }) {
  const cwd = mkdtempSync(join(tmpdir(), 'agency-performance-skip-'));
  try {
    execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd });
    writeFiles(cwd, base);
    const baseSha = commit(cwd, 'base');
    for (const [index, files] of intermediate.entries()) {
      writeFiles(cwd, files);
      commit(cwd, `intermediate ${index + 1}`);
    }
    for (const path of remove) rmSync(join(cwd, path), { force: true });
    if (rename) execFileSync('git', ['mv', rename.from, rename.to], { cwd });
    writeFiles(cwd, head);
    const headSha = commit(cwd, 'head');
    return classifyChanges({ baseSha, headSha, eventName, cwd });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('skips an added reflection with conventional front matter and editorial text', () => {
  const result = scenario({ head: { '_reflections/new-reflection.md': reflection('new-reflection') } });
  assert.equal(result.skip, true, result.reason);
  assert.deepEqual(result.paths, ['_reflections/new-reflection.md']);
});

test('skips an editorial text and metadata edit to an existing reflection', () => {
  const original = reflection('existing');
  const updated = original
    .replace('title: existing', 'title: Updated title')
    .replace('Editorial reflection text.', 'Revised editorial reflection text.');
  const result = scenario({
    base: { '_reflections/existing.md': original },
    head: { '_reflections/existing.md': updated }
  });
  assert.equal(result.skip, true);
});

test('skips a revised date metadata edit to an existing reflection', () => {
  const original = reflection('existing');
  const updated = original.replace('revised: null', 'revised: 2026-11-17');
  const result = scenario({
    base: { '_reflections/existing.md': original },
    head: { '_reflections/existing.md': updated }
  });
  assert.equal(result.skip, true);
});

test('skips multiple added and edited text-only reflections', () => {
  const result = scenario({
    base: { '_reflections/existing.md': reflection('existing') },
    head: {
      '_reflections/existing.md': reflection('existing', 'Edited editorial reflection text.'),
      '_reflections/first-new.md': reflection('first-new'),
      '_reflections/second-new.md': reflection('second-new')
    }
  });
  assert.equal(result.skip, true);
  assert.equal(result.paths.length, 3);
});

test('classifies the complete change range across multiple PR commits', () => {
  const result = scenario({
    intermediate: [{
      '_reflections/multi-commit.md': reflection('multi-commit', 'First editorial draft.')
    }],
    head: {
      '_reflections/multi-commit.md': reflection('multi-commit', 'Final editorial text.')
    }
  });
  assert.equal(result.skip, true, result.reason);
});

test('runs the full baseline for excluded tooling, dependencies, and configuration changes', () => {
  for (const path of ['scripts/site/measure_performance.mjs', 'tests/site/example.test.mjs', 'Gemfile', '_config.yml']) {
    const result = scenario({
      head: { [path]: 'change\n' }
    });
    assert.equal(result.skip, false, `${path} must fail open`);
  }
});

test('runs the full baseline for mixed reflection and site changes', () => {
  for (const path of ['assets/css/site.css', 'scripts/site.js', '_layouts/reflection.html', '_config.yml']) {
    const result = scenario({
      head: {
        '_reflections/new-reflection.md': reflection('new-reflection'),
        [path]: 'site change\n'
      }
    });
    assert.equal(result.skip, false, `${path} must fail open`);
  }
});

test('runs the full baseline for changed media, embeds, HTML, and Liquid', () => {
  const unsafeBodies = [
    '![portrait](/assets/portrait.png)',
    '![external image](https://images.example.test/content)',
    '![shortcut reference image]',
    '[download](/assets/recording.mp3)',
    '[stylesheet](/assets/css/site.css)',
    '<iframe src="https://example.test/embed"></iframe>',
    '--!>',
    '{% include callout.html %}',
    '{{ site.title }}'
  ];
  for (const body of unsafeBodies) {
    const result = scenario({
      base: { '_reflections/existing.md': reflection('existing') },
      head: { '_reflections/existing.md': reflection('existing', body) }
    });
    assert.equal(result.skip, false, `${body} must fail open`);
  }
});

test('runs the full baseline when a Markdown image reference target changes', () => {
  const original = reflection('existing', '![diagram]\n\n[diagram]: https://images.example.test/original');
  const updated = original.replace('images.example.test/original', 'images.example.test/updated');
  const result = scenario({
    base: { '_reflections/existing.md': original },
    head: { '_reflections/existing.md': updated }
  });
  assert.equal(result.skip, false);
});

test('runs the full baseline for behavior-affecting or unknown front matter edits', () => {
  for (const [before, after] of [
    ['published: 2026-11-16', 'published: 2026-11-17'],
    ['permalink: /reflections/existing/', 'permalink: /reflections/changed/'],
    ['css_id: reflection-existing', 'css_id: reflection-changed'],
    ['layout: reflection', 'layout: page'],
    ['title: existing', 'custom_field: changed']
  ]) {
    const result = scenario({
      base: { '_reflections/existing.md': reflection('existing') },
      head: { '_reflections/existing.md': reflection('existing').replace(before, after) }
    });
    assert.equal(result.skip, false, `${after} must fail open`);
  }
});

test('runs the full baseline for deleted and renamed reflections or changed media files', () => {
  const existing = reflection('existing');
  assert.equal(scenario({
    base: { '_reflections/existing.md': existing },
    remove: ['_reflections/existing.md']
  }).skip, false);
  assert.equal(scenario({
    base: { '_reflections/existing.md': existing },
    rename: { from: '_reflections/existing.md', to: '_reflections/renamed.md' }
  }).skip, false);
  assert.equal(scenario({
    head: {
      '_reflections/new-reflection.md': reflection('new-reflection'),
      'assets/photo.png': 'image bytes'
    }
  }).skip, false);
});

test('runs the full baseline when the complete PR diff cannot be determined', () => {
  const result = classifyChanges({
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    eventName: 'pull_request',
    cwd: tmpdir()
  });
  assert.equal(result.skip, false);
  assert.match(result.reason, /could not determine the complete pull request diff/);
});

test('scheduled and manual runs always perform the full baseline', () => {
  for (const eventName of ['schedule', 'workflow_dispatch']) {
    const result = scenario({
      head: { '_reflections/new-reflection.md': reflection('new-reflection') },
      eventName
    });
    assert.equal(result.skip, false);
    assert.match(result.reason, /always perform the full baseline/);
  }
});
