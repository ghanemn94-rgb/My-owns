# DG0 round 26: qa-verifier narrative (T-DG0-REV-QA-R26)

**Verdict: PASS.** Candidate `sha256:7ac7119044c899d4fa7363cb43d209173095d06b37eed75697532b092b7236df`, source commit `7edacdc`. I raised no new findings, and none of my own findings were open. I did not write a verifications sidecar: F-DG0-169 belongs to code-security-reviewer, and only its reporter (or another qualified non-author assigned to do so) may close it. My independent evidence that the D-042 fix works is below. My JSON record is `qa-verifier.json`.

I formed this verdict without reading any other round-26 review record. During my run, the domain-reviewer's and code-security-reviewer's round-26 run evidence was auto-committed (46aebd7, a6fc577). Those commits are metadata only, and the candidate ID did not change. My disposable clones were taken at 2f480e4, before those commits.

## What I checked

| # | Check | Result |
|---|---|---|
| K00 | Assignment hash, candidate, complete clone | PASS: HEAD 2f480e4 (freeze metadata), not shallow, recomputes to 7ac71190. Since round 25 the candidate changed only in rules.mjs, validator.test.mjs and decisions.md |
| K01–K04 | Extraction; gate self-tests 63/63 (includes "D-042 / F-DG0-169"); agents node 39/39 + python 22/22; `--register/--pipeline/--reconcile` | PASS |
| K05 | Full-history dry-run gate (`--no-local`, 230 commits) | PASS: 0 PRUNED/RECORD-LESS/DROPPED errors and **0 closure-anchor errors**, including none of the new "whose frozen candidate source_commit … is not present" form. The 8 + 46 remaining errors are "round 26 not finished" or harness artefacts (classified in `08b`) |
| K06 | `prefreeze.sh DG0` in a fresh `--no-local` clone | PASS: 11/11 |
| K07 | New D-042 suite `dg0-gate-negative-r26.test.mjs` on the candidate | PASS: 7/7 |
| K08 | The same suite on the pre-D-042 baseline 2386a0f | QA26-N1, N2, N3 and N5 **fail** there (N1 and N2 are ACCEPTED). The defect was real, and D-042 closes it |
| K09 | Round-25 and round-24 suites as regression | All pass except QA25-N2 and QA24-N2 (forged-absent shape). Those now show one *extra* error, the F-DG0-169 rejection, so they are stricter, as intended (`10c`). QA25-P1 flipped from ACCEPTED to REJECTED |
| K10 | Three-anchor census, with anchor 1 now unconditional | PASS: 115/115 closures pass A1, A2 and A3. A1 is absent for none. All 116 `fix_revision` values are 40-hex, present, and ancestors of HEAD and of the gate candidate |
| K11 | Register integrity (Python r26 script + the round-1 node script) | PASS: 0 errors. 412 rows, 19 IMPLEMENTED = the 19 DG0-final = the assigned set, no VERIFIED status |
| K12–K13 | Agent setup evidence; live guard probe (docs/source, another reviewer's area, tools/gates; file tool and shell) | PASS: all six writes were blocked |
| K14 | A01–A28 feasibility | PASS: 28/28 have a test level and a stage |

## D-042 in detail

The D-042 unit test takes a *valid* fixture and only rewrites `review_rounds[1].source_commit` to `"a"*40`, so the fix is already in every commit. My suite builds the attack shapes and edge cases that the unit test does not cover:

- **QA26-N1 (the round-25 case, my own round-25 probe QA25-P1).** A forged superseded round has a self-declared absent `source_commit`. The fix is committed after the claimed freeze but before the verifier's run, so anchors 2 and 3 hold.
  - Two variants: a non-candidate fix, and a **candidate-scope** fix that changes `app/main.txt`.
  - Both are now REJECTED, and the F-DG0-169 error is the only error. The `validate.mjs` CLI exits 1 and names F-DG0-169.
  - On 2386a0f, both are ACCEPTED.
- **QA26-N2.** An absent round `source_commit`, with a fix committed before everything, so it is in every other anchor. It is still REJECTED: there is no absence escape.
- **QA26-N3.** The round's `source_commit` is a *present* 40-hex object that is not a commit (a tree, a blob). Both are REJECTED by F-DG0-169. On the baseline, the blob variant was ACCEPTED.
- **QA26-N4 (scope).** An absent-source superseded round that verifies no closure gets no F-DG0-169 error and 0 errors overall. The D-035 manifest tolerance stays closure-scoped, as D-042 states.
- **QA26-N5.** The round-23 forge (fix committed after the run) is now rejected by both anchor 1 (absent) and anchor 2.
- **QA26-N6 (standing controls).** Each of these is rejected as expected:
  - a present-round post-freeze fix, by anchor 1 alone;
  - an all-zero or absent `fix_revision`;
  - an absent or `unknown` run head;
  - an F-DG0-165 downgrade of both `severity` and `mandatory_violation` (both drift errors);
  - a `--depth=2` clone, which is refused as shallow.

The header comment in `rules.mjs` and the D-042 text now describe the unconditional guarantee accurately. I judge the change against `threat-model.md`: it removes the last absent-commit path for closures and adds no new residual.

## Honesty notes

- **QA26-N4 failed on its first run.** The cause was a bug in my own harness: the no-closure variant still rewrote the original closure's `fix_revision`. The failing run is kept as `13a-qa26-first-run-harness-bug.log`. I fixed the test, not the product, and `13` is the clean run.
- **Assignment inconsistency.** `review-common.md` again says "Review round: `23`". I used round 26, as the paths and task ID say. This is clerical, in excluded metadata.
- Every listed check was run in this session. Disposable clones were under `$TMPDIR` only. No product implementation file was modified.
