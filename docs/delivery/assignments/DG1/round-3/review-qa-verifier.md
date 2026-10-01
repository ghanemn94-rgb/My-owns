# DG1 round-3: qa-verifier

Read `review-common.md` first. Task ID: `T-DG1-REV-QA-R3`. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Execute on the frozen candidate (record command, env, real output; a missing tool/DB is BLOCKED, never a silent pass)
1. Build+static: `pnpm install --frozen-lockfile` a no-op (or BLOCKED offline); `pnpm -r typecheck/build`, `pnpm lint`, `pnpm openapi:lint` (33 ops), `pnpm check:no-cdn`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. Unit: `pnpm test`.
3. Integration (real disposable PostgreSQL, unique port e.g. 5472): migrations 0001-0008 apply to a fresh DB; the audit trigger rejects UPDATE/DELETE; contract tests match `docs/api/openapi.yaml` incl. getBrandingTokens; **run the integration suite at least twice** (F-DG1-110 stability).
4. **e2e (pre-installed Chromium; never `playwright install`; `--workers=1`; unique PG port e.g. 5473):** the full journeys in EN and AR — this is the finding under re-test.
5. Acceptance suites A12/A13/A14/A18/A20.

## Findings you verify
- **F-DG1-208** (High): the full e2e suite is GREEN in EN and AR (0 failed, 0 did-not-run); the previously-skipped Arabic journeys pass.
- **F-DG1-209** (register evidence): REQ-S19-004 + REQ-DLV-033 evidence reflects the current migrations (0001-0008) and current logs.
- **F-DG1-005 / F-DG1-008** (cross-check): the derived-assignment audit entry is localized AR+EN.
- **F-DG1-110** (flaky): the integration suite is stable across your two runs (scope-local audit assertion; worker connections closed before the DB drop).

## Register + requirements
`node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile` pass; every IMPLEMENTED DG1 row's evidence exists. Record **all 12** in `requirements_checked`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-3/`.
