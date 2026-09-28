# Assignment T-DG0-AN-02: master prompt §1–§13 into requirements (transformation-analyst)

- **Stage:** P0 / DG0 (BUILDING). **Base revision:** `__BASE__` on `claude/mobily-transformation-platform-kwcc4i`. Verify it with `git rev-parse HEAD`.
- **Requirement IDs you create:** `REQ-S01-001` … `REQ-S13-NNN`. The area is the master-prompt section the requirement primarily comes from. You own only these areas.
- **Dependencies:** AN-01 is complete. Its SOURCE requirements are in `docs/analysis/parts/req-pb.csv` (IDs `REQ-PB-###`), with its handback at `docs/delivery/handbacks/DG0/T-DG0-AN-01-transformation-analyst.md`. AN-03 runs in parallel with you and covers the preamble, §0 and §14–§21 (areas DLV and S14–S21). Don't create IDs in those areas.

## Sources
- `docs/source/master-prompt.anchored.md`: master-prompt blocks. Your blocks are **M0075–M0255** (§1–§13), including every table row. The JSON form is `docs/source/master-prompt.blocks.json`.
- `docs/source/playbook.md`, the playbook, for grounding.
- `docs/delivery/requirements-spec.md`: the register format. Important: the status is `SPECIFIED`, never `VERIFIED`.
- `docs/delivery/agent-protocol.md` and `CLAUDE.md`.

## Permitted outputs (write guard enforced)
- `docs/analysis/parts/req-s01-s13.csv`: new register rows (same columns and header as `requirements-spec.md`).
- `docs/analysis/parts/mp-coverage-s01-s13.csv`: exactly one row per block M0075–M0255 (`block_id,disposition,req_ids,rationale`).
- `docs/analysis/parts/ref-additions-an02.csv`, with header `req_id,add_refs`. Use it when one of your blocks restates or elaborates content already captured by an existing `REQ-PB-###` requirement: map the block to that requirement and list the M anchor(s) here so the merge appends them to its `source_ref`. Don't edit `req-pb.csv`.
- `docs/analysis/permissions-matrix.md`: a role × record/action matrix. Roles are SP, TL, BO, WL, FIN, TO, KDS, TD, CM/SEC, AUD, ADM, with scope rules (organization / business unit / transformation / sensitive record), separation of duties, delegation, and "technical admins are not business approvers" (§10, §6, §16).
- `docs/analysis/user-journeys.md`: end-to-end journeys per role, for:
  - My Work;
  - each phase with its gate;
  - the modular-entry journey;
  - the KPI update ("open KPI → select period → enter/import actual and evidence → submit");
  - Finance validation;
  - the committee workflow;
  - the BAU handover;
  - administrator publishing (Draft → Preview/Test → Review → Publish).
  Each step must name its screen, its record and its guard condition.
- The handback, `docs/delivery/handbacks/DG0/T-DG0-AN-02-transformation-analyst.md`.

## Rules
- **Every block gets a disposition.**
  - REQUIREMENT: list the req IDs, and each one must cite the block (for new rows, via `source_ref`; for REQ-PB rows, via your ref-additions).
  - CONTEXT: a heading or explanation fully covered by named requirements. A rationale is required.
  - NON-REQUIREMENT: a rationale is required.
  - Table header rows are CONTEXT. Table data rows are normally REQUIREMENT.
- **Class:** USER for full in-platform operation, easy configuration, Mobily identity or transferable self-hosting. ENGINEERING for reliability, usability or deployability extensions. An S-area row may be SOURCE only if it cites at least one playbook `B####` block and is substantially grounded in the playbook. Otherwise prefer mapping the block to the existing REQ-PB row.
- **Granularity:** one row per distinct, testable capability. Preserve every normative detail in the requirement. Examples:
  - §4 gate submission fields and the gate statuses (Draft, Submitted, Under Review, Changes Requested, Approved, Rejected, Deferred), waivers, and material-change reapproval;
  - §7 KPI dictionary fields, polarity types, period vs cumulative, pp vs %, Unknown/Stale, RAG from trajectory, override rules, and prospective vs retrospective restatement;
  - §8 value states, the formula builder safety rule, the seeded examples, double counting and allocation ≤100%, and Finance validation contents;
  - §9 scorecard maths and the waves table;
  - §10 cadence, T11 and RACI tables, approvals, SoD, delegation and stale approvals;
  - §12 every starter automation row;
  - §13 the dashboard areas, exports, formula-injection neutralization, snapshots and the evidence repository.
- **Staging:** set `increments` and `final_gate` per master prompt §21 (the stage map in `docs/delivery/assignments/DG0/T-DG0-AN-01.md` applies). `final_gate` must not precede the last increment. The status is `SPECIFIED`. `evidence` is empty.
- **Acceptance:** at least one of A01–A28 plus a concrete, testable pass condition per row.
- Fill every column except `template_id`, `evidence` and `notes`. Keep CSV fields on one line and quote them per RFC 4180.
- Don't invent source content, and don't claim official PMI or Mobily-brand status.

## Self-check before handback (run these and paste the output)
1. Parse your CSVs with Python's `csv` module. Assert that coverage has exactly the 181 IDs M0075–M0255, and that every REQUIREMENT req_id exists (in your file or in `req-pb.csv`) and is cited (directly, or through your ref-additions).
2. Count the rows per area, class and final_gate.

## Handback path
`docs/delivery/handbacks/DG0/T-DG0-AN-02-transformation-analyst.md`
