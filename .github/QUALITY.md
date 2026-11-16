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
| [Build Integrity](workflows/build-integrity.yml) | Production Jekyll build | Production Jekyll build |
| [Link Integrity](workflows/link-integrity.yml) | Generated-site internal links, fragments, assets, and external destinations | Same generated-site audit, including external destinations; uncertain responses are reported separately |
| [SEO Integrity](workflows/seo-integrity.yml) | Generated page titles, canonical URLs, and indexing directives | Same generated-site audit |
| [Source Quality](workflows/source-quality.yml) | Super-Linter (including Ruff C901 complexity) and Ruby syntax validation | Same source checks |
| [Dependency Security](workflows/dependency-security.yml) | Differential review of the proposed dependency changes; moderate-or-higher threshold across runtime/development/unknown scopes | Open Dependabot alerts across enabled dependency ecosystems; moderate-or-higher findings require review. API/permission failures are unknown, not a clean result |
| [Rendered Site Integrity](workflows/rendered-site-integrity.yml) | Production-generated pages load in Chromium; smoke routes, detectable accessibility violations, and responsive layouts/visitor pathways at 320px, 768px, and 1280px CSS widths | Same browser, accessibility, and responsive suite |
| [Performance Integrity](workflows/performance-integrity.yml) | Four routes × mobile/desktop × three runs; only reflection-text-only changes intentionally skip measurement. Mixed or uncertain changes run Lighthouse | Full Lighthouse measurement and informational fixed/rolling comparisons |

The configured UTC schedule is: Performance Integrity **06:17**, Build Integrity **06:23**, Link Integrity **06:29**, SEO Integrity **06:35**, Source Quality **06:41**, Dependency Security **06:47**, and Rendered Site Integrity **06:53**. The Agency Quality Pulse is scheduled for **18:17 UTC**, with an explicit **18:00 UTC** completion cutoff. These times are staggered to avoid collisions and leave time for the longer browser run. Schedules are best-effort: a job completing after cutoff is shown as late, not fresh. This change has not yet been merged; its first complete daily `main` verification and pulse remain unverified until the owner observes them on `main`.

The Agency Quality Pulse is one native Actions Job Summary, not a dashboard, seventh required PR check, or remediation verdict. It queries only daily `schedule` runs on `main`, links to exact runs, and distinguishes fresh, failed, skipped, late, missing, prior, stale, and API-inaccessible data. Previous successful runs are evidence of earlier verification only, never a substitute for today's check. Findings and the shortest next action appear before the compact per-dimension evidence table. Performance measurement and fixed/rolling baseline details remain in its linked workflow summary; raw Lighthouse reports are retained for 14 days and machine-readable summaries/comparisons for 90 days.

The daily Dependency Security posture reads open Dependabot alerts across enabled ecosystems; it is distinct from the PR-diff action. It can only assess dependencies represented in the enabled GitHub dependency graph, and a denied or unavailable alert API is reported as unknown. Humans review findings, decide priorities, and merge fixes. No automatic editorial repair or performance threshold is active.

Lighthouse results are controlled lab observations, not field measurements or actual visitor Core Web Vitals. Comparisons are informational; there are no automatic regression thresholds. The versioned fixed reference in `.github/performance-reference.json` remains pending a reviewed first successful `main` sample. The rolling comparison uses up to 28 compatible successful scheduled daily-`main` summaries; pull-request runs are never reference data. Missing permissions, expired artifacts, insufficient history, and incompatible tool versions are unavailable/collecting, not zero measurements. The 14-day raw retention limits approximately 5.1 MB per full run; the 90-day compact history is for comparisons, subject to repository retention settings and periodic artifact cleanup by GitHub.

## Quality Pulse Response and Schedule Recovery

When a pulse reports a failure, missing/late run, stale evidence, or unknown API result, the human owner opens the linked workflow summary/logs, determines whether the check ran and what it found, and chooses whether to rerun, fix, or explicitly accept the finding. For missing runs, check Actions on `main` for the expected date, then manually dispatch the workflow when that trigger is available. If the pulse itself is absent, inspect the scheduled workflow runs directly; it cannot report its own suspension. GitHub may delay or miss a schedule and may disable schedules for public repositories after 60 days without repository activity, so check the default-branch Actions page periodically and manually dispatch after inactivity or a missed day.

## Required Check Names and Safe Migration

The active PR Quality Gate ruleset **27318804** requires exactly these current job/status contexts. They are intentionally retained in this change; workflow display titles, summaries, and documentation use the canonical names in the second column.

| Current required status context | Proposed canonical context |
| --- | --- |
| `Build integrity` | `Build Integrity` |
| `Link integrity` | `Link Integrity` |
| `SEO integrity` | `SEO Integrity` |
| `Source quality` | `Source Quality` |
| `Dependency security` | `Dependency Security` |
| `Rendered-site integrity` | `Rendered Site Integrity` |

Performance Integrity and Agency Quality Pulse are informational, not required statuses. To migrate the six contexts, the owner must coordinate a one-for-one update to the active ruleset: first verify every proposed new context on a candidate PR; during a maintenance window, replace all six required context strings in ruleset 27318804 with their mapped names without reducing the required count or changing enforcement; then verify the candidate PR still has all six green checks and that merges are protected. Do not merge renamed job contexts while the ruleset still requires old names, or update the ruleset ahead of available new checks. If owner approval or ruleset access is unavailable, keep the old job names as this change does and defer migration. No ruleset modification is included here.

To reproduce the performance measurement locally, build with `JEKYLL_ENV=production bundle exec jekyll build --trace`, run `npm ci`, install Chromium with `npx playwright install --with-deps --no-shell chromium`, then run `npm run measure:performance`. Raw reports are written to the ignored `performance-reports/` directory. Checks run on PRs or a schedule according to the risk they address—not because every dimension needs the same frequency.

The outcome is a quiet, trustworthy system that brings forward a problem **and a practical path to resolution** when attention is needed.
