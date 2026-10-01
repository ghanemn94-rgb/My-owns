# DG1 gate review — domain-reviewer (round 2, clean re-gate)
Task ID: `T-DG1-REV-DOM-R2`. Independent domain reviewer re-reviewing the **repaired** DG1 candidate after round 1. You did not implement any DG1 requirement. Read-only to implementation.

## Candidate
- **candidate_id:** `sha256:e6979e12111aeb1456f591d66f8437d9f491c7e8e58215ea7c5a9f233cbfe71d` — verify `node tools/gates/candidate.mjs --stage DG1` (must match). Complete clone; 394 files.
- **manifest:** `docs/delivery/candidates/DG1/e6979e12111aeb14.manifest.json`.
- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.

## Verify these round-1 findings are fixed on THIS candidate (you raised them)
- **F-DG1-001 / F-DG1-002 / F-DG1-003** (all Low): the three P1 read-model views (actor_display, business_unit_closure, scope_node) are now documented in `docs/architecture/erd.md` and `docs/architecture/data-dictionary.md`; `docs/operations/clean-start.md` states the current migration count (0001-0009); the REQ-S16-001 register note cites stable clean-candidate facts (no dev-history reference). Confirm each fix on this candidate.
Write a **verifications** sidecar `docs/delivery/reviews/DG1/round-2/domain-reviewer.verifications.json` with an entry per finding `{finding_id, result: PASS, status_after: CLOSED_VERIFIED, note, evidence:[...]}` (PASS only if genuinely fixed; else FAIL and explain).

## Re-check (no regression)
Source fidelity to the playbook; the transformation close rule (422/G6); scoped-access, identity routes, cursor/pagination; invariants (provisional brand provenance; no official PMI/Mobily claim; AR-RTL + EN-LTR; no CDN; decimal money; Unknown/Stale; DG0-DG7 vs G1-G6). The round-2 product change (BU re-parent cycle guard + destination authz, rate-limit keying) must not break the domain behaviour.

## Checks (real output; a missing tool/DB is BLOCKED) — Node 22 and 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm test` and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`, `pnpm --filter @mth/design-tokens run check:contrast`, plus a live scenario on the running stack. Evidence under `docs/delivery/test-evidence/DG1/domain/round-2/`.

## Requirements to check (record EXACTLY these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 rows you assess.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG1/round-2/domain-reviewer.json`:
- `assignment`: exactly `docs/delivery/assignments/DG1/round-2/domain-reviewer.md` (bare path, nothing appended).
- `candidate_id` above; `reviewer_role: domain-reviewer`; `round: 2`; `stage_id: DG1`.
- `checks_run[]`: each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`.
- `requirements_checked[]`: exactly the ids above.
- `findings[]`: only NEW findings raised this round; if non-empty also write `domain-reviewer.findings.json` (`reported_by: domain-reviewer`). None → empty, no sidecar.
- `verdict`: PASS only if the three findings verify, every requirement is complete, and no unresolved Critical/High/mandatory remains; else FAIL.
