import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { discoverReflections } from './site-routes.js';
import { assertResponsivePage, assertResponsiveTarget } from './responsive.js';

test.use({ hasTouch: true });

const widths = [320, 768, 1280];
const localOrigin = new URL('http://127.0.0.1:4173').origin;
const reflections = discoverReflections(resolve(process.cwd(), '_site'));
const latestReflection = reflections.at(-1);
const routes = [
  '/',
  '/know-your-patterns/',
  '/consulting/',
  '/reflections/',
  ...(latestReflection ? [latestReflection.route] : []),
  '/origin/'
];

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    return requestOrigin === localOrigin ? route.continue() : route.abort();
  });
});

for (const route of routes) {
  for (const width of widths) {
    test(`Responsive usability: ${route} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      await assertResponsivePage(page, route, width);

      const main = page.locator('main');
      await expect(main.locator('h1').first()).toBeVisible();

      const navigation = page.getByRole('navigation', { name: 'Main navigation' });
      for (const name of ['Coaching', 'Reflections']) {
        await assertResponsiveTarget(
          page,
          navigation.getByRole('link', { name }),
          `main navigation ${name} link`,
          route,
          width,
          test.info(),
          'navigation'
        );
      }

      const footer = page.locator('footer');
      for (const link of await footer.getByRole('link').all()) {
        const label = (await link.innerText()).trim().replace(/\s+/g, ' ');
        await assertResponsiveTarget(
          page,
          link,
          `footer ${label} link`,
          route,
          width,
          test.info(),
          'footer'
        );
      }

      const actions =
        route === '/'
          ? [
              ['coaching action', page.locator('#coaching a[href="/know-your-patterns/"]')],
              ['consulting action', page.locator('#coaching a[href="/consulting/"]')],
              ['reflections action', page.locator('#writing a[href="/reflections/"]')]
            ]
          : route === '/know-your-patterns/'
            ? [
                ['booking action', page.locator('.hero-offer .reserve-button')],
                ['contact action', page.locator('#booking a[href]').last()]
              ]
            : route === '/reflections/'
              ? [['reflection article link', page.locator('#reflections-list a').first()]]
              : [['contact action', footer.getByRole('link', { name: 'Email' })]];
      for (const [label, action] of actions) {
        await assertResponsiveTarget(
          page,
          action,
          label,
          route,
          width
        );
      }

      const hitAreaAnnotations = test.info().annotations.filter(
        ({ type }) => type === 'responsive-hit-area'
      );
      expect(hitAreaAnnotations.length).toBeGreaterThan(0);
      expect(
        hitAreaAnnotations.every(({ description }) =>
          description.startsWith('navigation:main navigation ') ||
          description.startsWith('footer:footer ')
        )
      ).toBe(true);
    });
  }
}

test('intentional local horizontal scrolling is not page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.setContent(`<!doctype html>
    <html lang="en">
      <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local scroll fixture</title></head>
      <body><main><h1>Fixture</h1><div style="width: 100%; overflow-x: auto"><div style="width: 640px">Local scrolling content</div></div></main></body>
    </html>`);

  await assertResponsivePage(page, 'in-memory local scroll fixture', 320);
});

test('mobile navigation remains operable by touch', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');

  const reflectionsLink = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Reflections' });
  const box = await reflectionsLink.boundingBox();
  expect(box, 'Reflections navigation link must have a touch target.').not.toBeNull();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/reflections\/$/);

  await page.goto('/');
  const coachingLink = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Coaching' });
  const coachingBox = await coachingLink.boundingBox();
  expect(coachingBox, 'Coaching navigation link must have a touch target.').not.toBeNull();
  await page.touchscreen.tap(coachingBox.x + coachingBox.width / 2, coachingBox.y + coachingBox.height / 2);
  await expect(page).toHaveURL(/\/#coaching$/);
  await expect(page.locator('#coaching')).toBeVisible();

  await page.goto('/');
  const originLink = page.locator('footer').getByRole('link', { name: 'Origin' });
  await originLink.scrollIntoViewIfNeeded();
  const originBox = await originLink.boundingBox();
  expect(originBox, 'Footer Origin link must have a touch target.').not.toBeNull();
  await page.touchscreen.tap(originBox.x + originBox.width / 2, originBox.y + originBox.height / 2);
  await expect(page).toHaveURL(/\/origin\/$/);
});
