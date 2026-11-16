# Handback T-DG7-BE-R8 (backend-workflow-engineer): F-DG7-940 migration-export organization-scope tests

- **Stage:** DG7 (P7). **Requirement:** REQ-S19-016. **Finding repaired:** F-DG7-940 (Medium, not a mandatory violation; code-security-reviewer, round 3).
- **Base:** `HEAD` c3e2a77b86df199087046d8e9cdc4f56191c075f on `claude/mobily-transformation-platform-dg6-regate`; the working tree was clean apart from this run's own `runs/` directory.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-BE-R8-backend-workflow-engineer-20261116T015935Z-f0d16713","session_id":"f0d16713-700a-476f-8f67-697b156deb27"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-R8.md`. Its SHA-256 matched the one given (52b98b11…be2e0).
- **Time:** started 2026-11-16T01:59:47Z, handback 2026-11-16T02:21Z (about 22 minutes).
- **Scope:** this task only adds a test. Product behaviour is unchanged: `apps/api/src/modules/transfer/export/service.ts` is byte-identical to `HEAD` (sha256 `9f16aeb79d30314ee5cc250e6a43a62101e384d544c035e873fe1edd3957bf06`, before and after; `git diff --exit-code` exit 0).
- **Approvals:** this work grants no G1–G6, Finance or IT approval. It touches no DG0–DG7 record. All data is SYNTHETIC.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/api/test/integration/transfer/export-scope.test.ts` (new; sha256 `d8c9238e74e4bfc82ce118364e0d6a56ec5f718dc0d1505b056388ea2374b627`) | Shipped integration test for the organization-scope rule of `requireExportRight`. It runs on its own scratch database. Fixture: ADM_TECH granted at `business_unit` scope and at `transformation` scope, plus an organization-scope ADM_TECH control that requests one export, which `runMigrationExport` takes to `succeeded`. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R8-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R8-evidence/*.log` | Logs of every check below (01–11). |

No migration and no API endpoint were added. No `p7-pending*.ts` entry existed for this repair: `P7_PENDING_BE_C` is already `[]`, so nothing was removed.

## 2. Behaviour delivered (per requirement)

**REQ-S19-016 / F-DG7-940.** The scope dimension of the migration-export authorization now has a shipped test. The test has 4 cases:

1. **Control.** ADM_TECH at organization scope gets 200 on list, get, manifest and attachment-manifest. Exactly one `migration_export` row exists, with audit `requested`, `started`, `succeeded`. This control proves that every 403 in cases 2–3 comes from the scope rule, not from a missing record or an unready package.
2. **ADM_TECH @ business_unit** and 3. **ADM_TECH @ transformation.** Each gets 403 on all five operations:
   - `GET /admin/migration-exports`;
   - `POST /admin/migration-exports`, both without and with an `Idempotency-Key`;
   - `GET /admin/migration-exports/{id}`;
   - `GET …/{id}/manifest`;
   - `GET …/{id}/attachment-manifest`.

   No refusal body names the export. After the calls:
   - `migration_export` still holds only the control's row;
   - the outbox still holds only the control's `migration_export.*` event;
   - the `migration_export.*` audit trail is unchanged;
   - the principal's own audit trail is still just its sign-in (`session.create`). No export event and no `authorization.denied` row was written.

   All outcomes are collected before the assertion, so a regression lists every operation it opens.
4. Across both narrower-scope principals, the only audit rows are their two sign-ins.

**Mutant M4 is killed** (log `02-mutant-M4.log`):

- **The mutation.** It replaced `if ((await authorize(db, principal, MIGRATION_EXPORT, { type: "organization", id: organizationId })).allowed) return organizationId;` with `return organizationId;`, the reviewer's M4 (diff in the log).
- **Result with the mutation in place.** The new file failed 3 of its 4 tests, and the run exited 1. Both narrower-scope principals got:
  - `GET list -> 200 (body names the export)`;
  - `POST -> 202` (business_unit), then `422` on the next request, because the mutant's export was now in progress;
  - `GET {id}`, `manifest` and `attachment-manifest` -> `200 (body names the export)`.

  The shipped `export.test.ts` still passed 10/10 in the same run, which confirms the finding.
