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

Pull requests to `main` run a production Jekyll build, link-integrity checks, and source linting. Results and diagnostics appear in the pull request's **Checks** tab. A weekly workflow also audits external links.

### Dependency maintenance

Dependabot proposes weekly Bundler and GitHub Actions updates for human review; it does not replace a vulnerability check on dependency changes. Dependency review is deferred because the hosted check reported that the dependency graph is not enabled. A repository administrator can enable **Dependency Graph** under **Settings → Advanced Security** ([GitHub instructions](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/enable-dependency-graph#enabling-the-dependency-graph-for-a-repository)). If unavailable, keep dependency review deferred rather than a permanently failing check and review dependency changes and advisories manually.

Once enabled and populated, restore the [dependency-review workflow](https://github.com/basil-one/agency/blob/c0566553020507a1f48fce70550a9f40821f9da3/.github/workflows/dependency-review.yml) in a reviewed change and verify it on a pull request. It checks newly introduced moderate-or-higher vulnerabilities across all dependency scopes, not unchanged baseline findings.

If [PR #44](https://github.com/basil-one/agency/pull/44) merges its root npm lockfile, add weekly root npm Dependabot coverage with the same minor/patch grouping and five-PR limit.

## License

The HTML structure and site code in this repository are licensed under the MIT License.

The written content and copy are © Michael Basil.  
All rights reserved unless otherwise noted.
