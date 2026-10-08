# ADR-0023: Roadmap (T07), dependency graph (T08), resource capacity and funding decisions (P3)

- **Status:** Proposed for P3 (DG3). Author: solution-architect (T-DG3-ARCH-01), 2026-10-07.
- **Requirements:** REQ-S16-016, REQ-PB-050, REQ-PB-051, REQ-PB-052, REQ-PB-059, REQ-S09-003, REQ-S09-004, REQ-S09-006, REQ-S09-008, REQ-S04-006 (funding, capacity), REQ-DLV-035 (cycles).
- **Sources:** playbook B0078–B0081, B0021, B0023, B0079 (Wave 2 entry "Evidence + capacity"); master prompt §9 (lines ~290–298), M0184, M0177.
- **Builds on:** ADR-0003, ADR-0004, ADR-0009 (web), ADR-0015 (one decision model), ADR-0016, ADR-0019, ADR-0021, F-DG1-140 (`0009`, advisory lock + database guard).
- **Physical model:** `0020_p3_portfolio_roadmap.sql` (waves, deliverables, milestones), `0022_p3_dependency_capacity_funding.sql` (dependency types, the dependency extension and cycle guard, resource roles, capacity, demand, selection, funding).

## Decision

### 1. Roadmap waves (T07, REQ-PB-050)

- **`roadmap_wave`**, per transformation. The four B0079 waves are instantiated for every transformation by `p3_instantiate_transformation()` (new ones and a migration backfill of existing ones), with the source text **verbatim** in `source_*_en` columns and provisional Arabic in `*_ar` columns:

  | `code` | `source_name_en` | `source_purpose_en` | `source_horizon_en` | `source_entry_criteria_en` | `source_exit_evidence_en` | horizon weeks (from–to) |
  |---|---|---|---|---|---|---|
  | `wave_0` | Wave 0 — Mobilize | Baseline, governance, design decisions | 0-6 weeks | Sponsor + charter | Approved case, owners, stage gates | 0–6 |
  | `wave_1` | Wave 1 — Prove | Quick wins / pilots / de-risking | 1-3 months | Prioritized initiatives | Measured pilot results | 4–13 |
  | `wave_2` | Wave 2 — Scale | Scale validated changes | 3-9 months | Evidence + capacity | Adoption + KPI movement | 13–39 |
  | `wave_3` | Wave 3 — Embed | BAU integration / optimization | 6-18 months | Stable solution | Benefits sustained, ownership transferred | 26–78 |

- The verbatim columns are immutable (trigger `roadmap_wave_source_immutable`; like `tom_dimension`). Editable (`RoadmapWaveUpdate`, `portfolio/waves.ts`): `planned_start`, `planned_end`, `owner_user_id`, `notes` and `status` (a source wave cannot be archived). Teams may add non-source waves (`is_source_seeded = false`). **Labels, as built (corrected by T-DG3-BE-F; FE-E handback §4.1):** a source wave's label is its verbatim source text (`name_en`/`name_ar`); a team-added non-source wave carries the name it was created with. There are no label overrides in P3, and `0020` has no override columns.
- **Overlap is allowed** (planning horizons, not deadlines; master prompt §9): there is no exclusion constraint on horizons or planned dates, and the horizon weeks are the numeric reading of the verbatim text, used only to draw the timeline. The verbatim text stays the label.
- An initiative belongs to at most one wave (`initiative.wave_id`, composite FK within the transformation).

### 2. Milestones and deliverables

- **`milestone`**: `initiative_id`, optional `wave_id`, `title`, `owner_user_id`, **`approved_date`** (the baseline, set only by `POST /milestones/{id}/approve-date`, `roadmap.approve`, with `approved_by`/`approved_at`), **`forecast_date`** (editable; "moving a milestone" changes it), `actual_date`, `status` (`planned` | `achieved` | `missed` | `cancelled`). Variance = forecast − approved, in **calendar** days, computed (never stored); see §8 for the working-day slip. Re-approval overwrites `approved_date` with a mandatory reason and its own audit event; formal rebaseline through change control is P4.
- **`deliverable`**: `initiative_id`, `title`, `description`, `owner_user_id`, `due_date`, **`acceptance_status`** `pending` → `submitted` → `accepted` | `rejected` (`rejected` → `submitted` again), `submitted_by/at`, `accepted_by/at` (or rejected), `acceptance_note`; CHECK `accepted_by <> submitted_by`. Accepting needs `deliverable.accept` **and** record-level ownership: the initiative's executive owner (or a delegate). `status` `active` | `archived` (archive, never delete).

