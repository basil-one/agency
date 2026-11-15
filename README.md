# agency

This repository contains the source for a Jekyll site for individual coaching
and reflections.

## Development

1. Open in GitHub Codespaces (uses the provided dev container), or use Ruby 3.2+ with Bundler locally. CI uses Ruby 3.3.
2. Install dependencies via terminal: `bundle install`
3. Run locally via terminal: `bundle exec jekyll serve`

The site will be available at http://localhost:4000.

### Build verification

From the repository root, install the locked dependencies and build as CI does:

```sh
BUNDLE_FROZEN=true bundle install
JEKYLL_ENV=production bundle exec jekyll build --trace
```

The generated site is in `_site/` (ignored by Git). Pull requests targeting
`main`, including drafts, run the **Jekyll build / Build Jekyll site** check.
A failed dependency installation or build fails the check; open its failing
step in the PR's Checks tab for the error and build trace.

If installation fails, check `ruby --version` and `bundle --version` against
the Ruby version above and `BUNDLED WITH` in `Gemfile.lock`. Install that
Bundler version with `gem install bundler -v 2.4.19` if needed. Use the committed
lockfile rather than running `bundle update` to work around errors. For build
failures, reproduce the command above and inspect the file and line named in
the trace (for example, YAML configuration, Liquid templates, or Sass).

This check only builds the site. GitHub Pages continues to build and publish
from the root of `main` to https://agency.basil.one/ after merge.

## License

The HTML structure and site code in this repository are licensed under the MIT License.

The written content and copy are © Michael Basil.  
All rights reserved unless otherwise noted.
