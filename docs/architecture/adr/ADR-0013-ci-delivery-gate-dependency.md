# ADR-0013: Product CI depends on the delivery-gates check

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-DLV-025 (completes at DG1), REQ-DLV-033.

## Context

`.github/workflows/delivery-gates.yml` is protected, and product agents must not edit it. GitHub Actions `needs:` can only reference jobs in the **same** workflow file. Product build and deploy jobs must not run when the gate pipeline is invalid.

## Decision

A new workflow, **`.github/workflows/ci.yml`**, whose **first job is `delivery-gates`**. It checks out with `fetch-depth: 0`, sets up Node, and runs `node tools/gates/validate.mjs --pipeline`. Every other job declares `needs: delivery-gates`, directly or transitively.

| Job | needs | Does |
|---|---|---|
| `delivery-gates` | — | `validate.mjs --pipeline`: every approved gate re-verified historically, and no stage advanced past an unapproved gate |
| `verify` | delivery-gates | Corepack pnpm, `pnpm install --frozen-lockfile`, format check, lint, typecheck, build, unit tests, `openapi:lint`, `check:no-cdn`; matrix Node 24 and 22 (ADR-0001) |
| `integration` | verify | PostgreSQL 18 service container, `pnpm test:integration` |
| `e2e` | verify | the Playwright 1.56.1 image (browsers baked in, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`), app plus DB, `pnpm e2e` |
| `images` (devops, T-DG1-DEVOPS) | integration, e2e | build the container images; push only on protected branches, with IT's registry configured |

The full intended file is **`docs/architecture/ci/ci.yml`**. It could not be written to `.github/workflows/` in this run because the path is read-only in the architect's sandbox (handback). devops-engineer installs it verbatim as `.github/workflows/ci.yml` and owns it from then on (stage plan: only devops-engineer writes product jobs in `.github/workflows/**`).

*Why a gate job in the same workflow and not `workflow_run`:*
- `workflow_run` runs in the **default-branch** context with elevated token permissions, a known risk for pull-request code.
- Its result is not reported as a check on the PR commit the same way.
- It chains awkwardly when more workflows are added.

The in-workflow job re-runs exactly the same validator command as `delivery-gates.yml`. It is cheap (git only, no bubblewrap needed for `--pipeline` [V-LOCAL: ran `node tools/gates/validate.mjs --pipeline` → `PASS pipeline (active stage: DG1 BUILDING)`]). A failed or unapproved gate therefore stops every product job.

Action pins reuse the SHAs already approved in `delivery-gates.yml` (`actions/checkout` v7.0.1, `actions/setup-node` v7.0.0). pnpm comes from Corepack, not a third-party action.

## Consequences

- The gate is checked twice per push (once per workflow). That is accepted for independence from the protected file.
- Branch protection should require `ci / verify`, `ci / integration` and `ci / e2e`. That is a repository-settings step for the user or IT, recorded in the handback.