### 3. One data source for timeline, table and board (REQ-S09-006)

`GET /transformations/{id}/roadmap` returns waves, initiatives (with status, wave, planned dates, flags), milestones, deliverables and initiative-to-initiative dependencies with `version`s, from one query set. The web's timeline, initiative table and work board render **the same TanStack Query cache entry** (`["roadmap", transformationId]`); there is no per-view copy. Moving a milestone is `PATCH /milestones/{id}` with `If-Match`; on success the client invalidates that one key (through `sessionBound`), so all three views update. A concurrent edit answers **409** with `currentVersion`; the web shows the standard conflict banner and reloads. The board columns are the initiative statuses; moving a card there calls the ADR-0021 transition actions (never a raw PATCH of `status`).

### 4. Dependencies: the canonical T08 record (REQ-PB-051, REQ-PB-052)

**Same table.** T08 uses the DG2 canonical `dependency` table (one record shared by T08 and RAID). `0022` extends it compatibly:

- new nullable columns `from_initiative_id`, `to_initiative_id` (composite FKs within the transformation); CHECKs: an id only with the matching `*_kind = 'initiative'`; `from_initiative_id <> to_initiative_id`;
- `dependency_type` moves from a closed CHECK to an FK onto the new **`dependency_type`** catalogue (code PK).

**The seven T08 columns** (B0081): Dependency (`code` DEP-nn + `description`), From (`from_kind` `initiative` with `from_initiative_id`, or **`external`** with `from_label`), To (`to_kind = 'initiative'`, `to_initiative_id`), Type (`dependency_type`), Needed by (`needed_by` date), Owner (`owner_user_id`), Status / mitigation (`status`, `mitigation`).

**Types (REQ-PB-052).** `dependency_type`: `code`, `label_en`, `label_ar`, `is_system`, `ordinal`, `status` (`active` | `retired`). System rows `decision`, `tech`, `data`, `vendor` (B0081 "Decision / Tech / Data / Vendor") plus `other` (kept as a system row because DG2 rows may use it). System rows cannot be deleted or retired (trigger `dependency_type_system_guard`; no DELETE grant at all). Admins (`dependency_type.configure`, ADM_METHOD) add types (`^[a-z][a-z0-9_]{1,47}$`), edit labels, and retire custom types (`DELETE /dependency-types/{code}` is a soft retire; on a system type it answers **422** `dependency_type.system_undeletable`). The API rejects an unknown or retired type with **422** `dependency.unknown_type` ('Unknown dependency type: {value}'); the FK is the database backstop.

**Paths.** T08 is served at `/api/v1/dependencies` (list needs `transformationId` query; create takes it in the body), `/api/v1/dependencies/{dependencyId}` (GET, PATCH) and `…/archive`, with representation `T08Dependency` (all DG2 fields plus `fromInitiativeId`, `toInitiativeId`, `flags[]`). **The DG2 operations under `/transformations/{id}/dependencies` stay byte-stable:** they return the DG2 `Dependency` representation; a row whose type is not one of the five DG2 values is projected as `dependencyType: "other"` there (the true code is on the T08 path), and a DG2 PATCH may not change `fromKind`/`toKind` of a row that has initiative endpoints (422 `dependency.managed_by_t08`). No DG2 schema changes.

### 5. Cycle detection and schedule conflicts (REQ-S09-008, REQ-PB-051, REQ-S09-004)

**Edge.** `from_initiative_id → to_initiative_id` for every non-archived dependency with both ids set: "From must deliver before To". External predecessors have no edge.

**Algorithm.** On create, or on a change of either endpoint or of status to non-archived, the API (and again the database) looks for a path from `to_initiative_id` back to `from_initiative_id` by breadth-first search over the transformation's edges (≤ 500 initiatives, bounded to 10 000 visited edges). If one exists the new edge closes a cycle; the reported cycle is `from → to → … → from` using the BFS parent chain (shortest cycle through the new edge).

**Race-freedom (the F-DG1-140 pattern).**

