# Assignment T-DG1-QA: first executable acceptance suites (qa-verifier, authoring)

- **Stage:** P1 / gate DG1 (BUILDING). **Base revision:** HEAD after T-DG1-BE, T-DG1-FE and T-DG1-DEVOPS integrate. This is an **authoring** task (not a gate review): you write the first executable acceptance suites and run them on the integrated candidate before the freeze. You may write tests under `tests/qa/**` and root `e2e/**`, and **never** the product implementation you verify.
- `node_modules` is installed; tests run **offline** against a real disposable PostgreSQL and the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; **never** run `playwright install`). Do not run `pnpm install`.

## Scope — you own (write) ONLY these (p1-work-split.md §5)
- `tests/qa/**` — Vitest projects `unit-node`/`integration` pick up `tests/qa/unit/**` and `tests/qa/integration/**`.
- root `e2e/**` — Playwright (the frontend's own journeys live at `apps/web/e2e/`; yours are the acceptance-level e2e at root `e2e/`).

## Deliver — the first cases of these acceptance tests, derived from the acceptance criteria and the OpenAPI contract (not from the implementation)
- **A12** — cross-scope read/write of a transformation is **denied** by the policy function (a user scoped to org/BU/transformation A cannot read or write B); the positive in-scope case succeeds.
- **A13** — job-framework **idempotency**: the outbox relay / `transformation.created` handler processed twice produces one ledger effect (idempotency key honored); a duplicate delivery is a no-op.
- **A14** — **optimistic-concurrency conflict**: a stale `If-Match` update returns **409** with `currentVersion`; a missing `If-Match` returns **428**; a fresh update succeeds and bumps `version`.
- **A20** — **bilingual shell + brand-token change**: the shell renders AR-RTL by default and EN-LTR after switch (`dir`/`lang` on `<html>`); changing a design token propagates to the rendered CSS; EN/AR screenshots.
- **A18** — **clean start** from the documented commands (with devops-engineer): a fresh checkout builds, migrates a fresh DB, starts, and serves `/healthz`+`/readyz`.

## Rules (CLAUDE.md; reviewers verify)
- Derive checks from acceptance criteria; assert real behavior (status codes, DB state, rendered `dir`/`lang`, screenshots), not implementation details.
- Tests must be deterministic and run offline. A missing tool/credential makes the check **BLOCKED**, never a silent pass.
- Bilingual and RTL coverage where the criterion is UX (A20).

## Must not touch
`apps/**` and `packages/**` product source, `deploy/**`, `.github/**`, `tools/**`, `.claude/agents/**`, `docs/source/**`, the frozen files (§1), and the delivery records. You author tests only.

## Acceptance checks (reviewers verify independently)
1. `pnpm test` (unit-node + integration, incl. `tests/qa/**`) passes on the integrated candidate against a real disposable PostgreSQL.
2. `pnpm e2e` (root `e2e/**`) passes on the pre-installed Chromium; A20 produces EN and AR screenshots.
3. A12/A13/A14 assert the exact contract behaviors above (deny, idempotent no-op, 409/428).
4. A18 clean-start evidence exists (with devops).

## Handback
`docs/delivery/handbacks/DG1/T-DG1-QA-qa-verifier.md` — the suites authored, what each asserts, checks run with real output, and anything BLOCKED. (Note: authoring these does not make you the DG1 gate reviewer; the independent DG1 review is a separate round.)
