# A26 drill: fix verification (code-security-reviewer, T-DG7-REV-A26-V)

- Stage: DG7, A26 drill (ADR-0073 §10, K7). Branch `drill/dg7-a26`, never merged. **Nothing here implies DG7.**
- Invocation reference: `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-REV-A26-V-code-security-reviewer-20261114T210336Z-01f2ad5e","session_id":"01f2ad5e-3942-4932-b8a0-3810666a105d"}`
- Assignment: `docs/delivery/assignments/DG7/T-DG7-REV-A26-V.md`, sha256 `3101e1d1b06e7cb8a5c0817b7b9889993477f6fd3722f31957ba3aad3cd7f5e4` (checked).
- Reviewed commit: `git rev-parse HEAD` = `c4943c8d1aa18dc018a81f84c0958787ccefce4f` (fix). Defect commit: `c3bbc780c`. Parent: `3e0cec962`.
- Recomputed candidate ID, for traceability only (working tree, assignment file untracked): `node tools/gates/candidate.mjs --stage DG7` → `sha256:5e58a9519193ccca80472c9f565117f23193737f117360eec8756bf35ecc7668` (3143 files, exit 0). The assignment names no candidate ID to compare against, so this is recorded, not matched.
- Independence: I did not author the fix (author: backend-workflow-engineer, handback `docs/delivery/handbacks/DG7/T-DG7-BE-A26-backend-workflow-engineer.md`). I originally reported F-DG7-CS-A26-1/-2. I formed this verdict from my own runs below. I read the handback for its claims only, and I did not read the QA verification.

## Environment

- Disposable clone: `git clone --no-hardlinks <worktree> "$TMPDIR/review-a26v"`, `git checkout c4943c8d1`. Removed afterwards.
- Node v22.22.0, pnpm 10.33.0. The shared pnpm store is read-only in the sandbox (`pnpm install --offline` exit 226), so I copied it to `$TMPDIR/pstore-a26v` and ran `pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/pstore-a26v"` (exit 0).
- PostgreSQL 16 (`/usr/lib/postgresql/16`), using a disposable cluster that `tests/qa/support/with-pg.sh` creates and deletes. The assignment names `packages/db/test/with-pg.sh`, but that path does not exist at this commit (`ls` → No such file). The documented harness is `tests/qa/support/with-pg.sh` (handover docs and earlier handbacks), so I used that.
- Product code was not modified. The reverts below were made only in the disposable clone and restored with `git checkout -- routes.ts` (clean `git status` afterwards).
- Logs (ANSI stripped) are in `verification-logs/`.

## Checks

| # | Code state in clone | Command | Expected | Actual | Exit |
|---|---|---|---|---|---|
| 1 | Fix (c4943c8d1) | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/organizations.test.ts` | all pass | 15 passed (15) | **0** |
| 2 | Defect: `routes.ts` = `git show c3bbc780c:apps/api/src/modules/organization/routes.ts` (both lines `business_unit.read`) | same, `--reporter=verbose` | the new regression tests fail | 4 failed / 11 passed: office, auditor and leadA1 tests plus the split-grant test, each `expected 200 to be 403`. Positive/404 control passes. | **1** |
| 3 | Only line 350 (route `config.access.permission`) reverted to `business_unit.read`. Line 361 stays `manage`. | same | (diagnostic) | 15 passed | 0 |
| 4 | Only line 361 (scoped `requireAction`) reverted to `business_unit.read`. Line 350 stays `manage`. | same | regression tests fail | 4 failed / 11 passed, same 4 tests, `expected 200 to be 403` | **1** |
| 5 | Fix | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/organizations.test.ts apps/api/test/integration/bu-hierarchy-guard.test.ts apps/api/test/integration/workflows/scale-scope-business-units.test.ts` | no regression | 3 files, 26 passed | **0** |
| 6 | Fix | `git diff 3e0cec962 c4943c8d1 -- apps/api/src` | empty (restored to the pre-defect contract) | empty | 0 |

## Analysis

**Both places are fixed.** At `routes.ts:350` the route declaration and at `routes.ts:361` the scoped `requireAction` are both `business_unit.manage` again, and `apps/api/src` is byte-identical to the parent `3e0cec962` (check 6). This matches `docs/api/openapi.yaml` `updateBusinessUnit` ("business_unit.manage; a re-parent also needs it at the destination"). The destination checks at lines 377 and 394 are unchanged.

**Which line enforces.** Checks 3 and 4 separate the two lines. `config.access.permission` is not a per-request authorization check. `apps/api/src/modules/platform/hooks.ts` uses it only at registration (the route must declare access) and in the fail-closed `onSend` guard (a success response must have consulted the policy at least once). The server-side enforcement is the scoped `requireAction` at line 361. Reverting line 361 alone brings the full escalation back, and the new tests catch it (check 4). Reverting line 350 alone does not change behaviour (check 3), so no test can catch it there. That is expected, because it is declarative.

**Split-grant re-parent.** The test gives a synthetic user ADM_TECH on BU a2 (manage on the destination) and AUD on BU a1 (read only on the moved unit a1x), then sends PATCH a1x `{parentBusinessUnitId: a2}`. It asserts 403, an unchanged parent and version, and no `business_unit.update` audit for that actor. It fails with 200 at the defect (check 2) and with only line 361 reverted (check 4), so it pins the moved-unit check independently of the destination check. The 403 (not 404) confirms that the user can read a1x, so the denial comes from the manage check.

**Assertions.** The reader tests check 403, that version/name_en/name_ar/status are unchanged, that no `business_unit.update` audit exists for the actor, and that the request's only audit row is `authorization.denied` (matched by X-Request-Id). The controls check 404 and no version change for other-org and no-grant callers, plus 200, version+1 and exactly one audit for ADM_TECH. All test data is synthetic (`seedWorld`, `createUser`).

## Verdicts

| Finding | Severity | Verdict | Basis |
|---|---|---|---|
| F-DG7-CS-A26-1 (BU PATCH needs only `business_unit.read`) | Critical, mandatory | **CLOSED_VERIFIED** | Checks 1, 2, 4, 5, 6 |
| F-DG7-CS-A26-2 (no negative authz test for BU PATCH) | Medium, mandatory | **CLOSED_VERIFIED** | The new tests fail on the defect (check 2) and on the enforcement-line revert (check 4), and pass on the fix (check 1) |

## Residual observation (new, not blocking these closures)

- **OBS-A26-V-1 (Low, not a mandatory violation):** `apps/api/src/modules/organization/routes.ts:350`. No test detects a mismatch between a route's declared `config.access.permission` and its scoped `requireAction` or OpenAPI permission. Check 3 shows that downgrading line 350 to `business_unit.read` passes every test. Today this has no security effect, because enforcement sits at line 361. But the declaration is misleading and can hide a future downgrade in review, which is how this drill's defect was disguised. The implementer suggested the same thing (handback §4): add a contract test that compares route declarations with the permission the handler enforces, or with OpenAPI. This is a recommendation and was not part of the original findings.

## Not checked

- I did not run the full integration suite or the unit suite, and I did not run typecheck or lint myself. The handback reports typecheck and lint exit 0, but I have not verified that. None of these are required by this assignment.
