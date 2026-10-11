# Handback T-DG4-AN-R1 (transformation-analyst): F-DG4-140 register follow-up

- **Stage:** P4 / DG4, repairs after review round 1 (D-117).
- **Invocation:** run `DG4-T-DG4-AN-R1-transformation-analyst-20261011T011150Z-c4b1d8ee`, session `c4b1d8ee-ea31-48ba-80c1-175ee0173401`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-AN-R1.md`. Its sha256 was verified as `d3295e5a8f876bbfb0f6693015c8c83e8497ca88f258a7c5771817165a289a3c`.
- **Base:** worktree `/home/user/wt/dg4-an-r1`, branch `dg4/an-r1`, `HEAD` = `f5579e7af2c793cd6dc5b529c9a88f33f815d785`.
  - The only tracked change is `docs/delivery/requirements.csv`. The untracked dotfiles at the top level belong to the runner's sandbox and were not touched.
- **Time:** started `Sun Oct 11 01:12:03 UTC 2026`, ended `Sun Oct 11 01:13:09 UTC 2026` (date -u, before this handback was written).
- **Changes:** left **uncommitted**, as instructed.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | REQ-PB-010 and REQ-S03-004 changed in `evidence` and `notes` only. Each row now cites the T-DG4-QA-D test that asserts its clause, the false "test gap" sentence is gone, and a dated `DG4 analyst check (T-DG4-AN-R1, base f5579e7): …` note is appended. |
| `docs/delivery/handbacks/DG4/T-DG4-AN-R1-transformation-analyst.md` | This handback. |

No other row, column or file changed. The script in §3 proves it. The CSV keeps its line ending and its trailing newline.

## 2. Behaviour delivered (per requirement)

I opened each test before editing its row and read every assertion.

### REQ-PB-010 (A01, F-DG4-140)

`tests/qa/integration/a01-one-source-of-truth-scorecard.test.ts` asserts the whole A01 clause:

- **Baseline.** Before the rename, the T10 Portfolio area and the traceability view show the old name.
- **The rename.** There is exactly one `PATCH /api/v1/initiatives/{id}` with `If-Match`. It returns 200, and the version goes up by 1.
- **The database.** It holds exactly one `initiative` row for the id and the code, with the new name, and no row with the old name in the transformation. Exactly one new `initiative.update` audit event is written.
- **Scorecard.** The T10 Portfolio area, which is the "scorecard" under D-106 (d), shows exactly one item for the initiative, with the database row's name. No item has the old name.
- **Traceability.** The full graph and the graph rooted at the initiative both show the new name, and neither shows the old one.
- **Roadmap and benefits register.** Both show the new name. The register row's `initiatives[]` is `[{id, code, name: NEW_NAME}]`.

Changes to the row:

- **Notes:** I removed only the sentence starting "Partial: the 'scorecard' read … is not re-read after the rename by any test; … test-coverage gap rather than a behaviour gap." The AN-P4A check and the playbook / master-prompt text are unchanged. The new note describes these assertions.
- **Evidence:** I added three paths:
  - the test (placed after the existing test paths);
  - `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-D-authoring/HANDBACK-T-DG4-QA-D-qa-verifier.md`;
  - `docs/delivery/test-evidence/DG4/qa/round-1/03-integration-tests-qa-candidate-only.log`. Lines 182–183 show both `it` blocks green in round 1.

### REQ-S03-004 (A02 and A08, F-DG4-140)

`tests/qa/integration/a02-a08-drafts-before-g2-scale-after-g5.test.ts` asserts all three parts, in order, on one natively built transformation:

1. **G2 is not approved.** The API gate view reads `draft`, `gate_instance` reads `draft`, and there are zero G2 `gate_decision` rows. This holds in Diagnose, and again in Define after a native G1 approval.
2. **Design-phase drafts are saved.**
   - In both phases, a T03 TOM gap is saved: 201, persisted, with one `tom_gap.create` audit.
   - In Define, a TOM canvas box is also edited and kept in `draft`: 200, persisted, with one more `tom_canvas_cell.update` audit.
   - Afterwards G2 is still not approved and the phase is still Define.
3. **Scaling is refused before G5.** G2–G4 are passed natively. A scale transition before G5 is 422 `application/problem+json`, with `urn:mth:problem:invalid-transition` and `gate.g5_not_approved`, and its detail matches `\bG5\b`. No `scale_transition` row is written.
4. **Scaling succeeds after G5.** G5 is approved natively with a scale scope. The same transition is then 201, its row is bound to that G5 decision, and one `scale_transition.create` audit is written.

Changes to the row:

- **Notes:** I removed only the sentence starting "The A02 'Design-phase draft can be saved before G2' clause is not asserted by a DG4 test: it is proven implicitly by the DG2 registers.test.ts …". The AN-04 class note and the AN-P4A A08 check are unchanged. The new note describes these assertions. It also says that `registers.test.ts` is now supporting evidence only. That file stays in `evidence` because it still exercises draft saves.
- **Evidence:** I added the same kind of three paths: the test, the QA-D handback, and the round-1 QA log. Line 135 of the log shows the test green.

### Round-1 repairs (D-117) and these two rows

Neither row needs a repair's evidence. I cited no file from another repair worktree.

- **F-DG4-100** changes `requirePermissionSomewhere` in `apps/api/src/modules/benefits/register.ts`, which REQ-PB-010 cites. That repair adds `authorization.denied` audit on 403. It does not change the one-source-of-truth behaviour, so the citation stays valid after KBE-R5 merges.
- **F-DG4-103** re-checks authorization at commit time in `decideGate` and `submitGate` (`workflows/gates.ts`). That file is not in REQ-S03-004's evidence. The G5 refusal and success that the row asserts are covered by the tests above.
- **F-DG4-121** (the Finance headline) does not affect either row.

## 3. Checks actually run

Environment: worktree `/home/user/wt/dg4-an-r1` at `f5579e7`, inside the agent sandbox, with Node from the repository toolchain and `python3 -I`.

**`node tools/gates/validate.mjs --register DG4`** exited 0:
```
PASS register rules at DG4
```

**`node tools/gates/validate.mjs --register DG3`** exited 0:
```
PASS register rules at DG3
```

**Diff, column-count and evidence check against the base:** `python3 -I $TMPDIR/verify.py` exited 0. The script reads `git show HEAD:docs/delivery/requirements.csv` and the working file with `csv`. It compares them cell by cell, requires that only REQ-PB-010 and REQ-S03-004 differ and only in `evidence` and `notes`, and checks that every evidence path is an existing regular file.
```
rows base/new: 413 413 header same: True
column counts in new file: [19]
DIFF REQ-PB-010 cols: ['evidence', 'notes']
   OK  (all 9 evidence paths exist)
  added evidence: ['tests/qa/integration/a01-one-source-of-truth-scorecard.test.ts', 'docs/delivery/test-evidence/DG4/qa/T-DG4-QA-D-authoring/HANDBACK-T-DG4-QA-D-qa-verifier.md', 'docs/delivery/test-evidence/DG4/qa/round-1/03-integration-tests-qa-candidate-only.log']
  test-gap phrase left: False
