import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertNoAccessibilityViolations } from './accessibility.js';
import { discoverHtmlRoutes, discoverReflections, selectSmokeRoutes } from './site-routes.js';

const siteDirectory = resolve(process.cwd(), '_site');
const localOrigin = new URL('http://127.0.0.1:4173').origin;
const htmlRoutes = discoverHtmlRoutes(siteDirectory);
const reflections = discoverReflections(siteDirectory);
const smokeRoutes = selectSmokeRoutes(siteDirectory);
const expectedHeadings = new Map([
  ['/', 'Adaptive Leadership, Applied'],
  ['/know-your-patterns/', 'Know Your Patterns'],
  ['/reflections/', 'Reflections'],
  ['/origin/', 'Creating Conditions']
]);

if (htmlRoutes.length === 0) {
  throw new Error(`No generated HTML pages were discovered in ${siteDirectory}.`);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    return requestOrigin === localOrigin ? route.continue() : route.abort();
  });
});

for (const route of smokeRoutes) {
  test(`${route} is present in generated output and loads`, async ({ page }) => {
    const outputFile = resolve(siteDirectory, `.${route}`, 'index.html');
    const article = reflections.find((reflection) => reflection.route === route);
    const expectedOutputFile = article?.filePath ?? outputFile;
    expect(existsSync(expectedOutputFile), `Jekyll did not generate ${route} at ${expectedOutputFile}`).toBe(true);

    const response = await page.goto(route);
    expect(response?.status(), `Expected ${route} to return HTTP 200`).toBe(200);
    await expect(page.locator('main')).toBeVisible();
    const heading = page.locator('main h1').first();
    await expect(heading).toBeVisible();
    if (expectedHeadings.has(route)) {
      await expect(heading).toHaveText(expectedHeadings.get(route));
    } else {
      await expect(heading).toHaveText(/\S/);
      await expect(page.locator('#reflection')).toBeVisible();
    }
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });
}

for (const route of htmlRoutes) {
  test(`${route} has no detectable accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await assertNoAccessibilityViolations(page, route, test.info());
  });
}

test('the reflections index links to a selected article', async ({ page }) => {
  test.skip(reflections.length === 0, 'No published reflections are available.');
  const latestReflection = reflections.at(-1);
  await page.goto('/reflections/');

  const articleLink = page.locator(`#reflections-list a[href="${latestReflection.route}"]`);
  await expect(articleLink).toBeVisible();
  await articleLink.click();
  await expect(page).toHaveURL(`${localOrigin}${latestReflection.route}`);
  await expect(page.locator('#reflection')).toBeVisible();
  await expect(page.locator('main h1')).toHaveText(/\S/);
});

test('reflection details label publication and conditional revision dates and retain reading time', async ({ page }) => {
  const revisedReflection = reflections.find(({ revisedAt }) => revisedAt !== null);
  const unrevisedReflection = reflections.find(({ revisedAt }) => revisedAt === null);
  expect(revisedReflection, 'A revised reflection is needed for this regression test.').toBeDefined();
  expect(unrevisedReflection, 'An unrevised reflection is needed for this regression test.').toBeDefined();

  for (const reflection of [revisedReflection, unrevisedReflection]) {
    await page.goto(reflection.route);
    const dateAndReadingTime = page.locator('#hero .publish-date');
    await expect(dateAndReadingTime).toContainText('Published');
    await expect(dateAndReadingTime).toContainText(/\d+ min read/);
    const dates = dateAndReadingTime.locator('time');
    await expect(dates).toHaveCount(reflection.revisedAt === null ? 1 : 2);
    expect(Date.parse(await dates.nth(0).getAttribute('datetime'))).toBe(reflection.publishedAt);

    if (reflection.revisedAt === null) {
      await expect(dateAndReadingTime).not.toContainText('Revised');
    } else {
      await expect(dateAndReadingTime).toContainText('Revised');
      expect(Date.parse(await dates.nth(1).getAttribute('datetime'))).toBe(reflection.revisedAt);
    }
  }
});

