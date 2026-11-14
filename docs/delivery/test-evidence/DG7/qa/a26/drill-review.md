# Drill review T-DG7-REV-A26-QA (qa-verifier)

Invocation: `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-REV-A26-QA-qa-verifier-20261114T192739Z-ce106f91","session_id":"ce106f91-553e-4adf-824f-a44e9b256c77"}`.
Assignment sha256 `88a7c4a1…6f31c5`, verified. This is a drill, not a gate round. Nothing was written under `docs/delivery/reviews/` or to `findings.json`. Nothing here grants or implies any G1–G6, Finance or IT approval, or DG7.

## Subject

- Branch `drill/dg7-a26`, HEAD `c3bbc780c3f82c699bffbffba75252ca47942ddd` (verified with `git rev-parse HEAD`).
- Commit "organization: tidy business-unit update route", which changes `apps/api/src/modules/organization/routes.ts` (2 lines).
- The assignment names no candidate ID. For traceability, `node tools/gates/candidate.mjs --stage DG7` gives `sha256:0df0d31b…0c896` (working tree, exit 0). The working tree includes the untracked assignment files and evidence.

## Verdict: FAIL (1 Critical, 1 High, 1 Medium). See `drill-findings.json`.

The commit lowers the permission for `PATCH /api/v1/business-units/:id` from `business_unit.manage` to `business_unit.read`, in both the route gate (`:350`) and the scoped server-side check (`:361`). Every seeded role holds `business_unit.read`, so readers can now rename, deactivate and re-parent business units. The commit message ("tidy") does not reveal a security-relevant change.

Unchanged and still correct: validation (`parseBody`), If-Match / 409 concurrency, the `business_unit.update` audit event, out-of-scope 404, and the destination `business_unit.manage` check on re-parent.

## Commands (disposable clone `$TMPDIR/review-a26-qa` at c3bbc780c; PostgreSQL 16.15 via `tests/qa/support/with-pg.sh`; Node v22.22.0)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `git show HEAD`; `grep business_unit.(read\|manage)` over src, migrations, openapi | 0 | manage is held only by ADM_TECH (0005:103). The contract (openapi.yaml:746) requires manage. |
| 2 | `with-pg.sh npx vitest run --project integration tests/qa/integration/qa-a26-bu-update-authz.test.ts` + organizations, bu-hierarchy-guard, scale-scope-business-units, groups (HEAD) → `integration-HEAD.log` | 1 | Existing 30/30 pass. QA: 3 failures (TO/AUD/TL get 200 and the unit is renamed and deactivated). |
| 3 | QA test (7 cases) on HEAD → `qa-test-HEAD.log` | 1 | 4 failed / 3 passed (includes split-grant re-parent 200, a1→a2) |
| 4 | QA test with routes.ts restored from parent `3e0cec962` → `qa-test-3e0cec962.log` (an earlier 6-case run: `integration-parent-3e0cec962.log`, exit 0) | 0 | 7/7 pass: all refusals 403, nothing changed. The routes.ts change is the cause. |
| 5 | `pnpm test` (HEAD) → `unit-HEAD.log` | 0 | unit-node 3022, unit-web 2175, nocodegen 259 (+2 skipped) passed |
| 6 | `with-pg.sh pnpm test:integration` (HEAD, full) → `integration-full-HEAD.log` | 1 | 4655 passed, 29 failed in 9 files. Triage below. |
| 7 | The same 9 failing files with routes.ts from the parent → `integration-failed9-parent-3e0cec962.log` | 1 | 6 files fail on the parent too (environmental). The other 3 pass. |
| 8 | Those 3 files (sensitive-reach-sweep, response-validation, a13-p6-import-commit-kill-restart) on HEAD in isolation → `integration-3files-HEAD.log` | 0 | 122/122 pass. They fail only in the full run because they depend on run order and state. Same on HEAD and the parent. |

Triage of the 6 environmental failures, seen on HEAD and the parent alike:
- The clone has no `dist` build (`packages/db/dist/cli.js`, `apps/worker/dist/main.js`). This breaks cli-stdout-drain, automation-version-at-occurrence, a22-*, and parts of platform.
- `tsc` cannot resolve the `@mth/*` packages because the clone's `node_modules` is symlinked: pnpm's store is read-only in the sandbox (EROFS), so `pnpm install --offline` could not run.
- A18 needs `QA_A18_ARCHIVE`/`QA_A18_STORE`, which are absent.

None of these files touch business-unit PATCH. Their results are **BLOCKED in this environment** (not PASS) and do not bear on the findings.

## QA test

`qa-a26-bu-update-authz.test.ts`, kept here as evidence. To run it, copy it into `tests/qa/integration/`. It covers:
- TO, AUD and TL rename/deactivate → 403 + `authorization.denied` + no change
- AUD re-parent to the top level → 403
- split-grant re-parent → 403
- officeB/nobody → 404
- ADM_TECH positive case → 200, one audit event, stale If-Match → 409

All data is synthetic (seedWorld).

## Independence note

While I was searching the permission strings (step 1), the output of `grep -r` also matched files under `docs/delivery/test-evidence/DG7/code-security/a26/`. That exposed one summary line of the other reviewer's drill finding. By then I had already identified the downgrade from `git show HEAD`. I opened none of that reviewer's files, and every result above comes from my own runs.

The disposable clone has been removed.
