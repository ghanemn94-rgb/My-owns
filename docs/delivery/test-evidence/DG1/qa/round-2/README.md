# DG1 round-2 QA evidence (qa-verifier, T-DG1-REV-QA-R2)

Candidate sha256:991d32417f16984e47da7bb0767bd2e432e2d88b9fb066513dd7fa1761fea8fc, source commit f32c705898cf0a393ed87d7f45a570df9bc09a17.
All execution ran in a disposable clone under $TMPDIR (removed after the run); no product file was modified.
Each log starts with its cwd/environment and command, and ends with `exit=<status>`.

| File | Check |
|---|---|
| 01-install.log | pnpm install --frozen-lockfile --offline (store = scratch copy of the read-only local store) |
| 02-typecheck.log .. 07-contrast.log | typecheck, build, lint, openapi:lint (33 ops), check:no-cdn, contrast |
| 07b-deps-verify.log | deps:verify: BLOCKED (needs npm registry; not an assigned check) |
| 08-unit.log | pnpm test (unit-node + unit-web) |
| 09/10-integration-run{1,2}.log | pnpm test:integration on two fresh PostgreSQL 16 clusters (port 5452) |
| 11-e2e.log | e2e/support/qa-stack.sh npx playwright test e2e --workers=1 (FAIL: F-DG1-208) |
| 12-e2e-ar-rerun.log | determinism re-run, chromium-ar (same failure) |
| 13-e2e-diagnostic.{patch,log} | DIAGNOSTIC ONLY: one test-locator change in the clone -> 20/20 (product OK) |
| 14-validate-*.log | validate.mjs --register / --pipeline / --reconcile |
| 15-req-evidence-exists.log | evidence files of the 12 DG1 requirements exist |
| 16-a18-clean-start.log | A18 clean start with a real frozen offline install |
| 17-web-repairs.log | independent spec docs/delivery/test-evidence/DG1/qa/tests/dg1-r2-web-repairs.spec.ts (F-DG1-004/005, closed status) |
| 18-a20-token-propagation.log | A20 token propagation on the disposable copy |
| 19-schema-probe.log | docs/delivery/test-evidence/DG1/qa/tests/dg1-r2-schema-probe.sh (0007/0008, audit trigger) |
| screenshots/ | A20 EN/AR shell + journeys EN/AR (diagnostic run), web-repairs EN/AR, the F-DG1-208 failure |
