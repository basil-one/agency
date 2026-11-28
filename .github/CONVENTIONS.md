# Repository Conventions

Agency's shared quality practice covers the website. The domains are ordered **Common → Site**; [Quality Stance](QUALITY.md) describes the capabilities, and this guide describes where their implementation lives.

## Find the work

| Area | Workflows | Supporting code | Tests |
| --- | --- | --- | --- |
| Common | `.github/workflows/common-*.yml` | `scripts/common/` | `tests/common/` |
| Site | `.github/workflows/site-*.yml` | `scripts/site/` | `tests/site/` |
| Cross-domain orchestration | `quality-pulse.yml`, `release-publish.yml` | `scripts/orchestration/` | `tests/orchestration/` |

Use workflow filenames as capability IDs. A workflow with one substantive job uses its filename stem as that job ID; multi-job workflows qualify each role (`common-dependency-security-review` / `-posture`, `site-publish-build` / `-deploy`). Keep domain-facing check names exactly `Domain: Capability`. Quality Pulse and Release Publish are unqualified orchestration capabilities.

Production helpers live under `scripts/{common,site,orchestration}/`; automated tests live under matching `tests/` domains. Browser test support stays under `tests/site/browser/`, while production route discovery and matrices live in `scripts/site/`.

## Workflow anatomy and intentional differences

Make the checked-out revision and task context clear; prepare only the needed environment; generate artifacts when required; run the check and focused tests; preserve named evidence; summarize passed, advisory, failed, incomplete, unknown, and skipped outcomes without inferring success from missing evidence.

Use release version tags for external actions and one version of each shared dependency across workflows, unless a documented compatibility constraint requires otherwise. Agency currently pins jactionlint to the commit for v2.6.0.

The order is purposeful, not a template: Site Publish validates and deploys a same-run Pages artifact; Dependency Security separates pull-request review from scheduled/manual alert posture. Performance keeps classification, initial measurement, confirmation, and artifact evidence distinct. Only Quality Pulse owns the daily schedule; proposed-change safeguards retain pull-request checks, and verification workflows support manual diagnostics. Keep permissions narrow and preserve ordinary pull-request protection.

Site Link Integrity reports uncertain external responses as nonblocking advisories; known defects retain failure precedence.

Site Performance Integrity measures four representative routes on mobile and desktop using three-run Lighthouse medians. Confirm initial violations with three new measurements per affected route/profile; incomplete confirmation is not a pass. The executable policy defines absolute budgets and substantial deterioration criteria. PRs skip only text-only reflection edits; retain the missing-route diagnostic.

Pull requests use `pr-controlled`, excluding external analytics execution; Pulse and ordinary manual runs use `full-experience`. Both block analytics collection. Compare only compatible contexts; historical summaries without a context are full-experience evidence. Rolling history is informational and uses successful scheduled-main runs.

Maintain reviewed fixed references in [site-performance-reference.json](site-performance-reference.json) (full experience) and `.github/site-performance-reference-controlled.json` (controlled). Capture controlled evidence by dispatching **Site: Performance Integrity** from `main` with `measurement_context: pr-controlled`; review the complete successful `performance-summary` artifact before updating the reference. Without a compatible reference, absolute budgets remain active.

## Run and maintain checks

- `npm run test:quality-pulse` — Pulse outcomes, orchestration, and dependency posture.
- `npm run test:coherence-integrity` — capability inventory/order, workflow IDs, repository boundaries, script/test placement, reference traceability, and negative fixtures.
- `npm run test:required-checks` — required workflow triggers/jobs and Site and Release publication contracts.
- `python3 -m unittest discover -s tests/site -p 'test_*.py' -v` — Site link, SEO, and SVG tests.
- `npm run test:performance-history`, `npm run test:performance-policy`, `npm run test:performance-skip`, and `npm run test:performance-summary` — focused Site Performance checks; run `npm run test:performance-cli` after `npm ci` to verify Lighthouse option parsing.
- `npm run test:rendering-summary` — rendering evidence and coverage reporting.
- `npm run test:site-routes` — generated-route discovery. The browser suite needs a built `_site` and the installed Playwright browser.
- `bundle exec jekyll build --trace` — production site build.

## Sustaining coherence

Coherence Integrity protects repository organization and architectural relationships; Code Quality protects source and workflow correctness. Keep contracts focused on meaningful boundaries and behavior. Human judgment guides simplicity and intentional differences.

## Changelog and releases

Record notable outcomes under Unreleased in [CHANGELOG.md](../CHANGELOG.md) as work is merged. Preserve published entries.

With human authorization, dispatch Release Publish from `main` with a stable version (`X.Y.Z`). Review and merge the changelog-only PR through the Quality Gate, approving its checks if requested. The workflow verifies the approved revision before tagging and publishing. Rerun the same version to resume an interrupted publication.
