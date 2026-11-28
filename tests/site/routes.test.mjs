import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  discoverHtmlRoutes,
  discoverReflections,
  responsiveViewports,
  selectResponsiveRoutes,
  selectSmokeRoutes
} from '../../scripts/site/routes.js';

test('discovers generated HTML routes and chronologically selects reflection smoke coverage', () => {
  const site = mkdtempSync(join(tmpdir(), 'agency-site-routes-'));
  try {
    for (const [route, date] of [
      ['/reflections/old/', '2026-01-02'],
      ['/reflections/new/', '2026-02-03']
    ]) {
      const directory = join(site, route.slice(1));
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'index.html'),
        `<section id="reflection"><time datetime="${date}"></time></section>`
      );
    }
    writeFileSync(join(site, 'index.html'), '<main>Home</main>');
    writeFileSync(join(site, 'about.html'), '<main>About</main>');

    assert.deepEqual(discoverHtmlRoutes(site), [
      '/',
      '/about.html',
      '/reflections/new/',
      '/reflections/old/'
    ]);
    assert.deepEqual(discoverReflections(site).map(({ route }) => route), [
      '/reflections/old/',
      '/reflections/new/'
    ]);
    assert.deepEqual(selectSmokeRoutes(site), [
      '/',
      '/know-your-patterns/',
      '/reflections/',
      '/origin/',
      '/reflections/old/',
      '/reflections/new/'
    ]);
    assert.deepEqual(responsiveViewports, [320, 768, 1280]);
    assert.deepEqual(selectResponsiveRoutes(site), [
      '/',
      '/know-your-patterns/',
      '/consulting/',
      '/consulting/models/pattern-level-consultant/',
      '/reflections/',
      '/reflections/new/',
      '/origin/'
    ]);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});
