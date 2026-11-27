---
published: false
---

# Working in Agency

Agency is a Jekyll website for individual coaching and reflections. Follow the approved task; these instructions do not replace its requirements.

## Understand before changing

- Start with [README.md](README.md). Understand our quality commitments in [QUALITY.md](.github/QUALITY.md) and follow the repository conventions in [CONVENTIONS.md](.github/CONVENTIONS.md).
- Establish the intended outcome, what must stay true, and how to verify it before implementing. Surface unresolved editorial or operating decisions early rather than inventing a policy.
- Inspect current `main`, the working branch, and affected consumers. Reconcile concurrent changes without undoing merged features, protections, or tests.
- For automation changes, inspect triggers, job names, required checks, permissions, concurrency, artifacts, and downstream consumers. Trace evidence by producer, artifact, run ID, ref, event, and historical reader; keep scheduled-main evidence distinct from PR and manual runs.

## Keep the change deliberate

- Prefer the smallest coherent change that solves the stated problem. Explain necessary deviations; avoid speculative refactoring, redundant infrastructure, and unrelated cleanup.
- Preserve the owner's approved language, links, positioning, and visitor experience. Do not rewrite content or make editorial choices under the guise of technical improvement.
- Use existing conventions and safeguards. Do not weaken quality gates, security, or access controls just to make a check green. Preserve required check identities unless an owner-approved migration includes a verified protection transition.
- Use least privilege; never expose write-capable credentials to untrusted PR code. Escalate missing permissions or settings prerequisites early. Preserve licensing, attribution, and AI disclosures.

## Verify outcomes, not just code

- Run the relevant build and tests using the repository's existing commands. Connect new tests to a test path that actually runs; a test file alone is not verification.
- For changes that depend on hosted behavior, permissions, external APIs, or workflow integration, plan end-to-end hosted verification early. Distinguish local tests, PR checks, and hosted results; verify the combined workflow where possible. Check cancellation and rerun behavior when changing concurrency; retain compatible history and explain compatibility assumptions.
- Add focused success and failure fixtures, including missing or malformed evidence when relevant. Avoid misleading error annotations from intentional failures; a successful summarizer must not hide a failed check.
- Treat missing or inaccessible evidence as unverified, never successful. State blockers and any specific owner action needed without claiming work was tested when it was not.

## Deliver for human review

- Keep QUALITY.md a concise stance and operating map, not a transcript of implementation details. Put technical specifics in workflows, scripts, tests, and linked run artifacts.
- Propose code changes in a focused draft PR targeting `main` unless otherwise authorized. Report the final revision, outcome, changed files, executed checks and links, observed behavior, limitations, and owner actions. Distinguish measured facts from conclusions.
- Do not merge, modify repository protection settings, or take privileged actions without explicit authorization.
