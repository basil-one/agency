# Repository Conventions

Agency's quality practice serves the website. The domains are ordered **Common → Site**; [Quality Stance](QUALITY.md) describes the safeguards, and this guide describes where their implementation lives.

## Find the work

| Area | Workflows | Supporting code | Tests |
| --- | --- | --- | --- |
| Common | `.github/workflows/common-*.yml` | `scripts/common/` | `tests/common/` |
| Site | `.github/workflows/site-*.yml` | `scripts/site/` | `tests/site/` |
| Cross-domain orchestration | `quality-pulse.yml` | `scripts/orchestration/` | `tests/orchestration/` |

Use workflow filenames as capability IDs. A single-job workflow uses its filename stem as its job ID. Multi-job capabilities qualify distinct roles, as in `common-dependency-security-review` and `common-dependency-security-posture`. Human-facing check names are exactly `Domain: Capability`; Quality Pulse is the unqualified Common → Site coordinator.

Production helpers live under `scripts/{common,site,orchestration}/`; automated tests live under matching `tests/` domains. Production route discovery and matrices live in `scripts/site/`. Browser test support stays under `tests/site/browser/`.

## Workflow contracts

Each capability is directly runnable for pull requests, manual diagnostics, and reusable workflow calls. Only Quality Pulse owns the daily schedule. Its dimensions run in Common then Site order and each substantive workflow retains the corresponding direct pull-request check. Keep permissions narrow and preserve ordinary pull-request review; do not make repository protection changes as part of a capability migration.

Report the checked-out revision and distinguish passed, advisory, failed, incomplete, skipped, and unknown outcomes. Missing evidence is not a pass. Site Link Integrity reports uncertain external responses as nonblocking advisories, while confirmed internal or likely-broken links retain failure precedence.

Site Performance Integrity measures four representative routes on mobile and desktop with three Lighthouse runs summarized by medians; reflection-text-only changes retain their intentional skip classification and missing-route diagnostic. The executable policy sets mobile LCP/TBT/CLS budgets to 3000 ms/300 ms/0.1 and desktop budgets to 1500 ms/150 ms/0.1. Substantial LCP deterioration requires both >25% and >500 ms against a compatible reviewed reference. Initial violations require three new measurements for each affected route/profile; incomplete confirmation is not a pass. Only complete successful scheduled-main measurements contribute to the informational rolling history; pull-request and manual measurements are excluded. The canonical fixed-reference filename is `.github/site-performance-reference.json`; a reference must come from complete, successful, compatible main evidence and receive human review.

## Sustaining coherence

Common: Coherence Integrity verifies the canonical capability inventory and order, workflow names and job IDs, domain ownership, direct script/test/workflow references, package commands, and consistent external action versions. Focused negative fixtures prove that incorrect identities, paths, references, or action versions are rejected. Site Build verifies that generated `_site` excludes repository scripts and tests.

The contracts protect explicit relationships, not conceptual simplicity. Reviewers still judge whether a boundary or exception earns its maintenance cost and whether the system remains understandable.

## Run and maintain checks

- `npm run test:coherence-integrity` — capability inventory, identities, paths, ownership, references, and action version contracts.
- `npm run test:quality-pulse` — Pulse outcomes, orchestration, and dependency posture.
- `npm run test:required-checks` — canonical PR check identities and triggers.
- `npm run test:site-routes` — generated-route discovery.
- `npm run test:performance-history`, `npm run test:performance-policy`, `npm run test:performance-skip`, and `npm run test:performance-summary` — Site Performance behavior and evidence.
- `python3 -m unittest discover -s tests/site -p 'test_*.py' -v` — Site link, SEO, and SVG tests.
- `bundle exec jekyll build --trace` — production site build.
