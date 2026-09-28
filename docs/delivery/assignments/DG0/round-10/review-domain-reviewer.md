# DG0 assignment: domain-reviewer (round 10)

Read `docs/delivery/assignments/DG0/round-10/review-common.md` first; it defines the candidate, output format and ID block. Task ID: `T-DG0-REV-DOM-R10`.

## Your scope: source fidelity and business/operating-logic correctness of the P0 specification

Check each item below directly against `docs/source/playbook.md`, the original docx and the master prompt. Record each as a check.

1. **Extraction fidelity.** Unzip `docs/source/Business_Transformation_Playbook.docx` in a temp dir, and confirm by independent means that `playbook.md` contains all of the document text and table content. For example, strip the XML tags from `word/document.xml` and diff the normalized text, or check a sample of passages across every section and every table.
2. **Source coverage.** Every block B0001–B0165 has a sensible disposition. REQUIREMENT blocks map to requirements that actually implement their substance. CONTEXT and NON-REQUIREMENT rationales are true. Look for source substance that's been dropped: a column, a value list, a rule, an example value, a band, a question.
3. **Templates.** T01–T16 columns appear **verbatim** in the register and the field inventory, with their meaning preserved. That includes the source value lists: H/M/L; Support/Neutral/Resist; Decision/Tech/Data/Vendor; Risk/Assumption/Issue/Dependency; A/R; the 25/25/20/15/15 weights; the waves' horizons and entry/exit; the T11 SLAs; the T10 RAG logic per area.
4. **First-class deliverables.** Check that each is fully specified:
   - the Charter's 14 fields;
   - the transformation thesis;
   - the 5 scope sanity checks;
   - the outcome hierarchy;
   - the TOM canvas (10 dimensions and their prompts);
   - the 90–120 minute workshop;
   - the business case's 10 sections;
   - the operating-system layers;
   - the benefits lifecycle;
   - the 7 adoption indicators;
   - the 90-day plan;
   - the Day-90 test;
   - the 25 questions with their 4 bands;
   - the roaming example and its traceability rows;
   - the modes;
   - the 6 phases and G1–G6 decision questions and evidence;
   - the minimum governance roles.
5. **No invented source requirements.** SOURCE-class rows must be grounded in the cited blocks. Master-prompt additions must be USER or ENGINEERING. Interpretations must be labelled as such (for example, health-check scoring as an implementation assumption).
6. **Provenance honesty.** Requirements capture that the product must present the playbook as a practical synthesis inspired by PMI/Brightline/BRM with custom extensions, never an official PMI standard. No text claims official Mobily branding (#0078FF is provisional).
7. **Operating-logic semantics in the register.** Check that the register states each of these correctly:
   - RAG comes from the trajectory, never from task completion;
   - delivery, adoption, validated value and closure are separate statuses;
   - forecast or unvalidated value never counts as validated;
   - Finance validates while the Business Owner stays accountable;
   - a shared benefit is counted once, and allocation is ≤100% with the unallocated share shown;
   - gates are explicit approvals tied to evidence snapshots;
   - DG0–DG7 are kept separate from G1–G6.
8. **Master-prompt coverage.** Sample at least 60 M blocks across every section (§0–§21, including table rows) and confirm the disposition and requirement mapping are correct and complete. Report the sample list.
9. **Stage plan and staging.** `final_gate` and `increments` follow §21 (for example, T05–T09 and G4 at DG3; T10–T16 and G5–G6 at DG4; Studio, reports, health check and demo at DG5; handover at DG7). Acceptance conditions are concrete and testable.
10. **Glossary, journeys and permissions.**
    - Arabic terms are sensible business Arabic.
    - Journeys cover every phase and gate, modular entry, KPI update, Finance validation, the committee workflow, BAU handover and admin publishing.
    - The permissions matrix respects the source roles, T11 and the RACI, and states that technical admins are not business approvers.

Requirements you verify: all `REQ-PB-*` rows (as specified), plus the DG0 `REQ-DLV-*` rows about source extraction and analysis. List exactly those you checked in `requirements_checked`.
