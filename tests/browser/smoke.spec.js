import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertNoAccessibilityViolations } from './accessibility.js';

const routes = [
  '/',
  '/know-your-patterns/',
  '/reflections/',
  '/reflections/where-does-leadership-live/'
];
const siteDirectory = resolve(process.cwd(), '_site');
const localOrigin = new URL('http://127.0.0.1:4173').origin;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    return requestOrigin === localOrigin ? route.continue() : route.abort();
  });
});

for (const route of routes) {
  test(`${route} is present in generated output and loads`, async ({ page }) => {
    const outputFile = resolve(siteDirectory, `.${route}`, 'index.html');
    expect(existsSync(outputFile), `Jekyll did not generate ${route} at ${outputFile}`).toBe(true);

    const response = await page.goto(route);
    expect(response?.status(), `Expected ${route} to return HTTP 200`).toBe(200);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });

  test(`${route} has no detectable accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await assertNoAccessibilityViolations(page, route);
  });
}

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

  const offerLink = page.locator('#coaching a[href="/know-your-patterns/"]');
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
