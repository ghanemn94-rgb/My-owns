# DG1 gate review — domain-reviewer (round 1, clean re-gate)
Task ID: `T-DG1-REV-DOM-R1`. You are the independent domain reviewer for the **DG1 gate** on a clean re-gate branch. You did not implement any DG1 requirement. Read-only to implementation.

## Candidate
- **candidate_id:** `sha256:25c97340b6047e87e82642c28e90dea72cdd07b5bbd5d81986f497e5e863061b` — verify with `node tools/gates/candidate.mjs --stage DG1` (must match exactly). Complete clone; 391 files.
- **manifest:** `docs/delivery/candidates/DG1/25c97340b6047e87.manifest.json`.
- A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin` (production target, ADR-0001).

## Context
This is a single clean gate round for the final, fully-remediated P1 product (the 16-round development history is preserved on branch `claude/mobily-transformation-platform-kwcc4i` + tag `dg1-dev-history-d1cb245` + `decisions.md` D-001..D-057). Review the candidate on its own merits.

## What to verify (source fidelity + operating logic + real outcomes)
1. **Source fidelity** to the Business Transformation Playbook (`docs/source/playbook.md`, blocks B0001-B0165) and the master prompt (`docs/source/master-prompt-v2.0.md`): the DG1 scope (architecture, domain model, API contract, config versioning, the P1-active modules) faithfully realizes the methodology. The playbook is a practical synthesis inspired by PMI/Brightline/BRM — confirm **no text claims it is an official PMI standard or a certified product**.
2. **Operating logic / real outcomes** on the running shell and in the register's terms: the transformation close rule (422 / product gate G6), scoped-access rules, identity routes, cursor/pagination behave correctly. Product gates G1-G6 are separate from engineering DG0-DG7; **G6 never implies DG7**.
3. **ADR-0002 module boundaries** (`apps/api/src/modules.ts`): the eight P1-active modules (platform, audit, identity, access, organization, transformations, jobs, admin) exist with the declared dependency directions; workflows/kpi/reporting are declared-but-reserved (D-047).
4. **Invariants:** provisional brand tokens (`provenance=provisional`; `#0078FF` provisional, text wordmark — no official Mobily logo/colour claim); AR-RTL + EN-LTR for every user-facing string; no public CDNs / builder-hosted runtime deps; decimal arithmetic for money and rates; missing/stale data shows Unknown/Stale, never zero or green; default timezone Asia/Riyadh, currency SAR (configurable).

## Checks to run (real output; a missing tool/DB is BLOCKED, never a fake PASS)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm test` (Node 22) **and** `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (Node 24), `pnpm --filter @mth/design-tokens run check:contrast`, plus a live scenario against the running stack exercising the close rule / scoped access / bilingual rendering. Evidence under `docs/delivery/test-evidence/DG1/domain/round-1/`.

## Requirements to check (record EXACTLY these in `requirements_checked`)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows you assess.

## Record format (MANDATORY — the gate validator checks these)
Write `docs/delivery/reviews/DG1/round-1/domain-reviewer.json`:
- `assignment`: the **exact** string `docs/delivery/assignments/DG1/round-1/domain-reviewer.md` — a bare repo-relative path, nothing appended (no sha256, no "with ..." clause).
- `candidate_id`: the candidate above. `reviewer_role`: `domain-reviewer`. `round`: 1. `stage_id`: `DG1`.
- `checks_run[]`: each entry has `id`, `environment`, `procedure`, `expected`, `actual`, `exit_status` (integer), `result` (exactly one of `PASS`/`FAIL`/`BLOCKED`), `evidence` (array of existing repo paths).
- `requirements_checked[]`: exactly the ids above.
- `findings[]`: **only** findings you raise **this round**; if non-empty, also write `docs/delivery/reviews/DG1/round-1/domain-reviewer.findings.json` with the full finding objects (`reported_by: domain-reviewer`). If you raise none, leave `findings` empty and write no sidecar.
- `verdict`: `PASS` only if every assigned requirement is complete with existing evidence and there is no unresolved Critical/High/mandatory finding; else `FAIL`.
