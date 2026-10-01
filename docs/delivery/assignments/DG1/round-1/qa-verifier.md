# DG1 gate review — qa-verifier (round 1, clean re-gate)
Task ID: `T-DG1-REV-QA-R1`. Independent QA verifier for the **DG1 gate**. You may author tests under `tests/qa/**` and `e2e/**`, never product code. Read-only to implementation otherwise.

## Candidate
- **candidate_id:** `sha256:25c97340b6047e87e82642c28e90dea72cdd07b5bbd5d81986f497e5e863061b` — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone; 391 files.
- **manifest:** `docs/delivery/candidates/DG1/25c97340b6047e87.manifest.json`.
- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.

## Context
Single clean gate round for the final remediated P1 product (dev history preserved on branch `claude/mobily-transformation-platform-kwcc4i`). Derive checks from the acceptance criteria and execute positive, negative, regression, bilingual (AR-RTL / EN-LTR) and reliability checks against the frozen candidate.

## Execute (real output; a missing tool/DB is BLOCKED, never a fake PASS)
1. **Build + static:** `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint` (33 ops), `pnpm check:no-cdn`, `pnpm format:check`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit on Node 22:** `pnpm test` (expect 325). **Unit on Node 24:** `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (expect 325; unit-web green).
3. **Integration** on a disposable PostgreSQL (unique port) **run at least twice** — deterministic exit 0, no 57P01, no "Hook timed out"; migrations 0001-0008; audit trigger rejects UPDATE/DELETE; contract matches OpenAPI incl. getBrandingTokens.
4. **e2e** (pre-installed Chromium, `--workers=1`, unique PG port): full journeys EN+AR green, incl. the BU-Lead create→Edit/Archive without reload.
5. **Acceptance suites** A12/A13/A14/A18/A20 (and any others your derived checks cover).
6. **Register & pipeline:** `node tools/gates/validate.mjs --register DG1`, `--pipeline`, `--reconcile` pass.

## Requirements to check (record EXACTLY these — all 12)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`. Evidence under `docs/delivery/test-evidence/DG1/qa/round-1/`.

## Record format (MANDATORY — the gate validator checks these)
Write `docs/delivery/reviews/DG1/round-1/qa-verifier.json`:
- `assignment`: exactly `docs/delivery/assignments/DG1/round-1/qa-verifier.md` — a bare path, nothing appended.
- `candidate_id` above; `reviewer_role`: `qa-verifier`; `round`: 1; `stage_id`: `DG1`.
- `checks_run[]`: each has `id`, `environment`, `procedure`, `expected`, `actual`, `exit_status` (integer), `result` (`PASS`/`FAIL`/`BLOCKED`), `evidence[]` (existing repo paths).
- `requirements_checked[]`: exactly the 12 ids above.
- `findings[]`: only findings raised **this round**; if non-empty also write `qa-verifier.findings.json` (`reported_by: qa-verifier`). None → empty, no sidecar.
- `verdict`: `PASS` only if every requirement is verifiable with existing evidence and no unresolved Critical/High/mandatory; else `FAIL`.
