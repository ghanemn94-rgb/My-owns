# DG0 round 25: qa-verifier narrative (T-DG0-REV-QA-R25)

**Verdict: PASS.** Candidate `sha256:b77a1c6303fe7be11fbdc858c2810329e947871d788d29b8f000cbd6dbfdcbab`, source commit `2386a0f`. There are no new findings, and none of my findings were open. I did not write a verifications sidecar: F-DG0-168 belongs to code-security, and only its reporter may close it. My JSON record is `qa-verifier.json`.

I formed this verdict without reading any other round-25 review record. The domain-reviewer's and code-security-reviewer's run evidence was auto-committed during my run (2f674e3, 7f7995a). That was metadata only, and the candidate ID did not change. I read only the model, session and head fields of their `meta.json`.

## What I checked

| # | Check | Result |
|---|---|---|
| K00 | Assignment hash, candidate, complete clone | PASS: HEAD e84c393 (freeze metadata), not shallow, recomputes to b77a1c63 |
| K01–K04 | Extraction; gate self-tests 62/62; agents node 39/39 + python 22; `--register/--pipeline/--reconcile` | PASS |
| K05 | Full-history dry-run gate (`--no-local`, 223 commits) | PASS: 0 PRUNED/RECORD-LESS/DROPPED, **0 closure-anchor errors**; the 46 OTHER errors are round-not-finished or harness artefacts (classified in `08b`) |
| K06 | `prefreeze.sh DG0` in a fresh `--no-local` clone | PASS: 11/11 |
| K07 | New D-041 suite `dg0-gate-negative-r25.test.mjs` on the candidate | PASS: 8/8 |
| K08 | The same suite on the pre-D-041 baseline 6db3b83 | N1 is **ACCEPTED** there, so the defect was real and D-041 closes it |
| K09 | Standing controls + the round-24 suite as regression | PASS: 10/10 |
| K10 | Three-anchor census over the real history | PASS: 114/114 closures pass A1, A2 and A3; A1 is never skipped |
| K11 | Register integrity (Python r25 script + the round-1 node script) | PASS: 0 errors |
| K12–K13 | Agent setup evidence; live guard probe (docs/source and another reviewer's area) | PASS: both writes blocked |
| K14 | A01–A28 feasibility | PASS |
| K15 | Informational probe QA25-P1 | ACCEPTED, and within disclosed residual 1 and D-035 (not a finding) |

## D-041 in detail

The D-041 unit test uses one fix that fails all three anchors at once, so it cannot show that each anchor is enforced on its own. My suite builds a **genuine** superseded round 3 instead. It has its own frozen candidate: content C3, a present `source_commit`, and a manifest that recomputes from it. Each case then makes exactly one anchor fail, and asserts that anchor's error is the **only** error.

- **QA25-N1 (the round-24 case).** The fix is committed after the round-3 freeze and before the verifier's run started. It is in the run head and in the gate candidate.
  - Two variants: a candidate-scope fix that restores `app/main.txt`, and a non-candidate fix.
  - Both are rejected by anchor 1 alone ("not in the verified round-3 candidate").
  - On 6db3b83, both are **ACCEPTED**.
- **QA25-N2 (the round-23 forge).** A superseded round with a non-existent `source_commit`, a genuine run, and the fix committed after the run. It is rejected by anchor 2 alone.
- **QA25-N3 (independence).**
  - Anchor 2 alone, on a *present* round, where the run started from a manifest-containing commit without the fix: rejected.
  - Anchor 3 alone, where the fix is in the round freeze and the run head on a side branch but not in the gate: rejected.
- **QA25-G0 (controls).** A fix before the freeze, and a fix equal to the freeze commit, are both accepted.

**Standing controls (QA25-N4/N5/N6):**
- An all-zero or absent `fix_revision`, and a run head that is absent, null, `unknown` or all-zero, are all rejected.
- An F-DG0-165 downgrade of only `mandatory_violation`, or only `severity`, gives exactly its own drift error.
- The validator refuses a clone exactly when `git rev-parse --is-shallow-repository` is true, across three clone shapes.

## Informational probe QA25-P1 (not a finding)

The probe combines a forged-absent round `source_commit` with a fix after the claimed freeze but before the run. The validator **accepts** it.

This is the one tolerance D-041 documents: anchor 1 cannot run on an absent commit (the findManifest D-035 case). I judge it acceptable under `threat-model.md`:
- The fix is in the head the verifier really started from, and in the gate candidate.
- Building the shape needs an orchestrator-committed forged manifest, which is disclosed residual 1.
- An honest reviewer's candidate recompute would not match the manifest's synthetic entries.
- The real history has no closure in an absent-source round.

## Assignment inconsistency (noted per the protocol)

`review-common.md` again says "Review round: `23`", while the task ID and paths say round 25. I wrote `round: 25`, which the validator requires to match the directory. It's a clerical error in excluded metadata, not in the candidate.

## Honesty

- Every listed check was run in this session. Commands and outputs are under `docs/delivery/test-evidence/DG0/qa/round-25/`.
- Partway through, the permission classifier refused several shell commands in a row (a transient outage). The same checks were re-run once it recovered; nothing was inferred.
- The negative suite passed on its first run against the candidate. The baseline run's exit 1 is expected: it is the detection evidence.
- Disposable clones were in `$TMPDIR` only. No product implementation file was modified.