test('the reflections index shows publication dates and sorts by publication, not revision date', async ({ page }) => {
  const olderWithLaterRevision = reflections.find((reflection) =>
    reflection.revisedAt !== null &&
    reflections.some((other) =>
      other.publishedAt > reflection.publishedAt && other.publishedAt < reflection.revisedAt
    )
  );
  expect(olderWithLaterRevision, 'A reflection revised after a newer publication is needed for this regression test.').toBeDefined();

  await page.goto('/reflections/');
  const entries = await page.locator('#reflections-list article').evaluateAll((articles) =>
    articles.map((article) => ({
      href: article.querySelector('h2 a')?.getAttribute('href'),
      date: article.querySelector('.publish-date time')?.getAttribute('datetime'),
      metadata: article.querySelector('.publish-date')?.textContent ?? ''
    }))
  );
  const expectedOrder = [...reflections]
    .sort((left, right) => right.publishedAt - left.publishedAt || right.route.localeCompare(left.route))
    .map(({ route }) => route);

  expect(entries.map(({ href }) => href)).toEqual(expectedOrder);
  for (const entry of entries) {
    const reflection = reflections.find(({ route }) => route === entry.href);
    expect(reflection, `Unexpected reflection in index: ${entry.href}`).toBeDefined();
    expect(Date.parse(entry.date)).toBe(reflection.publishedAt);
    expect(entry.metadata).not.toMatch(/Published|Revised/);
    expect(entry.metadata).toMatch(/\d+ min read/);
  }
});

test('primary navigation reaches the local reflections page', async ({ page }) => {
  await page.goto('/');

  const reflectionsLink = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Reflections' });
  await expect(reflectionsLink).toHaveAttribute('href', '/reflections/');
  await reflectionsLink.click();
  await expect(page).toHaveURL(`${localOrigin}/reflections/`);
  await expect(page.locator('main h1')).toBeVisible();
});

test('local and external calls to action are visible without leaving the local site', async ({ page }) => {
  await page.goto('/');

  const offerLink = page.locator('#work-together a[href="/know-your-patterns/"]');
  const reflectionsLink = page.locator('#writing a[href="/reflections/"]');
  await expect(offerLink).toBeVisible();
  await expect(reflectionsLink).toBeVisible();
  await expect(offerLink).toHaveText(/\S/);
  await expect(reflectionsLink).toHaveText(/\S/);

  await offerLink.click();
  await expect(page).toHaveURL(`${localOrigin}/know-your-patterns/`);

  const reservationLink = page.locator('#hero .hero-offer a').first();
  await expect(reservationLink).toBeVisible();
  expect(new URL(await reservationLink.getAttribute('href')).origin).not.toBe(localOrigin);
});

test('consulting is available by request from the homepage', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#work-together a[data-ga-label="change_leadership_consulting_connect"]')).toHaveCount(0);

  const overviewLink = page.locator('#work-together a[data-ga-label="consulting_approach_from_change_leadership_consulting"]');
  await expect(overviewLink).toHaveText('Explore Change Leadership Consulting');
  await expect(overviewLink).toHaveAttribute('href', '/consulting/');
  await overviewLink.click();
  await expect(page).toHaveURL(`${localOrigin}/consulting/`);
  await expect(page.locator('main h1')).toHaveText('Change Leadership Consulting');
  const paperLink = page.getByRole('link', { name: 'Read the Circle3 paper' });
  await expect(paperLink).toHaveAttribute('href', 'https://circle.basil.one/paper/');
  const modelLink = page.getByRole('link', { name: 'Explore Pattern-Level Consultant' });
  await expect(modelLink).toHaveAttribute('href', '/consulting/models/pattern-level-consultant/');
  await expect(page.getByRole('link', { name: 'Connect to Discuss' })).toHaveCount(0);
  await modelLink.click();
  await expect(page).toHaveURL(`${localOrigin}/consulting/models/pattern-level-consultant/`);
  await expect(page.locator('main h1')).toHaveText('Pattern-Level Consultant');
  await expect(page.locator('main h2')).toHaveCount(9);
  await expect(page.locator('main h2').last()).toHaveText('Working together');
  await expect(page.locator('.consulting-close .primary-link')).toHaveText('Connect to Discuss');
  await expect(page.locator('.consulting-breadcrumb')).toHaveCount(0);
  await expect(page.locator('footer .footer-fine-print')).toContainText('Pattern-Level Consultant © 2026 Michael Basil');
  await expect(page.locator('footer .footer-fine-print')).toContainText('CC BY-SA 4.0');
  await expect(page.getByRole('link', { name: 'Know Your Patterns' })).toHaveAttribute('href', '/know-your-patterns/');
  const workTogetherLink = page.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Work Together' });
  await expect(workTogetherLink).toHaveAttribute('href', '/#work-together');
  await expect(workTogetherLink).toHaveAttribute('data-ga-event', 'navigation_click');
  await expect(workTogetherLink).toHaveAttribute('data-ga-label', 'work_together_header');
  const footerWorkTogether = page.locator('footer').getByRole('link', { name: 'Work Together' });
  await expect(footerWorkTogether).toHaveAttribute('href', '/#work-together');
  await expect(footerWorkTogether).toHaveAttribute('data-ga-label', 'work_together_footer');
});

