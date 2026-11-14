# A27 drill report: resumption from a checkpoint (REQ-S20-027, REQ-DLV-030)

Orchestrator drill per p7-work-split §K.2 / ADR-0073 §11. Run 2026-11-14 in this container. Checkpoint `d8868b2a5c074b13c04693a88644c25ef2792583` (DG6 re-gate, FIXING after rounds 5–6, D-240). Logs: `k9-k12.log`, `k11.log`, `k13.log`, `k14.log` in this folder.

| Step | Command | Expected | Observed | Result |
| --- | --- | --- | --- | --- |
| K9 | `git clone --no-checkout` of this repository into scratch, checkout of the checkpoint; `candidate.mjs --stage DG6` | candidate id printed | `sha256:10f71f24…2fc5`, 2775 files, exit 0. A full clone, not a sparse one (deviation; no effect on the result). | PASS |
| K10 | `validate.mjs --reconcile` | `active stage: DG6 (FIXING)`; working tree differs; round-5/6 records STALE | `active stage: DG6 (FIXING)`; `working tree … (differs: 1 changed)`; every round 1–6 record `(STALE for current content)`; exit 0 | PASS |
| K11 | reconstruct the next action from `progress.md`, `stages.json`, assignments, open findings | the next action equals the one taken (round 7 on a new candidate) | `stages.json`: DG6 FIXING after rounds 4–6. `decisions.md` D-240: "Next: round 7, all three reviewers on the new candidate". The next commit after the checkpoint is `04569998d` "freeze round 7 (candidate 10f71f24, D-240)": the same candidate id K9 printed. **But `progress.md` at the checkpoint was stale**: its "Current checkpoint" said "DG6: FIXING after round 8 on 6cda8b33 (D-226)" (the earlier DG6 branch) and its "Next action" line was from P2. The reconstruction succeeded from `stages.json` + `decisions.md`, not from `progress.md`. | PASS for REQ-S20-027; **PARTIAL for REQ-DLV-030's "work continues from progress.md"** (disclosed) |
| K12 | `validate.mjs --stage DG6`; `validate.mjs --pipeline` | first non-zero; second shows no stage past DG5 approved | `--stage DG6` exit 1 (stale round records, F-DG6-952 not accepted); `--pipeline` "PASS pipeline (active stage: DG6 FIXING)", exit 0, nothing past DG5 approved | PASS |
| K13 | session ids of runs after the checkpoint | each new, none reused | 60 runs after the checkpoint; 0 of their `result_session_id` values used by any other run; 0 duplicates across all 733 runs that have one (12 aborted runs have none) | PASS |
| K14 | `node --test tools/gates/tests/validator.test.mjs` on the DG7 tree | exit 0 | 60/60 pass, exit 0 | PASS |
| K15 | this report; clone deleted | — | clone deleted after this report | done |

## A27 clauses

- Resume from a checkpoint and reconstruct stage/tasks/evidence: K9, K11. PASS.
- Reject stale reviews: K10. PASS.
- Continue without inventing approvals or routine user confirmation: K12, K13. PASS.
- REQ-DLV-030 "work continues from progress.md": PARTIAL. `progress.md` lagged the real state at this checkpoint; the validator and `decisions.md` carried the resumption. Proposed finding for the DG7 reviewers (Medium, process): keep `progress.md`'s checkpoint section current at each step change. The current `progress.md` is refreshed before the freeze.

No G1–G6, Finance or IT approval is granted or implied, and this drill does not imply DG7.
