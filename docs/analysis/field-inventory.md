# Field inventory: playbook templates and first-class source deliverables

- **Task:** T-DG0-AN-01 (transformation-analyst), stage P0/DG0.
- **Status:** SPECIFIED. This is an analysis artefact, not a delivered feature.
- **Source:** `docs/source/playbook.md` v1.0 (September 2026). Block IDs are cited for every field.

The source is a *practical synthesis inspired by* PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management, extended with a custom Target Operating Model toolkit (B0004). Nothing here claims official PMI status.

## Conventions

- **Source field (verbatim):** the exact column/field name from the playbook. Placeholder cell text such as `[Describe]` is recorded as help text, not as a value.
- **Type:** one of:
  - text
  - rich text
  - number
  - currency SAR (decimal, currency configurable)
  - percentage (stored as a fraction, e.g. 25% = 0.25)
  - date
  - reference→entity
  - choice (with source values)
  - person/role
  - attachment
  - calculated
- **Req.:** R = required to submit (a draft can always be saved incomplete), O = optional, C = conditional.
- **Interpretation:** marks a platform decision the source does not give. Where the note says "see master prompt §N", that section supplies the detail. It is **not** presented as source content.
- **Roles:** source roles are SP Executive Sponsor, TL Transformation Lead, BO Business Owner, WL Workstream Lead, FIN Finance/Value Office and TO Transformation Office. Implementation roles (master prompt §10, not source) are KDS KPI/Data Steward, TD Tech/Data contributor, CM committee member, SEC committee secretary, AUD read-only auditor and ADM system administrator.
- **Common system fields (every record):** these are not listed per table. They are:
  - id
  - transformation reference
  - version
  - created/updated by and at
  - audit trail
  - language-neutral stable key
  
  They are implementation fields (master prompt §16), not source fields.

---

## T01 — Current-State Diagnostic (B0030, B0031) → REQ-PB-026

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Dimension | B0031 | choice | R | Seeded values: Financial, Customer, Process, People / Org, Technology, Data (configurable additions) | The six source rows are pre-seeded per transformation |
| 2 | Current state | B0031 | rich text | R | non-empty | Help: "[Describe]" |
| 3 | Evidence / baseline | B0031 | reference→Baseline + attachment + text | R | at least a metric/source or evidence item | Help: "[Metric / source]" for Financial/Customer/Process; "[Evidence]" for People / Org, Technology, Data |
| 4 | Root cause | B0031 | rich text | R | non-empty | Help: "[Why?]"; supports health-check Q7 (root causes vs symptoms) |
| 5 | Impact | B0031 | text + optional currency SAR / reference→KPI | R | when a SAR amount is given it is a decimal | Help: "[SAR / KPI]" (Financial), "[KPI]" (Customer, Process), "[Impact]" (others) |
| 6 | Confidence | B0031 | choice | R | H / M / L | |

## T02 — Outcome & KPI Tree (B0049, B0050, B0048) → REQ-PB-032, REQ-PB-034, REQ-PB-036

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Outcome | B0050 | reference→Outcome (text) | R | passes the good outcome test (B0051), see REQ-PB-036 | "[Outcome 1]"…"[Outcome 4]" |
| 2 | KPI | B0050 | reference→KPI | R | KPI exists in dictionary | KPI dictionary detail is master prompt §7 |
| 3 | Baseline | B0050 | number / reference→Baseline | R | numeric, unit matches KPI; missing = Unknown, never 0 | "[x]" |
| 4 | Target | B0050 | number | R | numeric, unit matches KPI | "[y]" |
| 5 | Target date | B0050 | date | R | valid date after baseline date | Targets are "Time-bound ambition" (B0048) |
| 6 | Owner | B0050 | person/role | R | a business leader (B0051) | |
| 7 | Leading indicator | B0050 | reference→KPI (leading) or text | R | | |

### Outcome hierarchy (B0048) → REQ-PB-032

| Level (verbatim) | Definition (verbatim) | Example (verbatim) | Type |
|---|---|---|---|
| North Star | Concise description of the desired future business state. | "Make roaming effortless, trusted and economically accretive." | text (one sentence, one active per transformation, REQ-PB-033) |
| Strategic Outcomes | What must improve for the North Star to be true. | Revenue growth, activation, customer experience, partner economics. | reference→Outcome (parent: North Star) |
| KPIs | Measures proving outcome movement. | Roaming revenue, attach rate, complaint rate, digital activation. | reference→KPI (parent: Outcome) |
| Targets | Time-bound ambition. | +X% revenue by Q4; -Y% complaints. | number + date (on KPI target) |
| Initiative Contribution | How each initiative moves one or more outcomes. | New pass architecture → attach rate + ARPU. | reference→Initiative ↔ Outcome/KPI with contribution text |

Good outcome test (B0051), shown as checks on each outcome (REQ-PB-036):
- Specific
- measurable
- strategically relevant
- owned by a business leader
- achievable through a defined causal chain

An outcome that is not just "launch", "implement" or "deliver" is the source intent. **Interpretation:** keyword flagging (see master prompt §5).