test('new generated reflection pages enter route discovery and date-based smoke selection', async ({ page }) => {
  const fixtureDirectory = mkdtempSync(resolve(tmpdir(), 'agency-rendered-fixture-'));
  const fixtureRoutes = [
    ['article-z', '2026-09-01'],
    ['article-a', '2026-09-02'],
    ['article-y', '2026-09-03']
  ];
  const writeReflection = ([slug, date]) => {
    const directory = resolve(fixtureDirectory, 'reflections', slug);
    mkdirSync(directory, { recursive: true });
    const filePath = resolve(directory, 'index.html');
    writeFileSync(filePath, `<!doctype html>
      <html lang="en"><head><meta charset="utf-8"><title>${slug}</title></head>
      <body><main><h1>${slug}</h1><section id="reflection"><time datetime="${date}">${date}</time></section></main></body></html>`);
    return `/reflections/${slug}/`;
  };

  try {
    fixtureRoutes.forEach(writeReflection);
    const shortSelection = selectSmokeRoutes(fixtureDirectory);
    expect(
      shortSelection.filter(
        (route) => route.startsWith('/reflections/') && route !== '/reflections/'
      )
    ).toHaveLength(3);
    expect(new Set(shortSelection).size).toBe(shortSelection.length);

    [
      ['article-b', '2026-09-04'],
      ['article-x', '2026-09-05'],
      ['article-c', '2026-09-06'],
      ['article-w', '2026-09-07']
    ].forEach(writeReflection);
    const firstSelection = selectSmokeRoutes(fixtureDirectory);
    expect(discoverHtmlRoutes(fixtureDirectory)).toContain('/reflections/article-w/');
    expect(firstSelection).toContain('/reflections/article-z/');
    expect(firstSelection).toContain('/reflections/article-y/');
    expect(firstSelection).not.toContain('/reflections/article-a/');
    expect(new Set(firstSelection).size).toBe(firstSelection.length);

    const oldestNewRoute = writeReflection(['oldest-publication', '2026-08-31']);
    const newestNewRoute = writeReflection(['newest-publication', '2026-09-08']);
    const updatedSelection = selectSmokeRoutes(fixtureDirectory);
    expect(discoverHtmlRoutes(fixtureDirectory)).toContain(oldestNewRoute);
    expect(discoverHtmlRoutes(fixtureDirectory)).toContain(newestNewRoute);
    expect(updatedSelection).toContain(oldestNewRoute);
    expect(updatedSelection).toContain(newestNewRoute);
    expect(updatedSelection).not.toContain('/reflections/article-z/');
    expect(updatedSelection).not.toContain('/reflections/article-y/');
    expect(new Set(updatedSelection).size).toBe(updatedSelection.length);

    const newPage = resolve(fixtureDirectory, 'reflections/newest-publication/index.html');
    await page.route(`${localOrigin}${newestNewRoute}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: readFileSync(newPage, 'utf8')
      })
    );
    const response = await page.goto(newestNewRoute);
    expect(response?.status()).toBe(200);
    await assertNoAccessibilityViolations(page, newestNewRoute, test.info());
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});
