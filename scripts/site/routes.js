import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const coreSmokeRoutes = [
  '/',
  '/know-your-patterns/',
  '/reflections/',
  '/origin/'
];

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(filePath);
    return entry.isFile() && /\.html?$/i.test(entry.name) ? [filePath] : [];
  });
}

function routeForFile(siteDirectory, filePath) {
  const relativePath = relative(siteDirectory, filePath).split(sep).join('/');
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) {
    return `/${relativePath.slice(0, -'index.html'.length)}`;
  }
  return `/${relativePath}`;
}

export function discoverHtmlRoutes(siteDirectory) {
  return htmlFiles(siteDirectory)
    .map((filePath) => routeForFile(siteDirectory, filePath))
    .sort();
}

export function discoverReflections(siteDirectory) {
  return htmlFiles(resolve(siteDirectory, 'reflections'))
    .filter((filePath) => routeForFile(siteDirectory, filePath) !== '/reflections/')
    .map((filePath) => {
      const route = routeForFile(siteDirectory, filePath);
      const html = readFileSync(filePath, 'utf8');
      return { route, filePath, html };
    })
    .filter(({ html }) => /<section\b[^>]*\bid=["']reflection["']/i.test(html))
    .map(({ route, filePath, html }) => {
      const dateTime = html.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1];
      const publishedAt = dateTime ? Date.parse(dateTime) : Number.NaN;
      const revisedDateTime = html.match(/<span>Revised\s*<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1];
      const revisedAt = revisedDateTime ? Date.parse(revisedDateTime) : null;

      if (!Number.isFinite(publishedAt)) {
        throw new Error(`Could not read the publication date for generated reflection ${route}.`);
      }

      return { route, filePath, publishedAt, revisedAt };
    })
    .sort((left, right) => left.publishedAt - right.publishedAt || left.route.localeCompare(right.route));
}

export function selectSmokeRoutes(siteDirectory) {
  const reflections = discoverReflections(siteDirectory);
  const selectedReflections = [
    ...reflections.slice(0, 1),
    ...reflections.slice(-5)
  ];
  const routes = new Set(coreSmokeRoutes);
  for (const reflection of selectedReflections) routes.add(reflection.route);
  return [...routes];
}