## T03 — TOM Gap Matrix (B0057, B0058) → REQ-PB-039

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | TOM dimension | B0058 | choice (one of the 10 TOM dimensions, B0056) | R | must be a seeded dimension; API rejects a missing dimension | |
| 2 | Current state | B0058 | rich text | R | | "[Today]" |
| 3 | Target state | B0058 | rich text | R | | "[Future]" |
| 4 | Gap | B0058 | rich text | R | | "[Gap]"; linkable to capabilities, initiatives (traceability B0070) |
| 5 | Design decision | B0058 | reference→Decision (T04) | O | | "[Decision]"; required before G3 if the gap is unresolved (interpretation) |
| 6 | Owner | B0058 | person/role | R | | "[Owner]" |

## T04 — Design Decision Log (B0064, B0065) → REQ-PB-043

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | ID | B0065 | text (system-generated) | R | pattern `D-NN` (D-01, D-02, …) | Unique per transformation |
| 2 | Decision required | B0065 | text | R | | |
| 3 | Options | B0065 | list of text (labels A / B / C …) | R | at least 2 options (interpretation) | Source shows "A / B / C" |
| 4 | Recommendation | B0065 | reference→option + rationale text | O | must reference an existing option | "[Rec.]" |
| 5 | Decision owner | B0065 | person/role | R | | |
| 6 | Due | B0065 | date | R | valid date | |
| 7 | Status | B0065 | choice | R | seeded: Open (default); further states (Decided, Deferred, Cancelled) are interpretation | Source shows only "Open" |

## T05 — Initiative Card (B0071, B0072) → REQ-PB-045, REQ-PB-046

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Initiative name | B0072 | text | R | unique within transformation | |
| 2 | Executive owner | B0072 | person/role | R | | "[Name / role]" |
| 3 | Workstream lead | B0072 | person/role | R | | "[Name / role]" |
| 4 | Problem / gap addressed | B0072 | reference→T01 row / T03 gap (multi) | R | ≥1 link to submit (REQ-PB-046) | "[Reference diagnostic/TOM gap]" |
| 5 | Objective | B0072 | rich text | R | | "[What will change?]" |
| 6 | Scope | B0072 | rich text (In / Out) | R | both in and out parts | "[In/out]" |
| 7 | Key deliverables | B0072 | list of reference→Deliverable | R | warn if count outside 3–7 (interpretation: warn, not block) | "[3-7 deliverables]" |
| 8 | Outcome/KPI contribution | B0072 | reference→Outcome/KPI with contribution text | R | ≥1 link to submit | "[Outcome + KPI]" |
| 9 | Financial benefit | B0072 | reference→Benefit (T14) + classification | O | classification: Revenue / cost / avoided cost / capital efficiency | "[Revenue / cost / avoided cost / capital efficiency]" |
| 10 | Customer benefit | B0072 | reference→Benefit / KPI + text | O | | "[CX / complaints / NPS / adoption]" |
| 11 | Dependencies | B0072 | reference→Dependency (T08, canonical) | O | | "[Teams / systems / vendors / decisions]" |
| 12 | Risks | B0072 | reference→RAID Risk (T15) | O | | "[Top risks]" |
| 13 | Milestones | B0072 | list (name, date) | R | valid dates | "[Dates]" |
| 14 | Required decisions | B0072 | reference→Decision (decision + owner + date) | O | each has owner and date | "[Decision + owner + date]" |

## T06 — Prioritization Scorecard (B0075, B0076, B0077) → REQ-PB-047, REQ-PB-048, REQ-PB-049

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Initiative | B0076 | reference→Initiative | R | | "[A]"…"[D]" |
| 2 | Strategic fit (25%) | B0076 | number (integer score) | R | 1–5 | Default weight 0.25 |
| 3 | Financial value (25%) | B0076 | number | R | 1–5 | Default weight 0.25 |
| 4 | Customer impact (20%) | B0076 | number | R | 1–5 | Default weight 0.20 |
| 5 | Feasibility (15%) | B0076 | number | R | 1–5 | Default weight 0.15 |
| 6 | Time-to-value (15%) | B0076 | number | R | 1–5 | Default weight 0.15 |
| 7 | Weighted score | B0076 | calculated (decimal) | — | read-only | "[calc]". **Interpretation (master prompt §9):** Σ(score × weight) on a 1–5 scale; a missing score means incomplete, not zero |
| — | Weight (per criterion) | B0077 | percentage (fraction) | R | **interpretation (§9):** total = 100%; versioned | "Adjust weights to the transformation context"; risk/compliance may replace part of the weighting |

## T07 — Wave Roadmap (B0078, B0079) → REQ-PB-050

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Wave | B0079 | text | R | unique per transformation | Seeds: "Wave 0 — Mobilize", "Wave 1 — Prove", "Wave 2 — Scale", "Wave 3 — Embed" |
| 2 | Purpose | B0079 | text | R | | Seeds: "Baseline, governance, design decisions"; "Quick wins / pilots / de-risking"; "Scale validated changes"; "BAU integration / optimization" |
| 3 | Typical horizon | B0079 | text + optional start/end offsets | R | offsets may overlap between waves | Seeds: "0-6 weeks"; "1-3 months"; "3-9 months"; "6-18 months" |
| 4 | Entry criteria | B0079 | text/checklist | R | | Seeds: "Sponsor + charter"; "Prioritized initiatives"; "Evidence + capacity"; "Stable solution" |
| 5 | Exit evidence | B0079 | text/checklist + reference→Evidence | R | | Seeds: "Approved case, owners, stage gates"; "Measured pilot results"; "Adoption + KPI movement"; "Benefits sustained, ownership transferred" |

