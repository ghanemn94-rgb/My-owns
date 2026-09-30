# DG0 assignment: domain-reviewer (round 23)

Read `docs/delivery/assignments/DG0/round-23/review-common.md` first. Task ID: `T-DG0-REV-DOM-R23`.

## Your scope: source fidelity and business/operating-logic correctness of the P0 specification

Check each item directly against `docs/source/playbook.md`, the original docx and the master prompt. Record each as a check.

1. **Extraction fidelity.** Confirm by independent means that `playbook.md` contains all document text and table content (strip XML tags from `word/document.xml` and diff, or sample passages across every section and table).
2. **Source coverage.** Every block B0001–B0165 has a sensible disposition; REQUIREMENT blocks map to requirements that implement their substance; look for dropped source substance (a column, value list, rule, example value, band, question).
3. **Templates.** T01–T16 columns appear verbatim in the register and field inventory with meaning preserved, including value lists (H/M/L; Support/Neutral/Resist; Decision/Tech/Data/Vendor; Risk/Assumption/Issue/Dependency; A/R; 25/25/20/15/15 weights; wave horizons/entry/exit; T11 SLAs; T10 RAG per area).
4. **First-class deliverables** each fully specified: Charter's 14 fields; transformation thesis; 5 scope sanity checks; outcome hierarchy; TOM canvas (10 dimensions); 90–120 min workshop; business case's 10 sections; operating-system layers; benefits lifecycle; 7 adoption indicators; 90-day plan; Day-90 test; 25 questions with 4 bands; roaming example + traceability rows; modes; 6 phases + G1–G6 questions/evidence; minimum governance roles.
5. **No invented source requirements.** SOURCE rows grounded in cited blocks; master-prompt additions are USER/ENGINEERING; interpretations labelled.
6. **Provenance honesty.** The product is presented as a synthesis inspired by PMI/Brightline/BRM with custom extensions, never an official PMI standard; no official Mobily branding (#0078FF provisional).
7. **Operating-logic semantics** in the register: RAG from trajectory not task completion; delivery/adoption/validated-value/closure separate; forecast/unvalidated value never counts as validated; Finance validates, Business Owner accountable; shared benefit counted once, allocation ≤100% with unallocated shown; gates are evidence-tied approvals; DG0–DG7 separate from G1–G6.
8. **Master-prompt coverage.** Sample ≥60 M blocks across §0–§21 (incl. table rows); confirm disposition and mapping. Report the sample list.
9. **Stage plan and staging.** `final_gate`/`increments` follow §21; acceptance conditions concrete and testable.
10. **Glossary, journeys, permissions.** Arabic terms sensible; journeys cover every phase/gate, modular entry, KPI update, Finance validation, committee workflow, BAU handover, admin publishing; permissions matrix respects source roles, T11, RACI, and that technical admins aren't business approvers.

The D-039 change is delivery-tooling only (code-security/qa scope). Confirm the D-039 edit to `docs/delivery/decisions.md` does not misstate any business/operating-logic or source-provenance claim. Your round-22 F-DG0-013 was about the D-038 "uniformly absent" wording; verify the D-039 correction and the `gc` are accurate.

## Requirements to check (record exactly these in `requirements_checked`)
- **All `REQ-PB-*` rows** (as specified).
- **The DG0-final `REQ-DLV-*` about source extraction/analysis/register:** `REQ-DLV-001`, `REQ-DLV-002`, `REQ-DLV-020`, `REQ-DLV-032`. (code-security checks the full 19.)
