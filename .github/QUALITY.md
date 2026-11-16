# Quality stance

**Quality is a continuous practice in service of human connection.**

Technical quality protects people's ability to understand, trust, navigate, and engage. A sustainable quality practice also respects the time and attention of the people caring for the experience.

## Our stance

- **Human connection is the purpose.** Reliability, accessibility, clarity, and performance serve the visitor's experience. A passing score is evidence, not a substitute for human judgment.
- **Quality is sustained.** Relevant changes are checked before merging; conditions that can deteriorate without a code change are revisited over time.
- **Automation brings actionable work to human judgment.** When a problem has a safe, practical remedy, an agent or workflow brings a reviewable pull request. Otherwise it brings a focused finding with evidence, impact, and a recommended next action. Humans decide what matters, approve changes, and merge.
- **Care creates capacity.** Healthy checks stay quiet. Alerts are proportionate, understandable, and worth acting on. The practice reduces maintenance work rather than displacing attention from human connection.

## How we operate

**On change:** Pull requests run applicable checks and make failures inspectable. A failing check identifies the affected area and provides enough context to reproduce or investigate the problem. The `PR Quality Gate` ruleset must require the Jekyll build, source linting, and `Review dependency changes` checks; a check that is not required only reports a failure and does not enforce the gate.

**Over time:** Scheduled checks cover external references. GitHub's native Dependency graph and Dependabot alerts identify known dependency risks, while Dependabot security updates propose repair PRs for human review. We do not schedule routine dependency version updates. Routine successful runs require no attention.

**With judgment:** Human judgment governs intent, editorial decisions, priorities, approval, and merge. Automation supports those decisions with evidence and reviewable proposals; it does not replace them. Privileged automation remains narrowly scoped.

**Through learning:** Useful misses improve coverage. Noisy checks, fragile automation, and maintenance disproportionate to the site's needs are refined or retired. The practice evolves with evidence.

## Safeguards in operation

| Dimension | On pull requests | Over time |
| --- | --- | --- |
| Build integrity | Production Jekyll build and tests | Weekly build as part of the link-audit workflow |
| Link integrity | Generated-site internal links, fragments, and assets | Weekly/manual external-link audit; uncertain responses reported separately |
| Source quality | Super-Linter and Ruby syntax validation | Conventions enforced on subsequent PRs |
| Dependency security (CI-08) | `Review dependency changes` rejects PR-introduced known vulnerabilities of moderate or higher severity | GitHub Dependency graph, Dependabot alerts, and security-update PRs; humans review and merge fixes |

See [Jekyll build and link audit](workflows/jekyll-build.yml), [code quality](workflows/code-quality.yml), and [dependency review](workflows/dependency-review.yml) for the actual check configurations and diagnostics. The dependency check becomes an enforced merge gate only when `Review dependency changes` is added as a **required status check** in the repository's [PR Quality Gate ruleset](https://github.com/basil-one/agency/rules/27318804); enabling the workflow alone is insufficient.

## Commitments being established

The next quality capabilities extend the same stance:

| Dimension | Intended practice |
| --- | --- |
| Accessibility (CI-04) | Validate rendered accessibility on changes; revisit the live experience where useful |
| Responsive usability (CI-05) | Exercise representative viewports and visitor pathways |
| SEO integrity (CI-06) | Validate generated metadata and discoverability signals; monitor live endpoints where they can drift |
| Performance (CI-07) | Establish a measured baseline and detect meaningful regressions without chasing perfect scores |
| Maintainability and changeability (CI-09) | Keep the code understandable, cohesive, and economical to change; detect meaningful structural deterioration and favor simpler alternatives when they improve the system |

These are commitments under development, **not existing checks**. Each becomes an operating safeguard only after its behavior, reporting, and action path are verified. Checks run on PRs or a schedule according to the risk they address—not because every dimension needs the same frequency.

The outcome is a quiet, trustworthy system that brings forward a problem **and a practical path to resolution** when attention is needed.
