# DG0 round 7 QA evidence (qa-verifier, T-DG0-REV-QA-R7)

Candidate `sha256:dee0316dce953eb00665cbfc452ba9da140dce70b9faa0c028af0de38626cece` (source commit `e11b5f0`; HEAD `29b5255` adds metadata only).
Run: `DG0-T-DG0-REV-QA-R7-qa-verifier-20260928T162818Z-4976b063`. Every product check ran in disposable clones under /tmp (removed afterwards).

| Log | What |
|---|---|
| 00-candidate-recheck.log | manifest vs --ref e11b5f0 / HEAD; post-freeze diff is metadata-only |
| 01..04e | required commands (extraction, gate + guard tests, register, pipeline, reconcile, candidate, --stage DG0) |
| 05-prefreeze-fresh-clone.log | `tools/gates/prefreeze.sh DG0` on a fresh clone of e11b5f0 (exit 0, tree clean, ID unchanged) |
| 06-d022-prior-runs-replay.log | all 39 pre-round-7 DG0 runs carry 0 CLI-replayed prompts (confirms D-022's statement) |
| 10-qa7-negative-on-new.log | ../tests/dg0-gate-negative-r7.test.mjs on the candidate: 72/72 |
| 10-qa7-negative-on-old.log | QA7-* cases on the round-6 candidate a059b55 (demonstrates the repaired defects) |
| 11-register-integrity.log, 16-dg0-evidence-content.log | register integrity, DG0 evidence opened and matched to implementation markers |
| 12-live-guard-probe.log | live Write to docs/source/QA-PROBE.txt blocked |
| 13-agent-load.log, 15-agents-md-vs-evidence.log | T-DG0-LOAD evidence; agents.md claims vs raw meta and current runner (3 D-022 doc gaps -> F-DG0-222) |
| 14-acceptance-feasibility.log | A01-A28 level/stage/gate/author |
| 20, 22..26 | re-reproduction of F-DG0-201..213, 220, 221 on their original commits |