DIFF REQ-S03-004 cols: ['evidence', 'notes']
   OK  (all 13 evidence paths exist)
  added evidence: ['tests/qa/integration/a02-a08-drafts-before-g2-scale-after-g5.test.ts', 'docs/delivery/test-evidence/DG4/qa/T-DG4-QA-D-authoring/HANDBACK-T-DG4-QA-D-qa-verifier.md', 'docs/delivery/test-evidence/DG4/qa/round-1/03-integration-tests-qa-candidate-only.log']
  test-gap phrase left: False
RESULT PASS
```
The script printed every path individually, each as `OK`. The two `OK` lines above are condensed from that output.

**Byte safety of the edit.** Before writing, the edit script asserted that re-serialising each target line, unchanged, reproduces it byte for byte. It also asserted that each removed sentence occurs exactly once. Only those two lines were rewritten. `git diff --numstat` shows `2 2 docs/delivery/requirements.csv`. The file still ends in `\n`, as the base does.

**Not run:** I did not run the two QA-D tests myself. The analyst sandbox has no disposable PostgreSQL, and running tests is outside this task. The "green" statements in the notes cite the qa-verifier's round-1 log, which already exists in the repository. They are not my own run.

## 4. Known gaps / not done

- **Scope difference to resolve.** D-117 lists "AN-R1: F-140, plus register notes for the repaired rows", but the assignment says "Change nothing else", so I followed the assignment. The rows covering the F-DG4-100, F-DG4-101, F-DG4-102, F-DG4-103, F-DG4-120, F-DG4-121 and F-DG4-141 repairs still need their evidence and notes updated. That needs a later analyst task after the ARCH-R4, KBE-R5, BE-R5 and FE-R4 repairs merge, because their files and tests do not exist in this tree. The orchestrator should decide this.
- **Closing F-DG4-140.** I do not close the finding. Its owner is the analyst, but only the qa-verifier, or another non-author reviewer, can verify it in round 2.

## 5. Merge instructions

- There are no migrations or code.
- **Only two lines change:** CSV lines 11 (REQ-PB-010) and 151 (REQ-S03-004).
- **Possible conflict:** the implementer repairs (D-004) should not touch `requirements.csv`, but a parallel analyst task that edits these same rows would conflict. In that case merge row by row, as in D-116.
- **After merging,** run `node tools/gates/validate.mjs --register DG4` and `--register DG3` again.
