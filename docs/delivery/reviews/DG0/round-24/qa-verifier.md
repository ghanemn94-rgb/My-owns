# DG0 round 24: qa-verifier narrative (T-DG0-REV-QA-R24)

**Verdict: PASS.** Candidate `sha256:f0f3a93a1fcf33e58b1d553e39205cc8bc1764407189b69904d2d58e976f351a`, source commit `6db3b83`. There are no new findings. F-DG0-249, which I raised in round 23, is re-verified as **CLOSED_VERIFIED**. My JSON record is `qa-verifier.json`, and the verification is in `qa-verifier.verifications.json`.

I formed this verdict without reading any other round-24 review record. The domain-reviewer's and code-security-reviewer's run evidence was auto-committed during my run (372a379, 37f603e). That was metadata only, and the candidate ID did not change. I did not open it.

## What I checked, and how

| # | Check | Result |
|---|---|---|
| K00 | Assignment hash, HEAD/candidate, complete clone | PASS: HEAD 79fb0f8 (freeze metadata), not shallow, candidate recomputes to f0f3a93a |
| K01–K04 | Extraction; gate self-tests 62/62; agents node 39/39 + python 22; `--register/--pipeline/--reconcile` | PASS |
| K05 | Real-repo dry-run gate, full history (`--no-local` clone, 215 commits) | PASS: 0 PRUNED/RECORD-LESS/DROPPED, 0 "starting history" errors; the rest are round-not-finished artefacts (classified in `08b-…`) |
| K06 | `prefreeze.sh DG0` in a fresh `--no-local` clone | PASS: 11/11 |
| K07 | D-040 negative suite `dg0-gate-negative-r24.test.mjs`, on the candidate and on the pre-D-040 baseline | PASS: 10/10 on the candidate; on the baseline the exploit cases N1 and N2 are ACCEPTED |
| K08 | Standing strict controls (fix/head forms, F-DG0-165 downgrade, shallow shapes) + the round-23 suite as regression | PASS |
| K09 | F-DG0-014/167 comments vs the absence-tolerance census | PASS: the comments match the code |
| K10 | fix_revision integrity (110 closures) | PASS: 0 errors, all bound to their verifying run's head |
| K11 | Register integrity (new independent Python script + the round-1 script) | PASS: 0 errors |
| K12–K13 | Agent setup evidence; live guard probe | PASS |
| K14 | A01–A28 feasibility | PASS |

### D-040 verification in detail

To isolate the run-head check, the suite needs cases where the fix **is** in the gate candidate. The D-040 unit test uses a fix that is also outside the gate, so the gate check alone would already reject it.

- **QA24-N1** is the round-23 exploit shape (QA23-P1): a self-declared absent round, and a genuine run whose head contains the manifest but not the fix. It is rejected, and the only closure error is "not in the verifying run's starting history".
- **QA24-N2** is the literal assignment shape: the fix is committed *after* the verifier's run started and is still in the gate candidate. To build it, the harness re-derives the gate onto a later commit with identical candidate content and re-runs the auditor. It is rejected by the run-head check alone, whether the round's `source_commit` is forged absent or genuine.
  - Re-deriving the gate necessarily rewrites two write-once files, and the validator rightly reports 4 write-once errors on those two paths.
  - Those 4 errors are excluded by exact path and counted in the log. Every other error is asserted on.
- **Before/after.** Run against the round-23 candidate `6438e20` (pre-D-040), N1 and N2 are **ACCEPTED**. So the tests do detect the defect, and D-040 is what closes it.

### A note on D-040's design (not a finding)

D-040 *replaced* the round `source_commit` ancestry check with the run-head check; it did not add one to the other. So when a round's `source_commit` is present, a fix committed after the round's freeze but before the verifier started is now accepted, where before D-040 it was rejected.

I judge this acceptable under `threat-model.md`, for three reasons:
- the run head is the reviewer's real checkout, so the reviewer did see the fix;
- a fix that changed candidate content after the freeze would show up as a candidate-ID mismatch to the reviewer;
- the fix must still be in the gate candidate, which all three reviewers and the auditor review.

On the real history, `21-fix-revision-integrity-nl.log` shows **0** of the 110 closures depend on this. Every one is also in its round's `source_commit`. If the orchestrator wants defence in depth, keeping both checks when the round commit is present would cost nothing on current data.

### Assignment inconsistency (noted per the protocol)

`review-common.md` says "Review round: `23`", but the task ID, the paths and the role assignment all say round 24. I treated it as a typo and wrote `round: 24`, which the validator requires to equal the directory.

## Honesty

- Every check listed was actually run in this session. Commands and outputs are under `docs/delivery/test-evidence/DG0/qa/round-24/`.
- **K02.** My first self-test invocation used a directory argument, which node 22 reports as one failing file. It was re-run in the assignment's glob form.
- **N8.** The first version of this test used `--shallow-since=2100`, which gave a non-shallow clone. It was replaced; the test file records this.
- **P1.** The informational probe QA24-P1 does not isolate the relaxation described above, because the gate re-derivation also moves round 3's `source_commit`. That conclusion rests on reading the code and on the real-history measurement, not on P1.
- Disposable clones were in `$TMPDIR` only. No product implementation file was modified.
