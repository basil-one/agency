# agency.basil.one

Source for [Agency](https://agency.basil.one), a Jekyll site for individual coaching, change leadership consulting, and reflections.

## Quality

**Quality is a continuous practice in service of human connection.**

We keep Agency dependable, accessible, and easy to use so the site supports meaningful human encounters. Automation carries repetitive checks and brings evidence and practical remedies to human judgment. The practice creates capacity rather than maintenance overhead.

Our [quality stance and practice](.github/QUALITY.md) describes the quality domains, safeguards in operation, and how people review their evidence.

## Development

Use GitHub Codespaces (the provided dev container uses Ruby 3.2) or Ruby 3.2+ with Bundler locally. CI uses Ruby 3.3.

```sh
bundle install
bundle exec jekyll serve
```

The local site is available at http://localhost:4000.

See the [repository conventions](.github/CONVENTIONS.md) for workflow, script, and test locations and focused validation commands. Agents start with [AGENTS.md](AGENTS.md), including the linked automation guidance.

## Site Publication

The website is published through the existing GitHub Pages mechanism following an approved merge.

## Releases

The living site and a versioned release serve different purposes. To preserve an intentional milestone, a human runs [Release Publish](.github/workflows/release-publish.yml) from `main` with a stable version, reviews and merges the changelog-only release PR through the Quality Gate, and can rerun the same version to resume an interrupted publication. GitHub Actions may require repository permission to create pull requests and human approval of checks.

Maintain notable outcomes under Unreleased in [CHANGELOG.md](CHANGELOG.md); release notes come from the reviewed changelog.

## Intellectual stewardship

We develop original work while recognizing that knowledge emerges through practice, relationships, and the contributions of others.

- **Generosity:** Recognize the people and work that have meaningfully influenced our own.
- **Integrity:** Represent the origins, authorship, evidence, and limitations of our work accurately, including the role of AI where appropriate.
- **Independence:** Develop our own synthesis and expression without misappropriating the intellectual identity or protected materials of others.
- **Reciprocity:** Respect the intellectual property of others as we would want our own respected.

Apply these principles proportionately when creating, adapting, reviewing, and publishing content. Honor the licensing boundaries of each site, distinguish original work from third-party materials, and avoid claiming rights we do not hold.

This project uses AI-assisted drafting and editing. The author reviews and finalizes the published work.

## License

See the [licensing policy](LICENSE.md) for scope and terms. Original website software is MIT-licensed; designated original practice materials are CC BY-SA 4.0; other writing and site copy are all rights reserved unless otherwise noted. Paper licenses follow their own notices and publication terms. Third-party rights are preserved.
