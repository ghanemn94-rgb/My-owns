# DG1 round-11: qa-verifier
Read `review-common.md` first. Task ID: `T-DG1-REV-QA-R11`. You may author tests under `tests/qa/**` and `e2e/**`, never product code. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Execute on the frozen candidate (real output; a missing tool/DB is BLOCKED) — on BOTH Node 22 and Node 24
The round-10 BLOCK was a Node-24-only unit-web failure, so run the unit suites on **both** runtimes:
1. Build+static: `pnpm -r typecheck`, `pnpm -r build` (or repo build), `pnpm lint`, `pnpm openapi:lint` (33 ops), `pnpm check:no-cdn`, `pnpm format:check`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit on Node 22:** `pnpm test` — expect 302 (unit-node 188 + unit-web 110 + qa unit), unit-web 110/110.
3. **Unit on Node 24 (the F-DG1-214 fix):** `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` — expect 302, unit-web 110/110, **0 AbortSignal failures** (this is the regression that blocked round 10). Show the unit-web result on Node 24 explicitly.
4. Integration (real disposable PostgreSQL, unique port e.g. 5492): run **at least twice** — deterministic exit 0, no 57P01 (F-DG1-009). If feasible, also once on Node 24. Migrations 0001-0008; audit trigger rejects UPDATE/DELETE; contract matches OpenAPI incl. getBrandingTokens.
5. e2e (pre-installed Chromium; `--workers=1`; unique PG port e.g. 5493): full journeys EN+AR green, incl. the BU-Lead create→Edit/Archive without reload (F-DG1-210).
6. Acceptance suites A12/A13/A14/A18/A20.

## Findings you verify
- **F-DG1-214:** unit-web passes on Node 24 (and Node 22) — 0 "Expected signal to be an instance of AbortSignal" failures; the failing files from round 10 (apps/web/src/app/app.test.tsx, apps/web/src/pages/transformations/transformations.test.tsx, incl. F-DG1-004/F-DG1-210 regression tests) are green on Node 24. The fix is harness-only (`apps/web/test/jsdom-native-abort-environment.ts`); no product file changed.
- **F-DG1-215 (≡132):** the architecture self-check pins the crypto.setEngine enumeration forms as the documented residual (a) and still bans the spelled forms; `architecture.test.ts` green. Re-confirm **F-DG1-009/210** and that the REQ-DLV-042 installer acceptance log is still the 14-case run.

## Register + requirements
`node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile` pass. Record all 12 in `requirements_checked`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-11/`.
