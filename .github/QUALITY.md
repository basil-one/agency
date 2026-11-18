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

| Dimension | On pull requests | Daily on `main` |
| --- | --- | --- |
| [Site Build Integrity](workflows/site-build-integrity.yml) | Production Jekyll build | Production Jekyll build |
| [Link Integrity](workflows/link-integrity.yml) | Generated-site internal links, fragments, assets, and external destinations | Same audit; uncertain external responses are reported separately |
| [SEO Integrity](workflows/seo-integrity.yml) | Generated page titles, canonical URLs, and indexing directives | Same generated-site audit |
| [Source Quality](workflows/source-quality.yml) | jactionlint workflow validation, Super-Linter (including Ruff C901), and Ruby syntax | Same source checks |
| [Dependency Security](workflows/dependency-security.yml) | Dependency changes reviewed at moderate-or-higher severity across runtime, development, and unknown scopes | Open Dependabot alerts across enabled ecosystems; API/permission failures are unknown, not clean |
| [Rendered Site Integrity](workflows/rendered-site-integrity.yml) | Chromium smoke routes, detectable accessibility violations, and responsive usability at 320px, 768px, and 1280px | Same browser, accessibility, and responsive suite |
| [Performance Integrity](workflows/performance-integrity.yml) | Four routes × mobile/desktop × three runs; only reflection-text-only changes intentionally skip measurement | Full Lighthouse measurement and informational fixed/rolling comparisons |

## Quality Pulse

The Quality Pulse summarizes daily scheduled checks on `main` in one native Actions Job Summary. To find it, open GitHub Actions → Quality Pulse → latest scheduled run → Summary. It also surfaces concise current-vs-fixed and rolling performance comparisons when compatible data are available; detailed evidence is in the linked Performance Integrity Summary. It is informational—not a required PR check or remediation verdict—and links to its evidence. Fresh, failed, skipped, late, missing, stale, prior, and unknown results remain distinct; unavailable evidence is never reported as a pass. A human reviews findings and decides whether to rerun, fix, or accept them. If a scheduled check or Pulse is missing, inspect Actions on `main` and dispatch the workflow when available. Schedules may be delayed, missed, or disabled after 60 days without repository activity, so periodically check Actions directly; the Pulse cannot report its own suspension.

Lighthouse results are informational lab measurements, not field data; they have no automatic threshold. Fixed comparisons use a reviewed successful `main` sample; rolling comparisons require 28 compatible successful scheduled `main` runs, never PR runs. Raw reports are retained for 14 days and compact performance summaries for 90 days.
