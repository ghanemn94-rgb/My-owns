# DG5 round 5: qa-verifier (T-DG5-REV-QA-R5), narrative

**Verdict: PASS.** Candidate `sha256:a18a9f05…` (2189 files, source `0c88d5e`) was confirmed on a complete clone at the start and at the end of the review.

This round's sandbox allows nested user namespaces (D-176), so PostgreSQL started. Every check of the assignment ran. None is BLOCKED.

## Open findings: both verified closed

### F-DG5-144: CLOSED_VERIFIED

The Diagnose reflow was checked on the real stacks, in en and ar, in both locale settings.

- **My round-3 reproduction (R3-DIAG, unchanged):** 0 px page overflow at 390 px and at 200 % text. It was 433/394 px and 830/731 px before the repair. The workstream grid now has one 332 px track at 390 px and a 606 px track at 200 %, and the cards fit.
- **My round-4 production-stack probe (R4, unchanged):** 6/6 in each locale setting.
  - Diagnose with every workstream filled, including a 120-character word and a long Arabic text, has 0 overflow at 390, 320 and 200 %.
  - The real 409 banner, on the page and in a dialog, has 0 overflow.
- **My round-3 verification probe (R3-REG, 38 DG2–DG4 demo screens):** across 8 runs, no screen scrolls sideways, Diagnose included. Every scrolling region is focusable and named, and axe reports no serious or critical issue.
- **Disclosed: the R3-REG test failed in 3 of its 4 runs.**
  - The failures are intermittent keyboard-scroll reads ("focused, but no scroll after six arrow presses and a 5 s poll"). One run also had 5 screens whose h1 took longer than 5 s.
  - The affected screens change from run to run. Each passes in another run, and the fourth run passed 4/4.
  - A dedicated diagnostic repeated R3-REG's exact sequence, with and without axe, plus real Tab presses, on 6 of the flagged screens. It scrolled in 180 of 180 trials in en and ar.
  - So this is a timing artefact of the probe's long single-page session, not a product defect. None of it concerns the Diagnose layout.

### F-DG5-146: CLOSED_VERIFIED

**My independent probe (revision 2) passed 8/8 in each locale setting.** It measured these surfaces at 390, 320 and 200 %:
- the Form builder field table: a draft with a very long extension field, and the auditor's read-only view;
- the T14 Attachments and History tables, and the export-preview dialog;
- the T01 Diagnose item's Form-tools dialog, which the product spec does not cover.

On every surface:
- no page overflow;
- no element escapes the viewport;
- each table sits in a named, focusable region inside the viewport;
- the arrow key scrolls the region;
- axe reports nothing at 390 px.

**Other confirmations:**
- The product regression spec passes 4/4 alone in each locale setting, and in both full runs.
- The unit guard catches each fix when it is reverted.
- The dialog-wide CSS change causes no regression across 452 journeys in each locale setting.

**Disclosed: revision 1 of my probe failed 4 of 6 tests in each locale setting.** Both causes were mine:
- I put the long word in the benefit **title**, so the page headings overflowed. The tables passed every check; the heading cause became F-DG5-147.
- I opened T01 form tools on a finding instead of a T01 item.

Revision 1 and its logs are kept.

## New finding

**F-DG5-147 (Low, not mandatory, REQ-S15-009, final gate DG6; owner frontend-ux-engineer).** An unbroken token in a record title or transformation name widens the page.

- **Size:** a 46-character identifier gives 44–415 px of overflow; a 120-character word gives up to 2797 px. Ordinary text gives 0.
- **Where:** at 390 px, 320 px and 200 %, in en and ar.
- **Cause:** the page header h1, the breadcrumbs and the card headings have no `overflow-wrap` rule. That includes the P5 "Form tools: …" heading.
- **Scope:** this is app-wide and not a regression of the repair diff. It needs unusual input, and it does not block DG5.

## Everything else that ran

- **Static checks:** all seven exit 0.
  - The first `format:check` attempt flagged only my own probe, copied into the clone during the scan. The re-run on the clean clone exits 0.
- **Unit tests:** 2341 / 1713 / 259 + 2 skipped on Node 22 and Node 24, with the locale unset and with C.UTF-8.
  - The 18 stderr blocks per run are identical to rounds 2–4.
  - F-DG5-145's headroom holds (8–12.7×).
- **Integration run 1:** 316/318 files.
  - Two DG1 tests hit 30 s timeouts at load 15–19.
  - Re-run alone, they pass in 3.8 s and 5.3 s.
- **Integration run 2:** 318/318 files, 3057 passed + 1 by-design skip.
  - 89 migrations (0001–0097) applied.
  - The contract test covers 846 operations.
  - All 43 p5-pending lists are empty.
- **`tests/qa` alone:** 336/336.
- **e2e:**
  - product journeys 452/452 with the locale unset and 452/452 with C.UTF-8 (retries 0);
  - root specs 30/30 ×2;
  - demo specs 12/12 ×2;
  - AUD read-only tests: 52 per run, all passing;
  - axe: 0 violations of any impact over 700 screen checks per language and run.
- **REQ-DLV-037:** A06 27, A07 12, A15 34 and A16 30 in every integration run.
- **Exported samples:** 26 files (PDF, DOCX, XLSX, PPTX and CSV) in en and ar.
  - Provenance wording, the illustrative label and the provisional legend appear everywhere; no DG0–DG7 text appears.
  - Arabic files carry RTL markers.
  - The provisional label is on the executive pack's PDF lines.
- **Validators:** `--register DG5`, `--pipeline` and `--historical` for DG4, DG3, DG2 and DG1 all PASS.
- **Requirements:** all 78 rows map to 406 named test references. Every one ran and passed this round.
  - The partial-coverage disclosures are accepted, as in rounds 1–3.
  - Some interim wording in the register notes is stale (REQ-S20-002, REQ-S12-012, REQ-S12-020); this round's results show those items resolved.

Every value used is synthetic. Nothing here approves anything real. The product's G1–G6 gates are unrelated to the engineering gates DG0–DG7.