1. The API takes `pg_advisory_xact_lock(730221, hashtext(transformation_id))` (`DEPENDENCY_GRAPH_LOCK_CLASS`) at the start of the write transaction, then runs its friendly check, then writes. Every advisory-lock class (730219–730223) is listed in the registry in **ADR-0016 §6**; dependency-type creation (§4) uses its own class **730223**.
2. The **database guard** `dependency_cycle_guard()` (AFTER INSERT OR UPDATE OF `from_initiative_id`, `to_initiative_id`, `status`, `transformation_id`) takes the **same** lock and re-runs the search with fresh READ COMMITTED snapshots, so two concurrent inserts (A→B and B→A) serialize and the second fails. Under REPEATABLE READ/SERIALIZABLE (where the snapshot can predate the lock) the guard refuses to run and raises `40001` so it fails closed; the application uses READ COMMITTED.
3. Error: SQLSTATE `23514`, constraint `dependency_acyclic`, message `dependency cycle: <code> -> <code> -> … -> <code>` (initiative codes).

**422 body** (both API and mapped DB error): `type: urn:mth:problem:validation`, `code: dependency.cycle`, `detail: "Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01"`, `errors: [{pointer: "/toInitiativeId", code: "dependency.cycle", message: <same text>}]`, and the extension member `cycle: [{initiativeId, code, name}, …]` (first element repeated at the end). A→B→A is reported the same way (`INI-01 → INI-02 → INI-01`). Nothing is written.

**Schedule flags (warnings, never rejections).** Computed on read by `portfolio/schedule.ts`, returned in `flags[]` on dependencies, initiatives and the roadmap:

- **Predecessor finish** = the latest `forecast_date` (else `approved_date`) of the predecessor's non-cancelled milestones, else its `planned_end`; unknown when none exists.
- `schedule.needed_by_conflict`: predecessor finish > `needed_by` ('{from} finishes after {to} needs it ({date})').
- `schedule.before_predecessor` ("sequenced before its predecessor", REQ-S09-004): the successor's `planned_start` < predecessor finish, **or** the successor's wave ordinal < the predecessor's wave ordinal.
- `schedule.unknown`: a date needed for either check is missing; shown as Unknown, never as "no conflict".

**Critical path is out of P3 scope.** P3 has no duration-based scheduling model, so it makes no critical-path claim and shows no critical-path highlighting (master prompt: "Critical-path claims must come from defined scheduling logic, not cosmetic highlighting"). The only scheduling logic in P3 is the precedence and date comparison above.

### 6. Resource capacity and demand (REQ-PB-059, REQ-S09-004)

