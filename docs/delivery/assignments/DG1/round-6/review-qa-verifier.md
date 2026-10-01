# DG1 round-6: qa-verifier
Read `review-common.md` first. Task ID: `T-DG1-REV-QA-R6`. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Execute on the frozen candidate (real output; a missing tool/DB is BLOCKED)
1. Build+static: `pnpm -r typecheck`, `pnpm -r build` (or repo build), `pnpm lint`, `pnpm openapi:lint` (33 ops), `pnpm check:no-cdn`, `pnpm format:check`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. Unit: `pnpm test` (expect 270 — the three new X6–X8 self-check plants are included).
3. Integration (real disposable PostgreSQL, unique port e.g. 5492): run **at least twice** — deterministic exit 0, no 57P01 (F-DG1-009 holds). Migrations 0001-0008; audit trigger rejects UPDATE/DELETE; contract matches OpenAPI incl. getBrandingTokens.
4. e2e (pre-installed Chromium; `--workers=1`; unique PG port e.g. 5493): full journeys EN+AR green, incl. the BU-Lead create→Edit/Archive without reload (F-DG1-210).
5. Acceptance suites A12/A13/A14/A18/A20.

## Findings you verify
- **F-DG1-125:** the architecture self-check now includes X6–X8 (node:process default/named import forms) and they pass; P12 (global process.binding) still caught; the real module tree passes (`architecture.test.ts` 77/77). Confirm the change is test-only (no runtime/behavioural effect: unit + integration + e2e unaffected).
- **F-DG1-126:** the installer acceptance suite is 14/14 incl. AC-10 (a `!`-excluded package + a `publicHoistPattern` entry are not copy-back destinations; a member + the root are). Re-confirm **F-DG1-009/210** hold.

## Register + requirements
`node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile` pass. Record all 12 in `requirements_checked`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-6/`.