Linked initiatives, dates and milestones are master prompt §5 additions, carried by T05 milestones.

## T08 — Dependency Map (B0080, B0081) → REQ-PB-051, REQ-PB-052

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Dependency | B0081 | text (+ system ID) | R | | "[D1]" |
| 2 | From | B0081 | reference→Initiative or "External" | R | | Source shows "Initiative A", "Initiative C", "External" |
| 3 | To | B0081 | reference→Initiative | R | From ≠ To; no cycles (§9) | |
| 4 | Type | B0081 | choice | R | Decision / Tech / Data / Vendor + configurable | |
| 5 | Needed by | B0081 | date | R | valid date | "[Date]" |
| 6 | Owner | B0081 | person/role | R | | |
| 7 | Status / mitigation | B0081 | choice (status) + text (mitigation) | R | status list is interpretation (Open/At risk/Resolved) | "[Status]". This is the canonical record also shown as a RAID Dependency |

## T09 — Benefit Formula (B0086, B0087) → REQ-PB-056, REQ-PB-057

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Benefit | B0087 | reference→Benefit (T14) | R | | |
| 2 | Baseline driver | B0087 | text + typed variables | R | variables have units | e.g. "Customers × attach rate × ARPU"; "Volume × unit cost" |
| 3 | Change assumption | B0087 | text + typed variable | R | | e.g. "Attach +X pp"; "Unit cost -X%". pp is distinct from % |
| 4 | Formula | B0087 | calculated (restricted expression) | R | parse-valid, no undefined variables, unit-consistent (§8) | e.g. "Δ attach × customers × ARPU"; "Volume × Δ unit cost" |
| 5 | Ramp | B0087 | text / period range | R | | e.g. "Q1-Q4", "Q2-Q3" |
| 6 | Confidence | B0087 | choice | R | H/M/L | Seeds: M (revenue), H (cost) |

Seeded examples (illustrative):
- Revenue uplift
- Cost reduction

**Interpretation (§8):** rates are stored as fractions.

## T10 — Executive Transformation Dashboard (B0094, B0095) → REQ-PB-062, REQ-PB-063, REQ-PB-064

The dashboard is a calculated view. Its "fields" are the areas.

| # | Area (verbatim) | What to show (verbatim) | RAG logic (verbatim) | Type | Notes |
|---|---|---|---|---|---|
| 1 | Outcomes | Actual vs baseline vs target; trend | RAG based on target trajectory, not activity completion | calculated | Thresholds are interpretation (§7); missing = Unknown/Stale |
| 2 | Value | Realized / forecast benefit; investment | RAG based on validated benefit gap | calculated (currency SAR) | Unvalidated values labelled pending |
| 3 | Portfolio | Top initiatives by value/criticality | RAG by milestone + outcome risk | calculated | |
| 4 | Dependencies | Top cross-functional blockers | RAG by decision date / critical path | calculated | Critical path needs defined scheduling logic (§9) |
| 5 | Decisions | Decision needed, owner, due date, impact of delay | Red if executive decision overdue | calculated | Hard rule, REQ-PB-064 |
| 6 | People & adoption | Usage/adoption/capability signals | RAG vs adoption curve | calculated | |

Source column names are Area, What to show and RAG logic.

## T11 — Decision Rights Matrix (B0098, B0099) → REQ-PB-065, REQ-PB-066

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Decision | B0099 | text (decision type) | R | unique | |
| 2 | Recommend | B0099 | person/role (multi) | R | | |
| 3 | Approve | B0099 | person/role or forum | R | exactly one approving authority (interpretation) | |
| 4 | Consult | B0099 | person/role (multi) | O | | |
| 5 | Inform | B0099 | person/role (multi) | O | | |
| 6 | SLA | B0099 | choice of type + number | R | types: working days \| next forum ("Next SteerCo / urgent route") \| "Per release plan" | Working-day calendar Asia/Riyadh default (§10) |

Seeded rows (verbatim):

| Decision | Recommend | Approve | Consult | Inform | SLA |
|---|---|---|---|---|---|
| Business scope change | Transformation Lead | Sponsor | Business owners / Finance | Workstreams | 5 working days |
| Funding reallocation | Transformation Lead + Finance | SteerCo | Initiative owners | PMO | Next SteerCo / urgent route |
| Target-state design | Design owner | Business owner | Tech / Ops / CX / Finance | Transformation Office | 10 working days |
| Go-live / scale | Initiative owner | Business owner | Risk / Tech / CX | SteerCo | Per release plan |

## T12 — RACI (B0100, B0101) → REQ-PB-067

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Deliverable | B0101 | text / reference→deliverable type | R | unique | |
| 2 | Sponsor | B0101 | choice | O | A, R, C, I, A/R | Role maps to named people (§10) |
| 3 | Transformation Lead | B0101 | choice | O | same | |
| 4 | Business Owner | B0101 | choice | O | same | |
| 5 | Workstream Lead | B0101 | choice | O | same | |
| 6 | Finance | B0101 | choice | O | same | |
| 7 | Tech/Data | B0101 | choice | O | same | |

