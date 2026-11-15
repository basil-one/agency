# agency

This repository contains the source for a Jekyll site for individual coaching
and reflections.

## Development

1. Open in GitHub Codespaces (uses the provided dev container), or use Ruby 3.2+ with Bundler locally. CI uses Ruby 3.3.
2. Install dependencies via terminal: `bundle install`
3. Run locally via terminal: `bundle exec jekyll serve`

The site will be available at http://localhost:4000.

### Build verification

Pull requests to `main` run an automated Jekyll build.

```sh
BUNDLE_FROZEN=true bundle install
JEKYLL_ENV=production bundle exec jekyll build --trace
```

Build failures are reported in the PR's Checks tab.

## License

The HTML structure and site code in this repository are licensed under the MIT License.

The written content and copy are © Michael Basil.  
All rights reserved unless otherwise noted.
