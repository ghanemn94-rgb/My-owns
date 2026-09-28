# DG0 round 8 QA evidence (qa-verifier, T-DG0-REV-QA-R8)

Candidate `sha256:90ad5271429719ba975cc900c61f0a611120045c1b72040ad50c94359c5178e0` (source commit `d662625`; HEAD `1474a96` adds metadata only).
Run: `DG0-T-DG0-REV-QA-R8-qa-verifier-20260928T165738Z-3521f846`. Every product check ran in disposable clones under /tmp
(`qa8-cand` @ d662625, `qa8-pre` fresh clone for prefreeze, `qa8-head` @ 1474a96, `qa8-old` @ e11b5f0 = round-7 candidate), all removed afterwards.

| Log | What |
|---|---|
| 00-candidate-recheck.log | recomputed ID, --ref d662625 / --ref HEAD, manifest; post-freeze diff is metadata-only |
| 01..04d | required commands (extraction, gate tests 39/39, guard + run_meta tests 13+5, register, pipeline, reconcile, candidate) |
| 04e-validate-stage-DG0.log | informational: --stage DG0 fails only because no gate record exists yet |
| 05-prefreeze-fresh-clone.log | `tools/gates/prefreeze.sh DG0` on a fresh clone of d662625 (exit 0, tree clean, ID unchanged) |
| 10-qa8-negative-on-new.log | ../tests/dg0-gate-negative-r8.test.mjs on the candidate: 86 tests, 85 pass; the 1 failure is QA8-F223, the reproduction of new finding F-DG0-223 |
| 10a-qa7-suite-on-new-unchanged.log | round-7 suite unchanged on the new candidate: 6 fixture-control failures, all "names no assignment file and sha256" (the new F-DG0-133 rule; the r7 fixture prompt lacked the clause) |
| 10b-qa8-cases-on-old.log | QA8-* cases on the round-7 candidate e11b5f0: 9 fail, which shows the F-DG0-132/133/011/222 repairs |
| 11-register-integrity.log, 16-dg0-evidence-content.log | register integrity (411 rows, 0 errors), DG0 evidence opened and matched to implementation markers |
| 12-live-guard-probe.log | live Write to docs/source/QA-PROBE.txt blocked by this run's guard |
| 13-agent-load.log, 15-agents-md-vs-evidence.log | T-DG0-LOAD evidence (10 roles/10 sessions/requested model/oos write blocked); agents.md vs raw meta, runner and validator (0 errors now; 9 FAIL on e11b5f0 = F-DG0-222 reproduction) |
| 14-acceptance-feasibility.log | A01-A28 level/stage/gate/author |
| 17-live-own-transcript.log | this run's own transcript carries the CLI-replayed prompt with matching assignment path + sha256 |
| 18-f223-space-in-path.log | F-DG0-223 reproduction |
