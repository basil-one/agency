# Quality Stance

**Quality is a continuous practice in service of human connection.**

Technical quality protects people's ability to understand, trust, navigate, and engage. A sustainable quality practice respects the time and attention of the people caring for the experience.

## Our Stance

- **Human connection is the purpose.** Reliability, accessibility, clarity, and performance serve visitors. A passing score is evidence, not a substitute for human judgment.
- **Quality is sustained.** Relevant changes are checked before merging; conditions that can deteriorate without code changes are revisited over time.
- **Automation supports human judgment.** It brings actionable findings and evidence, or proposes a reviewable remedy when one is safe and practical. Humans decide priorities, approve changes, and merge.
- **Care creates capacity.** Checks should be quiet, proportionate, and worth acting on. Noisy or fragile automation is refined or retired.

## Safeguards in Operation

| Dimension | On pull requests | Daily on `main` |
| --- | --- | --- |
| [Site Build Integrity](workflows/build-integrity.yml) | Production Jekyll build | Production Jekyll build |
| [Link Integrity](workflows/link-integrity.yml) | Generated-site internal links, fragments, assets, and external destinations | Same audit; uncertain external responses are reported separately |
| [SEO Integrity](workflows/seo-integrity.yml) | Generated page titles, canonical URLs, and indexing directives | Same generated-site audit |
| [Source Quality](workflows/source-quality.yml) | Super-Linter (including Ruff C901) and Ruby syntax | Same source checks |
| [Dependency Security](workflows/dependency-security.yml) | Dependency changes reviewed at moderate-or-higher severity across runtime, development, and unknown scopes | Open Dependabot alerts across enabled ecosystems; API/permission failures are unknown, not clean |
| [Rendered Site Integrity](workflows/rendered-site-integrity.yml) | Chromium smoke routes, detectable accessibility violations, and responsive usability at 320px, 768px, and 1280px | Same browser, accessibility, and responsive suite |
| [Performance Integrity](workflows/performance-integrity.yml) | Four routes × mobile/desktop × three runs; only reflection-text-only changes intentionally skip measurement | Full Lighthouse measurement and informational fixed/rolling comparisons |

## Quality Pulse

Quality checks run daily from **06:17 to 06:53 UTC**; the Quality Pulse is scheduled for **18:17 UTC** with an **18:00 UTC** completion cutoff. It is one native Actions Job Summary, not a dashboard, required PR check, or remediation verdict. It links to each scheduled `main` run and distinguishes fresh, failed, skipped, late, missing, prior, stale, and unavailable evidence. Freshness uses Actions job completion timestamps; unavailable or invalid timestamps are not fresh. If the Pulse is absent, inspect the scheduled workflow runs directly.

The Pulse presents findings and next actions before its evidence table. Lighthouse detail stays in the linked workflow summary: results are controlled lab observations, not field measurements, and comparisons have no automatic threshold. The fixed reference awaits a reviewed successful `main` sample; rolling comparisons use up to 28 compatible successful scheduled `main` runs, never PR data. Raw Lighthouse and dependency-posture artifacts are retained for 14 days; compact performance summaries and comparisons for 90 days.

## Human Response

For a failure, missing or late run, stale evidence, or unknown result, open the linked run and decide whether to rerun, fix, or explicitly accept the finding. For missing checks, inspect Actions on `main` for the expected date and manually dispatch when available. GitHub schedules can be delayed, missed, or disabled after 60 days without repository activity; periodically check the default-branch Actions page because the Pulse cannot report its own suspension.

Humans retain authority over intent, editorial decisions, priorities, and merge. Useful misses improve coverage, and maintenance remains proportionate to the site's needs.
