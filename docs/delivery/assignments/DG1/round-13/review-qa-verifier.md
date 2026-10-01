# DG1 round-13: qa-verifier
Read `review-common.md` first. Task ID: `T-DG1-REV-QA-R13`. You may author tests under `tests/qa/**` and `e2e/**`, never product code. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Execute on the frozen candidate (real output; a missing tool/DB is BLOCKED)
1. Build+static: `pnpm -r typecheck`, `pnpm -r build` (or repo build), `pnpm lint`, `pnpm openapi:lint` (33 ops), `pnpm check:no-cdn`, `pnpm format:check`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit on Node 22:** `pnpm test` — expect 320.
3. **Unit on Node 24:** `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` — expect 320, unit-web 110/110 (F-DG1-214 stays fixed).
4. Integration (real disposable PostgreSQL, unique port e.g. 5492): run **at least twice** — deterministic exit 0, no 57P01 (F-DG1-009). Migrations 0001-0008; audit trigger rejects UPDATE/DELETE; contract matches OpenAPI incl. getBrandingTokens.
5. e2e (pre-installed Chromium; `--workers=1`; unique PG port e.g. 5493): full journeys EN+AR green, incl. the BU-Lead create→Edit/Archive without reload (F-DG1-210).
6. Acceptance suites A12/A13/A14/A18/A20.

## Findings you verify
- **F-DG1-134:** the architecture self-check now lints a planted non-`.ts` module file (e.g. `.mts`) and flags its violations; the real module tree (0 non-ts/tsx files) stays zero `moduleViolations`; `architecture.test.ts` green. Confirm test-only (unit+integration+e2e unaffected on both runtimes). Re-confirm **F-DG1-009/210/214** hold.
- **F-DG1-216:** confirm D-055 now matches the lint (route closed by rule 5), i.e. `grep -n "residual (a).*F-DG1-132/215" docs/delivery/decisions.md` finds nothing.

## Register + requirements
`node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile` pass. Record all 12 in `requirements_checked`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-13/`.
