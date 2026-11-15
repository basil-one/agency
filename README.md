# Agency

Source for [Agency](https://agency.basil.one), a Jekyll site for individual coaching and reflections.

## Quality

**Quality is a continuous practice in service of human connection.**

We keep Agency dependable, accessible, and easy to use so the site supports meaningful human encounters. Automation carries repetitive checks and brings evidence and practical remedies to human judgment. The practice creates capacity rather than maintenance overhead.

Our [quality stance and practice](QUALITY.md) describes the commitment, the safeguards in operation, and the capabilities being established.

## Development

Use GitHub Codespaces or Ruby 3.2+ with Bundler locally (CI uses Ruby 3.3).

```sh
bundle install
bundle exec jekyll serve
```

The local site is available at http://localhost:4000.

Pull requests to `main` run a production Jekyll build, link-integrity checks, and source linting. Results and diagnostics appear in the pull request's **Checks** tab. A weekly workflow also audits external links.

## License

The HTML structure and site code in this repository are licensed under the MIT License.

The written content and copy are © Michael Basil.  
All rights reserved unless otherwise noted.
