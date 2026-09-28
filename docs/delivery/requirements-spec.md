# Requirement register specification

`docs/delivery/requirements.csv` is the single register. It's UTF-8 CSV (RFC 4180), with a header row and one row per requirement. `tools/gates/validate.mjs` checks it mechanically.

## Columns (in this order)

| Column | Rule |
|---|---|
| `req_id` | Unique. Pattern `REQ-<AREA>-<NNN>`. Areas: `PB` (playbook-grounded source requirement), `DLV` (master prompt §0 delivery protocol), `S01`…`S21` (master prompt section the requirement comes from). |
| `class` | `SOURCE` (grounded in the playbook, and `source_ref` must cite ≥1 `B####` block), `USER` (full in-platform operation, easy configuration, Mobily identity, transferable self-hosting) or `ENGINEERING` (reliability, usability, deployability extension). |
| `title` | A short imperative statement of the requirement. |
| `source_ref` | Semicolon-separated block anchors (`B0031;M0131`). SOURCE rows cite playbook blocks and may add master-prompt blocks. USER and ENGINEERING rows cite `M####` blocks. |
| `source_heading` | The playbook heading, template name or master-prompt section title. |
| `template_id` | `T01`…`T16`, `CHARTER`, `TOM-CANVAS`, `BIZCASE`, `LAUNCH90`, `HEALTH25`, `ROAMING-EX`, or empty. |
| `input_fields` | Semicolon-separated fields or inputs (preserve source column names verbatim for templates). |
| `procedure` | How the user or system performs it in the platform (short). |
| `output` | The record or deliverable produced. |
| `owner_roles` | The accountable or performing roles (source roles plus implementation roles). |
| `permissions` | Who may create, edit, approve or view, in short form (for example `create:WL,TL; approve:BO; view:scoped`). |
| `automation` | The relevant automation or trigger, or `none`. |
| `screen_api` | The screen or navigation area and API resource (planned names are acceptable before P1). |
| `acceptance` | The acceptance scenario IDs (`A01`…`A28`) plus a concrete, testable pass condition. |
| `increments` | The stages that implement parts of it, semicolon-separated (`P2;P4`). |
| `final_gate` | Exactly one of `DG0`…`DG7`: the gate at which it must be fully VERIFIED. |
| `status` | `PLANNED` → `SPECIFIED` → `IMPLEMENTED` → `VERIFIED`, or `BLOCKED` (with `notes` naming the exact missing dependency). |
| `evidence` | Semicolon-separated test IDs or evidence paths once they exist. Empty while PLANNED or SPECIFIED. |
| `notes` | Assumptions, and labels such as `implementation-assumption` or `extension`. |

## Coverage matrices

- `docs/analysis/source-coverage.csv`: columns `block_id,disposition,req_ids,rationale`. It has exactly one row per playbook block `B0001`–`B0165`.
- `docs/analysis/master-prompt-coverage.csv`: the same columns, with exactly one row per master-prompt block `M0001`–`M0423`.

Disposition values:

| Disposition | Rule |
|---|---|
| `REQUIREMENT` | `req_ids` lists existing register IDs. Each listed requirement must cite this block in its `source_ref`. |
| `CONTEXT` | Explanatory or heading text whose substance is covered by the requirements that cite its section. `rationale` is required. |
| `NON-REQUIREMENT` | Cover text, version stamps, reference URLs. `rationale` is required. |

## Gate rules the validator applies

- **DG0:**
  - Every register row has all columns except `evidence` filled.
  - Every row is at least `SPECIFIED`, and `DLV` rows assigned to DG0 are `VERIFIED`.
  - Both coverage matrices are complete and consistent in both directions.
  - Every SOURCE row cites a playbook block.
  - Every A01–A28 scenario is referenced by at least one requirement.
- **DGn (n ≥ 1):** every row with `final_gate = DGn` is `VERIFIED` with non-empty `evidence`, and every row with `final_gate < DGn` stays `VERIFIED`.
