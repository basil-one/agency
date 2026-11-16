# Quality stance

**Quality is a continuous practice in service of human connection.**

Technical quality protects people's ability to understand, trust, navigate, and engage. A sustainable quality practice also respects the time and attention of the people caring for the experience.

## Our stance

- **Human connection is the purpose.** Reliability, accessibility, clarity, and performance serve the visitor's experience. A passing score is evidence, not a substitute for human judgment.
- **Quality is sustained.** Relevant changes are checked before merging; conditions that can deteriorate without a code change are revisited over time.
- **Automation brings actionable work to human judgment.** When a problem has a safe, practical remedy, an agent or workflow brings a reviewable pull request. Otherwise it brings a focused finding with evidence, impact, and a recommended next action. Humans decide what matters, approve changes, and merge.
- **Care creates capacity.** Healthy checks stay quiet. Alerts are proportionate, understandable, and worth acting on. The practice reduces maintenance work rather than displacing attention from human connection.

## How we operate

**On change:** Pull requests are checked against the safeguards in operation below. Failures require correction or an explicit authorized human decision.

**Over time:** Risks that can change without a code change are revisited. Meaningful findings or proposed remedies come to human judgment; healthy checks stay quiet.

**With judgment:** Human judgment governs intent, editorial decisions, priorities, approval, and merge. Automation supports those decisions with evidence and reviewable proposals; it does not replace them. Privileged automation remains narrowly scoped.

**Through learning:** Useful misses improve coverage. Noisy checks, fragile automation, and maintenance disproportionate to the site's needs are refined or retired. The practice evolves with evidence.

## Safeguards in operation

| Dimension | On pull requests | Over time |
| --- | --- | --- |
| Build integrity | Production Jekyll build | No separate scheduled check |
| Link integrity | Generated-site internal links, fragments, assets, and external destinations | Weekly/manual external-link audit; uncertain responses reported separately |
| SEO integrity | Generated page titles, canonical URLs, and indexing directives | No separate scheduled/deployed-site check |
| Source quality | Super-Linter (including Ruff C901 complexity) and Ruby syntax validation | Conventions enforced on subsequent PRs |
| Dependency security | Check dependency changes for known vulnerabilities | GitHub Dependency graph, Dependabot alerts, and security-update PRs; humans review and merge fixes |

See [build integrity](workflows/build-integrity.yml), [link integrity](workflows/link-integrity.yml), [SEO integrity](workflows/seo-integrity.yml), [source quality](workflows/source-quality.yml), and [dependency security](workflows/dependency-security.yml) for the checks and their diagnostics.

## Commitments being established

The next quality capabilities extend the same stance:

| Dimension | Intended practice |
| --- | --- |
| Accessibility (CI-04) | Validate rendered accessibility on changes; revisit the live experience where useful |
| Responsive usability (CI-05) | Exercise representative viewports and visitor pathways |
| Performance (CI-07) | Establish a measured baseline and detect meaningful regressions without chasing perfect scores |

These are commitments under development, **not existing checks**. Each becomes an operating safeguard only after its behavior, reporting, and action path are verified. Checks run on PRs or a schedule according to the risk they address—not because every dimension needs the same frequency.

The outcome is a quiet, trustworthy system that brings forward a problem **and a practical path to resolution** when attention is needed.
