# DG1 round-10: qa-verifier
Read `review-common.md` first. Task ID: `T-DG1-REV-QA-R10`. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Execute on the frozen candidate (real output; a missing tool/DB is BLOCKED)
1. Build+static: `pnpm -r typecheck`, `pnpm -r build` (or repo build), `pnpm lint`, `pnpm openapi:lint` (33 ops), `pnpm check:no-cdn`, `pnpm format:check`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. Unit: `pnpm test` (expect ~298 — the new crypto.setEngine self-checks S1/S2/S3 + positive control are included).
3. Integration (real disposable PostgreSQL, unique port e.g. 5492): run **at least twice** — deterministic exit 0, no 57P01 (F-DG1-009). Migrations 0001-0008; audit trigger rejects UPDATE/DELETE; contract matches OpenAPI incl. getBrandingTokens.
4. e2e (pre-installed Chromium; `--workers=1`; unique PG port e.g. 5493): full journeys EN+AR green, incl. the BU-Lead create→Edit/Archive without reload (F-DG1-210).
5. Acceptance suites A12/A13/A14/A18/A20.

## Findings you verify
- **F-DG1-130:** the architecture self-check now denies `crypto.setEngine` (named/namespace/string-key) and still allows `node:crypto` + `randomUUID`/`createHash` (positive control); `architecture.test.ts` green incl. the real module tree. Confirm the change is test-only (unit + integration + e2e unaffected). Re-confirm **F-DG1-009/210** hold and the REQ-DLV-042 installer acceptance log is still the 14-case run.

## Register + requirements
`node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile` pass. Record all 12 in `requirements_checked`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-10/`.
