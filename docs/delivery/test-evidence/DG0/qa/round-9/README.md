# DG0 round 9 QA evidence (qa-verifier, T-DG0-REV-QA-R9)

Candidate `sha256:fc0bd2a2f2019ca436e586bdd5fb4d636b9bc6025f06321db7a7ac38cab18998` (source commit `cbc755d`; HEAD `777ec85` adds metadata only).
Run: `DG0-T-DG0-REV-QA-R9-qa-verifier-20260928T171212Z-b93c74f1`. Every product check ran in disposable clones under this session's
scratchpad (`qa9-cand` @ cbc755d, `qa9-pre` fresh clone for prefreeze, `qa9-old` @ d662625 = round-8 candidate, `qa9 space dir/My Projects/repo`
and `qa9-مستخدم/repo` @ cbc755d for portability), all removed afterwards (19-cleanup.log).

| Log | What |
|---|---|
| 00-candidate-recheck.log | recomputed ID (clone, --ref cbc755d, main tree) = fc0bd2a2; post-freeze diff is metadata-only |
| 01..04d | required commands: extraction, gate tests 40/40, guard tests 13/13, register, pipeline, reconcile, candidate |
| 03b-agents-py-tests.log | runner metadata tests (tools/agents/tests/test_run_meta.py) 5/5 |
| 04e-validate-stage-DG0-historical-check.log | informational: --stage DG0 fails only because no gate record exists yet (stage REVIEWING) |
| 05-prefreeze-fresh-clone.log | `tools/gates/prefreeze.sh DG0` on a fresh clone of cbc755d: exit 0, tree clean, ID unchanged |
| 06-f223-repro-old.log / 06-f223-repro-cand.log | F-DG0-223: QA8-F223 fails on d662625, passes on cbc755d |
| 06c-orchestrator-regression-on-old.log | the new tools/gates test "F-DG0-223: ..." fails against the d662625 validator (it discriminates) |
| 07-qa8-suite-on-candidate.log | unchanged round-8 suite on the candidate: 86/86 |
| 08-space-path-clone.log | candidate cloned under a path with spaces: 36/53 gate+guard tests fail, prefreeze exit 1 (F-DG0-224) |
| 09-f224-percent-encoded-path.log | F-DG0-224 root cause: rules.mjs:37 `new URL(".", import.meta.url).pathname` keeps %20 / %D9..; --pipeline and --reconcile crash (ENOENT) under space and Arabic paths; same line in d662625 (since 8825dca) |
| 10-qa9-cases-on-cand.log / 10-qa9-cases-on-old.log | new QA9-* cases: 7/8 pass on the candidate (fail = QA9-F224 reproduction); 7/8 fail on d662625 |
| 10a-qa9-full-suite-on-candidate.log | ../tests/dg0-gate-negative-r9.test.mjs on the candidate: 94 tests, 93 pass, 1 fail = QA9-F224 |
| 11-register-integrity.log, 16-dg0-evidence-content.log | register integrity (411 rows, 0 errors), DG0 evidence opened and matched to implementation markers (19 rows, 0 errors) |
| 12-live-guard-probe.log | live Write to docs/source/QA-PROBE.txt blocked by this run's guard |
| 13-agent-load.log, 15-agents-md-vs-evidence.log | T-DG0-LOAD evidence (10 roles/10 sessions/requested model/oos write blocked); agents.md vs raw meta, runner and validator (0 errors) |
| 14-acceptance-feasibility.log | A01-A28 level/stage/gate/author, 0 errors |
| 17-live-own-transcript.log | this run's own stream-json transcript: replayed prompt matches the candidate regex, assignment path + sha256 |