Seeded rows:

| Deliverable | Sponsor | Transformation Lead | Business Owner | Workstream Lead | Finance | Tech/Data |
|---|---|---|---|---|---|---|
| Charter | A | R | C | I | C | I |
| Target Operating Model | C | R | A | C | C | C |
| Business Case | A | R | C | C | R | C |
| Initiative Delivery | I | C | A | R | C | C |
| Benefits Validation | I | C | A | C | R | I |
| BAU Handover | I | C | A/R | R | C | C |

**Interpretation (§10):** one A per deliverable.

## T13 — Stakeholder & Adoption Plan (B0106, B0107) → REQ-PB-070

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | Stakeholder | B0107 | text / reference→stakeholder group | R | | "[Group]" |
| 2 | Impact | B0107 | choice | R | H/M/L | |
| 3 | Current stance | B0107 | choice | R | Support / Neutral / Resist | |
| 4 | Required behavior | B0107 | text | R | | "[Behavior]" |
| 5 | Intervention | B0107 | choice (multi) + text | R | Comms / training / involvement / incentive | |
| 6 | Owner | B0107 | person/role | R | | |
| 7 | Adoption KPI | B0107 | reference→KPI | R | | Usually one of the seven leading indicators |

## T14 — Benefits Register (B0122, B0123) → REQ-PB-075, REQ-PB-076, REQ-PB-058

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | ID | B0123 | text (system) | R | pattern `BNN` (B01, B02, …) | Unique; distinct from playbook block IDs |
| 2 | Benefit | B0123 | text | R | | |
| 3 | Type | B0123 | choice | R | seeded: Revenue, Cost, CX (configurable, e.g. avoidance, working capital from B0085) | |
| 4 | Baseline | B0123 | number / reference→Baseline | R | missing = Unknown | "[x]" |
| 5 | Target | B0123 | number | R | | "[y]" |
| 6 | Value (SAR) | B0123 | currency SAR, or n/a | C | required for financial types; n/a allowed for non-financial (CX) | |
| 7 | Realized | B0123 | currency SAR or KPI actual (calculated from accepted actuals) | — | pending until Finance validation | "[Actual]" for CX |
| 8 | Owner | B0123 | person/role | R | exactly one owner (B0088) | |
| 9 | Evidence | B0123 | reference→Evidence / attachment | C | required for realized value | "[Source]" |
| 10 | Status | B0123 | choice | R | R/A/G (calculated with manual override rules, §7) | |

## T15 — RAID (B0127, B0128) → REQ-PB-079, REQ-PB-080

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | ID | B0128 | text (system) | R | prefix by type: R01 / A01 / I01 / D01 | |
| 2 | Type | B0128 | choice | R | Risk / Assumption / Issue / Dependency | Dependency rows reference the canonical T08 record |
| 3 | Description | B0128 | text | R | | |
| 4 | Impact | B0128 | choice | R | H/M/L | |
| 5 | Probability | B0128 | choice | C | H/M/L for Risk; n/a for Assumption, Issue, Dependency | REQ-PB-080 |
| 6 | Owner | B0128 | person/role | R | | |
| 7 | Due | B0128 | date | R | | |
| 8 | Mitigation / action | B0128 | text | R | | Source hints: [Action], [Validate], [Resolve], [Mitigate] |
| 9 | Status | B0128 | choice | R | Open (default); further states are interpretation | |

## T16 — Executive Decision Log (B0129, B0130) → REQ-PB-081, REQ-PB-068, REQ-PB-082

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes |
|---|---|---|---|---|---|---|
| 1 | ID | B0130 | text (system) | R | pattern `DEC-NN` | |
| 2 | Decision | B0130 | text | R | | |
| 3 | Why now | B0130 | text | R | | "[Trigger]" |
| 4 | Options | B0130 | list of text | R | A/B/C | |
| 5 | Rec. | B0130 | reference→option + text | R | | Recommendation (B0102 requires it on agenda items) |
| 6 | Owner | B0130 | person/role (executive) | R | | "[Exec]" |
| 7 | Decision date | B0130 | date | R | due date until decided | Overdue → T10 Decisions Red |
| 8 | Impact if delayed | B0130 | text | R | | |
| 9 | Outcome | B0130 | text / reference→chosen option | C | required to close | "[Decision]" |

Governance rule (B0102): every executive agenda item requires:
- decision required
- options
- recommendation
- impact of delay
- decision owner

---

## Transformation Charter (B0034, B0035) → REQ-PB-029

