# Quality Stance

**Quality is a continuous practice in service of human connection.**

Technical quality protects people's ability to understand, trust, navigate, and engage. A sustainable quality practice also respects the time and attention of the people caring for the experience.

## Our Stance

- **Human connection is the purpose.** Reliability, accessibility, clarity, and performance serve the reader's experience. A passing score is evidence, not a substitute for human judgment.
- **Quality is sustained.** Relevant changes are checked before merging; conditions that can deteriorate without a code change are revisited over time.
- **Automation brings actionable work to human judgment.** When a problem has a safe, practical remedy, an agent or workflow brings a reviewable pull request. Otherwise it brings a focused finding with evidence, impact, and a recommended next action. Humans decide what matters, approve changes, and merge.
- **Coherence creates capacity.** Consistent organization and clear relationships make the system easier to understand, maintain, and extend.
- **Care creates capacity.** Healthy checks stay quiet. Alerts are proportionate, understandable, and worth acting on. The practice reduces maintenance work rather than displacing attention from human connection.

## How We Operate

**On change:** Pull requests are checked against the applicable quality safeguards. Failures require correction or an explicit authorized human decision.

**Over time:** Risks that can change without a code change are revisited. Meaningful findings or proposed remedies come to human judgment; healthy checks stay quiet.

**With judgment:** Human judgment governs intent, editorial decisions, priorities, approval, merge, and publication. Automation supports those decisions with evidence and reviewable proposals; it does not replace them. Privileged automation remains narrowly scoped.

**Through learning:** Useful misses improve coverage. Noisy checks, fragile automation, and maintenance disproportionate to the needs of the work are refined or retired. The practice evolves with evidence.

## Quality Domains

- **Common:** Shared source quality, repository coherence, and dependency security.
- **Site:** Integrity of website development, generation, and the visitor's experience.

Capabilities follow `Domain: Capability` naming. Quality Pulse is the unqualified Common → Site coordinator.

## Capabilities in Operation

| Capability | Pull request and daily operation |
| --- | --- |
| [Common: Code Quality](workflows/common-code-quality.yml) | Workflow correctness, Ruby syntax, Super-Linter (including Ruff C901), and focused quality regression tests. |
| [Common: Coherence Integrity](workflows/common-coherence-integrity.yml) | Positive and negative contracts for capability inventory/order, workflow identities, ownership, paths, references, and external action versions. |
| [Common: Dependency Security](workflows/common-dependency-security.yml) | Proposed dependency changes and open Dependabot alerts at moderate severity or higher; unavailable alert evidence remains unknown. |
| [Site: Build Integrity](workflows/site-build-integrity.yml) | Production Jekyll generation and exclusion of repository scripts and tests from generated output. |
| [Site: Link Integrity](workflows/site-link-integrity.yml) | Generated-site links, fragments, and assets; confirmed defects fail while uncertain external responses are nonblocking advisories. |
| [Site: SEO Integrity](workflows/site-seo-integrity.yml) | Generated page titles, canonical URLs, and indexing directives. |
| [Site: Rendering Integrity](workflows/site-rendering-integrity.yml) | Chromium smoke routes, detectable accessibility violations, SVG validation, and responsive usability at 320px, 768px, and 1280px. |
| [Site: Performance Integrity](workflows/site-performance-integrity.yml) | Four routes × mobile/desktop × three Lighthouse runs; mobile LCP/TBT/CLS budgets are 3000 ms/300 ms/0.1 and desktop budgets are 1500 ms/150 ms/0.1. Initial violations require three new measurements of each affected route/profile; fixed-reference LCP deterioration requires both >25% and >500 ms. Reflection-text-only changes intentionally skip measurement. |

These eight dimensions run in parallel in one same-cycle Quality Pulse. Each reusable workflow retains its pull-request check and manual diagnostic entry point; only Quality Pulse owns the daily schedule.

## Quality Gate

Known defects fail their applicable checks. Unknown or incomplete evidence is never treated as clean. Repository required status checks remain intentionally empty during this check-name migration; ordinary pull-request review and existing protection remain in place.

## Coherence Integrity

Executable [repository conventions](CONVENTIONS.md) help sustain conceptual integrity across workflows, code, tests, and documentation. Automation checks explicit relationships and path contracts; human judgment still guides simplicity, consistency, teaching clarity, and intentional differences.

## Publication

The existing GitHub Pages deployment remains separately managed. This increment does not introduce a Site Publish workflow or change publication behavior.

## Quality Pulse

The [daily workflow](workflows/quality-pulse.yml) coordinates Common checks followed by Site checks in the evidence table and publishes their same-cycle outcomes. Passed, advisory, failed, incomplete, skipped, and unavailable evidence remain distinguishable. A cycle with advisories may complete successfully, but is not reported as an unconditional pass. Dispatch Quality Pulse in GitHub Actions to run the full cycle on demand. GitHub may delay scheduled runs; the daily cadence is an operating goal, not a completion-time guarantee.

Absolute budgets apply without a fixed reference. A compatible reviewed fixed reference additionally enforces substantial LCP deterioration; a violation is confirmed with three new measurements of that route/profile. Missing or incompatible confirmation is incomplete, not a pass. The 28-sample rolling history is informational and is never the enforcement baseline.

The fixed reference is pending at [`site-performance-reference.json`](site-performance-reference.json). Its proposed source is scheduled `main` run [45996004222](https://github.com/basil-one/agency/actions/runs/45996004222), revision `4f1ea918a8630adfa2757b8d7d2dd878f4b6bf58`, captured 2026-11-27 12:12:51 UTC. The successful run includes all four routes, both profiles, and 24 Lighthouse samples on `ubuntu-24.04`, Lighthouse 13.6.0, Chrome 159.0.8154.6, Ruby 3.3.14, Jekyll 3.10.0, and Node 22.23.5. Review found mobile TBT medians above the 300 ms budget on `/know-your-patterns/` (337 ms), `/reflections/` (344 ms), and `/reflections/the-world-that-conflict-intelligence-opens/` (338 ms); confirmation is not present in this run. The candidate therefore remains explicitly pending, not an accepted baseline.

After this policy is available on `main`, run **Actions → Quality Pulse → Run workflow → branch `main` → Run workflow**. Review the Performance Integrity findings and confirmation artifact; only a complete successful main measurement with compatible environment and resolved confirmation is eligible for human review as the fixed reference. Do not use a PR measurement or the current candidate as an accepted reference.
