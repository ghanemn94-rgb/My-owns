# Round-23 regression analysis: round-22 QA suite re-run unchanged (qa-verifier)

Log: `10-r22-suite-rerun.log` (candidate e6df2e1e, source 6438e20, `--no-local` clone of 78954a6). 7 pass, 2 fail. Both failures are expected consequences of D-039, not regressions.

| Case | Round 22 | Round 23 | Analysis |
|---|---|---|---|
| QA22-N7 (F-DG0-246 probe) | FAIL (ACCEPTED an all-zero fix in a self-declared absent round) | **PASS** (REJECTED: `fix 0000000000 is not a commit present in this repository`) | This is the fix for F-DG0-246. |
| QA22-N6 (D-038 tolerance control) | PASS (accepted) | FAIL by design | It asserted that the absent-head + absent-fix superseded shape is **accepted**. D-039 removes that tolerance on purpose. It is now rejected on both the head (`started from cdcdcdcdcd, a commit absent`) and the fix (`fix efefefefef is not a commit present`). QA23-N2 asserts the new, strict behaviour. The real round 18 needs no tolerance: its closures (F-DG0-150/151) were re-verified in round 22, and the real-repo dry-run shows 0 PRUNED errors. |
| QA22-N5 all-zero variant | PASS | FAIL (test label only) | The case matched on the removed D-038 message text (`is not a commit in this repository, but round-2 is retained`). The logged actual error is `finding F-DG0-201 (High): fix 0000000000 is not a commit present in this repository`, which is a rejection. The uppercase and abbrev-12 variants are still REJECTED by the 40-hex rule. |
| QA22-N1/N2/N3/N4/N8/N9 | PASS | PASS | Unchanged behaviour (shallow refusal, dropped-finding detection, malformed heads, finish() collision, prototype-named keys). |

Conclusion: no regression. The round-22 cases that change outcome do so exactly as D-039 intends. The tests that encode the new behaviour are in `dg0-gate-negative-r23.test.mjs` (QA23-N1/N2/N3).
