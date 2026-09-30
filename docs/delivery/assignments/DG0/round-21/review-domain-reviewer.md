# DG0 assignment: domain-reviewer (round 21)

Read `docs/delivery/assignments/DG0/round-21/review-common.md` first; it defines the candidate, output format and ID block. Task ID: `T-DG0-REV-DOM-R21`.

## Your scope: source fidelity and business/operating-logic correctness of the P0 specification

Check each item below directly against `docs/source/playbook.md`, the original docx and the master prompt. Record each as a check.

1. **Extraction fidelity.** Unzip `docs/source/Business_Transformation_Playbook.docx` in a temp dir, and confirm by independent means that `playbook.md` contains all of the document text and table content (strip XML tags from `word/document.xml` and diff the normalized text, or check a sample of passages across every section and every table).
2. **Source coverage.** Every block B0001–B0165 has a sensible disposition. REQUIREMENT blocks map to requirements that actually implement their substance. CONTEXT and NON-REQUIREMENT rationales are true. Look for dropped source substance: a column, a value list, a rule, an example value, a band, a question.
3. **Templates.** T01–T16 columns appear **verbatim** in the register and the field inventory, with their meaning preserved, including the source value lists (H/M/L; Support/Neutral/Resist; Decision/Tech/Data/Vendor; Risk/Assumption/Issue/Dependency; A/R; the 25/25/20/15/15 weights; the waves' horizons and entry/exit; the T11 SLAs; the T10 RAG logic per area).
4. **First-class deliverables.** Check each is fully specified: the Charter's 14 fields; the transformation thesis; the 5 scope sanity checks; the outcome hierarchy; the TOM canvas (10 dimensions and prompts); the 90–120 minute workshop; the business case's 10 sections; the operating-system layers; the benefits lifecycle; the 7 adoption indicators; the 90-day plan; the Day-90 test; the 25 questions with 4 bands; the roaming example and its traceability rows; the modes; the 6 phases and G1–G6 decision questions and evidence; the minimum governance roles.
5. **No invented source requirements.** SOURCE-class rows must be grounded in the cited blocks. Master-prompt additions must be USER or ENGINEERING. Interpretations must be labelled as such.
6. **Provenance honesty.** Requirements capture that the product must present the playbook as a practical synthesis inspired by PMI/Brightline/BRM with custom extensions, never an official PMI standard. No text claims official Mobily branding (#0078FF is provisional).
7. **Operating-logic semantics in the register.** Check the register states each correctly: RAG comes from the trajectory, never task completion; delivery/adoption/validated value/closure are separate statuses; forecast or unvalidated value never counts as validated; Finance validates while the Business Owner stays accountable; a shared benefit is counted once, allocation is ≤100% with the unallocated share shown; gates are explicit approvals tied to evidence snapshots; DG0–DG7 stay separate from G1–G6.
8. **Master-prompt coverage.** Sample at least 60 M blocks across every section (§0–§21, including table rows) and confirm the disposition and requirement mapping are correct and complete. Report the sample list.
9. **Stage plan and staging.** `final_gate` and `increments` follow §21. Acceptance conditions are concrete and testable.
10. **Glossary, journeys and permissions.** Arabic terms are sensible business Arabic; journeys cover every phase and gate, modular entry, KPI update, Finance validation, the committee workflow, BAU handover and admin publishing; the permissions matrix respects the source roles, T11 and the RACI, and states that technical admins are not business approvers.

## Requirements to check (record exactly these in `requirements_checked`)
- **All `REQ-PB-*` rows** (as specified).
- **The DG0-final `REQ-DLV-*` rows about source extraction, analysis and the register:** `REQ-DLV-001`, `REQ-DLV-002`, `REQ-DLV-020`, `REQ-DLV-032`. (code-security-reviewer independently checks the full set of 19 DG0-final rows; between you the validator requires every DG0-final row checked by domain or code-security.)

The D-037 changes in this candidate are in the delivery tooling and threat model (code-security's and qa's scope). Your focus stays source fidelity and operating logic; confirm the D-037 edits to `docs/delivery/decisions.md` and `docs/delivery/threat-model.md` do not misstate any business/operating-logic or source-provenance claim.
