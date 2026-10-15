# Unit run 1 (locale unset): FAILED, 2 tests, both fixed. The raw log was lost

- **Command:** `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test`. It started at about 03:23Z and ended at about 03:33Z.
- **Result:** `Test Files 2 failed | 105 passed (107)` and `Tests 2 failed | 1900 passed (1902)`. These counts are for the `unit-node` project. `pnpm test` continued with `unit-web` and `unit-formula-nocodegen` and exited non-zero.
- **The two failures:**
  1. `apps/api/src/modules/platform/advisory-locks.test.ts`, "no module source outside the registry spells a class number". `AssertionError: expected [ 'workflows/approval-routes.ts' ] to deeply equal []`. My header comment in `approval-routes.ts` spelled the two lock class numbers. **Fix:** the comment now names the classes (`approvalSubject`, `approvalRouteStep`), not their numbers.
  2. `apps/api/src/modules/workflows/workflows.test.ts`, "registers its routes, each declaring access". `GET /api/v1/admin/approval-routes: expected 'methodology.read' to be 'transformation.read'`. ADR-0044 §9 makes this list `methodology.read`. **Fix:** I added one commented exception line to that DG2 test. It is disclosed in the handback §1 and §5 for the orchestrator.
- **After the fixes:** `npx vitest run --project unit-node` on the two files gave 2 files and 17/17 tests passed. Full reruns: `unit-locale-unset.txt` and `unit-c-utf8.txt`.
- **Why the raw log is missing:** I started the rerun and an `mv` of the run-1 log in two background shells at the same moment. The rerun's `>` redirect truncated the file before the `mv` renamed it, so the run-1 output was overwritten. The figures above are copied from my own `grep` of that log, taken before the rerun started. Nothing else is claimed for run 1.
