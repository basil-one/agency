import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { responsiveViewports, selectResponsiveRoutes } from '../../../scripts/site/routes.js';
import { assertResponsivePage, assertResponsiveTarget } from './responsive.js';

test.use({ hasTouch: true });

const localOrigin = new URL('http://127.0.0.1:4173').origin;
const routes = selectResponsiveRoutes(resolve(process.cwd(), '_site'));

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    return requestOrigin === localOrigin ? route.continue() : route.abort();
  });
});

for (const route of routes) {
  for (const width of responsiveViewports) {
    test(`Responsive usability: ${route} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      await assertResponsivePage(page, route, width);

      const main = page.locator('main');
      await expect(main.locator('h1').first()).toBeVisible();

      const navigation = page.getByRole('navigation', { name: 'Main navigation' });
      for (const name of ['Work Together', 'Reflections']) {
        await assertResponsiveTarget(
          page,
          navigation.getByRole('link', { name }),
          `main navigation ${name} link`,
          route,
          width
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
          width
        );
      }

      const actions =
        route === '/'
          ? [
              ['coaching action', page.locator('#work-together a[href="/know-your-patterns/"]')],
              ['consulting overview', page.locator('#work-together a[data-ga-label="consulting_approach_from_change_leadership_consulting"]')],
              ['reflections action', page.locator('#writing a[href="/reflections/"]')]
            ]
          : route === '/know-your-patterns/'
            ? [
                ['booking action', page.locator('.hero-offer .reserve-button')],
                ['contact action', page.locator('#booking a[href]').last()]
              ]
            : route === '/consulting/'
              ? [
                  ['Circle3 paper', page.getByRole('link', { name: 'Read the Circle3 paper' })],
                  ['pattern-level consultant', page.getByRole('link', { name: 'Explore Pattern-Level Consultant' })]
                ]
              : route === '/consulting/models/pattern-level-consultant/'
                ? [
                    ['independent coaching', page.getByRole('link', { name: 'Know Your Patterns' })],
                    ['model contact', page.locator('.consulting-close .primary-link')]
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

    });
  }
}

test('responsive check rejects whole-page horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.setContent('<main><h1>Fixture</h1><div style="width: 640px">Overflow</div></main>');
  await expect(
    assertResponsivePage(page, 'in-memory fixture', 320)
  ).rejects.toThrow(/whole-page horizontal overflow/);
});

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
  const workTogetherLink = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Work Together' });
  const workTogetherBox = await workTogetherLink.boundingBox();
  expect(workTogetherBox, 'Work Together navigation link must have a touch target.').not.toBeNull();
  await page.touchscreen.tap(workTogetherBox.x + workTogetherBox.width / 2, workTogetherBox.y + workTogetherBox.height / 2);
  await expect(page).toHaveURL(/\/#work-together$/);
  await expect(page.locator('#work-together')).toBeVisible();

  await page.goto('/');
  const originLink = page.locator('footer').getByRole('link', { name: 'Origin' });
  await originLink.scrollIntoViewIfNeeded();
  const originBox = await originLink.boundingBox();
  expect(originBox, 'Footer Origin link must have a touch target.').not.toBeNull();
  await page.touchscreen.tap(originBox.x + originBox.width / 2, originBox.y + originBox.height / 2);
  await expect(page).toHaveURL(/\/origin\/$/);
});
