# DG1 gate review — domain-reviewer (round 4, clean re-gate)
Task ID: `T-DG1-REV-DOM-R4`. Independent domain reviewer. You did not implement any DG1 requirement.
## Candidate
- **candidate_id:** `sha256:6e0c0db1a8bea33cd81f05ea8c795d8ede4bfb7f380dfe146556cb4875a6f827` — verify `node tools/gates/candidate.mjs --stage DG1`. 395 files. **manifest:** `docs/delivery/candidates/DG1/6e0c0db1a8bea33c.manifest.json`. Node 24 at `/opt/nvm/versions/node/v24.21.0/bin`.
## Scope
The only change since round 3 is a **test-tooling** fix: a new `apps/web/tsconfig.e2e.json` + apps/web `typecheck` now covers the e2e specs (F-DG1-147). No product/runtime/i18n/data change. Your prior findings stay CLOSED_VERIFIED; no re-verification needed. Re-confirm **no regression** (source fidelity; 422/G6 close rule; scoped access; invariants: provisional brand, no official PMI/Mobily claim, AR-RTL+EN-LTR, no CDN, decimal money, Unknown/Stale, DG0-DG7 vs G1-G6).
## Checks (real output; missing tool/DB = BLOCKED) — Node 22 and 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm test` and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`, `pnpm --filter @mth/design-tokens run check:contrast`, live shell scenario. Evidence under `docs/delivery/test-evidence/DG1/domain/round-4/`.
## Requirements (record EXACTLY): `REQ-S15-002`,`REQ-S15-005`,`REQ-S15-006`,`REQ-S16-001`,`REQ-S16-002`,`REQ-S16-004`,`REQ-S19-004`,`REQ-S19-006` + REQ-PB/§15/§16 rows.
## Record (MANDATORY)
`docs/delivery/reviews/DG1/round-4/domain-reviewer.json`: `assignment`=exactly `docs/delivery/assignments/DG1/round-4/domain-reviewer.md` (bare path); `candidate_id` above; `reviewer_role: domain-reviewer`; `round: 4`; `stage_id: DG1`; `checks_run[]` each {id,environment,procedure,expected,actual,exit_status,result (PASS|FAIL|BLOCKED),evidence[]}; `requirements_checked[]` exactly those ids; `findings[]` only NEW (+ .findings.json if any); `verdict` PASS if no regression and no unresolved Critical/High/mandatory. No verifications sidecar needed.