- **`resource_role`** (per transformation): `code`, `label_en`, `label_ar`, `status`. Roles are resourcing roles ("Data engineer"), not access roles.
- **`capacity`**: `resource_role_id`, `period_month` (date, first day of a month; CHECK), `available_fte numeric(6,2) ≥ 0`, `owner_user_id`, `status` (`active` | `archived`); one active row per role and month.
- **`resource_demand`**: `initiative_id`, `resource_role_id`, `period_month`, `demand_fte numeric(6,2) > 0`, `owner_user_id`, `status` `planned` → `committed` → `released`, or `archived`; `committed_by/at`. Committing (`POST /resource-demands/{id}/commit`, `capacity.commit`) is the **capacity commitment** G4 requires; it is recorded by the capacity owner (record-level: the capacity row's owner, or a holder of `capacity.commit` at transformation scope) and is a resourcing commitment, not a business approval.
- **Conflict rule.** For each role and month: `demand = Σ demand_fte` of `planned` + `committed` demand of initiatives that are not `cancelled`/`completed`. `available` = the active capacity row's `available_fte`. `demand > available` → **conflict** (`capacity.over_allocated`, shown with the shortfall `demand − available`, decimal). No capacity row → `capacity.unknown` (Unknown, never "no conflict"). G4 uses committed demand only. `GET /transformations/{id}/capacity` returns the role × month grid with `available`, `demand`, `committedDemand`, `shortfall` and the flag.
- FTE is decimal (`numeric(6,2)`, transport `DecimalString`), never a float.

### 7. Portfolio selection and funding decisions (REQ-S09-003, REQ-S04-006)

- **`portfolio_selection`** (append-only): `initiative_id`, `action` (`selected` | `deselected`), `rationale`, `ranking_snapshot_id`, `decided_by`, `on_behalf_of_user_id`, `decided_at`. The latest row per initiative is the selection state.
- **`funding_decision`** (append-only): `initiative_id`, `decision_id` → a canonical **`decision` row of kind `executive`** (code `DEC-nn`, status `decided`, one decision model, ADR-0015) via the composite FK `(decision_id, 'executive')`; `outcome` (`approved` | `rejected` | `deferred` | `revoked`), `amount numeric(20,4)` (null = Unknown), `currency`, `funding_source`, `conditions`, `rationale` (required), `business_case_id` (optional), `decided_by`, `on_behalf_of_user_id`, `decided_at`, `approver_role_code`. The latest row per initiative decides the funding state; `revoked` needs a prior `approved`.
- Recording one is `POST /api/v1/funding-decisions` (`funding.approve`, business approval, FIN and SP by default). The product records a person's decision; nothing auto-approves or auto-funds. An approved decision moves `selected → funded` in the same transaction (ADR-0021 §3); recording a decision for an initiative that is not selected is 422 `funding.not_selected`.

### 8. Decisions recorded after build (T-DG3-BE-C handback §7; T-DG3-ARCH-03, 2026-10-08)

- **`GET /api/v1/dependency-types` is `authenticated`.** The dependency-type catalogue is global reference data (labels for a closed-plus-configurable code set) with no transformation scope. Every signed-in user may read it, as the frozen contract says: the operation declares no 403. Writes stay behind `dependency_type.configure` (ADM_METHOD). `workflows.test.ts` pins this one GET as `authenticated`; every other workflows GET stays `transformation.read`.
- **`varianceDays` is in calendar days, and stays so.** `Milestone.varianceDays` is `forecastDate − approvedDate` in calendar days, as the contract ("in days") and §2 define it. REQ-S09-007 asks for the forecast slip "in working days". P3 has no business-calendar model (working week, holidays, Asia/Riyadh default, configurable), so a working-day figure cannot be computed honestly now. The field is **not relabelled**. A separate working-day slip, on the configurable calendar with no hard-coded holidays, is added when the business calendar lands in a later stage. REQ-S09-007 (increments P3 and P4, final gate DG4) keeps its working-day part open until then, and P3 does not claim it.
- **T08 schedule flags: explicit injection, not a Fastify decoration.** `workflows` may not import `portfolio`, so the T08 routes read their flags through `T08ScheduleFlagsProvider`. BE-C built this as a Fastify decorator that `portfolio/roadmap.ts` set at registration (`t08ScheduleFlags`, first decorator wins). T-DG3-ARCH-03 switched it to the pattern the G4 `GateFactsProvider` already uses:
  - `portfolio/index.ts` exports `t08ScheduleFlags`;
  - `server.ts` passes it in `registerWorkflowsModule(app, deps, { gateFacts, t08ScheduleFlags })`;
  - `registerT08DependencyRoutes(app, db, scheduleFlags?)` uses it.

  The wiring is now visible in the composition root, does not depend on Fastify encapsulation or on the order modules register in, and has no "first decorator wins" branch. Unwired still fails closed: every scheduled dependency gets `schedule.unknown`, never "no conflict". The behaviour and the contract are unchanged, and the T08 integration tests (`needed_by_conflict`, `schedule.unknown`) run through `server.ts`.
- **One cycle-problem class.** The T08 friendly check throws the platform's `DependencyCycleProblem` (now on `platform/index.ts`; its `CycleNode.name` is filled by T08), the same class the mapped database error uses. BE-C's copy `T08CycleProblem` is deleted. The §5 422 body is byte-identical: `workflows/t08-cycle-problem.test.ts` compares the JSON with a frozen copy of the deleted class, and the T08 integration test checks it over HTTP.
- **Dependency-type creation lock.** Creating a type code serializes on `pg_advisory_xact_lock(730223, hashtext(code))` (`DEPENDENCY_TYPE_LOCK_CLASS`), so that a race answers the friendly 409 rather than a unique violation. Until T-DG3-ARCH-03 it used 730222, which collided with prioritization. Registry: ADR-0016 §6.

### 9. Decisions recorded after wave 4 (T-DG3-BE-E handback §7, T-DG3-FE-B handback §4; T-DG3-ARCH-04, 2026-10-08)

These are the rule, and reviewers test against this text.

- **Commit authority (§6).** Committing and releasing a resource demand (`POST /resource-demands/{id}/commit`, `/release`) need `capacity.commit` (BO and TO by default), checked through the policy function at transformation scope and re-checked at commit. §6's "capacity owner (record-level: the capacity row's owner, or a holder of `capacity.commit`)" is read **conservatively**: being the capacity row's `ownerUserId` grants nothing by itself, so an owner without `capacity.commit` cannot commit. Committing over capacity is allowed, because a commitment records a resourcing decision and does not test it. The over-allocation is then visible as `capacity.over_allocated` on the plan and as `g4.capacity_conflict` at G4.
- **G4 capacity (§6, ADR-0021 §11 item 4).** G4 counts **committed** demand only. A role and month with committed demand and no active capacity row is Unknown, and it is a conflict: 'Capacity conflict: {role} {YYYY-MM}'.
- **Deselect voids funding (§7).** A funding decision counts only for the selection it was recorded under, and re-selection needs a new approved decision. The full rule is in ADR-0021 §11 item 1.
- **Codes and texts** (BE-E's wording, as built; FE-E translates from `code`, Arabic provisional):

| Code | Status | English `detail` |
|---|---|---|
| `funding.not_selected` | 422 invalid-transition | 'Funding can only be approved for a selected initiative' |
| `funding.not_revocable` | 422 invalid-transition | 'Only the funding of a funded initiative that is not launched can be revoked' (revoking needs status `funded`; a launched or unfunded initiative is refused) |
| `funding.amount_invalid` | 422 at `/amount` | 'The funding amount must be zero or more, with at most 16 digits before and 4 after the decimal point.' (so `numeric(20,4)` never rounds silently) |
| `resource_demand.not_planned` | 422 invalid-transition | 'Only a planned resource demand can be changed or committed' |
| `resource_demand.not_committed` | 422 invalid-transition | 'Only a committed resource demand can be released' |
| `resource_demand.release_first` | 422 invalid-transition | 'A committed resource demand must be released before it is archived' |
| `resource_role.code_taken` | 409 | "A resourcing role with the code '{code}' already exists." |
| `capacity.duplicate` | 409 | 'This resourcing role already has active capacity for that month; update that row instead.' |
| `resource_role.archived` | 422 at `/resourceRoleId` | 'The resourcing role is archived.' |

  The source files (`portfolio/funding.ts`, `resource-demands.ts`, `capacity.ts`) are the single place for these texts. This table fixes the codes and their meaning.
- **Cycle path order (§5; FE-B §4.4).** The 422 `dependency.cycle` path runs `from → to → … → from` of the **refused** edge. Which initiative comes first therefore depends on the edge that closes the cycle. The UI shows the server's path verbatim and does not reorder it.
- **Approve-date reason (§2; FE-B §4.7).** The frozen `MilestoneDateApproval` requires `reason` on **every** approve-date call, including the first approval, where it says why that baseline date was chosen. That is stricter than "a mandatory reason on re-approval", and the contract stands. It is not loosened.
- **Dependency-type administration (§8; FE-B §4.5).** The catalogue is global, so the web checks `dependency_type.configure` at any scope it holds (`canAnywhere`), not at transformation scope. The server is unchanged: the permission is held at organization scope (ADM_METHOD).
- **The work board is read-only (§3; FE-B §4.6).** P3's board displays the ADR-0021 status of each card. Status changes are made on the initiative through the ADR-0021 transition actions, and the board does not offer drag-to-transition. This satisfies the §3 rule "moving a card calls the ADR-0021 transition actions" by having no move action, not by adding a second path.
- **Shared mirrors.** The roadmap, T08 and capacity response mirrors are in `@mth/shared/schemas` (`roadmap.ts`; ADR-0021 §11 item 7).

## Alternatives considered

1. **A separate T08 table for initiative dependencies.** Rejected: one canonical dependency record shared by T08 and RAID is a stated rule.
2. **Cycle check only in the API.** Rejected: F-DG1-140 showed two concurrent writers can each pass an API-only check and together commit a cycle.
3. **A serializable transaction instead of the advisory lock.** Rejected: retries leak into every dependency write; the lock is scoped to one transformation's graph.
4. **Weekly capacity periods.** Monthly is what resourcing plans use; weekly can be added later with a `period_kind` column.

## Consequences

- DG2 dependency paths remain stable; T08 functionality lives on the new paths.
- The roadmap endpoint is the single read model the three views share.
- Critical-path analysis needs a duration model and is deferred (P4/P5 if required).

## Verification

- Probe: an insert that closes A→B→A and A→B→C→A is refused by the database with `dependency_acyclic` and the path in the message; deleting a system dependency type is refused; `funding_decision` UPDATE raises.
- Integration: the T08 seven columns round-trip; From `external` accepted; unknown type → 422; system type DELETE → 422; A→B→C→A → 422 naming the cycle; concurrent A→B / B→A (two connections) → exactly one succeeds; predecessor finishing after needed-by → `schedule.needed_by_conflict`; demand above capacity → `capacity.over_allocated`; moving a milestone with a stale If-Match → 409; selected without funding → 'Selected - unfunded' and launch → 422.
