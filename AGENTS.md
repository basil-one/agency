---
published: false
---

# Working in Agency

Agency is a Jekyll website for individual coaching and reflections. Follow the approved task; these instructions do not replace its requirements.

## Understand before changing

- Start with [README.md](README.md). For quality work, read [.github/QUALITY.md](.github/QUALITY.md) and inspect the actual workflows and tests.
- Establish the intended outcome, what must stay true, and how to verify it before implementing. Surface unresolved editorial or operating decisions early rather than inventing a policy.
- Inspect current `main`, the working branch, and affected consumers. Reconcile concurrent changes without undoing merged features, protections, or tests.
- For automation work involving `.github/`, `scripts/`, or `tests/`, also consult [.github/AGENTS.md](.github/AGENTS.md) when the files support GitHub workflows.

## Keep the change deliberate

- Prefer the smallest coherent change that solves the stated problem. Explain necessary deviations; avoid speculative refactoring, redundant infrastructure, and unrelated cleanup.
- Preserve the owner's approved language, links, positioning, and visitor experience. Do not rewrite content or make editorial choices under the guise of technical improvement.
- Use existing conventions and safeguards. Do not weaken quality gates, security, or access controls just to make a check green.

## Verify outcomes, not just code

- Run the relevant build and tests using the repository's existing commands. Connect new tests to a test path that actually runs; a test file alone is not verification.
- For changes that depend on hosted behavior, permissions, external APIs, or workflow integration, obtain real execution evidence when possible. Distinguish local tests, PR checks, and end-to-end hosted results.
- Treat missing or inaccessible evidence as unverified, never successful. State blockers and any specific owner action needed without claiming work was tested when it was not.

## Deliver for human review

- Propose code changes in a focused draft PR targeting `main` unless otherwise authorized. Summarize the outcome, changed files, tests, hosted evidence, limitations, and remaining decisions.
- Do not merge, modify repository protection settings, or take privileged actions without explicit authorization.
