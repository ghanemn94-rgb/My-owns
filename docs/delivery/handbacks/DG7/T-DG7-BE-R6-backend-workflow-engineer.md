# Handback T-DG7-BE-R6: business-unit PATCH authorization regression test (backend-workflow-engineer)

- **Stage:** DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `a472a9f0ce57ce56839be401d3b70fb71c5c7a7f`. The working tree was clean apart from this run's own `runs/` folder.
- **Invocation:** run `DG7-T-DG7-BE-R6-backend-workflow-engineer-20261115T095427Z-820e80a2`, session `820e80a2-09cf-4073-9772-1955aa36cc50`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-R6.md`, sha256 `68eb3876…179395cf` (verified).
- **Finding:** F-DG7-954. The task asked for a test-only repair, and that is what this is. No product code, migration or API endpoint changed.
- **Time:** started 09:54:39Z and finished at about 10:15Z.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/api/test/integration/organizations.test.ts` | Ports the A26 K6 regression tests from `c4943c8d1aa18dc018a81f84c0958787ccefce4f` (branch `drill/dg7-a26`) byte-for-byte: `git diff HEAD c4943c8d1 -- <file> \| git apply`. Prettier leaves the file unchanged. The change is +87 lines: three helper imports and one `describe` block with 5 tests. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R6-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R6-evidence/*` | Logs of every run below, the mutant patches, and the sha256 of `routes.ts` before and after the mutation runs. |

- **Not changed:**
  - `apps/api/src/modules/organization/routes.ts`. At HEAD it is byte-equal to the fixed drill version: `git diff HEAD c4943c8d1 -- routes.ts` is empty.
  - The `p7-pending*.ts` files. They have no entry for this task (`grep business.unit|954|A26` finds nothing), so there was nothing to remove.

## 2. Behaviour per requirement

### REQ-S10-001 (scoped RBAC enforced on the server)

`PATCH /api/v1/business-units/:id` now has negative and positive authorization tests in the main tree:

- **office, auditor and leadA1** hold `business_unit.read` but not `business_unit.manage`. A rename, rename-AR and deactivate request from each of them gets **403**. Each test also checks that:
  - the unit is unchanged (version, `name_en`, `name_ar` and status);
  - there is no `business_unit.update` audit event;
  - the request's only audit event is `authorization.denied`.
- **Split grant.** A user with `ADM_TECH` (manage) on the destination `a2` and only `AUD` (read) on `a1`, which covers the moved unit `a1x`, gets **403** on a re-parent. The parent and version are unchanged, and no update is audited.
- **Other organization and no grant.** officeB and nobody get **404** (ADR-0006), and the version is unchanged.
- **Positive control.** The technical admin gets **200**. The version goes up by exactly 1, with exactly one `business_unit.update` audit event.

### REQ-S20-026 (findings repaired and proven by a regression test)

The A26 drill's regression tests are now in the release line. I proved that they **detect** the drill defect, using a local mutation that was never committed. `routes.ts` was restored, and its sha256 before and after is identical (`routes-sha256-before.txt` / `routes-sha256-after.txt`; `sha256sum -c` printed OK).

| Mutant (patch in evidence) | Change | Result |
| --- | --- | --- |
| `mutant-both.patch` | The exact A26 defect, `git diff c4943c8d1 c3bbc780c -- routes.ts`: route gate and `requireAction` both use `business_unit.read`. | **Detected.** Exit 1, 4 failed and 11 passed. The failures are the office, auditor, leadA1 and split-grant tests. |
| `mutant-requireAction-patch-only.patch` | Only the PATCH handler's `requireAction` is changed to `business_unit.read`. | **Detected.** Exit 1, 4 failed and 11 passed (the same 4). |
| `mutant-route-gate-only.patch` | Only the route's `config.access.permission` is changed to `business_unit.read`. | **Not detected.** Exit 0, 15/15 passed. This is an equivalent mutant (see §4). |

On the unmodified tree: exit 0, 15/15 passed (10 existing tests and 5 ported).

## 3. Checks run (Node 24.21.0, `MTH_PNPM_OFFLINE=1`, PostgreSQL 16.15 disposable cluster via `tests/qa/support/with-pg.sh`)

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/organizations.test.ts` (tree) | 0 | 1 file, 15/15 passed, 135 migrations applied to a fresh database | `tree-organizations.log` |
| The same command with each mutant applied | 1, 1 and 0 | See the table in §2 | `mutant-both.log`, `mutant-requireAction-patch-only.log`, `mutant-route-gate-only.log` |
| `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/organizations.test.ts apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/bu-hierarchy-guard.test.ts` | 0 | 3 files, 133/133 passed | `tree-integration-touched-and-contract.log` |
| `pnpm -r typecheck` | 0 | Done | `pnpm_-r_typecheck.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0`, clean | `pnpm_lint.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `pnpm_openapi_lint.log` |
| `pnpm test` | 0 | 130 files, 2179 passed; 3 files, 259 passed and 2 skipped | `pnpm_test.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All files pass, this handback and the evidence included | `prettier-check.log` |

A first `requireAction`-only attempt used a global `sed`. That also changed the **create** handler's `requireAction`, and the run failed 5 tests, including the create test. I discarded that run and its patch because it was not a PATCH-only mutant. The PATCH-scoped re-run is the one reported above.

## 4. Known gaps

- **The route-gate-only mutant survives, and no HTTP test can kill it.** In `apps/api/src/modules/platform/hooks.ts` and `identity/routes.ts`, the declared `config.access.permission` is used only for two things:
  - requiring an authenticated session (with CSRF on unsafe methods);
  - the fail-closed `onSend` guard, which requires `permission !== "authenticated"` and at least one policy decision.

  The value itself is never evaluated against grants. Authorization is done only by the scoped `requireAction(..., "business_unit.manage", target)`, and both of the mutants that touch it are detected. So downgrading only the route label is not an access-control change. A test that pins the declared label would have to be static (route metadata), and I did not add one, because the assignment says to port the drill tests.
- I ran only the integration files listed in §3, not the full integration project. The assignment requires the files I touch and the contract test.

## 5. Open questions and merge instructions

- **Open question:** should the declared `config.access.permission` of each mutation route be pinned by a static test, for example by matching it against the permission passed to `requireAction`? That would make the route-gate-only mutant detectable. It is a design choice for the architect or code-security, outside this task.
- **Merge:** a single test file plus records. No migrations, ordering or conflicts are expected. The tests use only synthetic seed data.
- **Approvals:** this run grants no business, Finance or IT approval. Product G1–G6 and engineering DG7 are not affected.
