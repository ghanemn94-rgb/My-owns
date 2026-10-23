# DG5 round 7: qa-verifier narrative (T-DG5-REV-QA-R7C)

**Verdict: PASS** on candidate `sha256:33188e9e…` (2194 files, source `12dc33e`, freeze commit `1932faa`). I recomputed it on a complete disposable clone and in the main repository, at the start and after the main HEAD moved during the run.

All demonstration data used is SYNTHETIC. No product gate G1–G6 approval was granted or implied, and nothing here relates product G6 to DG7.

## Finding verifications

| Finding | Result | Basis |
|---|---|---|
| F-DG5-148 (Low) | **CLOSED_VERIFIED** | Round-6 reproduction R6-TITLE-B re-run unchanged: 0 failures over 47 pages × 3 sizes × 3 tokens, 4 runs. Traceability and Modular entry are now 0 px (they were up to 1658 px). New asserted R7-F148: Modular entry and the Traceability graph are 0 px at 390/360/320 px and 200 %. |
| F-DG5-149 (Low) | **CLOSED_VERIFIED** | Round-6 reproduction R6-DEFINE-NARROW re-run unchanged: 0 px at 320/360/375/390 px in en and ar (it was 61/21/6 px). New asserted R7-F149: the table sits in a focusable, named region; the keyboard scrolls it; axe passes. |

## New findings (both Low, non-mandatory, not blocking DG5)

- **F-DG5-150 (REQ-S15-009, DG6-final).** On Traceability, clicking a node's **Focus** shows the note "Showing the links of <type> "<name>"" (`p.small[data-root]`). The name in that note is plain text outside `.record-name`, so an unbroken name widens the page (651 px at 390 px, 721 px at 320 px). A test-only `overflow-wrap` on that note alone brings every case to 0 px. It is a third element that F-DG5-148 did not name, and round 6 never focused a record.
- **F-DG5-151 (REQ-PB-091, test defect).** The `reloaded` wait in `p5-launch-health-kpi.spec.ts:159` resolves on a GET issued *before* the Save-actions click when GETs are slow: 6/6 runs at 1500 ms. In those runs the product still sent the right If-Match and showed "submitted" in time. The defect is a plausible but unproven cause of the D-182 failure.

## D-181 and D-182 judgements

**D-181.** The shared hook follows `nextCursor`, fails the whole list on any page error, and guards against cursor loops. On the real stack, with 102–103 transformations, I probed 10 picker screens in en and ar, in both locale settings:

- 8 screens offer the newest and the oldest-updated transformation, with the newest first.
- The dashboard chooser pages all of them: its pager total equals the API total, and search finds the newest.
- The migrations entry, opened as `dev.lead`, lists the newest first. As `dev.admin`, who has no transformation-scoped grant, it honestly shows "No transformation is visible to you".

**D-182.** The failure did not reproduce:

- 4 full product suites, 460/460 each;
- 10/10 targeted runs in chromium-ar;
- 5/5 runs at CPU rate 1 and 5/5 at rate 4;
- 12/12 slow-GET runs.

I found no product defect. The test's synchronization is unsound (F-DG5-151).

## Runs (all on this candidate)

- **Static:** build, typecheck, lint, openapi lint (846 operations), no-cdn and contrast all exit 0. `format:check` exits 0; the first attempt flagged only my own probe file, which was temporarily in the clone (disclosed).
- **Unit:** Node 22 and Node 24, both locale settings: 2341 + 1722 + 259 tests passed (2 by-design skips), exit 0 in all four runs.
- **Integration ×2:** 319 files, 3076 passed, 1 by-design skip. `tests/qa` alone: 31 files, 336 tests. All `p5-pending` lists are empty.
- **Product e2e:** 460/460 with the locale unset and 460/460 with C.UTF-8. Root: 30/30 ×2. Demo: 12/12 ×2.
- **AUD and axe:** 52/52 AUD tests ×2. Axe: 553 + 148 screen checks per language and run, 0 violations.
- **REQ-DLV-037:** A06 27, A07 12, A15 34 and A16 30 tests pass in every run, plus their root e2e specs. 26 export samples were inspected in en and ar.
- **Validators:** register, pipeline, and historical DG4/DG3/DG2/DG1 all exit 0.
- **Acceptance matrix:** 78/78 rows, 406 named tests, all passing in this round.

## Disclosures

- The assignment says "round: 5" and "T-DG5-REV-QA-R5". The record uses round 7, as the path, the invocation and the validator require.
- Every failing probe log is either an assertion by design (R7-F148 → F-DG5-150) or a probe error: picker revisions 1–3 and one harness file race. Each is kept and explained in the record's QA-R7-12.
- The probe sources were first written by this role's orphaned round-7 runs. They were re-read, corrected where marked `T-DG5-REV-QA-R7C`, and re-run. No orphaned result is cited.
