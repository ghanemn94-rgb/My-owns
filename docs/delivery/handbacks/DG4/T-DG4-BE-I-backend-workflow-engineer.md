# Handback T-DG4-BE-I (backend-workflow-engineer): performance areas, links, cycles, BAU handovers and acceptance

- **Stage / gate:** P4 "Execution value and sustainment", DG4 (BUILDING). Section: `docs/architecture/p4-work-split.md` §F+G FG.4.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-I-backend-workflow-engineer-20261009T103435Z-0d587da4","session_id":"0d587da4-1155-458b-9b37-6df8b53d2dd2"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-I.md` (sha256 `31711a0b…9966c`, verified with `sha256sum` at start).
- **Base:** branch `dg4/be-i`, `HEAD` `b1d3b7fcfa8ce42c94edb68a8d4636fbbbc5c3fc` ("DG4: assignments BE-F, FE-B, BE-H, BE-I"). Changes are **uncommitted**, as instructed.
- **Time:** `date -u` at start `Fri Oct  9 10:34:53 UTC 2026`; at end `Fri Oct  9 11:40:31 UTC 2026` (§6).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → exit **0**, `PASS gate DG3 (historical)` (run first, before any edit; log `T-DG4-BE-I-evidence/validate-historical-DG3-start.log`; rerun at the end, §4).
- **Two gate systems.** The receiving-owner acceptance built here is a **business approval inside the product** (product slice G; never DG0–DG7). No code, seed, job or test of this task grants a real business, Finance or IT approval. Every test datum is synthetic; the test "acceptances" are synthetic in-product approvals of test data. Nothing here reads or writes DG0–DG7 records, and product G6 is not touched.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/sustainment/performance-areas.ts` | The 9 area/link operations; the shared slice G write gate (`openSustainmentWrite`), lock helper (730243), `PA`/`HO` code allocation, business-date + review-period helper; the **exported** `scheduleAreaReview(tx, areaId, dueDate, actor?)`. |
| `apps/api/src/modules/sustainment/handovers.ts` | The 8 handover operations: prepare, edit, evidence, submit (M0217 item list, `bau_handover.incomplete`, `bau_handover_to_accept` work item), accept (receiving owner only; acceptance transaction under lock 730243), return. |
| `apps/api/src/modules/platform/db-errors.ts` | New "slices F and G block" with BE-I's lines: `mapP4SustainmentAreaError` (area, link, cycle, handover constraints → §12 codes/texts) and one call line in `mapDatabaseGuardError`. |
| `packages/shared/src/schemas/sustainment-areas.ts` (new) | Zod mirrors of `PerformanceArea*`, `PerformanceAreaCycle`, `PerformanceAreaLink*`, `BauHandover*`, the `AdoptionReason`/`StatusNote` bodies used by slice G (`sustainmentReason`, `sustainmentStatusNote`), `BAU_HANDOVER_ITEMS` (item, English label, pointer). |
| `packages/shared/src/schemas/index.ts` | One export line (+ comment) for the file above (append-only). |
| `apps/api/test/support/p4-pending-be-i.ts` | Emptied: all 17 operations routed. |
| `apps/api/test/integration/contract/p4-exercises-be-i.ts` | `P4_MIRRORS_BE_I` (17 mirrors) and `exerciseP4BeIOperations` (every operation with a success through `ctx.mirrored`); shared fixtures for the sustainment suites (`seedSustainmentWorld`, `insertControl`, `createNoteEvidence`, `fullContent`, `createArea`, `areaInBau`, `closeTransformationSynthetic`). |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin only: `[229, 228, 1]` → `[239, 238, 1]` with the comment line (§5). |
| `apps/api/test/integration/sustainment/handovers.test.ts` (new) | REQ-S11-005, REQ-PB-083 proofs and the handover state machine, gates, If-Match, audit, commit-time auth (10 tests). |
| `apps/api/test/integration/sustainment/performance-areas.test.ts` (new) | Areas, links, gates, If-Match, audit, commit-time auth; REQ-S03-002 (areas half) after closure (7 tests). |
| `apps/api/test/integration/sustainment/reopen.test.ts` (new) | REQ-S11-009 proof and the reopen refusals/gates (3 tests). |
| `docs/delivery/handbacks/DG4/T-DG4-BE-I-backend-workflow-engineer.md`, `T-DG4-BE-I-evidence/*` | This handback and its logs. |

No migration was written (D-099: none free in `0047`–`0050`; none needed, see §7). `sustainment/index.ts`, `server.ts`, `adoption/**` and every other slice's files are untouched.

## 2. API endpoints added (17 operations)

| Operation | Method and path (`/api/v1/transformations/{transformationId}/…`) | Permission (record rule) |
|---|---|---|
| `listPerformanceAreas` | `GET performance-areas` (`?status`, cursor, limit) | `transformation.read` |
| `createPerformanceArea` | `POST performance-areas` → 201 establishing, cycle 1 (+ cycle row) | `performance_area.manage` (BO, TO) |
| `getPerformanceArea` | `GET performance-areas/{a}` (with `cycles`) | `transformation.read` |
| `updatePerformanceArea` | `PATCH performance-areas/{a}` (If-Match) | `performance_area.manage` |
| `reopenPerformanceArea` | `POST performance-areas/{a}/reopen` (If-Match, lock 730243) | `performance_area.reopen` (BO, TL) |
| `retirePerformanceArea` | `POST performance-areas/{a}/retire` (If-Match) | `performance_area.manage` |
| `listPerformanceAreaLinks` | `GET performance-areas/{a}/links` | `transformation.read` |
| `createPerformanceAreaLink` | `POST performance-areas/{a}/links` → 201 | `performance_area.manage` |
| `removePerformanceAreaLink` | `POST performance-areas/{a}/links/{l}/remove` (bodiless, If-Match) | `performance_area.manage` |
| `listBauHandovers` | `GET bau-handovers` (`?performanceAreaId`, `?status`) | `transformation.read` |
| `createBauHandover` | `POST bau-handovers` → 201 draft (lock 730243) | `bau_handover.prepare` (WL, TL) |
| `getBauHandover` | `GET bau-handovers/{h}` (`controlIds`, `evidenceIds`, `openImprovementItemIds`, `missingItems`) | `transformation.read` |
| `updateBauHandover` | `PATCH bau-handovers/{h}` (If-Match) | `bau_handover.prepare` |
| `addBauHandoverEvidence` | `POST bau-handovers/{h}/evidence` → 201 (If-Match) | `bau_handover.prepare` |
| `submitBauHandover` | `POST bau-handovers/{h}/submit` (bodiless, If-Match) | `bau_handover.prepare` |
| `acceptBauHandover` | `POST bau-handovers/{h}/accept` (If-Match) | `bau_handover.accept` **and** caller = receiving owner; ADM-only 403 |
| `returnBauHandover` | `POST bau-handovers/{h}/return` (If-Match) | `bau_handover.accept` **and** caller = receiving owner; ADM-only 403 |

`config.consumes` is `application/json` on the 10 operations with a JSON body and absent on the 2 bodiless POSTs (S-3); the contract test's "every route accepts exactly the request media types its operation declares" passes.

## 3. Behaviour delivered, per requirement row

### REQ-S11-005 — acceptance text: "A11: a handover missing data access is rejected; acceptance by anyone other than the receiving owner returns 403"

- **Missing data access rejected.** `submitBauHandover` checks the ADR-0034 §5 item list before writing and answers **422 `bau_handover.incomplete`**, detail exactly "The BAU handover is incomplete. Missing: data access.", one error per missing item at its field (`/dataAccess`); status, version, submit stamps, audit trail and work items are unchanged (`handovers.test.ts` "a handover missing data access…"). With nothing filled in, all nine items are named in the §12 order with their pointers. `getBauHandover.missingItems` shows the same list before submission. The database CHECK/trigger (`bau_handover_content_complete`, `_controls_required`, `_evidence_required`) stays the last line (mapped in `db-errors.ts`).
- **Anyone other than the receiving owner → 403.** Another BO who holds `bau_handover.accept` gets **403 `bau_handover.not_receiving_owner`** ("Only the receiving owner can accept or return this handover."); WL, TL, TO, FIN and AUD get 403 (they lack `bau_handover.accept`); the ADM-only technical admin gets **403** (REQ-S10-003 via `technicalAdminRefusal`, not 404); an outsider of another organization gets 404. The same rule applies to `returnBauHandover`. Only after all refusals does the receiving owner's acceptance succeed. A delegate does not accept for the receiving owner (D-099): the check is `caller = receiving_owner_user_id`, with no `actsFor`.
- **"The receiving owner accepts or returns it":** return needs a reason (400 `bau_handover.return_reason_required` at `/reason` for missing, blank or too short), closes the My Work item, and a returned handover can be edited and resubmitted (a new My Work item, dedupe on the new version).

### REQ-PB-083 — acceptance text: "A11;A13: accepting a handover creates recurring BAU review tasks for the BAU owner exactly once"

- The acceptance transaction (lock 730243 on the area; `handovers.ts` `acceptHandover`): handover → `accepted` (final) with stamps and optional note; area → `bau` with `current_handover_id`, `bau_owner_user_id` = receiving owner, `kpi_owner_user_id` = the handover's KPI owner, `next_review_date` = acceptance business date (org default calendar timezone, else org timezone; default Asia/Riyadh) + one review period in **calendar** months/weeks (ADR-0034 §5); the `bau_handover_to_accept` item closed; **routine ownership transfer** (every non-archived linked KPI → the KPI owner; every active control without an owner → the receiving owner; every non-archived linked benefit without a BAU owner → the receiving owner and the monitoring cadence as `control_cadence`), each row version + 1 with its audit event; and the **first recurring review** through `scheduleAreaReview` (`sustainment_review` for the BAU owner, cycle, due date, audit event, `performance_review_due` work item with dedupe `sustainment.review:<areaId>:<dueDate>`).
- **Exactly once:** the test asserts one review and one My Work item for the BO; a repeated acceptance is **422 `bau_handover.accepted_final`** and creates nothing; calling `scheduleAreaReview` again for the same area and date returns `{outcome: "existing"}` and creates no row or work item (`INSERT … ON CONFLICT` on `sustainment_review_due_key`). "Recurring": the next reviews are created by BE-I2's `sustainment.review_scan` through the same exported function (§8).
- The test also asserts the transfer (KPI owner and version + 1 with audit `kpi_definition.ownership_transfer`; ownerless control → BO, owned control unchanged; benefit BAU owner and `control_cadence = monthly`) and the next review date computed by PostgreSQL month arithmetic.

### REQ-S11-009 — acceptance text: "A07;A11: after reopening, the original handover acceptance and closure date remain visible and unchanged"

- `reopenPerformanceArea` (BO, TL; lock 730243): only from `bau`; writes the next `performance_area_cycle` row with the reason and, copied as they are, the prior accepted handover id, acceptance time and acceptor and the origin transformation's closure record id and closure time; the area moves to `reopened` with `cycle_no + 1`, keeps `current_handover_id` on the prior accepted handover, and its next review date becomes NULL ("not scheduled"). Nothing is updated on the handover or the closure record.
- `reopen.test.ts`: the transformation is closed (synthetic closure fixture, §7), the BAU area reopened; `getPerformanceArea` returns cycle 1 unchanged and cycle 2 with `priorHandoverAcceptedAt`/`priorHandoverAcceptedBy` equal to the original acceptance and `priorClosureRecordId`/`priorClosedAt` equal to the closure; the `bau_handover` row and the `closure_record` row are **deep-equal** before and after; `getBauHandover` of the original still shows `accepted` with the same stamps. A cycle-2 handover is then accepted and the area returns to BAU with both cycles still listed and the same prior stamps.
- Refusals: 400 `performance_area.reopen_reason_required` at `/reason`; 422 invalid-transition `performance_area.not_reopenable` (establishing, reopened); 422 `performance_area.retired`; AUD, TO, WL 403; ADM-only and outsider 404; If-Match 428/409; one audit event per cycle row.
- A07 (the rendered screen) is FE-E's (`pages/bau/**`); this task delivers the API data it renders.

### REQ-S03-002 (areas) — acceptance text: "A11: after a transformation is closed its linked performance area still generates scheduled review tasks and accepts KPI actuals"

- BE-I's half (FG.10: "BE-I, BE-I2"): no slice G guard reads the transformation's status; only the DG1 `archived_at` rule applies. `performance-areas.test.ts` closes the transformation (status `closed`, `archived_at` NULL, closure record present) and shows the area still takes edits, links, and a complete handover → acceptance → BAU with its review scheduled for the BAU owner.
- **Not proven by this task** (BE-I2's half): the *periodic* `sustainment.review_scan` creating the *next* review on time after closure, and the KPI accepting an actual after closure (FG.5 proofs, worker test `sustainment-scans`). I did not claim those.

## 4. Checks actually run (final tree)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; PostgreSQL from `tests/qa/support/with-pg.sh` (disposable cluster, UTF8, C locale); ports 24100–24149 only.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | `validate-historical-DG3-start.log` |
| 2 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (every batch) | `format.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 607 operations` (contract unchanged by this task) | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (LANG/LC_* unset) | 0 | unit-node+unit-web **115 files, 2208 passed**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped** (the pre-existing fuzz skips, same as D-101) | `unit-locale-unset.log` |
| 8 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | unit-node+unit-web **115 files, 2208 passed**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped** (same pre-existing skips) | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=24100 MTH_PORT_POOL=24101-24149 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **109 files, 1219 tests passed** (D-101 baseline 1199 + this task's 20: `handovers` 10, `performance-areas` 7, `reopen` 3; `contract.test.ts` 45 incl. "P4 BE-I operations"); PostgreSQL 16.13, fresh database, 55 migrations; started 11:27:45 UTC | `integration.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` | `validate-historical-DG3-end.log` |

**Disclosed non-zero exits during development (all fixed before the final runs above):**
- First targeted integration run (`with-pg.sh npx vitest run --project integration apps/api/test/integration/sustainment …/contract.test.ts`): exit 1, 2 failed / 63 passed. Cause: my closure fixture used `SET session_replication_role`, which the test owner role may not set ("permission denied"). Rewritten as `mth_owner` (disable only `closure_record_guard` inside the fixture's transaction); second run failed with "cannot ALTER TABLE … pending trigger events" (deferred audit trigger), fixed with `SET CONSTRAINTS ALL IMMEDIATE` before re-enabling. Third run: exit 0, 20/20. (Logs of these iterations were in `$TMPDIR` and are not kept; the final runs are in the evidence directory.)
- First `pnpm test` (both locales): exit 1, 1 failed / 2207 passed — `architecture.test.ts` flagged 8 computed member accesses with non-literal keys in my two route files (module-interface check). Rewritten with `Map`s; the architecture test then passed (137/137) and the full reruns in rows 7–8 are the final results.

## 5. Contract seams and pins

- **Pending-list delta (`p4-pending-be-i.ts`): −17 → empty.** Removed: `listPerformanceAreas`, `createPerformanceArea`, `getPerformanceArea`, `updatePerformanceArea`, `reopenPerformanceArea`, `retirePerformanceArea`, `listPerformanceAreaLinks`, `createPerformanceAreaLink`, `removePerformanceAreaLink`, `listBauHandovers`, `createBauHandover`, `getBauHandover`, `updateBauHandover`, `addBauHandoverEvidence`, `submitBauHandover`, `acceptBauHandover`, `returnBauHandover`. Each is exercised with a success (and the key refusals) through `ctx.mirrored` in `p4-exercises-be-i.ts`, and each success body is parsed by its zod mirror (`P4_MIRRORS_BE_I`, 17 entries). `contract.test.ts` "P4 BE-I operations" passes.
- **Media-type pin delta: +10 JSON bodies** (`createPerformanceArea`, `updatePerformanceArea`, `reopenPerformanceArea`, `retirePerformanceArea`, `createPerformanceAreaLink`, `createBauHandover`, `updateBauHandover`, `addBauHandoverEvidence`, `acceptBauHandover`, `returnBauHandover`); `removePerformanceAreaLink` and `submitBauHandover` are bodiless. Pin at my base `[229, 228, 1]` → `[239, 238, 1]`. The orchestrator reconciles with the concurrent pins (BE-F, BE-H, …).
- **Integration pinned counts:** no count pin changed by this task other than the media-type pin above. The integration total grows by my 20 new tests (3 files).

## 6. Time

- Start: `Fri Oct  9 10:34:53 UTC 2026`. End: `Fri Oct  9 11:40:31 UTC 2026` (about 66 minutes; within the 2-hour limit).

## 7. Contract, schema and design needs (for the orchestrator)

No migration is needed for what this task delivers. Items to decide:

1. **Benefit `control_cadence` has no `weekly`, and spells `semiannual`.** `benefit.control_cadence` (0037) allows `monthly, quarterly, semiannual, annual`; the handover's `benefit_monitoring_cadence` (0048) allows `weekly, monthly, quarterly, semi_annual, annual`. On acceptance I map `semi_annual → semiannual` and, for `weekly`, set the BAU owner but **leave `control_cadence` unchanged** (never a guessed value). If a weekly cadence must reach the benefit, the `benefit_control_cadence` CHECK needs `weekly` (repair-range migration, `0058`–`0069`).
2. **Receiving owner on a returned handover.** CHECK `bau_handover_returned_stamps` requires `returned_by = receiving_owner_user_id` while the stamps exist, and the stamps stay after a return (also through resubmission). So a returned handover cannot change its receiving owner. The API refuses that edit first with 422 `validation.not_applicable` at `/receivingOwnerUserId` ("A returned handover keeps the receiving owner who returned it."). ADR-0034 §12 has no code for this; if a different code or behaviour is wanted (for example clearing the return stamps on edit), it needs an ADR line and possibly a CHECK change.
3. **No ADR code for "link already removed".** `removePerformanceAreaLink` on a removed link answers the platform's generic 422 invalid-transition (`invalid_transition`, "This link is removed; a removed link is final."). Add a §12 code if one is wanted.
4. **`scheduleAreaReview` and the worker.** It is exported from `apps/api/src/modules/sustainment/performance-areas.ts` with signature `(tx, areaId, dueDate, actor?)` (the actor defaults to the service actor, source `worker`, S-13). ADR-0002 rule 5 forbids `apps/worker` importing API code, so BE-I2's scan handler cannot import it directly. As with `createWorkItemOnce`, BE-I2 may need a worker-side twin over the same `@mth/db` calls (and a parity test), or the orchestrator decides another seam. The function's contract: insert-if-absent on `sustainment_review_due_key` (`ON CONFLICT (subject_kind, (coalesce(performance_area_id, transition_decision_id)), due_date) DO NOTHING`), audit `sustainment_review.create`, work item `performance_review_due` with dedupe `sustainment.review:<areaId>:<dueDate>`, link `/transformations/<t>/performance-areas/<areaId>`, message key `sustainment.task.performance_review_due` (params `areaCode`, `dueDate`).
5. **Re-acceptance on the same business date.** After reopen and a same-day re-acceptance, the new next review date equals the cycle-1 review's due date, so `sustainment_review_due_key` keeps the existing (cycle-1) review and no cycle-2 row is created for that date. This is the exactly-once rule as designed; the cycle-1 review is not cancelled on reopen (the ADR is silent). BE-I2 / the ADR owner may want reopen to cancel the open review of the prior cycle.
6. **Ownership transfer writes `kpi_definition` and `benefit` directly.** FG.4 says "slice A's KPI update path and slice B's benefit update path (version + 1, audit)", but neither module exports an owner-update service, and those files are not mine. I update the rows from `handovers.ts` with version + 1 and one audit event each (`kpi_definition.ownership_transfer`, `benefit.ownership_transfer`, `control.ownership_transfer`), skipping archived rows (the 0037 trigger refuses changes to an archived benefit). If slice A/B owners prefer their own service, they can export one and this call can switch.
7. **i18n keys requested from FE-A/FE-E** (S-6): problem codes `performance_area.retired`, `performance_area.not_reopenable`, `performance_area.reopen_reason_required`, `performance_area_link.exists`, `bau_handover.incomplete`, `bau_handover.not_receiving_owner`, `bau_handover.status_transition`, `bau_handover.frozen`, `bau_handover.accepted_final`, `bau_handover.area_not_open`, `bau_handover.exists`, `bau_handover.return_reason_required`; work-item message keys `sustainment.task.bau_handover_to_accept` (params `handoverCode`, `areaCode`, `areaName`) and `sustainment.task.performance_review_due` (params `areaCode`, `dueDate`).
8. **Test fixture for closure.** Until BE-J routes `closeTransformation`, `closeTransformationSynthetic` (in `p4-exercises-be-i.ts`) closes a transformation as `mth_owner`: inside one transaction it disables only `closure_record_guard` (the G6 check), writes the closure record and `status = 'closed'` with audit events, and re-enables the trigger. It creates **no** G6 approval. BE-J may replace it with the real action.

## 8. What remains

- Test-depth note: the retire action's audit event is enforced by the database (`performance_area_audit_required`, deferred, would fail the commit) and exercised by the retire tests, but no test asserts the `performance_area.retire` audit row explicitly (the update, reopen, link, cycle and handover audit rows are asserted). A one-line assertion can be added in repair if a reviewer wants it.

- Nothing of FG.4 is left open. The items in §7 are decisions for the orchestrator, not unfinished work.
- Owned by others (not claimed here): BE-I2 (controls API, checks, reviews completion, the two scans incl. the *next* reviews after closure and KPI actuals after closure for REQ-S03-002 / REQ-S11-004), BE-J (closure actions), FE-E (screens, A07).

## 9. Merge instructions

- No migrations. Apply as one change; no ordering constraint except the `db-errors.ts` "slices F and G block": BE-H (concurrent) also opens this block. Expect a textual conflict in `platform/db-errors.ts` at the end of the file and in `mapDatabaseGuardError` (one call line each); keep both functions and both call lines.
- `contract.test.ts` media-type pin: reconcile `+10` with the concurrent tasks' deltas.
- `packages/shared/src/schemas/index.ts`: append-only line; concurrent tasks append theirs (keep all).
