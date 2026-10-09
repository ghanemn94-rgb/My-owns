# ADR-0038: Traceability view and orphan report, many-to-many links with contribution and allocation rules, downstream impact, Modular-entry missing-link flags and labelled inherited records, portfolios and workstreams

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-08), 2026-10-09. §7.4 is a **reopen candidate** for the orchestrator (D-088 trigger).
- **Requirements (slice K of `docs/architecture/p4-plan.md`):** REQ-PB-005, REQ-PB-010, REQ-PB-044, REQ-S03-001, REQ-S03-005, REQ-S03-006.
- **Sources (quoted where a design point has one):**
  - Playbook B0070 ("Traceability chain  Diagnosed issue → Target-state gap → Initiative → Deliverable → Capability change → KPI movement → Benefit."), B0008/B0009 (Modular: "Enter at the relevant phase, complete the minimum mandatory templates, then reconnect to outcomes and benefits."), B0015 ("One source of truth: keep the transformation charter, roadmap, initiative portfolio and benefits register linked."), B0162.
  - Master prompt M0097 (the chain), M0098 ("Support many-to-many relationships with explicit contribution and allocation rules. Every node is clickable, and each change can show downstream impact. Add a traceability view and an orphan report for missing links."), M0095 ("Modular: … Capture inherited evidence, baseline and approvals, complete minimum mandatory fields, and reconnect the module to outcomes and benefits. Flag missing links; never silently fabricate approvals or bypass controls."), M0092 ("Support multiple transformations, business units, portfolios, workstreams, initiatives and ongoing business performance areas."), M0150 ("Avoid duplicate registers that drift.").
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true); D-089 (plan adopted; R4); D-101 (ARCH-07 decisions: `gate_dispensation` not widened).
- **Builds on:** ADR-0002 (rule 4: reporting read models may use SQL views), ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0015 (gate engine), ADR-0016 (lock registry), ADR-0018 (evidence verification), ADR-0021 §2 (initiative links) and §5 (Modular entry, inherited approvals as `gate_dispensation`, never a gate decision), ADR-0029 (benefit allocations, 100 % rule), ADR-0035 (gate exceptions), ADR-0036 §5 (change-request impact assessment), ADR-0037 (dashboards).
- **Physical model:** `0055_p4_traceability_modular_structure.sql` (`trace_link`, the allocation columns of `initiative_outcome_contribution`, `trace_allocation_guard`, `inherited_record`, `portfolio`, `portfolio_transformation`, `workstream`, `workstream_initiative`, view `traceability_edge`), `0057_p4_dashboards_traceability_permissions.sql` (permissions). Probe ids refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/probe-output.txt`.
- **Two gate systems.** Inherited approvals are product-gate (G1–G6) business records captured as evidence; nothing here creates a gate decision, and nothing reads or writes DG0–DG7.

## Context

As built at `HEAD` `89df7f7`:

1. Five steps of the chain already have canonical storage: Target-state gap or diagnosed finding → Initiative (`initiative_gap_link`, DG3, T05 "Problem / gap addressed"); Initiative → Deliverable (`deliverable.initiative_id`, DG3); Initiative → Outcome/KPI (`initiative_outcome_contribution`, DG3, with a contribution statement and no share); Outcome → its KPI rows (`outcome_kpi`, DG2); KPI → Benefit (`benefit.measurement_kpi_definition_id`, slice B) and Initiative → Benefit with shares (`benefit_allocation`, slice B, at most 100 % per set, ADR-0029).
2. No table records Diagnosed issue → Target-state gap, Deliverable → Capability change, or Capability change → KPI movement.
3. Modular entry exists since P1 (`transformation.mode`, `entry_phase`, `standalone_deliverable_type`). Prior approvals are `gate_dispensation` rows of kind `inherited_approval` (ADR-0021 §5); the gate list shows them as the `inheritedApproval` annotation and never as `approved`. No row labels an evidence item or a baseline as inherited.
4. **As built, a Modular transformation entering at Design can submit G3 without any baseline or outcome link:** `sequenceProblem` (`workflows/gates.ts`) skips the gates before the entry phase, and the five G3 criteria (`0011`: TOM, gap matrix, capability gaps, future journeys, design decisions) do not test baselines or outcome links. p4-plan §1.2 says "the G3 refusal itself is DG2's (A03)"; that sentence is not true of the code (§7.4).
5. `scoped_assignment.scope_type` (`0001`) already lists `portfolio` and `workstream`, but no portfolio or workstream table exists.
6. No P4 table stores a copy of an initiative's name (checked with `grep` over `packages/db/migrations/`).

## Decision

### 1. The chain and its canonical records (REQ-PB-044, REQ-S03-006, REQ-PB-010)

| Chain step (B0070) | Canonical record | Edge kind in `traceability_edge` |
|---|---|---|
| Diagnosed issue → Target-state gap | `trace_link` kind `issue_gap` (new) | `issue_gap` |
| Target-state gap (or finding) → Initiative | `initiative_gap_link` (DG3) | `gap_initiative` |
| Initiative → Deliverable | `deliverable.initiative_id` (DG3) | `initiative_deliverable` |
| Deliverable → Capability change | `trace_link` kind `deliverable_capability` (new) | `deliverable_capability` |
| Capability change → KPI movement | `trace_link` kind `capability_kpi` (new) | `capability_kpi` |
| Initiative → KPI movement (T05 contribution) | `initiative_outcome_contribution` (DG3) | `initiative_kpi` (to the outcome KPI, or to the outcome when no KPI row is named) |
| Outcome → its KPI rows | `outcome_kpi` (DG2) | `outcome_kpi_of` |
| KPI movement → Benefit | `trace_link` kind `kpi_benefit` (new), and `benefit.measurement_kpi_definition_id` matched to the outcome KPIs of that KPI definition | `kpi_benefit`, `kpi_benefit_measure` |
| Initiative → Benefit (shares) | `benefit_allocation`, the benefit's current set (slice B) | `initiative_benefit` |

Node types: `diagnostic_finding` ("diagnosed issue"), `tom_gap`, `initiative`, `deliverable`, `capability` ("capability change"), `outcome`, `outcome_kpi` ("KPI movement"), `benefit`. **`traceability_edge`** (`0055`) is one SQL view with one `UNION ALL` branch per row of the table above; it reads every canonical table in place and copies nothing (probe G05: a DG3 contribution appears in the view on an upgraded P3 database; TL17: the whole chain, and a removed link is absent). Removed links, archived deliverables, inactive outcome KPIs, archived benefits and allocations outside the benefit's current set are not edges.

### 2. Trace links (REQ-S03-006)

**Entity `trace_link`** (`0055`; probes TL02–TL17): `link_kind` (`issue_gap` | `deliverable_capability` | `capability_kpi` | `kpi_benefit`), exactly the two typed reference columns its kind names (`diagnostic_finding_id`, `tom_gap_id`, `deliverable_id`, `capability_id`, `outcome_kpi_id`, `benefit_id`; CHECK `trace_link_kind_shape`, TL03), each a composite foreign key on `(transformation_id, id)` so both records are in the link's transformation (TL13), `contribution_statement` (1–2000, required: the "explicit contribution" of M0098), `allocation_share` (numeric(7,6), 0 < share ≤ 1, decimal fraction; TL06) and `allocation_basis` (1–1000, only with a share), `status` (`active` | `removed`) with `removed_at`/`removed_by`/`remove_reason` (all or none), P2 stamps, `version`. One active link per (kind, from, to) (`trace_link_one_active_key`, `NULLS NOT DISTINCT`; TL04). A share is allowed only into a value-bearing record, i.e. kinds `capability_kpi` and `kpi_benefit` (TL05).

**State machine.** `active → removed` (with a reason; `If-Match`). A removed link is never re-activated; a new link is created instead. Rows are never deleted: `mth_app` has no DELETE grant (TL16).

**Operations** (BE-M): `listTraceLinks`, `createTraceLink`, `getTraceLink`, `updateTraceLink` (contribution statement, share, basis; `If-Match`), `removeTraceLink` (`If-Match`, reason). The records each kind joins must be active (a removed gap or archived capability → 422 `trace_link.record_inactive`).

**Many-to-many (REQ-S03-006 acceptance "one initiative links to two gaps and two KPIs"):** an initiative takes any number of `initiative_gap_link` rows and contributions (TL01); a capability, KPI or benefit takes any number of trace links.

### 3. Allocation rules (REQ-S03-006 "an allocation link set totalling 110% is rejected")

- **Allocation set** of a target record = every **active** link into it that carries a share: into an **outcome KPI**, the `capability_kpi` trace links and the `initiative_outcome_contribution` rows that name it; into a **benefit**, the `kpi_benefit` trace links. Benefit → initiative shares stay slice B's `benefit_allocation` set with its own 100 % rule (ADR-0029); this ADR does not change it.
- **Rule:** the decimal sum of the set is at most 1 (100 %). A write that would exceed it is refused by the trigger `trace_allocation_guard` (`0055`) with constraint name `trace_allocation_total` (probes TL07: 0.6 + 0.4 = 1.000000 commits; TL08: one more 0.1 → refused, "would total 1.100000"; TL09: raising a member instead → refused; TL11: into a benefit → refused), and by the API first with 422 `trace_link.allocation_exceeds_total`. Below 1 the read model shows `unallocatedShare` = 1 − total (decimal), never "0 %". A removed link leaves the set (TL10).
- **Serialization:** advisory-lock class **730249 `traceAllocationSet`** (ADR-0016 §6), key = the target record's id. The API takes it before reading the set; the trigger takes the same lock (`trace_allocation_lock_class`), so two concurrent writes into one target are serialized.
- **Contribution shares** are set by `setOutcomeContributionAllocation` (`POST /api/v1/initiatives/{initiativeId}/outcome-contributions/{linkId}/allocation`, `If-Match`, body `{allocationShare: decimal string | null, allocationBasis: string | null}`). A share needs the contribution's outcome KPI (`initiative_outcome_contribution_allocation_needs_kpi`; TL12). The DG3 contribution routes and their responses are unchanged: they never write the two columns, and existing rows keep NULL (G04; G06: a DG3-style edit still commits).
- `getAllocationSet` (`GET …/allocation-sets/{targetType}/{targetId}`) returns the members, `total`, `unallocatedShare` and `version`s.

### 4. Traceability view (REQ-PB-044, REQ-S03-006 "every node opens its record")

`getTraceability` (`GET /api/v1/transformations/{transformationId}/traceability`; optional `rootType` + `rootId`, `direction` `upstream` | `downstream` | `both` (default `both`), `depth` 1–8 (default 8)). Response: `nodes[]` (`recordType`, `recordId`, `code`, `label`, `status`, `href`, `orphan` flags of §5, and for an outcome KPI or benefit its `allocation` `{total, unallocatedShare}`), `edges[]` (`edgeKind`, `fromType`, `fromId`, `toType`, `toId`, `linkTable`, `linkId`, `contributionStatement`, `allocationShare`), `truncated` (true when the 2000-node cap was reached). Without a root it returns the whole graph of the transformation. Every edge kind of §1 points forward in the node order finding → gap → initiative → deliverable → capability → outcome → outcome KPI → benefit, so the graph has no cycle and its longest path has 6 edges; the walk keeps a visited set all the same.

**Clickable nodes:** `href` is the path of the record's existing read operation in `docs/api/openapi.yaml`; a BE-M test asserts that every node type's `href` returns 200 for a readable record. FE-G opens the record's screen on click (REQ-PB-044 "clicking a node opens the linked record", e2e).

### 5. Orphan report (REQ-PB-044 "an initiative without a TOM gap appears in the orphan report")

`getOrphanReport` (`GET …/orphans`; `recordType`, `missing`, `cursor`, `limit`). A record is listed with `missing` = `upstream`, `downstream` or `both`, and `expected` = the missing step:

| Record (active only) | Upstream missing when | Downstream missing when |
|---|---|---|
| `diagnostic_finding` (status `confirmed`) | — (start of the chain) | no `issue_gap` link and no `initiative_gap_link` to it |
| `tom_gap` (status `open` or `resolved`) | no `issue_gap` link | no active `initiative_gap_link` to it |
| `initiative` (not `draft`, not `cancelled`) | no active `initiative_gap_link` of target type `tom_gap` (a link to a finding only still reports `expected: tom_gap → initiative`) | no active deliverable |
| `deliverable` (active) | — (always has its initiative) | no `deliverable_capability` link |
| `capability` (active) | no `deliverable_capability` link | no `capability_kpi` link |
| `outcome_kpi` (active) | no `capability_kpi` link and no contribution naming it | no benefit reached by `kpi_benefit` or `kpi_benefit_measure` |
| `benefit` (active) | no `kpi_benefit` link, no outcome KPI of its measurement KPI, and no allocation in its current set | — (end of the chain) |

Drafts are not orphans (they are work in progress). The report reads `traceability_edge` and the record tables only.

### 6. Downstream impact (REQ-S03-006 "changing a KPI target lists the linked benefits and dashboards as affected")

`getRecordImpact` (`GET /api/v1/records/{recordType}/{recordId}/impact`; `recordType` ∈ the eight node types plus `kpi_definition`; `cursor`, `limit`). It walks `traceability_edge` **downstream** from the record (for a `kpi_definition`, from each of its active outcome KPIs), transitively, at most 8 steps, with a visited set, and returns:

- `records[]`: each reached record with `recordType`, `recordId`, `code`, `label`, `href`, `distance` and the edge kinds of its path; benefits reached are flagged `valueAffected`;
- `dashboards[]`: the T10 areas (ADR-0037) and dashboards that read the record or a reached record: an outcome, outcome KPI or KPI definition → `outcomes` (and `people_adoption` when an active adoption metric link names the KPI); a benefit → `value` and the Finance dashboard; an initiative or deliverable → `portfolio` (and `dependencies` when an open dependency names the initiative) and, for an initiative in a workstream, that workstream dashboard; every record → the transformation dashboard and the Executive Overview;
- `hiddenCount`: reached records the caller may not read (counted, never listed).

The impact is computed when it is requested ("Record changed → compute downstream impact list": the list for the current state is what the call returns); nothing is stored. It is a live read model; the change-request impact assessment of ADR-0036 §5 stays the frozen, approved artefact, and the two are not merged.

### 7. Modular entry (REQ-PB-005, REQ-S03-005)

#### 7.1 Inherited records

**Entity `inherited_record`** (`0055`; probes IR01–IR11): `kind` (`evidence` | `baseline`), exactly one of `evidence_id`/`baseline_id` (CHECK `inherited_record_kind_shape`, IR03; composite FKs to the same transformation), `source_description` (3–2000, required: where it comes from), `original_owner` (optional), `original_date` (optional), `recorded_by`, `status` (`active` | `withdrawn`) with `withdrawn_at`/`withdrawn_by`/`withdraw_reason` (all or none, IR07), P2 stamps, `version`. One active row per evidence item or baseline (IR06). The canonical evidence or baseline row is **referenced, not copied**.

**Guards** (`inherited_record_guard`): only a transformation with `mode = 'modular'` takes rows (IR02, constraint `inherited_record_modular_only`); a new row starts `active`; the provenance columns are immutable and the only update is `active → withdrawn` (IR05, IR09). **State machine:** `active → withdrawn` (terminal).

**Prior approvals** are not `inherited_record` rows. They stay `gate_dispensation` rows of kind `inherited_approval` (ADR-0021 §5: approving body, date, evidence required, accepted by a `gate.decide` holder other than the recorder, never a `gate_decision`). Recording an inherited item creates no gate decision and changes no gate (IR11). Inheriting a baseline does not validate it (IR04: it stays `unvalidated`).

**Operations** (BE-M2): `listInheritedRecords` (`GET /api/v1/transformations/{id}/inherited-records`) returns the inherited evidence and baselines **and** the transformation's inherited-approval dispensations as read-only entries of kind `prior_approval` (approving body, date, evidence id, dispensation status), each labelled `inherited` with the English label "Inherited - recorded, not granted in platform" (REQ-S03-005 procedure, verbatim; Arabic provisional); `createInheritedRecord` (`POST`, kinds `evidence` and `baseline`; kind `prior_approval` → 422 `inherited_record.prior_approval_use_dispensation`); `withdrawInheritedRecord` (`POST …/{inheritedRecordId}/withdraw`, `If-Match`, reason).

#### 7.2 Gate labels (REQ-S03-005 "shows G2 as 'inherited' (not Approved)")

The missing-links response (§7.3) lists G1–G6 with `label`: `approved` only when `gate_instance.status = 'approved'`; else `inherited` when the DG3 `inheritedApproval` annotation has `counts = true`; else `inherited_pending_verification` when it is pending; else the gate's own status. The DG3 gate list (`GateInstance.inheritedApproval`) is unchanged.

#### 7.3 Missing links (REQ-PB-005 screen_api `GET /api/v1/transformations/{id}/missing-links`)

`getMissingLinks` returns `mode`, `entryPhase`, `standaloneDeliverableType`, `gates[]` (§7.2) and `items[]`, each `{code, severity: blocking | warning, recordType, recordId, label, href}`:

| Code | Severity | When |
|---|---|---|
| `baseline_missing` | blocking | no active `baseline` row with a value (inherited or not) |
| `outcome_link_missing` | blocking | no active outcome with an active outcome KPI row |
| `outcome_kpi_missing` | warning | per active outcome without an active KPI row |
| `initiative_outcome_link_missing` | warning | per initiative (not draft/cancelled) without an active contribution |
| `initiative_gap_link_missing` | warning | per initiative (not draft/cancelled) without an active `tom_gap` link |
| `benefit_missing` | warning | no active benefit |
| `benefit_outcome_link_missing` | warning | per active benefit without an upstream KPI movement (§5 benefit upstream rule) |
| `inherited_approval_unverified` | warning | per inherited-approval dispensation still pending verification |

The derivation is one pure function in `packages/shared/src/traceability/missing-links.ts` over facts loaded by `transformations/missing-links-facts.ts` (exported by `transformations/index.ts`), so the read model (`reporting`) and the gate precondition of §7.4 (`workflows`) use the same rule without importing each other.

#### 7.4 Gate submission in a Modular entry — **reopen candidate (orchestrator decision needed)**

REQ-PB-005 and REQ-S03-005 accept: "a transformation entering at Design with no baseline and no outcome links shows both as missing and G3 submission is rejected by the API until they are supplied or an authorized waiver exists". As built (Context item 4) that submission is accepted. Making it a 422 changes a DG2-approved response for existing Modular data, so it is a reopen candidate (D-088 trigger). **Recommended rule** (BE-M2 implements it only after the orchestrator accepts it):

- For a transformation with `mode = 'modular'`, `submitGate` for the gate that closes its entry phase or any later gate is refused with **422** `gate.modular_links_missing` while §7.3 has a `blocking` item, unless an accepted, unexpired `gate_dispensation` of kind `waiver` for that gate (and no initiative) exists. `errors[]` lists each blocking item (`/baseline`, `/outcomes`).
- End-to-End transformations, and Modular ones with no blocking item, get exactly the DG2/DG3 responses. The waiver path covers G1–G3, the gates `gate_dispensation` allows (`0020` CHECK; not widened, D-101); for an entry at Mobilize or later the links must be supplied.
- The check runs after the DG2 sequence check and before criteria evaluation, so every existing DG2 refusal keeps its order and body.

### 8. One source of truth (REQ-PB-010)

- Every view that shows an initiative reads `initiative.name` by join: the roadmap (`getRoadmap`, DG3), the scorecard (the T10 transformation dashboard's Portfolio area, ADR-0037 — no other scorecard read model exists in DG4) and the benefits register. For the register, this ADR adds an **optional** `initiatives[]` member (`{id, code, name}` of the initiatives in the benefit's current allocation set) to `BenefitRegisterRow` (a P4 schema; the P1–P3 contract is unchanged); BE-M fills it in `benefits/register.ts` (one named block).
- No P4 table stores an initiative's name (Context item 6), and `traceability_edge` copies nothing (§1).
- REQ-PB-010's acceptance ("renaming an initiative changes it in roadmap, scorecard and benefits register views in one update; no duplicate initiative rows exist in the database") is tested by BE-M: one `PATCH` of the initiative's name, then the three reads show the new name, and `SELECT count(*) FROM initiative WHERE transformation_id = $1 AND code = $2` is 1.

### 9. Portfolios and workstreams (REQ-S03-001)

- **`portfolio`** (organization-level; code unique per organization, upper-case pattern; `name`, `description`, `owner_user_id`, `status` `active` | `archived` with reason; probes PF01–PF04) and **`portfolio_transformation`** (membership; a transformation is in at most one active portfolio, `portfolio_transformation_one_active_key`, PF06; the portfolio must be of the transformation's organization, composite FK, PF07; removal keeps the row with a reason, PF08).
- **`workstream`** (per transformation, code `WS-nn` from `record_code_counter` prefix `WS`; `name`, `description`, `lead_user_id`, `status` `active` | `archived`; WS01, WS02, WS06) and **`workstream_initiative`** (an initiative is in at most one active workstream, WS03; same transformation, WS04).
- **State machines:** portfolio and workstream `active → archived` (terminal); memberships `active → removed` (terminal; a new row re-adds).
- **Operations** (BE-M2): `listPortfolios`, `createPortfolio`, `getPortfolio`, `updatePortfolio` (incl. archive), `listPortfolioTransformations`, `addPortfolioTransformation`, `removePortfolioTransformation`; `listWorkstreams`, `createWorkstream`, `getWorkstream`, `updateWorkstream` (incl. archive), `listWorkstreamInitiatives`, `addWorkstreamInitiative`, `removeWorkstreamInitiative`.
- **Scope.** A portfolio's membership list shows only transformations the caller may read. This ADR does not change how `scoped_assignment` rows of scope type `portfolio` or `workstream` are resolved (no such grant is created by any P4 path). REQ-S03-001's acceptance (two transformations in different business units are listed separately; a user scoped to one business unit cannot list the other's) is the DG1 `listTransformations` behaviour; BE-M2 re-runs it and extends the sweep to `listPortfolioTransformations`, `listWorkstreams` and the slice J/K reads.

### 10. Authorization (permissions matrix §17)

| Action | Permission (category) | Default roles | Record-level rule |
|---|---|---|---|
| Read traceability, orphans, missing links, impact, links, allocation sets, inherited records, workstreams | `transformation.read` | every business role, AUD | 404 outside scope |
| Create, edit, remove trace links; set contribution shares | `traceability.link` (write) | TL, BO, WL, TO | the records linked must be readable |
| Record and withdraw inherited evidence and baselines | `inherited_record.record` (write) | TL, TO | Modular transformations only (422 otherwise) |
| Create, edit, archive workstreams; assign initiatives | `workstream.manage` (write) | TL, TO | — |
| Read portfolios | `organization.read` | every role | memberships filtered to readable transformations |
| Create, edit, archive portfolios; place transformations | `portfolio.manage` (configure) | TO | the transformation must be readable |

AUD holds only reads (403 on every write). No technical-admin role holds any of these codes; none is a business approval (`0057`). Every mutation re-authorises at commit, validates (shared free-text and UTF-8 rules), requires `If-Match` (428/409; creates are version 1), writes one audit event in its transaction (probes PF02, WS05, TL14, IR10), and does no remote I/O inside the transaction.

### 11. Decimal and Unknown

Shares are decimal fractions (`numeric(7,6)`), summed with decimal arithmetic in the database and decimal.js in the API; percentages are shown from the fractions. A target with no share is "unallocated 100 %", not 0 %. An impact or traceability item the caller cannot read is counted in `hiddenCount`, never shown as "no impact". The inherited baseline keeps its value as a decimal and its validation status.

### 12. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` (or error `message`) |
|---|---|---|
| 422 | `trace_link.pair_not_allowed` (at `/linkKind`) | "This kind of link cannot connect these two records." |
| 422 | `trace_link.record_not_found` (at the id field) | "The linked record does not exist in this transformation." |
| 422 | `trace_link.record_inactive` (at the id field) | "The linked record is archived or removed." |
| 409 | `trace_link.duplicate` | "These two records are already linked." |
| 422 | `trace_link.share_not_allowed` (at `/allocationShare`) | "A share can be set only on a link into a KPI or a benefit." |
| 422 | `trace_link.allocation_exceeds_total` (at `/allocationShare`) | "The allocations into this record would total {total}%, more than 100%." |
| 422 | `trace_link.not_active` (invalid-transition) | "This link has been removed." |
| 422 | `contribution.allocation_needs_kpi` (at `/allocationShare`) | "A share needs the contribution's KPI; name the KPI first." |
| 422 | `contribution.not_active` (invalid-transition) | "This contribution has been removed." |
| 422 | `inherited_record.not_modular` | "Inherited records can be recorded only for a transformation in Modular entry." |
| 422 | `inherited_record.prior_approval_use_dispensation` (at `/kind`) | "Record a prior approval as an inherited gate approval; it is never stored as a platform approval." |
| 409 | `inherited_record.duplicate` | "This record is already recorded as inherited." |
| 422 | `inherited_record.not_active` (invalid-transition) | "This inherited record has already been withdrawn." |
| 409 | `portfolio.code_taken` | "Another portfolio of this organization uses this code." |
| 422 | `portfolio.transformation_already_placed` | "This transformation already sits in a portfolio." |
| 422 | `portfolio.archived` | "This portfolio is archived." |
| 422 | `workstream.initiative_already_assigned` | "This initiative already belongs to a workstream." |
| 422 | `workstream.archived` | "This workstream is archived." |
| 422 | `membership.not_active` (invalid-transition) | "This membership has already been removed." |
| 422 | `gate.modular_links_missing` (§7.4; only if accepted) | "Modular entry: supply the missing baseline and outcome links, or record an authorized waiver, before submitting this gate." |