| # | Source field (verbatim) | Block | Type | Req. | Validation | Notes (source fill-in hint) |
|---|---|---|---|---|---|---|
| 1 | Transformation name | B0035 | text | R | unique within organization | [Name] |
| 2 | Executive sponsor | B0035 | person/role | R | | [Name / role] |
| 3 | Transformation lead | B0035 | person/role | R | | [Name / role] |
| 4 | Case for change | B0035 | rich text | R | | [What is happening and why now?] |
| 5 | North Star | B0035 | text | R | one sentence; single active (REQ-PB-033) | [One sentence describing the future outcome] |
| 6 | In scope | B0035 | rich text + references | R | | [Businesses / products / journeys / geographies / capabilities] |
| 7 | Out of scope | B0035 | rich text | R | non-empty (scope sanity check B0041) | [Explicit exclusions] |
| 8 | Baseline date | B0035 | date | R | valid date; displayed DD/MM/YYYY per locale | [DD/MM/YYYY] |
| 9 | Target horizon | B0035 | text / duration (number + unit) | R | | [e.g., 18 months] |
| 10 | Top 3-5 outcomes | B0035 | reference→Outcome (multi; each Outcome + KPI + target) | R | warn outside 3–5 (REQ-PB-035) | [Outcome + KPI + target] |
| 11 | Strategic guardrails | B0035 | list of reference→Guardrail | R | | [Non-negotiables: regulatory, CX, capex, risk, brand, etc.] |
| 12 | Governance forum | B0035 | reference→Forum | R | | [SteerCo / executive committee] |
| 13 | Decision rights | B0035 | rich text + reference→T11 | R | | [What can workstreams decide vs sponsor?] |
| 14 | Success definition | B0035 | rich text | R | | [What evidence proves transformation succeeded?] |

### Transformation thesis (B0036, B0037) → REQ-PB-030

| # | Part (source placeholder) | Type | Req. |
|---|---|---|---|
| 1 | If we change [capabilities / journeys / operating model] | text | R |
| 2 | then [customer/operational outcomes] will improve | text / reference→Outcome | R |
| 3 | which will create [financial/strategic benefits] | text / reference→Benefit | R |
| 4 | because [evidence / causal logic] | rich text + reference→Evidence | R |

### Five scope sanity checks (B0038–B0043) → REQ-PB-031

| # | Check (verbatim) | Block | Type | Notes |
|---|---|---|---|---|
| 1 | Is scope tied to outcomes rather than departments? | B0039 | choice + evidence text | response scale is interpretation (§5) |
| 2 | Can each major scope item be traced to a diagnosed problem or opportunity? | B0040 | choice + evidence | system pre-check: scope items linked to T01 |
| 3 | Are explicit exclusions documented? | B0041 | choice + evidence | system pre-check: Out of scope non-empty |
| 4 | Is the baseline measurable? | B0042 | choice + evidence | system pre-check: baselines have values/sources |
| 5 | Are executive decisions required to unblock the transformation visible? | B0043 | choice + evidence | system pre-check: open T16 asks listed |

## TOM: 10 dimensions (B0056) and canvas prompts (B0062) → REQ-PB-038, REQ-PB-041

The canvas box labels differ slightly from the dimension names. Both are preserved and mapped one-to-one.

| # | Dimension (B0056, verbatim) | Design question (B0056, verbatim) | Canvas box (B0062) | Canvas prompt (B0062, verbatim) | Type |
|---|---|---|---|---|---|
| 1 | Customer & Value Proposition | What experience/value should customers receive? | CUSTOMER & VALUE | Segments / needs / promise / experience principles | rich text |
| 2 | Products & Services | What portfolio, pricing, features and service model are required? | PRODUCTS & SERVICES | Portfolio / bundles / pricing / service model | rich text |
| 3 | Journeys & Processes | What end-to-end journeys/processes must change? | JOURNEYS & PROCESSES | Critical E2E journeys / automation / controls | rich text |
| 4 | Organization | What structure, roles and accountabilities are needed? | ORGANIZATION | Structure / role clarity / accountability | rich text |
| 5 | Governance & Decision Rights | Who decides what, at what level, using what forums? | GOVERNANCE | Decision rights / forums / escalation | rich text |
| 6 | People & Capabilities | What skills, capacity, behaviors and incentives are required? | PEOPLE & CAPABILITY | Skills / capacity / incentives / behaviors | rich text |
| 7 | Technology | What platforms, systems and integration are required? | TECHNOLOGY | Platforms / architecture / integration | rich text |
| 8 | Data & Analytics | What data, metrics, models and ownership are needed? | DATA & ANALYTICS | Sources / ownership / insight / AI / measurement | rich text |
| 9 | Partners & Sourcing | What should be built, bought, outsourced or partnered? | PARTNERS & SOURCING | Partner model / vendors / build-buy-partner | rich text |
| 10 | Performance Management | How will KPIs, benefits and continuous improvement be managed? | PERFORMANCE | KPIs / benefits / management cadence / CI | rich text |

Each canvas box holds "[Write target-state design here]" (help text).

The workshop record (B0063, REQ-PB-042) holds:

| Field | Type | Req. | Notes |
|---|---|---|---|
| workshop date | date | R | |
| duration | number (minutes) | R | guidance 90-120 |
| participants | person (multi) | R | must include business owners |
| contributions | text per box | O | |
| unresolved items | list | O | converted to a T04 decision with owner |

## Transformation Business Case (B0083–B0085) → REQ-PB-053, REQ-PB-054, REQ-PB-055