- **Restore.** I restored `service.ts` from a copy. `cmp` exit 0, the same sha256 as before, `git diff --exit-code` exit 0.
- **After the restore.** All 6 transfer integration files pass, 59/59 (`03-transfer-integration-restored.log`).

## 3. Checks run (Node 24.21.0, `MTH_PNPM_OFFLINE=1`, PostgreSQL 16.15 disposable cluster from `tests/qa/support/with-pg.sh`)

| # | Command | Result | Exit | Log |
| --- | --- | --- | --- | --- |
| 01 | `QA_PG_PORT=26481 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/transfer/export-scope.test.ts` (unmodified source) | 4/4 passed | 0 | `01-new-test-unmodified.log` |
| 02 | Same harness, the M4 mutant in place, `export-scope.test.ts` + `export.test.ts` | 3 failed / 11 passed (the new file fails 3; `export.test.ts` passes 10/10, so it doesn't catch M4); source restored byte-identically | 1 (expected) | `02-mutant-M4.log` |
| 03 | `QA_PG_PORT=26481 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/transfer/` (restored) | 6 files, 59/59 passed | 0 | `03-transfer-integration-restored.log` |
| 04 | `pnpm -r typecheck` | done | 0 | `04-typecheck.log` |
| 05 | `pnpm lint` | clean | 0 | `05-lint.log` |
| 06 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | 0 | `06-openapi-lint.log` |
| 07 | `npx eslint` and `npx prettier --check` on the new test file | clean | 0 / 0 | `07-touched-file-lint-prettier.log` |
| 08 | `pnpm test` | unit-node 3042 passed; unit-web 2199 passed; unit-formula-nocodegen 259 passed, 2 skipped | 0 | `08-pnpm-test.log` |
| 09 | `QA_PG_PORT=26491 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | 111/111 passed | 0 | `09-contract.log` |
| 10 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | "All matched files use Prettier code style!" | 0 | `10-prettier-all.log` (rerun after this handback was written; see the log's timestamp) |
| 11 | `node tools/gates/validate.mjs --historical --stage DG6` | `PASS gate DG6 (historical)` | 0 | `11-validate-historical-DG6.log` |

I did not run the full integration suite (`pnpm test:integration`). The assignment asks for the transfer integration tests and the contract test, and both were run (03, 09).

## 4. Merge instructions

- There are no migrations or ordering constraints, and I expect no conflicts. The test file is new and owns its scratch database (`mth_transfer_export_scope`).
- Commit `apps/api/test/integration/transfer/export-scope.test.ts`, this handback and the evidence directory.
- To re-verify F-DG7-940, the reviewer can rerun mutant M4 on a disposable clone. `export-scope.test.ts` should fail.

## 5. Known gaps / residual risks

- The test covers ADM_TECH, the only role that holds `migration.export`. If a future role gets `migration.export`, it needs its own narrower-scope case. The rule itself, organization scope only, sits in `requireExportRight` and does not depend on the role, so it covers that role at runtime.
- `POST /migration-exports` re-checks the right inside `requestExport`, on reloaded grants. M4 mutates the one shared function, so both checks are covered together. A mutant that removes only the route-level pre-check would still be refused, by the in-transaction check, and is not a separate exposure.
- A narrower-scope denial does not write `authorization.denied`. That is current product behaviour: `problems.forbidden()` without a denial target (`access/denials.ts`). The test pins this behaviour, and the assignment asks for "no audit event". If the product later decides to audit these denials, the test's audit assertions need updating with it.

## 6. Open questions

- None that block this task. One possible follow-up for the orchestrator: the reviewer's sibling mutant M5 (import side) is already killed by `import-routes.test.ts`, which tests AUD at business_unit scope only, not at transformation scope. Adding a transformation-scope case there would make the two suites symmetric. That file is outside this assignment, so I left it unchanged.