`platform/db-errors.ts` maps the `0055` constraints: `trace_allocation_total` → `trace_link.allocation_exceeds_total` (or `contribution.…` on a contribution; the API's own check normally answers first), `trace_link_one_active_key` → `trace_link.duplicate`, `trace_link_kind_shape` → `trace_link.pair_not_allowed`, `trace_link_allocation_kind` → `trace_link.share_not_allowed`, `initiative_outcome_contribution_allocation_needs_kpi` → `contribution.allocation_needs_kpi`, `inherited_record_modular_only` → `inherited_record.not_modular`, `inherited_record_one_active_key` → `inherited_record.duplicate`, `portfolio_org_code_key` → `portfolio.code_taken`, `portfolio_transformation_one_active_key` → `portfolio.transformation_already_placed`, `workstream_initiative_one_active_key` → `workstream.initiative_already_assigned`.

## Alternatives considered

1. **One generic link table for the whole chain, replacing the DG3 links.** Rejected: it would copy or migrate DG3 rows (`initiative_gap_link`, contributions) and change DG3 routes; M0150 asks for one canonical record per relationship. `trace_link` covers only the steps without a record.
2. **Polymorphic `(from_type, from_id, to_type, to_id)` columns.** Rejected: typed composite foreign keys prove both records exist in the same transformation (TL13) without a trigger per type.
3. **Shares on `initiative_gap_link`.** Rejected: a gap carries no value to allocate; M0098 "Allocation % (where value is allocated)".
4. **Storing impact lists when a record changes.** Rejected: a stored list goes stale at the next link change; the live walk is exact and cheap at the chain's depth.
5. **Inherited approvals as `inherited_record` rows.** Rejected: ADR-0021 §5 already stores them, with verification and a second person's acceptance; a second store would drift.

## Consequences

- §7.4 waits for the orchestrator. If it is rejected, REQ-PB-005's and REQ-S03-005's literal "G3 submission is rejected" clause is not met in DG4 and must be recorded as such.
- BE-M edits one named block in `portfolio/links.ts` (the allocation action) and one in `benefits/register.ts` (`initiatives[]`); BE-M2 adds `transformations/missing-links-facts.ts` and its export line, and, if §7.4 is accepted, the precondition lines in `workflows/gates.ts` after BE-K2.
- None of the six rows is complete at this task's end.

## Verification

- **Database (probe, real output):** G04–G06, PF01–PF08, WS01–WS06, TL01–TL17, IR01–IR11 (`probe-output.txt`).
- **API (BE-M, BE-M2 tests, p4-work-split §J+K):** one initiative with two gaps and two KPIs; a 110 % set refused with the exact text and a 100 % set accepted, `unallocatedShare` below 100 %; changing a KPI target: `getRecordImpact` on the KPI lists the linked benefits and the Outcomes/Value areas and dashboards (REQ-S03-006); an initiative without a TOM gap in the orphan report, and every node's `href` returning 200 (REQ-PB-044); the PB-010 rename test; Modular entry at Design with an inherited G2 approval: G2 labelled `inherited`, `baseline_missing` and `outcome_link_missing` listed, and (if §7.4 is accepted) G3 submission 422 until supplied or waived (REQ-PB-005, REQ-S03-005); the BU scope sweep (REQ-S03-001); AUD 403, If-Match 428/409 and one audit event on every write.

## Amendment (2026-10-09, T-DG4-ARCH-R1): the validation codes added outside §12 (BE-M handback §2 item 3; D-108)

Accepted, with their exact English texts. `validation.decimal_measure_scale` is the shared `columnDecimal` code for a column named `measure` (`SHARE_COLUMN`).

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `validation.basis_needs_share` | 400 field | accepted | An allocation basis needs a share. |
| `validation.share_range` | 400 field | accepted | A share is more than 0 and at most 1 (100 %). |
| `validation.decimal_measure_scale` | 400 field | accepted | Enter a decimal with at most 6 decimal places. |
| `validation.root_pair` | 400 field | accepted | Give rootType and rootId together. |
| `trace_link.record_not_found (existing ADR-0038 §12 code)` | 422 | accepted reuse | on a getTraceability root that is not a record of that type in the transformation (the §12 text) |