| # | Section (verbatim) | Content (verbatim) | Type | Req. | Validation / notes |
|---|---|---|---|---|---|
| 1 | Strategic rationale | Why now; linkage to strategy; external/internal trigger. | rich text | R | |
| 2 | Baseline | Revenue, cost, customer, operational and capability baseline. | reference→Baseline (multi) | R | Finance validation before G4 (B0084) |
| 3 | Value pools | Quantified upside/downside by driver. | reference→Value pool (multi) | R | |
| 4 | Interventions | Initiatives and target-state changes required. | reference→Initiative / TOM gap | R | |
| 5 | Investment | Capex, opex, internal FTE, vendor cost, opportunity cost. | line items: currency SAR (FTE: number) + choice classification | R | each line exactly one classification (no duplicate treatment, §5) |
| 6 | Benefits | Revenue uplift, cost reduction, avoidance, working capital, strategic/non-financial. | reference→Benefit (T14) + classification | R | no double counting (B0088) |
| 7 | Timing | Benefit ramp, one-off vs recurring, implementation horizon. | ramp periods + choice (one-off / recurring) + duration | R | |
| 8 | Risks & sensitivities | Key assumptions, downside/upside cases. | rich text + reference→RAID Assumptions + scenario values | R | |
| 9 | Ownership | Benefit owner, initiative owner, Finance validator. | person/role ×3 | R | Finance validator holds FIN |
| 10 | Decision ask | Funding / policy / resource / prioritization decision needed. | choice (Funding / policy / resource / prioritization) + text + reference→Decision | R | |

The case level (Transformation | Initiative) is a choice. The parent case is a reference (B0084).

## Operating system layers (B0093) → REQ-PB-060, REQ-PB-061

| # | Layer | Cadence | Purpose | Participants | Outputs |
|---|---|---|---|---|---|
| 1 | Executive SteerCo | Monthly | Outcomes, major trade-offs, funding, escalation | Sponsor + CxOs + Transformation Lead | Decisions, unblockers, benefit view |
| 2 | Transformation Review | Bi-weekly | Portfolio health, dependencies, risks, decisions | Transformation Lead + workstream leads | Integrated status, decision log |
| 3 | Workstream Review | Weekly | Delivery, issues, actions | Workstream lead + team | Milestones, actions, RAID |
| 4 | Rapid Response / Sprint | Daily / 2-3x week | Solve high-priority cross-functional issue | Small empowered team | Test, evidence, recommendation |
| 5 | Value Review | Monthly | Validate realized benefits vs plan | Finance + benefit owners | Benefit evidence, forecast, corrective action |

Field types for the forum record:

| Field | Type |
|---|---|
| Layer | text |
| Cadence | choice + recurrence rule |
| Purpose | text |
| Participants | person/role (multi) |
| Outputs | list of reference→ (decisions, actions, RAID, evidence, benefit forecasts) |

## Benefits lifecycle (B0121) → REQ-PB-074

| # | Step | Question (verbatim) | Output (verbatim) | Output type |
|---|---|---|---|---|
| 1 | Identify | What benefit should this change create? | Benefit profile | T14 record |
| 2 | Plan | How will it be measured, when, and by whom? | Baseline, formula, target, owner | T09 formula + T14 fields |
| 3 | Enable | What capability/deliverable must exist first? | Benefit dependency chain | reference→deliverable/capability (traceability B0070) |
| 4 | Measure | Is the benefit appearing in actual performance? | Evidence / actuals | KPI actuals + evidence |
| 5 | Correct | What action is needed if benefit is off track? | Recovery plan | corrective action record (REQ-PB-085) |
| 6 | Sustain | Who owns the metric after transformation closure? | BAU owner + control cadence | BAU handover (REQ-PB-083) |

## Leading adoption indicators (B0109–B0115) → REQ-PB-071, REQ-PB-072

| # | Indicator (verbatim) | Block | Type (KPI template) | Notes |
|---|---|---|---|---|
| 1 | Usage / activation rate | B0109 | percentage (fraction) | |
| 2 | Compliance with new process | B0110 | percentage (fraction) | |
| 3 | Cycle-time shift | B0111 | number (duration delta) | polarity lower-is-better (interpretation) |
| 4 | Training completion + observed proficiency | B0112 | two measures: percentage + observed proficiency | tracked separately (REQ-PB-072) |
| 5 | Decision turnaround time | B0113 | number (working days) | |
| 6 | Percentage of transactions handled through the new journey | B0114 | percentage (fraction) | |
| 7 | Exception / workaround rate | B0115 | percentage (fraction) | lower-is-better (interpretation) |

## 90-day launch plan (B0134) → REQ-PB-086

| # | Window | Primary objective | Actions (verbatim) | Outputs (verbatim) |
|---|---|---|---|---|
| 1 | Days 0-30 | Diagnose & align | Confirm sponsor; build baseline; interview stakeholders; map journeys/processes; quantify value pools; establish initial governance. | Charter v0.9; diagnostic; baseline; issue tree; governance. |
| 2 | Days 31-60 | Define & design | Agree North Star/outcomes; build KPI tree; design TOM; run design decisions; identify initiatives; size benefits. | North Star; KPI tree; TOM; initiative backlog; initial business case. |
| 3 | Days 61-90 | Mobilize & prove | Prioritize portfolio; assign owners; sequence roadmap; launch Wave 1 pilots; establish benefits register and executive dashboard. | Roadmap; initiative cards; dashboard; benefits register; Wave 1 evidence. |

Generated task fields:

