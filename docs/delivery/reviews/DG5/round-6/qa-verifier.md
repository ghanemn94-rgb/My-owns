# DG5 round 6: qa-verifier (T-DG5-REV-QA-R6), narrative

**Verdict: PASS.** Candidate `sha256:3294f8fc…` (2191 files, source `ad52a56`) was confirmed on a complete clone three times: at the start, at the source commit and at the end of the review. Every check of the assignment ran. None is BLOCKED.

## Open finding: F-DG5-147 is CLOSED_VERIFIED

I re-ran my round-5 probe R5-TITLE on the production stack, in en and ar, in both locale settings. Its data, screens and sizes are unchanged. It is now **asserted** (R6-TITLE-A), and it adds an unbroken 69-character Arabic token.

- **Result:** 4 of 4 runs pass. Each run has 26 cases per language, all with 0 px page overflow and no escaping element.
  - The cases are the benefit page ("B01 · <title>" and "Form tools: <title>") and the overview (h1 and breadcrumbs), each at 390 px, 320 px and 200 %.
  - In round 5 the same cases overflowed by 44–415 px (46-character token) and up to 2797 px (120-character word).
- **axe** at 390 px with the long title: 0 violations.
- **No needless wrapping:** the ordinary h1 stays on one line at 1280 px.
- **The product regression** `p5-title-reflow.spec.ts` passes in both full product runs.

### Beyond the finding (R6-TITLE-B)

The sweep put long tokens in a transformation name, a Define outcome and a T13 stakeholder group, and visited:
- all 42 workspace tabs;
- 5 global pages;
- the T13 "Form tools" dialog title.

Each was measured at 390 px, 320 px and 200 %: 432 measurements per run, 4 runs. Everything the repair targets wraps:
- page headings and breadcrumbs;
- card titles;
- the outcome title;
- the launch-plan and health-check pickers;
- the dialog title.

The sweep's assertions fail by design on three screens, and these became two new findings.

## New findings (both Low, not mandatory, REQ-S15-009, final gate DG6; not blocking DG5)

### F-DG5-148: unbroken record names still widen two DG4 screens

The same class as F-DG5-147 remains on two DG4 screens that the repair's selector list does not cover:
- **Traceability:** the record link in the trace panel.
- **Modular entry:** the missing-item label "· <name>".

| Token | Overflow at 390 px / 320 px / 200 % |
|---|---|
| 120-character word | up to 823 / 893 / 1658 px |
| Arabic token | up to 164 / 234 / 372 px |
| Ordinary text | 0 px |

The results are identical in en and ar and in both locale settings.

### F-DG5-149: the Define outcome card is too wide for narrow phones

The Define page's outcome card is a fixed ~352 px wide in en, because its Good-outcome table has no scroll region. So the page scrolls sideways even with **ordinary** text:

| Language | 320 px | 360 px | 375 px | 390 px |
|---|---|---|---|---|
| en | 61 px | 21 px | 6 px | 0 px |
| ar | 29 px | 0 px | 0 px | 0 px |

Earlier rounds measured only 390 px and 200 %, where the page shows 0 px. This is a DG2 component and not a regression.

## The repair for F-DG5-124 (domain's finding), checked as qa acceptance of REQ-S18-001 / REQ-PB-089

On the real demo stack I downloaded exports through the UI:
- the T01 and T14 CSV files, from the Export dialog's CSV link;
- the matching JSON files, from its JSON button.

**Result:**
- Each CSV starts with BOM + "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي", then the header.
- Each JSON carries `illustrativeLabel` in its language.
- The repair's integration test covers all 8 demo cases and the unlabelled production case. It passes in both integration runs.

**Observations (no finding):**
- The CSV label row has one field, while the header has many. D-178 decided this layout.
- ADR-0041 §5 and ADR-0050 §2 (d) are not yet amended for this second export path. BE-AA1's handback lists this.

## Everything else that ran

- **Static checks:** all seven exit 0.
  - The first `format:check` attempt flagged only my own probe, which was in the clone during the scan. The clean re-run exits 0.
- **Unit tests:** 2341 / 1713 / 259 + 2 skipped, on Node 22 and Node 24, with the locale unset and with C.UTF-8.
  - The 18 stderr blocks per run are identical to round 5.
  - The boundary walk has 5.9–6.3× headroom.
- **Integration:** 319/319 files twice, 3076 passed + 1 by-design skip.
  - The only change from round 5 is the repair's new 19-test file.
  - 89 migrations were applied.
  - The contract test covers 846 operations.
  - All 43 p5-pending lists are empty.
  - There were no timeouts this round.
- **`tests/qa` alone:** 336/336.
- **e2e:**
  - product journeys 454/454 per locale setting (452 + the new title-reflow spec);
  - root specs 30/30 ×2;
  - demo specs 12/12 ×2;
  - 52 AUD read-only tests per locale setting;
  - axe 0 violations over 700 screen checks per language and run.
- **REQ-DLV-037:** A06 27, A07 12, A15 34 and A16 30 in every run, plus the root specs 2/1/1/2 per project.
- **Exported samples:** 26 pack/register samples in en and ar, plus 8 form-record exports.
  - Provenance, the demo label and the provisional legend appear everywhere; no DG0–DG7 text appears.
  - The Arabic files carry RTL markers.
- **Validators:** `--register DG5`, `--pipeline` and `--historical` for DG4, DG3, DG2 and DG1 all PASS.
- **Requirements:** all 78 rows map to 406 named test references, and every one passed this round.

## Disclosed

- **Probe errors of mine, both fixed in revision 2.** Revision 1 of each probe and its logs are kept.
  - The title probe's first run used an upper-case dev-login username, which returned 400.
  - The export probe's first run looked for the T14 Export button on the register page instead of a benefit page, and timed out after 240 s.
- **Playwright's "Internal error: step id not found"** lines appear only in my failing probe runs. They are reporter output.
- **The assignment contradicts itself.** It says `round: 5` and Task ID `…-R5`, but the paths say round 6. The validator binds `round` to the directory, so this record uses 6.
- **The main repo moved during my run.** It went to `ffd3883`, which only adds the other two reviewers' auto-committed records. The candidate ID is unchanged. I did not read those records.

Every value used is synthetic. Nothing here approves anything real. The product's G1–G6 gates are unrelated to the engineering gates DG0–DG7.
