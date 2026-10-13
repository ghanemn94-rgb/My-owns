# DG4 round 10: qa-verifier narrative (T-DG4-REV-QA-R10)

**Verdict: PASS. No new finding.** Candidate `sha256:f38274cb6d50c49857a89876cec1bc4713f69ef84b29a6f5b9af10061317ccc6`, source `e70ac02`, freeze `01a801e`. This round reviews the round-9 repairs: T-DG4-FE-R11 (F-DG4-160 and the 'later release' sweep) and T-DG4-BE-R7 (the A08 G6 fingerprint). It also judges D-137 to D-139.

## What I did myself this round
- **Identity.** On a complete clone, at the freeze and at the source, and on the working tree, at the start and at the end, every check gave 1475 files and the same ID. Two run-record commits from the other reviewers landed during my run, all under docs/delivery. I checked only their paths.
- **Diff.** f2ae717..e70ac02 outside docs/delivery is exactly the 9 files. Compared with round 7's dab4562 it is the same 9, so everything else is the code I reviewed in full in round 7.
- **FE-R11.**
  - The four catalogues change only the status hint, `plannedBody`, `willContain` and `entry.portfolioPlanned`, in EN and AR.
  - The unit tests pin all of them literally, add negative checks, and render the 4 planned areas × 2 locales, checking every sub-entry href.
  - A mutant that restores round 9's catalogues fails 14 of 49 tests.
  - On the real stack, my own probe confirms that what the texts claim is true:
    - the edit page shows the exact new hint, offers no 'closed', and its Closure page opens;
    - every sub-entry under the 4 planned areas leads to a working transformation screen (RAID, Action register, Corrective actions, Adoption plan, Performance areas, Improvement backlog, Lessons, Phases), and Dashboards opens;
    - the 6 partial areas show the new card text.

  These checks pass in EN and AR, in both locale settings, with axe clean, and at 390 px and 200 % text.
- **F-DG4-160.** The audit's reproduction no longer reproduces. Its reporter, the release-auditor, verifies the closure, so I write no verifications file.
- **BE-R7.**
  - The narrowed `deliveryFingerprint` is identical in rule and set to `g5-g6.test.ts`, and it keeps all four non-vacuity assertions.
  - My mutants on a scratch copy of the records each fail exactly the G6 test: appending to stages.json, appending to requirements.csv, deleting findings.json, adding gates/DG7.json, and adding a review. A write to candidates/ passes, as designed.
  - Product code has no file-write path to docs/delivery: the only matches are 4 comments in packages/db/src/schema.ts. So the narrowing loses nothing that REQ-S04-008 covers.
- **Runs.**
  - Unit: series r1 was outside the load envelope (max 11.82, partly because of my own validators); it is disclosed and not used. Series r2 ran inside it (max 6.91): 4/4 EXIT 0, Node 22 and 24, both locale settings, 1589/1358/259 + 2 skipped by design.
  - Integration (`with-pg.sh pnpm test:integration`), once: 209 files, 1984/1984, max load 6.25.
  - tests/qa: 172/172. REQ-DLV-036: 85/85.
  - The changed e2e specs: 24/24 per setting. The root acceptance specs: 14/14 per setting.
  - Static checks 7/7 and validators 10/10 pass. The register shows 137/137 rows IMPLEMENTED.

## Judgements
- **D-137: accurate.**
  - My own sweep confirms every row of the FE-R11 table.
  - It also lists some fail-closed fallback texts that the table does not name individually:
    - `dashboards.*.other` ("… not listed in this release");
    - `gate__criterion_not_evaluable`;
    - `define…noEvaluator`.

    These describe a code or criterion the release cannot label or evaluate. They don't claim that a delivered feature is missing, so they are observations, not findings.
  - Naming nit: D-137 writes `nav.portfolioPlanned` and `transformations.laterStage`; the real keys are `nav.entry.portfolioPlanned` and `transformations.workspace.laterStage`.
- **D-138: accurate.** My scope figures match: 535 files / 9.96 MB now, against about 4,975 files / 346 MB before. The cold-cache cause is honestly marked as inferred.
- **D-139: accurate** for everything I re-ran: the diff, integration, the unit counts and the root specs. I did not re-run the full 350-test e2e.

## Disclosed harness errors of mine (none affects the product)
- A08 mutants:
  - Attempt 1 used `-t`, which skipped the sequential setup tests, so even the control got a 422.
  - Attempt 2 overlapped attempt 1, which I had failed to stop.
  - Both are kept as `*-INVALID.log`. The third, clean run is the evidence.
- Root e2e: `e2e/` as a filter also matched old probe specs under docs/delivery. It was re-run with the four files named.
- Probe revision 1 was too weak on the sub-entry pages. Revision 2 is the check.

## Carried forward (not re-run; identical code outside the 9 files)
The full product e2e, the AUD read-only pass, 390 px and 200 % on all P4 screens, and the second full integration run. These are round-7 evidence, with every non-pass disclosed there.

All data is synthetic. No product gate (G1–G6) was decided, and product G6 never implies DG7.
