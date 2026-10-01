# DG1 assignment: qa-verifier (round 1)

Read `docs/delivery/assignments/DG1/round-1/review-common.md` first. Task ID: `T-DG1-REV-QA-R1`.

Note: you authored the first acceptance suites in T-DG1-QA. This is the independent **gate verification** of the frozen candidate — re-run everything against the frozen candidate and verify the DG1 acceptance criteria hold; you did not implement the product you verify.

## Execute and verify (record command, environment, actual output; a missing tool/DB is BLOCKED, never a silent pass)
1. **Build + static:** `pnpm install --frozen-lockfile` must be a no-op (lockfile committed) — or BLOCKED if offline; `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit:** `pnpm test` (unit-node + unit-web).
3. **Integration (real disposable PostgreSQL):** the integration project via `packages/db/test/global-setup.ts` (set `TEST_DATABASE_ADMIN_URL`, or use a throwaway cluster as in `e2e/support/qa-stack.sh`). Confirm migrations apply to a fresh DB, the audit trigger rejects UPDATE/DELETE, and the contract tests match `docs/api/openapi.yaml` (incl. `getBrandingTokens`).
4. **e2e (pre-installed Chromium, never `playwright install`):** `e2e/support/qa-stack.sh npx playwright test e2e --workers=1` and the web journeys. Produce EN + AR screenshots.
5. **Acceptance suites (your T-DG1-QA cases, re-run on the frozen candidate):**
   - **A12** cross-scope read/write denied; **A13** job idempotency (one ledger effect under double/parallel/duplicate delivery); **A14** optimistic concurrency (stale If-Match→409 w/ currentVersion, missing→428, fresh bumps version); **A20** bilingual shell (AR-RTL default/EN-LTR switch persists) + design-token change propagates; **A18** clean start (fresh build+migrate+start, `/healthz`+`/readyz` ready).
6. **REQ-S15-002:** `GET /api/v1/branding/tokens` returns the seven seeded tokens with values + provenance=provisional; **REQ-S15-005** fonts bundled (no CDN request); **REQ-S15-006** provisional wordmark + badge; no string claims official brand/PMI compliance.
7. **Register integrity:** `node tools/gates/validate.mjs --register DG1` passes; every IMPLEMENTED DG1 row's evidence exists and implements the requirement; `--pipeline` and `--reconcile`.
8. **Clean start with devops (A18):** the documented commands from a fresh checkout (Compose path is BLOCKED if Docker is unavailable — record it).

Save evidence under `docs/delivery/test-evidence/DG1/qa/round-1/`. Where you add verification tests, put them under `tests/qa/**` or `e2e/**` (you may author tests, never product code).

## Requirements to check (record exactly these in `requirements_checked`)
**All 12** DG1-completing requirements: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
