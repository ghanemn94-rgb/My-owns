# DG5 clean re-gate, round 2: qa-verifier narrative

**Verdict: FAIL.** One required check, the product journey e2e suite, fails deterministically on the frozen candidate (F-DG5-143, Medium, not mandatory). The product behaves correctly; the defect is in a test that a repair-wave screen change broke. My three round-1 findings are all CLOSED_VERIFIED.

**Candidate.** `sha256:5df44203b73c7c9e4a7a34d65abde4f7060bcd5b1ef66ee84e7d47ba7699186b`
- 2203 files; source `edbf5ce2be5212f9de2e7d5f1af5ce57ca2eb9e7`; freeze `7144a19`.
- Verified at the start and at the end of the review, on a complete clone (no sparse checkout this round) and on the working tree.

**Run.** `DG5-T-DG5-RG-QA-R2-qa-verifier-20261024T145111Z-ef4aa8c5`. The assignment names the task `T-DG5-REV-QA-R5`, and the invocation reference names it `T-DG5-RG-QA-R2`. I used the invocation reference verbatim. The assignment asks me to mirror `reviews/DG4/round-20/qa-verifier.json`, which does not exist (DG4 has rounds 1–10), so the record follows `review.schema.json` and my DG5 round-1 record.

All commands, outputs and disclosures are in `docs/delivery/test-evidence/DG5/qa/round-2/`; start with `RUN-NOTES.md` and `env.txt`. The probes are in `docs/delivery/test-evidence/DG5/qa/tests/round-2/`.

## My round-1 findings (verified on this candidate)

| ID | Result | How |
|---|---|---|
| F-DG5-140 | CLOSED_VERIFIED | Probe run in en and ar, both locale settings, 8/8 each time. Neither user without `procedure.launch` (auditor, admin) gets a launch control, including after a reload and back navigation; both see the read-only note. The server still answers 403 and nothing is created. Lead and office keep the form. A mutant that removes the gate is caught by both the product test and my probe. |
| F-DG5-141 | CLOSED_VERIFIED | In both full runs, 6a and 6b pass in en and ar with at most 18.2 s of their 60 s budget, and no assertion changed. |
| F-DG5-142 | CLOSED_VERIFIED | `QA_A22_CROSS_BOUNDARY=1` forces a quarter-hour boundary between the test's read and the screen's read. A22 passes in en and ar in both settings, and each run proves the boundary was crossed. A stale-next-run mutant fails A22. |

## What ran

| Check | Result |
|---|---|
| Static checks: build, typecheck, lint, openapi:lint (846 ops), no-cdn, format, contrast | 7/7 exit 0 |
| Unit tests: Node 22 and 24, locale unset and C.UTF-8 | Series r2 inside the D-134 envelope (max load 6.38): 4/4 exit 0, 2350 / 1746 / 259 + 2 by-design skips. Series r1 is disclosed: same results, but it ran above the envelope (max 9.48). |
| Integration x2 (disposable PostgreSQL) | 320 files; 3084 passed + 1 by-design skip in each run; migrations 0001–0097 (89 files); contract test passes; p5-pending lists empty |
| `tests/qa` alone | 31 files, 336/336 |
| REQ-DLV-037 suites on this candidate | A06 27, A07 12, A15 34, A16 30 |
| Product e2e, locale unset | 465 passed, 2 failed, 3 did not run (F-DG5-143, F-DG5-144) |
| Product e2e, C.UTF-8 | 468 passed, 1 failed, 1 did not run (F-DG5-143) |
| Root acceptance specs | 30/30 in each setting. In the unset run, A20 ran separately because my command misnamed the file. |
| Demo-stack specs (`a02-*`, `a21`) | 12/12 in each setting |
| Product specs with a demo branch, on the demo stack | 8/8. The unset run also included a production-only spec by my mistake; its 2 failures are expected there and disclosed. |
| AUD read-only sweep (34 P5 screens) | Includes the new slips section and a reader table. 0 problems in en and ar, both settings: no mutations, no write controls, no overflow at 390 px or 200 % text, no serious or critical axe issue. |
| Probes | REQ-PB-093 Studio UI (en and ar); B0147 chains on the rendered screen; inbox approval label; Day-90 test on the demo data (new after F-DG5-121); executive-pack provisional label; CSV injection after the F-DG5-101 change. All pass. |
| Export samples | 18 demo files and the 64-file A15 matrix, inspected at content level: all Arabic files RTL with Arabic fonts, all carry the label and provenance. Raster rendering is impossible in this sandbox (disclosed). |
| Validators (working tree) | register, pipeline, and historical DG4, DG3, DG2 and DG1: all PASS |

## New findings

**F-DG5-143 (Medium, not mandatory, frontend-ux-engineer, REQ-S12-012).** `apps/web/e2e/p3-prioritization-roadmap.spec.ts:542` fails every time in chromium-ar: in both full runs and alone.
- **Cause.** Its "no approve/move button" check uses `/approve|اعتماد|move|نقل/i`. T-DG5-FE-RG1 (F-DG5-120) added the critical-slips table to the Dependencies page, and its column-sort button is named «الاعتمادية غير مرتّب» ("Dependency, not sorted"). «الاعتمادية» contains «اعتماد».
- **Product.** Correct: the button is a read-only sort control, and my sweep of the same page finds no write control and no mutation.
- **Effect.** The candidate's own regression suite cannot pass. The serial follower test (capacity, ar) does not run.
- **Why it was missed.** The spec is unchanged since DG3. D-186 skipped the e2e runs before the freeze, so the merged tree never ran it; this is the "reopen" condition D-186 itself names.
- **Why Medium, and why it blocks.** A Medium finding cannot be accepted as an observation (D-185), and a gate needs its required checks to pass. I therefore consider it blocking.

**F-DG5-144 (Low, not mandatory, frontend-ux-engineer, REQ-S10-012).**
- `p4-raid-governance.spec.ts:290` (test 5, meeting workspace) has no explicit budget. In the unset full run it timed out at 30.1 s in chromium-ar; en took 27.2 s.
- No assertion failed, and no single step was slow. It passes alone (16.5–16.9 s) and passed in the C.UTF-8 run (25.0 s).
- This is the F-DG5-141 class in another test.

## Disclosed and explained

Every non-zero exit and probe error is listed in `RUN-NOTES.md`:
- the deterministic and the timing e2e failures above;
- my unset demo-branch selection error;
- the CSV probe's attempt-1 fixture error;
- the by-design mutant failures;
- a run that never started (exit 127);
- the misnamed A20 path;
- the r1 unit series above the envelope;
- the 18 known stderr blocks and the by-design skips;
- the trace-prune guard's 2 h limit;
- the other reviewers' auto-commits during my run (paths only; not opened).

## Boundaries

No product file was changed. Probes and mutants ran only in a disposable clone, which has been removed.

Product gates G1–G6 are business approvals inside the product. Nothing here approves anything real, and product gate G6 never implies DG7. All data is synthetic.
