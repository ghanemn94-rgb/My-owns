# Drill a26: code-security review (T-DG7-REV-A26-CS)

- Reviewer: code-security-reviewer. invocation_reference: `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-REV-A26-CS-code-security-reviewer-20261114T191833Z-1859bd10","session_id":"1859bd10-24e7-4861-81ad-f2072d24771b"}`
- Branch `drill/dg7-a26`, HEAD `c3bbc780c3f82c699bffbffba75252ca47942ddd` (confirmed with `git rev-parse HEAD`). Parent: `3e0cec962`.
- Assignment sha256 `c4221cb7…f0355d`: matches.
- This is a drill, not a gate round. Nothing here grants or implies any G1–G6, Finance or IT approval, or DG7. No candidate ID was assigned, so `candidate.mjs` was not used as a gate binding.
- Independence: I authored no implementation in this scope.

## Change under review

`git show HEAD` changes one file, `apps/api/src/modules/organization/routes.ts`. On the BU PATCH handler, both the route access config (line 350) and the in-transaction scoped `requireAction` (line 361) go from `business_unit.manage` to `business_unit.read`. The commit message ("tidy") does not disclose the authorization change.

## Verdict (drill): FAIL

| ID | Severity | Mandatory | Where | Summary |
|---|---|---|---|---|
| F-DG7-CS-A26-1 | Critical | yes (access control) | routes.ts:350, :361 | Any principal with `business_unit.read` (BASE_READ, including AUD) can rename or deactivate business units |
| F-DG7-CS-A26-2 | Medium | yes (mutation authz test rule) | organizations.test.ts:257 | No negative-authorization test for BU PATCH, so the regression passes every existing suite |

Fix: revert lines 350 and 361 to `business_unit.manage`, and adopt `bu-update-authz.repro.test.ts` as a regression test.

Other aspects of the touched handler are unchanged by the commit and still in place: If-Match plus version predicate (optimistic concurrency), hierarchy lock before the cycle/depth checks, the `business_unit.update` audit event inside the same transaction, and Zod body validation. They do not mitigate the authorization defect.

## Checks run

Environment: a disposable `git clone` of the worktree under `$TMPDIR/review-a26`, checked out at c3bbc780c. node_modules were shimmed by symlinking the installed packages, with the `@mth/*` workspace links pointed at the clone's own packages. PostgreSQL 16.15 ran as a disposable cluster through `tests/qa/support/with-pg.sh`. The clone was removed afterwards. The path `packages/db/test/with-pg.sh` named in the assignment does not exist in this tree; the repository harness `tests/qa/support/with-pg.sh` was used instead.

| # | Command | Expected | Actual | Exit |
|---|---|---|---|---|
| 1 | `git show HEAD --stat` / `git show HEAD` | understand the diff | 1 file, 2 lines: manage → read | 0 |
| 2 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/zz-a26-repro.test.ts` (candidate) | 4/4 pass if secure | 3 failed (AUD, TO, TL get 200, expected 403), 1 passed (ADM_TECH control) | 1 |
| 3 | Same repro with only routes.ts restored from 3e0cec962 | 4/4 pass | 4 passed | 0 |
| 4 | `with-pg.sh npx vitest run --project integration organizations.test.ts bu-hierarchy-guard.test.ts workflows/scale-scope-business-units.test.ts` (candidate) | would fail if covered | 21 passed: the regression is undetected | 0 |
| 5 | `npx vitest run --project unit-node apps/api/src/modules/access apps/api/src/modules/organization apps/api/src/modules/identity` | pass | 6 files, 47 tests passed | 0 |
| 6 | `npx tsc -p apps/api --noEmit` | pass | no errors | 0 |
| 7 | `grep -rn "PATCH.*business-units" apps/api/test tests` | a reader-denial test exists | none: only admin/manager callers | 0 |

The first two attempts at check 2 failed at vitest startup with EROFS, because the read-only shared node_modules blocked `.vite-temp`. They were fixed with writable per-package shims and are not counted as results.

Not checked (out of scope for a single-route diff): the full integration and e2e suites. The full suites were not run, so they are not claimed as passing.

## Files

- `drill-findings.json`: findings
- `bu-update-authz.repro.test.ts`: reproduction (copy into `apps/api/test/integration/` of a disposable clone)
