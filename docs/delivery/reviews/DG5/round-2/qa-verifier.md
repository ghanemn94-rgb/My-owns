# DG5 round 2: qa-verifier review (T-DG5-REV-QA-R2)

**Verdict: PASS.** Candidate `sha256:c4f70a80196e79c75883e970656a84fa8a365d9f9f5091d14ad144be2361f06e` (2183 files, source `d3528fc`). I verified it on a complete disposable clone at the start and at the end of the review. The record is `qa-verifier.json`, the findings are in `qa-verifier.findings.json`, and the round-1 verifications are in `qa-verifier.verifications.json`. Evidence is in `docs/delivery/test-evidence/DG5/qa/round-2/`, and the probes are in `docs/delivery/test-evidence/DG5/qa/tests/round-2/`.

## Round-1 findings

| Finding | Result | How it was verified |
|---|---|---|
| F-DG5-140 (scoring defaults reflow) | CLOSED_VERIFIED | My round-1 probe, re-run unchanged: 0 px page overflow at 390 px and with 200 % text, on all 31 P5 screens, in en and ar. |
| F-DG5-141 (coverage region not focusable) | CLOSED_VERIFIED | No serious or critical axe violation at 390 px, at 1366 px or with 200 % text. All 24 scroll regions are focusable and named. Real Tab presses reach the coverage region and the rubric region, and the arrow keys scroll them (in RTL too). `p5-reflow-axe.spec.ts` asserts what it claims. |

## Runs

| Check | Result |
|---|---|
| Static checks | All exit 0. |
| Unit tests (Node 22 and 24, locale unset and C.UTF-8) | 2335 / 1708 / 259 + 2 skipped in all four runs. The stderr lines are the 18 D-169 blocks, plus one Fastify deprecation warning, which was also present in round 1. |
| Integration, run 1 and run 2 | 317 files, 3053 passed + 1 skipped, in each run. |
| `tests/qa` alone | 336/336. |
| Root e2e | 30/30 in each locale setting. |
| Demo e2e | 12/12 in each locale setting. |
| Validators | All PASS. |
| Product e2e | 441/442 in each locale setting. The one failure each time is the p5-forms T01 test, which passes 6/6 when re-run alone (F-DG5-143). |
| REQ-DLV-037 counts | A06 27, A07 12, A15 34, A16 30. |
| Export samples | 26 PDF/DOCX/PPTX/XLSX/CSV samples inspected in en and ar. |

## New findings

**F-DG5-142** (Medium, not mandatory, REQ-S15-012). This is my judgement of D-171 observation (f).
- On the demo dataset at 390 px, four DG2–DG3 screens fail axe `scrollable-region-focusable` (serious), in en and ar: the transformation overview, the charter, readiness and the benefit formula page.
- It is not a regression, and it falls outside every DG5 acceptance text. The binding requirement is final at DG6, so I do not count it as blocking DG5.
- It should be repaired before DG6, with the same wrapper fix FE-V1 applied to the P5 tables.

**F-DG5-143** (Low). The product e2e `p5-forms.spec.ts:211` depends on row order.
- Its fixture fills the API's first diagnostic item, which is ordered by a UUIDv7 id that is random within one millisecond. The test then opens the screen's first row, which is ordered by dimension ordinal.
- It failed in 2 of the 4 runs of this test on this candidate.
- This is test reliability only; the product behaves correctly.

## Judgements

- **The a02 hunk (`6c7f54b`):** accepted. It adds one audited role assignment, and the test still asserts its clause.
- **Observations (a)–(e) and (g):** accepted, with the reasons in check QA-R2-17.

## Disclosed incidents

Each one is explained in its check:
- A demo e2e run stalled inside one sandboxed task. A fresh bring-up of the same stack succeeded, and the fresh runs passed.
- A probe path collision occurred in the complete clone; I fixed it in my runner.
- My own wrong probe selector made two keyboard tests fail; I corrected it and re-ran.
- A non-waiting banner check in my round-1 probe raced one screen per language. The screenshots show the banner, and two clean re-runs passed.
