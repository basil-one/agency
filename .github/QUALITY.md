# Quality stance

**Quality is a continuous practice in service of human connection.**

Technical quality protects people's ability to understand, trust, navigate, and engage. A sustainable quality practice also respects the time and attention of the people caring for the experience.

## Our stance

- **Human connection is the purpose.** Reliability, accessibility, clarity, and performance serve the visitor's experience. A passing score is evidence, not a substitute for human judgment.
- **Quality is sustained.** Relevant changes are checked before merging; conditions that can deteriorate without a code change are revisited over time.
- **Automation brings actionable work to human judgment.** When a problem has a safe, practical remedy, an agent or workflow brings a reviewable pull request. Otherwise it brings a focused finding with evidence, impact, and a recommended next action. Humans decide what matters, approve changes, and merge.
- **Care creates capacity.** Healthy checks stay quiet. Alerts are proportionate, understandable, and worth acting on. The practice reduces maintenance work rather than displacing attention from human connection.

## How we operate

**On change:** Pull requests run applicable checks and make failures inspectable. A failing check identifies the affected area and provides enough context to reproduce or investigate the problem.

**Over time:** Scheduled checks watch risks that change independently of commits, such as external references and dependencies. Automation proposes fixes where safe and feasible; otherwise an actionable issue replaces an open-ended report. Routine successful runs require no attention.

**With judgment:** Human judgment governs intent, editorial decisions, priorities, approval, and merge. Automation supports those decisions with evidence and reviewable proposals; it does not replace them. Privileged automation remains narrowly scoped.

**Through learning:** Useful misses improve coverage. Noisy checks, fragile automation, and maintenance disproportionate to the site's needs are refined or retired. The practice evolves with evidence.

## Safeguards in operation

| Dimension | On pull requests | Over time |
| --- | --- | --- |
| Build integrity | Production Jekyll build and tests | Weekly build as part of the link-audit workflow |
| Link integrity | Generated-site internal links, fragments, and assets | Weekly/manual external-link audit; uncertain responses reported separately |
| SEO integrity | Generated HTML titles, canonicals, and indexing directives | Weekly generated-site audit; consider a separate live-endpoint check if hosting behavior or indexing endpoints need monitoring |
| Source quality | Super-Linter and Ruby syntax validation | Conventions enforced on subsequent PRs |

See [Jekyll build and link audit](workflows/jekyll-build.yml) and [code quality](workflows/code-quality.yml) for the actual configuration, run details, and diagnostics.

The SEO audit checks every generated HTML page for one nonempty title, one canonical URL matching its configured site and generated route, and no `noindex` or `none` meta directive. It intentionally does not require descriptions or social metadata, which remain optional/editorial, and does not infer a sitemap or robots.txt requirement. For the current production build (19 pages), a passing run reports:

```text
SEO audit passed: 19 generated HTML pages checked (nonempty titles, expected canonicals, no noindex directives).
```

A deliberately incorrect canonical produces a page-specific diagnostic, for example:

```text
ERROR: /reflections/example/ (reflections/example/index.html): canonical URL is 'https://wrong.example/reflections/example/'; expected 'https://agency.basil.one/reflections/example/'. Check canonical_url in _layouts/default.html against site.url, baseurl, and the page URL.
```

The weekly build inspects generated files, not hosting behavior. A narrowly scoped scheduled request to deployed routes and any explicitly configured robots/sitemap endpoints could catch drift in redirects, response headers, or deployed indexing directives; it is not added here because no robots.txt or sitemap.xml is currently generated and no live-endpoint policy is defined.

## Commitments being established

The next quality capabilities extend the same stance:

| Dimension | Intended practice |
| --- | --- |
| Accessibility (CI-04) | Validate rendered accessibility on changes; revisit the live experience where useful |
| Responsive usability (CI-05) | Exercise representative viewports and visitor pathways |
| SEO integrity (CI-06) | Validate generated metadata and discoverability signals; monitor live endpoints where they can drift |
| Performance (CI-07) | Establish a measured baseline and detect meaningful regressions without chasing perfect scores |
| Security and maintenance (CI-08) | Use dependency advisories and automated update PRs, with human review of security and compatibility |
| Maintainability and changeability (CI-09) | Keep the code understandable, cohesive, and economical to change; detect meaningful structural deterioration and favor simpler alternatives when they improve the system |

These are commitments under development, **not existing checks**. Each becomes an operating safeguard only after its behavior, reporting, and action path are verified. Checks run on PRs or a schedule according to the risk they address—not because every dimension needs the same frequency.

The outcome is a quiet, trustworthy system that brings forward a problem **and a practical path to resolution** when attention is needed.
