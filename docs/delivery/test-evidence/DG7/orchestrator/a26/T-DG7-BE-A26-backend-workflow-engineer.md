# Handback T-DG7-BE-A26 (backend-workflow-engineer): A26 drill defect fix

- Stage: DG7, A26 drill (ADR-0073 §10, K6). Branch `drill/dg7-a26`, worktree HEAD `c3bbc780c3f82c699bffbffba75252ca47942ddd` (verified with `git rev-parse HEAD` before writing). This branch is never merged.
- Invocation reference: `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-BE-A26-backend-workflow-engineer-20261114T204434Z-79cf8324","session_id":"79cf8324-1c8e-43b9-afa3-db4186bf4ac3"}`
- Assignment: `docs/delivery/assignments/DG7/T-DG7-BE-A26.md` (sha256 `e7799e98…cf95188`, checked).
- Findings addressed: F-DG7-CS-A26-1, F-DG7-CS-A26-2 (code-security); QA-A26-01, QA-A26-02, QA-A26-03 (qa). As the author, I don't close any of them. The originating reviewers verify.
- Nothing committed, as the assignment requires. The orchestrator commits.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/organization/routes.ts` | Restores `business_unit.manage` for `PATCH /api/v1/business-units/:businessUnitId`, both in the route gate (line 350) and in the scoped server-side `requireAction` (line 361). `apps/api/src` is now byte-identical to the parent `3e0cec962` (`git diff --quiet 3e0cec962 -- apps/api/src` returns 0). |
| `apps/api/test/integration/organizations.test.ts` | Adds the regression `describe` block "business unit update authorization (business_unit.manage, not business_unit.read)", with 5 tests. Imports `auditOfRequest`, `createUser` and `grant` from the harness. |

No migrations. No new endpoints. The existing endpoint's authorization is restored to its contract (`docs/api/openapi.yaml`: `business_unit.manage`).

## 2. Behaviour delivered

All test data is synthetic (`seedWorld`).

- **Readers refused (F-DG7-CS-A26-1, QA-A26-01).** `office` (TO@orgA), `auditor` (AUD@orgA) and `leadA1` (TL@BU a1) all hold `business_unit.read` without `business_unit.manage`. Each sends PATCH a1 `{nameEn, nameAr, status:"inactive"}` with a valid If-Match and a unique `X-Request-Id`. The test asserts:
  - the response is **403** (ADR-0006: the caller can read the record but not change it);
  - version, name_en, name_ar and status are unchanged;
  - no `business_unit.update` audit event exists for that actor on a1;
  - the request's only audit row is `authorization.denied`. The refusal is audited as a denial, never as a change.
- **Split-grant re-parent (QA-A26-02).** A new synthetic user holds ADM_TECH@BU a2 (manage on the destination) and AUD@BU a1 (read only on the moved unit a1x). They send PATCH a1x `{parentBusinessUnitId: a2}`. The test asserts 403, the parent stays a1, the version is unchanged, and there is no `business_unit.update` audit.
- **Scope and positive controls.** `officeB` (other organization) and `nobody` (no grants) get **404** with no version change. `admin` (ADM_TECH@orgA, holds manage) renames a1x and gets 200, version+1, and exactly one `business_unit.update` audit by admin.
- **Test gap closed (F-DG7-CS-A26-2, QA-A26-03).** Business-unit PATCH now has positive and negative authorization tests in `organizations.test.ts`.

## 3. Checks actually run

Environment:
- worktree as above, Node v22.22.0, pnpm 10.33.0;
- disposable PostgreSQL 16.15 cluster (UTF8, C locale) created and deleted by `tests/qa/support/with-pg.sh` on port 24351;
- dependencies installed with `pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/pstore"`. The store is a copy of the local pnpm store, because the shared store is read-only in the sandbox (EROFS) and the worktree had no `node_modules`. `node_modules` is gitignored and not part of the change.

I couldn't save the logs under `docs/delivery/test-evidence/` because that path is read-only for this role (`mkdir: … Read-only file system`). The tails are pasted below.

| # | Code state | Command | Exit | Result |
|---|---|---|---|---|
| 1 | **Defect** (`routes.ts` = HEAD c3bbc780c; new test, before prettier) | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/organizations.test.ts` | **1** | 4 failed, 11 passed (15) |
| 2 | Fix applied | same | **0** | 15 passed (15) |
| 3 | Fix applied | `pnpm -r typecheck` | 0 | all 9 projects Done |
| 4 | Fix applied | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | no output |
| 5 | Fix applied | `npx prettier --check <test file> <routes.ts>` | 1 | test file needed formatting; ran `prettier --write` on it |
| 6 | **Defect again** (`routes.ts` restored from `git show HEAD:…`, `git diff -- apps/api/src` empty; final formatted test) | same as #1 | **1** | 4 failed, 11 passed (15) |
| 7 | Fix re-applied (final state) | same as #1 | **0** | 15 passed (15) |
| 8 | Final state | `npx prettier --check apps/api/test/integration/organizations.test.ts apps/api/src/modules/organization/routes.ts` | 0 | All matched files use Prettier code style |
| 9 | Final state | `pnpm -r typecheck` | **0** | all Done |
| 10 | Final state | `pnpm lint` | **0** | clean |
| 11 | Final state | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/organizations.test.ts apps/api/test/integration/bu-hierarchy-guard.test.ts apps/api/test/integration/workflows/scale-scope-business-units.test.ts apps/api/test/integration/groups/groups.test.ts` | 0 | 4 files, 35 passed (35) |

Output tail for run #6 (defect, final test):

```
   × business unit update authorization (business_unit.manage, not business_unit.read) > office (business_unit.read without business_unit.manage) gets 403; unit unchanged; no update audited
   × … > auditor (business_unit.read without business_unit.manage) gets 403; unit unchanged; no update audited
   × … > leadA1 (business_unit.read without business_unit.manage) gets 403; unit unchanged; no update audited
   × … > split grant: manage on the destination (a2) but only read on the moved unit (a1x) cannot re-parent it (403)
AssertionError: expected 200 to be 403 // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 11 passed (15)
defect-exit=1
```

Output tail for run #7 (fixed):

```
 Test Files  1 passed (1)
      Tests  15 passed (15)
   Duration  14.46s
fixed-exit=0
```

Output tails for runs #9 and #10: `apps/api typecheck: Done` (tc-exit=0); `> eslint . --max-warnings=0` with no findings (lint-exit=0).

## 4. Known gaps / not done

- I did not run the full integration suite (`pnpm test:integration`). Only the target file and the three related BU suites ran (#11).
- The test logs aren't persisted in the repository, because the evidence path is read-only for this role. The orchestrator or reviewers can reproduce them with the commands above.
- This fix doesn't add a structural guard against a future permission downgrade, such as a contract test that compares each route's `access.permission` with `x-permission` in openapi.yaml. I'm suggesting it here and haven't implemented it.
- I didn't edit the `findings.json` status. Closing the findings is up to the originating reviewers.

## 5. Merge instructions

None. This is a drill branch and is never merged. The orchestrator commits the two changed files plus this handback on `drill/dg7-a26`. There are no migrations and no ordering constraints.
