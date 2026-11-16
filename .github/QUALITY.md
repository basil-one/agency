# Quality Stance

**Quality is a continuous practice in service of human connection.**

Technical quality protects people's ability to understand, trust, navigate, and engage. A sustainable quality practice also respects the time and attention of the people caring for the experience.

## Our Stance

- **Human connection is the purpose.** Reliability, accessibility, clarity, and performance serve the visitor's experience. A passing score is evidence, not a substitute for human judgment.
- **Quality is sustained.** Relevant changes are checked before merging; conditions that can deteriorate without a code change are revisited over time.
- **Automation brings actionable work to human judgment.** When a problem has a safe, practical remedy, an agent or workflow brings a reviewable pull request. Otherwise it brings a focused finding with evidence, impact, and a recommended next action. Humans decide what matters, approve changes, and merge.
- **Care creates capacity.** Healthy checks stay quiet. Alerts are proportionate, understandable, and worth acting on. The practice reduces maintenance work rather than displacing attention from human connection.

## How We Operate

**On change:** Pull requests are checked against the safeguards in operation below. Failures require correction or an explicit authorized human decision.

**Over time:** Risks that can change without a code change are revisited. Meaningful findings or proposed remedies come to human judgment; healthy checks stay quiet.

**With judgment:** Human judgment governs intent, editorial decisions, priorities, approval, and merge. Automation supports those decisions with evidence and reviewable proposals; it does not replace them. Privileged automation remains narrowly scoped.

**Through learning:** Useful misses improve coverage. Noisy checks, fragile automation, and maintenance disproportionate to the site's needs are refined or retired. The practice evolves with evidence.

## Safeguards in Operation

| Dimension | On pull requests | Over time |
| --- | --- | --- |
| [Build integrity](workflows/build-integrity.yml) | Production Jekyll build | No separate scheduled check |
| [Link integrity](workflows/link-integrity.yml) | Generated-site internal links, fragments, assets, and external destinations | Weekly/manual external-link audit; uncertain responses reported separately |
| [SEO integrity](workflows/seo-integrity.yml) | Generated page titles, canonical URLs, and indexing directives | No separate scheduled/deployed-site check |
| [Source quality](workflows/source-quality.yml) | Super-Linter (including Ruff C901 complexity) and Ruby syntax validation | Conventions enforced on subsequent PRs |
| [Dependency security](workflows/dependency-security.yml) | Check dependency changes for known vulnerabilities | GitHub Dependency graph, Dependabot alerts, and security-update PRs; humans review and merge fixes |
| [Rendered-site integrity](workflows/rendered-site-integrity.yml) | Production-generated pages load in Chromium; main navigation and visitor actions work; generated pages are scanned for detectable accessibility violations; representative pages exercise responsive layouts and visitor pathways at 320px, 768px, and 1280px CSS widths | No separate scheduled check |
| [Performance integrity](workflows/performance-integrity.yml) | Informational Lighthouse mobile/desktop measurements and loaded asset/external script inventory; no calibrated regression threshold yet | No separate scheduled check |

To run the same measurement locally, build with `JEKYLL_ENV=production bundle exec jekyll build --trace`, run `npm ci`, install Chromium with `npx playwright install --with-deps --no-shell chromium`, then run `npm run measure:performance`. Raw Lighthouse reports are written to the ignored `performance-reports/` directory.

## Commitments Being Established

The next quality capabilities extend the same stance:

| Dimension | Intended practice |
| --- | --- |
| Accessibility (CI-04) | Validate rendered accessibility on changes; revisit the live experience where useful |
| Responsive usability (CI-05) | Exercise representative viewports and visitor pathways |

These are commitments under development, **not existing checks**. Each becomes an operating safeguard only after its behavior, reporting, and action path are verified.
Performance measurements are lab observations of the locally generated site, not field data or a claim about real-user Core Web Vitals. Regression thresholds remain deferred until repeated runs demonstrate a stable, visitor-relevant signal. Checks run on PRs or a schedule according to the risk they address—not because every dimension needs the same frequency.

The outcome is a quiet, trustworthy system that brings forward a problem **and a practical path to resolution** when attention is needed.
