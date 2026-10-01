# Assignment T-DG1-ANALYST3: register residuals round-3 (transformation-analyst)

- **Stage:** P1 / gate DG1 (round-3 repair). **Base revision:** current `HEAD` (≥ `45d0297`). Dedicated git worktree; `node_modules` present; run **offline**; no `pnpm install`.
- Fix **only** the two register findings below (full text in `docs/delivery/findings.json`). Write ONLY `docs/analysis/**`, `docs/delivery/requirements.csv`, `docs/delivery/handbacks/**`. Edit the parts under `docs/analysis/parts/**` and re-merge (`python3 -I -B tools/source/merge_register.py`), then verify `node tools/gates/validate.mjs --register DG1` and `--reconcile` pass and the analysis-consistency checks (counts, test-refs, acceptance-map) stay green.

## Findings

### F-DG1-007 — stale/contradictory register text the round-2 pass missed
- **REQ-PB-009:** the acceptance says closure is refused with 422 `invalid-transition`, but the notes still end "…enforced as API 409." Correct the note to 422 (one transition contract across the register, per ADR-0007 / REQ-S16-023).
- **REQ-S19-004** (DG1-final, IMPLEMENTED): the note says "migrations 0001-0006 apply to a fresh database" and the evidence lists only 0001/0006 plus a round-1 QA log. The candidate ships **0001-0008** (0007 oidc_login_state.browser_binding_hash, 0008 scoped_assignment.derived_from_assignment_id). Update the note to 0001-0008 and the evidence to the actual migrations + a current integration log. The behaviour is correct; this is documentation accuracy.

### F-DG1-209 — register evidence for REQ-S19-004 and REQ-DLV-033 is still pre-repair
Same REQ-S19-004 correction as above. Also **REQ-DLV-033**: its evidence is still the pre-repair integration log; update it to a current one and ensure the note matches the candidate (migrations 0001-0008; the contract/e2e state after round-2/round-3).
Scan the parts for any remaining "0001-0006", "32 operations", or "API 409"-for-a-transition residuals and fix them.

## Self-verification
`node tools/gates/validate.mjs --register DG1` (all 12 DG1-final IMPLEMENTED with existing evidence), `--reconcile`, and the analysis-consistency checks all pass; `requirements.csv` equals a fresh merge of the parts (no hand-edit drift).

## Handback
`docs/delivery/handbacks/DG1/round-3/T-DG1-ANALYST3-transformation-analyst.md` — what text/evidence changed and why, the real validator/consistency output.
