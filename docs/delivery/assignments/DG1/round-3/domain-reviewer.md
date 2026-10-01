# DG1 gate review — domain-reviewer (round 3, clean re-gate)
Task ID: `T-DG1-REV-DOM-R3`. Independent domain reviewer re-reviewing candidate after the round-2 F-DG1-232 e2e-determinism fix (test-only). You did not implement any DG1 requirement.

## Candidate
- **candidate_id:** `sha256:18e150714d29fa67aeaf28e817bb500d2db6191c88cde3ea680b3a64c8056f5b` — verify `node tools/gates/candidate.mjs --stage DG1` (must match). 394 files. **manifest:** `docs/delivery/candidates/DG1/18e150714d29fa67.manifest.json`. Node 24 at `/opt/nvm/versions/node/v24.21.0/bin`.

## Scope
The only change since round 2 is a **test-only** e2e determinism fix (apps/web/e2e/journeys.spec.ts, F-DG1-232). Your round-2 findings (F-DG1-001/002/003) stay CLOSED_VERIFIED; no re-verification needed. Re-confirm **no regression**: source fidelity; transformation close rule (422/G6); scoped access; invariants (provisional brand; no official PMI/Mobily claim; AR-RTL+EN-LTR; no CDN; decimal money; Unknown/Stale; DG0-DG7 vs G1-G6).

## Checks (real output; missing tool/DB = BLOCKED) — Node 22 and 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm test` and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`, `pnpm --filter @mth/design-tokens run check:contrast`, plus a live shell scenario. Evidence under `docs/delivery/test-evidence/DG1/domain/round-3/`.

## Requirements (record EXACTLY): `REQ-S15-002`,`REQ-S15-005`,`REQ-S15-006`,`REQ-S16-001`,`REQ-S16-002`,`REQ-S16-004`,`REQ-S19-004`,`REQ-S19-006` + REQ-PB/§15/§16 rows.

## Record (MANDATORY)
`docs/delivery/reviews/DG1/round-3/domain-reviewer.json`: `assignment` = exactly `docs/delivery/assignments/DG1/round-3/domain-reviewer.md` (bare path); `candidate_id` above; `reviewer_role: domain-reviewer`; `round: 3`; `stage_id: DG1`; `checks_run[]` each {id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}; `requirements_checked[]` exactly those ids; `findings[]` only NEW ones (+ .findings.json if any); `verdict` PASS only if no regression and no unresolved Critical/High/mandatory. No verifications sidecar needed (no findings assigned to you this round).