| Field | Type | Notes |
|---|---|---|
| window | choice | |
| action | text | |
| owner | person/role | |
| start date | date | plan start date + offset |
| due date | date | |
| required output | reference→ target record type | |
| dependency | reference→task | |

### Day-90 leadership test (B0136–B0141) → REQ-PB-087

| # | Question (verbatim) | Block | Type |
|---|---|---|---|
| 1 | Can leaders explain the same case for change and North Star? | B0136 | choice + evidence |
| 2 | Can every initiative be traced to a target-state gap and outcome? | B0137 | choice + evidence (system pre-check: orphan report) |
| 3 | Are executive decision rights clear? | B0138 | choice + evidence (pre-check: T11 complete) |
| 4 | Is Finance aligned on baselines and benefit formulas? | B0139 | choice + evidence (pre-check: validation statuses) |
| 5 | Are Wave 1 initiatives producing evidence rather than only plans? | B0140 | choice + evidence |
| 6 | Can the transformation team show what it needs from executives this month? | B0141 | choice + evidence (pre-check: open T16 asks) |

## Roaming worked example (B0145, B0147) → REQ-PB-088, REQ-PB-089, REQ-PB-090

Illustrative example only (B0144). All seeded values are synthetic.

| # | Element (verbatim) | Illustrative content (verbatim) | Target record |
|---|---|---|---|
| 1 | Case for change | Roaming has value leakage from low adoption, fragmented propositions, inconsistent digital activation and avoidable CX friction. | Charter.Case for change |
| 2 | North Star | Make international roaming effortless, trusted and economically accretive. | Charter.North Star |
| 3 | Outcomes | Revenue growth; higher attach/activation; improved partner economics; fewer complaints; higher digital self-service. | T02 outcomes |
| 4 | TOM focus | Product/pricing, digital journey, partner management, network/service assurance, data/personalization, care operations, governance. | T03 gaps / canvas |
| 5 | Initiatives | Pass architecture redesign; digital activation; proactive travel triggers; partner-cost optimization; QoS monitoring; care simplification; analytics. | T05 cards |
| 6 | Governance | Monthly executive review; bi-weekly transformation review; weekly workstreams; monthly value review with Finance. | Forums |
| 7 | Benefits | Incremental roaming revenue, margin improvement, complaint reduction, digital adoption, avoided care cost. | T14 rows (distinct classifications) |

Illustrative traceability (B0147). Columns: Problem, TOM gap, Initiative, KPI, Benefit.

| Problem | TOM gap | Initiative | KPI | Benefit |
|---|---|---|---|---|
| Low activation | Proposition + journey | Pass redesign + digital activation | Attach rate / activation | Revenue uplift |
| High complaints | Journey + service assurance | Proactive comms + QoS monitoring | Complaint rate | CX + care cost |
| Partner cost pressure | Partner model + analytics | Partner optimization | Cost/MB, margin | Margin improvement |

## Health check (B0150) and bands (B0152) → REQ-PB-091, REQ-PB-092

Per-question fields:

| Field | Type | Req. | Notes |
|---|---|---|---|
| question number | number 1–25 | — | |
| question text (verbatim) | text (read-only) | — | |
| response | choice | R | **Interpretation (§14):** Yes=1 / No=0; the source shows a checkbox "☐" |
| evidence | attachment / reference / text | O | |
| owner | person/role | O | |
| action | text | O | |

Per-assessment fields:

| Field | Type | Req. | Notes |
|---|---|---|---|
| assessment date | date | R | |
| assessor | person | R | |
| Score | calculated | — | "____ / 25". Incomplete when any response is missing |
| Top 3 actions | 3 × text/reference→action | R | |

Questions (verbatim, B0150):
1. Is there a quantified case for change?
2. Is the baseline trusted by Finance?
3. Is there one clear North Star?
4. Are 3-5 business outcomes measurable?
5. Are outcomes owned by business leaders?
6. Is the customer perspective explicit?
7. Have root causes been separated from symptoms?
8. Is there a defined Target Operating Model?
9. Are decision rights explicit?
10. Are capability gaps visible?
11. Can every initiative be traced to a TOM gap?
12. Can every initiative be traced to an outcome?
13. Are benefits quantified without double counting?
14. Are dependencies integrated across workstreams?
15. Is sequencing based on value and feasibility?
16. Do executive forums make decisions rather than review slides?
17. Are overdue decisions visible?
18. Are workstreams empowered within clear boundaries?
19. Are adoption metrics tracked?
20. Are frontline/business teams involved in design?
21. Are benefits validated with evidence?
22. Is BAU ownership defined before closure?
23. Is a continuous-improvement backlog retained?
24. Are lessons reused across transformations?
25. Can leadership state what support the transformation needs now?

Bands (B0152, verbatim):

| Score | Interpretation |
|---|---|
| 21-25 | Strong transformation discipline; focus on value acceleration and continuous improvement. |
| 16-20 | Solid foundation; address a few structural gaps before scaling. |
| 10-15 | Execution risk is material; strengthen direction, TOM, governance or benefits. |
| 0-9 | Transformation is likely being managed as disconnected projects; reset around outcomes and operating model. |

## Minimum governance roles (B0018) → REQ-PB-012, REQ-PB-013

