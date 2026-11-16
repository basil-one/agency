# Agency

Source for [Agency](https://agency.basil.one), a Jekyll site for individual coaching and reflections.

## Quality

**Quality is a continuous practice in service of human connection.**

We keep Agency dependable, accessible, and easy to use so the site supports meaningful human encounters. Automation carries repetitive checks and brings evidence and practical remedies to human judgment. The practice creates capacity rather than maintenance overhead.

Our [quality stance and practice](.github/QUALITY.md) describes the commitment, the safeguards in operation, and the capabilities being established.

## Development

Use GitHub Codespaces or Ruby 3.2+ with Bundler locally (CI uses Ruby 3.3).

```sh
bundle install
bundle exec jekyll serve
```

The local site is available at http://localhost:4000.

PR checks report their results in the pull request's **Checks** tab. The [quality practice](.github/QUALITY.md) describes which safeguards run on PRs and over time.

The separate rendered-site browser workflow builds the production site and runs Chromium smoke tests against generated pages at `http://127.0.0.1:4173`. To run them locally:

```sh
BUNDLE_FROZEN=true JEKYLL_ENV=production bundle exec jekyll build --trace
npm ci
npx playwright install --only-shell chromium
npm run test:browser
```

The smoke tests cover `/`, `/know-your-patterns/`, `/reflections/`, and `/reflections/where-does-leadership-live/`; they check generated route files, page loading, main navigation, and visible calls to action without following external links. Set `BROWSER_VIEWPORT_WIDTH` and `BROWSER_VIEWPORT_HEIGHT` to change the browser viewport. `npm run test:browser:negative` deliberately requests a missing route to show the failure diagnostic (it is expected to fail).

Future accessibility, additional viewport, and performance tests can reuse `playwright.config.js`, the local generated-site server, and the Chromium installation. Those checks are not part of this smoke-test foundation.

## License

The HTML structure and site code in this repository are licensed under the MIT License.

The written content and copy are © Michael Basil.  
All rights reserved unless otherwise noted.
