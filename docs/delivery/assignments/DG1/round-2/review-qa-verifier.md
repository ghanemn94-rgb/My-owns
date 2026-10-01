# DG1 round-2: qa-verifier

Read `review-common.md` first. Task ID: `T-DG1-REV-QA-R2`. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Execute and verify on the frozen candidate (record command, environment, real output; a missing tool/DB is BLOCKED, never a silent pass)
1. **Build + static:** `pnpm install --frozen-lockfile` a no-op (or BLOCKED offline); `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit:** `pnpm test` (expect the new module-scaffold suites workflows/kpi/reporting, auditChanges, and the web transition test).
3. **Integration (real disposable PostgreSQL):** the integration project. Confirm migrations `0001..0008` apply to a fresh DB (incl. 0007 browser-binding, 0008 derived assignment), the audit trigger rejects UPDATE/DELETE, and the contract tests match `docs/api/openapi.yaml` including **getBrandingTokens** (33 ops).
4. **e2e (pre-installed Chromium, never `playwright install`):** `e2e/support/qa-stack.sh npx playwright test e2e --workers=1`; EN + AR screenshots.
5. **Your acceptance suites re-run on this candidate:** A12 (cross-scope 404), A13 (job idempotency), A14 (optimistic concurrency 409/428), A20 (bilingual shell + token propagation), A18 (clean start + /healthz,/readyz).

## Findings you verify (qa-authored in round 1)
- **F-DG1-101 / F-DG1-201:** the contract/integration suite now exercises `getBrandingTokens` and is GREEN (the round-1 red); all 33 operations covered.
- **F-DG1-110:** the previously-flaky integration tests are stable (run the integration suite at least twice; the audit-count assertion is scope-local; the worker test closes its connection before the DB drop).
- **F-DG1-004 / F-DG1-005** (web): after create, the record is reachable (no dead not-found); the audit-trail "Changes" column is localized AR/EN. **The web no longer offers the governed `closed` status** (F-DG1-001 consistency).

## Register + requirements
`node tools/gates/validate.mjs --register DG1` passes; every IMPLEMENTED DG1 row's evidence exists and implements the requirement; `--pipeline`, `--reconcile`. Record **all 12** in `requirements_checked`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.

**Disposable PostgreSQL:** you run concurrently with the code-security reviewer, so spin your throwaway cluster on a **distinct port 5452** (e.g. `QA_E2E_PG_PORT=5452`, or `TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:5452/postgres`). PostgreSQL cannot run as root; use `unshare --user --map-user=1000 --map-group=1000` as `e2e/support/qa-stack.sh` does. The e2e stack serves the API on :3000 — if you also run code-security's checks is irrelevant (they don't start the stack), but keep the e2e run single-worker.

Save evidence under `docs/delivery/test-evidence/DG1/qa/round-2/`; author any verification tests under `tests/qa/**` or `e2e/**`.