| # | Role (verbatim) | Accountability (verbatim) | Code | Type |
|---|---|---|---|---|
| 1 | Executive Sponsor | Owns enterprise outcome, removes constraints, approves major trade-offs. | SP | role assignment → person |
| 2 | Transformation Lead | Integrates workstreams, drives cadence, ensures outcome realization. | TL | role assignment → person |
| 3 | Business Owners | Own target-state capabilities and BAU adoption. | BO | role assignment → person (multi) |
| 4 | Workstream Leads | Deliver initiatives and manage dependencies. | WL | role assignment → person (multi) |
| 5 | Finance / Value Office | Validates baseline, benefit logic, value realization. | FIN | role assignment → person/group |
| 6 | Transformation Office | Governance, reporting, risks, dependencies, decisions, standards. | TO | role assignment → person/group |

Assignment fields:

| Field | Type |
|---|---|
| role | choice |
| person or governed group | person |
| scope | organization / business unit / transformation |
| effective from/to | date |

## Modes (B0009) → REQ-PB-003, REQ-PB-004, REQ-PB-005

| Mode | When to use (verbatim) | How (verbatim) |
|---|---|---|
| End-to-End | New enterprise or business-unit transformation | Run Phases 1-6 sequentially. Do not launch initiatives before the North Star, outcomes and target state are clear. |
| Modular | A transformation is already underway | Enter at the relevant phase, complete the minimum mandatory templates, then reconnect to outcomes and benefits. |

Transformation record fields:

| Field | Type | Req. | Notes |
|---|---|---|---|
| mode | choice: End-to-End \| Modular | R | |
| entry phase | choice of the 6 phases | C | required if Modular |
| standalone deliverable type | choice: Target Operating Model \| initiative business case \| benefits register | O | from B0008 |

## Phases (B0021) and gates (B0023) → REQ-PB-014, REQ-PB-015..022

| # | Phase | Purpose | Key outputs | Objective block |
|---|---|---|---|---|
| 1 | DIAGNOSE | Establish fact base | Current state, root causes, value pools | B0027 |
| 2 | DEFINE | Set direction | North Star, outcomes, KPIs, guardrails | B0046 |
| 3 | DESIGN | Create target state | Target Operating Model, capabilities, journeys | B0054 |
| 4 | MOBILIZE | Build execution portfolio | Initiatives, business cases, roadmap, resourcing | B0068 |
| 5 | TRANSFORM | Execute & govern | Operating system, workstreams, decisions, adoption | B0091 |
| 6 | REALIZE | Prove & sustain value | Benefits, BAU handover, continuous improvement | B0119 |

| Gate | Decision question (verbatim) | Evidence required (verbatim) |
|---|---|---|
| G1 - Case for Change | Do we agree on the problem/opportunity and value at stake? | Diagnostic, baseline, root causes, value pools. |
| G2 - Direction | Are outcomes specific enough to steer decisions? | North Star, outcome tree, KPI definitions, guardrails. |
| G3 - Target State | Do we know what must be different operationally? | Target Operating Model, capability gaps, future journeys. |
| G4 - Mobilization | Is the portfolio executable and value-backed? | Initiative cards, business cases, roadmap, owners, capacity. |
| G5 - Scale | Are pilots/results sufficient to scale? | Performance evidence, adoption, risk closure, decision log. |
| G6 - Sustain | Is value embedded in BAU? | Benefits evidence, ownership transfer, controls, continuous improvement backlog. |

Gate record fields are gate, evidence checklist items (reference→evidence, with completeness), submission version, approver (person/role), decision (choice), rationale (text) and decision timestamp. The workflow states (Draft … Deferred), waivers and conditional approval come from master prompt §4. They are **not** source content and belong to AN-02.

Product gates G1–G6 are business approvals. They are unrelated to the engineering delivery gates DG0–DG7.

## Other source-derived records (supporting)

| Record | Source | Fields | Req. |
|---|---|---|---|
| Diagnostic workstream | B0029 | Workstream (6 seeded); Key questions; Typical outputs (linked records/evidence) | REQ-PB-023 |
| Capability heatmap | B0029 | Capability; current level; target level; gap; build/buy/partner need; owner (rating scale: interpretation §5) | REQ-PB-024 |
| Journey/process map | B0029, B0056 | name; steps; pain points; cycle time; failure demand; current/future (steps/actors/handoffs/systems/controls per §5, extension) | REQ-PB-025 |
| Baseline | B0031, B0035, B0042, B0085 | metric; value; unit; source; baseline date; validation status (registry is §5 extension) | REQ-PB-027 |
| Value pool | B0029, B0085 | value pool; driver; upside; downside; currency; materiality; evidence; confidence | REQ-PB-028 |
| Guardrail | B0035 | guardrail; category (regulatory, CX, capex, risk, brand, other); statement | REQ-PB-037 |
| Capacity plan | B0023, B0079 | initiative; owner; role; FTE demand; availability; period (extension, §5) | REQ-PB-059 |
| BAU handover | B0101, B0121 | BAU owner; KPI owner; controls; control cadence; receiving-owner acceptance | REQ-PB-083 |
| CI backlog item | B0021, B0023 | item; owner; source; status | REQ-PB-084 |
| Corrective action / recovery plan | B0093, B0121 | trigger; action; owner; due date; status | REQ-PB-085 |
