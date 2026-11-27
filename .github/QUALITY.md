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

| Capability | Purpose |
| --- | --- |
| [Common: Code Quality](workflows/common-code-quality.yml) | Source quality, workflow correctness, and maintainability. |
| [Common: Coherence Integrity](workflows/common-coherence-integrity.yml) | Conceptual integrity of repository organization, conventions, and architectural relationships. |
| [Common: Dependency Security](workflows/common-dependency-security.yml) | Dependency changes and open vulnerability alerts at moderate severity or higher. |
| [Site: Build Integrity](workflows/site-build-integrity.yml) | Successful production website generation. |
| [Site: Link Integrity](workflows/site-link-integrity.yml) | Internal links, fragments, assets, and external destinations; uncertain external responses are reported as advisories. |
| [Site: SEO Integrity](workflows/site-seo-integrity.yml) | Page titles, canonical URLs, and indexing directives. |
| [Site: Rendering Integrity](workflows/site-rendering-integrity.yml) | Browser verification, accessibility, and responsive usability at 320px, 768px, and 1280px. |
| [Site: Performance Integrity](workflows/site-performance-integrity.yml) | Loading performance, responsiveness, and visual stability against confirmed budgets and meaningful deterioration versus a compatible, reviewed reference. |

These eight dimensions run in parallel in one same-cycle Quality Pulse. Each reusable workflow retains its pull-request check and manual diagnostic entry point; only Quality Pulse owns the daily schedule.

## Quality Gate

Known defects fail their applicable checks. Unknown or incomplete evidence is never treated as clean. Repository required status checks remain intentionally empty during this check-name migration; ordinary pull-request review and existing protection remain in place.

Performance Integrity protects against confirmed budget violations and substantial loading regressions against a compatible reviewed reference. Rolling comparisons inform human judgment.

## Coherence Integrity

Executable [repository conventions](CONVENTIONS.md) help sustain conceptual integrity across workflows, code, tests, and documentation. Automation checks explicit relationships and path contracts; human judgment still guides simplicity, consistency, teaching clarity, and intentional differences.

## Publication

The existing GitHub Pages deployment remains separately managed. This increment does not introduce a Site Publish workflow or change publication behavior.

## Quality Pulse

The [daily workflow](workflows/quality-pulse.yml) coordinates the Common and Site safeguards in one cycle and provides a coherent view of quality. Passed checks, advisories, confirmed failures, incomplete checks, and unavailable evidence remain distinguishable. A cycle with advisories may succeed, but is not reported as an unconditional pass.

The fixed performance reference remains pending until complete, successful `main` evidence is compatible with the policy and reviewed. Rolling comparisons inform judgment but do not replace the fixed-reference safeguard.
