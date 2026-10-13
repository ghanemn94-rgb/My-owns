# DG4 round 9: qa-verifier narrative (T-DG4-REV-QA-R9)

**Verdict: PASS. No new finding.** Candidate `sha256:18c18fe4eda7cbc1c9b2c42ffd22f5ec5c1c4851be1a34183cb118bd4ddad76c`, source `f2ae717`. This is a confirmation and re-verification round after the D-136 history rewrite.

## What I did myself this round
- **Candidate identity.** On a complete clone, at the freeze commit 01ad2e1 and at f2ae717 itself, and on the working tree: 1475 files, the same ID every time. Two run-record commits from the other reviewers landed during my run, both under `docs/delivery/runs/DG4` only. I did not read them.
- **Product unchanged.** 5cd1e06..f2ae717 has 0 files outside docs/delivery, and the product tree equals round 8's pre-rewrite 8553323 and round 7's dab4562.
  - *Observation:* the diff also carries the round-8 review, run and evidence material, not only the records the assignment lists. All of it is under docs/delivery.
- **Rewrite (B3).** The backup ref vs a445b24 is exactly 33 added run files, at their recorded blobs. I checked **all 360** SHA-map pairs, not just three:
  - identical subject, author and committer metadata;
  - no tree difference outside the restored paths;
  - identical product patch-ids.

  Running the validator's own `checkWriteOnce` gives 99 errors at the old head and 0 at the new one (DG4 and DG3). DG0–DG3 are untouched.
- **D-136 overall: accurate.** B1, B2 and B4 all hold. One observation: D-135 still cites the pre-rewrite commit `16e5343`, which is now `e8f14db`. The SHA map resolves it, and it has no effect.
- **B2 closures: all 7 PASS → CLOSED_VERIFIED.** The findings are F-DG4-140, 141, 143, 144, 145, 146 and 147.
  - Every remapped fix commit is an ancestor of f2ae717 and maps to its old id.
  - The product diffs are byte-identical.
  - Every old fix commit was an ancestor of the source where I first verified it.
  - Every fix file is unchanged since the fix.
  - The F-DG4-146 mutants (M4, M4a, M4b) are killed again, with the same counts as round 7.
- **F-DG4-148: re-recorded as ACCEPTED_OBSERVATION.**
  - Series r1 went above the envelope (max 11.67), partly because my own git checks overlapped it. It is disclosed and not counted, although its 4 runs also passed.
  - Series r2 ran inside the envelope (max 5.81): 4/4 EXIT 0, covering Node 22 and 24, each with the locale unset and with C.UTF-8.
  - The margins are wide: architecture.test.ts took about 11 s against its 30 s limit, and the first render 1.2–1.8 s against 5 s.
- **Static checks** 7/7 EXIT 0. **Validators** 5/5 PASS, on both the working tree and the clone. **Register:** 137/137 rows IMPLEMENTED, 0 missing evidence paths, and no change since round 7.

## Carried forward (not re-run; identical code)
These were not re-run this round, and the round-7 evidence is cited:
- integration ×2;
- tests/qa;
- the REQ-DLV-036 counts;
- the full e2e in both languages and both locale settings, with every non-pass disclosed there;
- the axe, 390 px, 200 % text and AUD read-only probes.

## Disclosures
- Each mutant EXIT 1 is by design (a killed mutant).
- The old-head `checkWriteOnce` EXIT 1 is by design: it reproduces B3.
- Two helper key slips in my scripts were corrected in the same log.
- Each unit log carries 14 React duplicate-key fixture warnings, identical in rounds 6–8.
- The build log has the Vite chunk-size advisory.

Details: `docs/delivery/test-evidence/DG4/qa/round-9/RUN-NOTES.md`.

No product gate (G1–G6) was decided. Product G6 never implies DG7.
