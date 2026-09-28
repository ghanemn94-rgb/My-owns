# Assignment T-DG0-AN-01 — Playbook source extraction into requirements (transformation-analyst)

- **Stage:** P0 / gate DG0 (state BUILDING)
- **Base revision:** commit `b42a4aa3029437dcbbae8aab61c81a3def3e69c2` on branch `claude/mobily-transformation-platform-kwcc4i`. Verify with `git rev-parse HEAD` before writing.
- **Requirement IDs you create:** `REQ-PB-001` onward (class SOURCE). You own this ID range exclusively.
- **Dependencies:** none. You run first; two later analyst tasks (AN-02 for master prompt §1–§11, AN-03 for §0/§12–§21) will reference your `REQ-PB` IDs.

## Sources (read in full)
1. `docs/source/playbook.md`, the authoritative playbook v1.0, with anchors `B0001`–`B0165` (machine-readable: `docs/source/playbook.blocks.json`).
2. `docs/source/master-prompt-v2.0.md`, for context on how each source item must become an executable in-platform workflow (especially §2, §4, §5, §9, §10, §11, §14, §18). Do NOT create USER/ENGINEERING requirements here; those belong to AN-02/AN-03.
3. `docs/delivery/requirements-spec.md`, the exact register format (columns, allowed values, ID pattern).
4. `docs/delivery/agent-protocol.md` and `CLAUDE.md`.

## Permitted files (write guard enforced)
- `docs/analysis/parts/req-pb.csv`: your register rows (same header and columns as `requirements-spec.md`, all rows class SOURCE).
- `docs/analysis/source-coverage.csv`: exactly one row per block `B0001`–`B0165` (`block_id,disposition,req_ids,rationale`).
- `docs/analysis/glossary.md`: a domain glossary with the English term, an Arabic term (Modern Standard Arabic as used in Saudi business contexts), a definition, and the source block.
- `docs/analysis/field-inventory.md`: for every template and first-class source deliverable, list every field with the **exact source column/field name**, source block, proposed data type (text, rich text, number, currency SAR, percentage (stored as a fraction), date, reference→entity, choice (with source values), person/role, attachment, calculated), required/optional, validation, and notes. Cover:
  - T01–T16;
  - the Transformation Charter (B0035);
  - the transformation thesis (B0037) and the five scope sanity checks (B0039–B0043);
  - the outcome hierarchy (B0048);
  - the 10 TOM dimensions and the TOM canvas prompts (B0056, B0062);
  - the business case sections (B0085);
  - the operating system layers (B0093);
  - the benefits lifecycle (B0121);
  - the adoption indicators (B0109–B0115);
  - the 90-day plan (B0134) and the Day-90 test (B0136–B0141);
  - the roaming example (B0145, B0147);
  - the health check (B0150) and its bands (B0152);
  - the minimum governance roles (B0018);
  - the modes (B0009) and the phases/gates (B0021, B0023).
- `docs/delivery/handbacks/DG0/T-DG0-AN-01-transformation-analyst.md`: your handback.

## Constraints
- **Granularity:** one requirement per distinct, testable capability. Each template gets one requirement listing all its fields verbatim in `input_fields`, plus separate requirements for rules that carry distinct behaviour, for example:
  - T06 weights 25/25/20/15/15 with the 1–5 scale;
  - T10 area-specific RAG logic;
  - the rule that T08 dependency types include Decision/Tech/Data/Vendor;
  - T15 probability being n/a for non-risks;
  - "Red if executive decision overdue";
  - the escalation principle (B0131);
  - the governance rule (B0102);
  - the good outcome test (B0051);
  - the Gate 1 rule (B0032);
  - "no double counting" (B0088);
  - the design principle "a project portfolio is not a TOM" (B0059);
  - the traceability chain (B0070);
  - the design principles (B0011–B0015);
  - the four questions (B0016);
  - the people-centred principle (B0116);
  - the PMI BRM connection (B0124, a classification/labelling requirement);
  - and so on.
- **Every** block must get a disposition. Use REQUIREMENT when the block's substance is implemented by listed requirements, each of which must cite that block in `source_ref`. Use CONTEXT (heading or explanation fully covered elsewhere; name where) or NON-REQUIREMENT (cover, version stamp, reference URLs, "how to extend" advice), always with a rationale. Headings like "PHASE 1" or "TEMPLATE" are CONTEXT.
- **Faithfulness:** preserve source values verbatim (for example "Next SteerCo / urgent route", "A/R", "0-6 weeks", "H / M / L", "Support / Neutral / Resist", "Comms / training / involvement / incentive").
  - Don't invent requirements the playbook doesn't state.
  - Where the platform needs an interpretation the source doesn't give (such as health-check scoring), note it in `notes` as `interpretation — see master prompt §14`, and don't present it as source.
  - The playbook is "Practical synthesis inspired by PMI … extended with a custom Target Operating Model toolkit" (B0004, B0154–B0162). Include a requirement that the product labels this provenance honestly and never claims official PMI status.
- **Staging:** set `increments` and `final_gate` per the stage map below. Status is `SPECIFIED` for every row. `evidence` stays empty.
  - P1/DG1: foundation (roles/scoped access skeleton, transformation creation, audit, bilingual shell).
  - P2/DG2: charter, diagnostic T01, baseline, value pools, outcome/KPI definitions T02, TOM canvas/gaps T03, capabilities/journeys, design decisions T04, gates G1–G3, modes (End-to-End/Modular entry).
  - P3/DG3: T05–T09, business case, formula foundations, prioritization, waves, resources, funding, dependencies, G4.
  - P4/DG4: KPI/benefit engines, T10–T16, forums/decisions/RACI/RAID, adoption, corrective actions, scheduled jobs, BAU handover, continuous improvement, G5–G6.
  - P5/DG5: Playbook Studio / configurable methodology, reports/exports, the 90-day launch plan, the 25-question health check, the source-grounded roaming demo.
  - P6/DG6: imports/integrations/hardening.
  - P7/DG7: handover.
- **Acceptance:** every row names at least one of A01–A28 (master prompt §20) plus a concrete pass condition. For example: "A01: T03 form persists all 6 source columns; a TOM gap row without a dimension is rejected by the API."
- **Permissions:** use the source roles: Executive Sponsor (SP), Transformation Lead (TL), Business Owner (BO), Workstream Lead (WL), Finance/Value Office (FIN), Transformation Office (TO). Also use the implementation roles: KPI/Data Steward (KDS), Tech/Data contributor (TD), committee member/secretary (CM/SEC), read-only auditor (AUD), system administrator (ADM).
- CSV must be valid RFC 4180: quote any field containing commas, quotes or newlines, and avoid newlines inside fields.

## Acceptance checks for your handback (the reviewers will verify these independently)
1. `source-coverage.csv` has exactly 165 data rows, B0001–B0165, with no duplicates.
2. Every REQUIREMENT block's `req_ids` exist in `req-pb.csv` and cite that block. Every `req-pb.csv` row cites ≥1 existing B block.
3. All T01–T16 columns appear verbatim in `input_fields`, and in `field-inventory.md`.
4. No row claims official PMI status. No invented source content.
5. The handback lists counts (rows, dispositions, rows per final_gate), anything uncertain, and the exact commands you ran to self-check (for example, a small Python CSV check that you run and paste the output of).

## Handback path
`docs/delivery/handbacks/DG0/T-DG0-AN-01-transformation-analyst.md`
