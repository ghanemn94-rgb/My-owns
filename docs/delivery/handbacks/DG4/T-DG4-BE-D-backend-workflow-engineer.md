# Handback T-DG4-BE-D (backend-workflow-engineer): the T15 RAID register, Dependency entries through T08, actions

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING). Section: `docs/architecture/p4-work-split.md` §E.1.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-D.md` (sha256 `3147ca00…f7fb2ddb7f650`, checked at start).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-D-backend-workflow-engineer-20261009T070241Z-f6f9b7e6","session_id":"f6f9b7e6-e3db-4d89-afdc-db9cafb2822d"}`.
- **Working tree:** worktree `/home/user/wt/dg4-be-d`, branch `dg4/be-d`, base `HEAD` `588fe12875ce9d88c819034ec277aa5c3ab9dae9` (D-098). Changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** `date -u` at start `Fri Oct  9 07:02:59 UTC 2026`; at the end, see §6.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, **exit 0**, at the start and again at the end (`T-DG4-BE-D-evidence/validate-dg3-historical-at-start.txt`, `validate-dg3-historical.txt`).
- **Gates:** nothing here is a business approval. Closing a RAID entry or resolving a dependency is an operational record change, not a G1–G6 decision. Nothing reads or writes the engineering records DG0–DG7. All test and exercise data is synthetic.

## 1. Changed files

| File | Status | Purpose |
|---|---|---|
| `apps/api/src/modules/raid/register.ts` | new | `listRaidEntries`, `createRaidEntry`, `getRaidEntry`, `updateRaidEntry`, `closeRaidEntry`, `getRaidDecisionLog`. Reads `raid_register`; `R`/`A`/`I` codes from `record_code_counter`; the ADR-0031 §11 refusals |
| `apps/api/src/modules/raid/dependency-port.ts` | new | The `RaidDependencyPort` interface the module consumes (ADR-0031 §2): `lock`, `create`, `update`, `resolve` |
| `apps/api/src/modules/raid/actions.ts` | new | `listRaidEntryActions`, `createRaidEntryAction`, `listActionRegister`, `getActionRegisterItem`, `updateActionRegisterItem`; the `raid_action_due` work item through `createWorkItemOnce`; the exported `createLinkedAction` for BE-D2 |
| `apps/api/src/modules/raid/routes.ts` | edited (stub) | BE-D's registration lines (first); BE-D2 appends after |
| `apps/api/src/modules/raid/index.ts` | edited (stub) | The port parameter of `registerRaidModule` (`{ dependencies?: RaidDependencyPort }`); exports the port types and `createLinkedAction` |
| `apps/api/src/modules/raid/raid.test.ts` | edited (BE-A's module suite) | 5 new unit tests: probability rule, `raid.type_invalid`, db-error mappings, `sourceKind`/`overdue` |
| `apps/api/src/modules/workflows/t08-dependencies.ts` | edited (appended only) | The exported `raidDependencyPort` implementation. It reuses T08's `nextCode("DEP")`, `assertActiveType`, `assertAcyclic` and `lockGraph`. No T08 route, schema or text changed (`git diff` shows additions only, after the last existing line) |
| `apps/api/src/server.ts` | edited (2 lines) | The wiring line `registerRaidModule(app, deps, { dependencies: raidDependencyPort })`, plus its one import line (the KBE-C precedent of importing a workflows file directly). See §5 item 7 |
| `apps/api/src/modules/platform/db-errors.ts` | edited | The slice E block: a new `mapP4RaidError` with the RAID and action lines (ADR-0031 §11), and its dispatch line in `mapDatabaseGuardError`. BE-D2 and BE-E append their lines inside `mapP4RaidError` |
| `packages/shared/src/schemas/raid.ts` | new | Zod mirrors: `raidEntry(+Page)`, `raidEntryCreate`, `raidEntryUpdate`, `raidEntryClose`, `raidAction(+Page)`, `raidActionCreate`, `raidActionUpdate`, `raidDecisionLogItem(+Page)`; `raid.type_invalid` on `/type` |
| `packages/shared/src/schemas/index.ts` | edited (+3 lines) | Its `export * from "./raid.ts"` line |
| `apps/api/test/support/p4-pending-be-d.ts` | edited | Emptied (11 → 0) |
| `apps/api/test/integration/contract/p4-exercises-be-d.ts` | edited (stub; **first**) | Exercises all 11 operations through `ctx.mirrored`; `P4_MIRRORS_BE_D` |
| `apps/api/test/integration/contract/contract.test.ts` | edited (pin line + comment) | Media-type pin `[205, 204, 1]` → `[210, 209, 1]` (as the assignment instructs) |
| `apps/api/test/integration/raid/register.test.ts` | new | 15 tests |
| `apps/api/test/integration/raid/dependency-entries.test.ts` | new | 9 tests |
| `apps/api/test/integration/raid/actions.test.ts` | new | 8 tests |
| `docs/delivery/handbacks/DG4/T-DG4-BE-D-backend-workflow-engineer.md`, `…/T-DG4-BE-D-evidence/*` | new | This handback and its logs |

- **No migration.** The section gives BE-D no number, and none was needed.
- **No new fixture file.** The integration tests and exercises **import** (read-only) `seedBenefitWorld`, `extraUser` and `insertInitiative` from `test/integration/benefits/fixtures.ts` (KBE-D's).

## 2. Behaviour delivered, per requirement row

### REQ-PB-079: Implement Template 15 RAID as a native register

Acceptance (quoted): **"A01: T15 persists all 9 columns; Type outside Risk/Assumption/Issue/Dependency is rejected"**.

- **All nine columns persist.** `register.test.ts` › "a Risk persists all nine T15 columns on create and read; Status is Open; ID R-nn":
  - ID, Type, Description, Impact, Probability, Owner, Due, Mitigation / action and Status are created through the API.
  - They read back unchanged through `getRaidEntry` (AUD session) and match the `raid_entry` row column by column.
  - Status is `open` by default.
- **Codes.** Risk, Assumption and Issue get `R-nn`, `A-nn` and `I-nn` (D-089 Q5). A Dependency entry keeps `DEP-nn` (`dependency-entries.test.ts`).
- **Type rejected.** A Type outside the four is **400** `urn:mth:problem:validation` with the error `{ pointer: "/type", code: "raid.type_invalid", message: "Type must be Risk, Assumption, Issue or Dependency." }`, and nothing is written.
  - Checked for `"opportunity"`, `"Risk"`, `""`, `7` and `null` (`register.test.ts`), in the contract exercise (`type: "opportunity"`) and in the unit test.
  - `parseRaidCreate` rewrites the `/type` error of the zod parse, so any other field errors keep their own codes.
- **Who may write.** Create and edit are limited to WL, TL and TO through `raid.edit`, and the register is `view:scoped`. BO, FIN and AUD get 403; ADM-only and outsiders get 404 (see "Authorization, concurrency and audit" below).

### REQ-PB-080: Set T15 Probability to n/a for Assumption, Issue and Dependency entries

Acceptance (quoted): **"A01: an Issue with Probability H is rejected; a Risk without Probability is rejected"**.

- **Issue or Assumption with Probability `high`:** 422 `raid.probability_not_applicable`, detail "Probability is n/a for Assumption, Issue and Dependency entries; leave it empty.", error at `/probability`. Nothing is written.
- **Risk without Probability (absent or `null`):** 422 `raid.probability_required`, detail "A Risk needs a Probability (High, Medium or Low).", at `/probability`. Nothing is written.
- **The same rules on update:** a Risk cannot lose its Probability, and an Issue cannot gain one (`register.test.ts`, "T15 Probability").
- **Dependency entries:** 422 `raid.probability_not_applicable` on create and update. Their `probability` is always `null`, since a dependency has no probability column (`dependency-entries.test.ts`).
- **Order of checks:** these are returned before the database refuses. The last-line mapping of `raid_entry_probability_applicable` (by the failing row's `entry_type` column) is unit-tested.

### REQ-PB-078: Integrate RAID and decisions so dependencies and decisions are single canonical records

Acceptance (quoted): **"A01: editing a dependency's owner in T08 changes the same RAID entry; there is no second copy"**.

- **T08 owner edit, one row.** `dependency-entries.test.ts` › "A01: …":
  - A dependency is created and its owner edited through the T08 API (`POST`/`PATCH /api/v1/dependencies`).
  - `getRaidEntry` of the **same id** then shows the new owner at the **same version** (ETag `"2"`).
  - `listRaidEntries` (paged to the end) has **exactly one** row for that id.
  - No `raid_entry` row is ever written: the row count is unchanged, and there is no `raid_entry` row with that id.
- **RAID create, one record.** A Dependency entry created through RAID is listed by `listT08Dependencies` with its `DEP-nn` code, exactly once (`fromKind`/`toKind`/`dependencyType` `other` when no endpoints are named, ADR-0031 §2). Its `impact` is stored on `dependency.impact`, and the T08 representation still does not show it.
- **Writes go to the canonical row.**
  - A RAID update changes the canonical row: T08 reads the new owner, needed-by and mitigation at the same version.
  - A RAID close resolves it.
  - Each is audited on the `dependency` record (`dependency.create`, `dependency.update`; the close carries the closure note as the audit `reason`).
- **T08 rules hold on the RAID path:** `dependency.cycle`, `dependency.unknown_type` and `dependency.self` all return 422.
- **One decision model.** `getRaidDecisionLog` returns the open `raid_register` rows plus the open `decision` rows of kinds `design` and `executive`, from their canonical records, with no copied fields beyond the listed columns. In the test: an open Risk and a design decision created through `/api/v1/decisions` are listed, and a closed Risk is not.

### REQ-S16-018: the RAID, decisions and approvals entity group (BE-D's halves: Risk, Assumption, Issue, Action)

Acceptance (quoted): **"A09: the ERD and migrations contain every entity listed (Risk, Assumption, Issue, Action, Decision, ChangeRequest, Approval) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced"**.

- **Delivered by BE-D:**
  - Risk, Assumption and Issue are created and read through `/raid`, each with AUD 403 on the write and 404 outside scope (`register.test.ts`).
  - Action is created and read through `/raid/{id}/actions` and `/action-register`, with AUD 403 and ADM-only/outsider 404 (`actions.test.ts`).
- **Not complete.** The single entity-group test (`test/integration/raid/entity-group.test.ts`, ADR-0031 §12) belongs to **BE-D2**. ChangeRequest belongs to **BE-L** (slice H). REQ-S16-018 must stay open until both land.

### Authorization, concurrency and audit (S-4; ADR-0031 §9)

- **Write gate.** Every mutation runs, in order:
  1. a request-time read gate (ADM-only and outsiders get **404**);
  2. the permission (AUD and roles without the right get **403**, re-checked **at commit time** on reloaded grants);
  3. validation (400);
  4. `If-Match` (**428** when missing; **409** with `currentVersion` when stale; creates are version 1 with ETag `"1"`);
  5. the write and **one audit event in the same transaction**. There is no remote I/O inside the transaction.
- **Permissions per write:**
  - Risk, Assumption and Issue: `raid.edit`.
  - Dependency entries: `raid.edit` **and** `dependency.edit`. TD, which holds `dependency.edit` only, gets 403.
  - Actions: `action.edit`, or `action.update_own` for the caller's own action. A WL may create an action for itself only; creating one for someone else is 403.
- **Tests for each item:** AUD/BO/FIN 403 with nothing written; ADM-only and outsider 404 on every operation; 428/409; the audit sequence with prior and new versions; and a commit-time revoke → 403 with nothing written, for create, entry update, dependency-entry update, action create and action update.

### Actions (ADR-0031 §4)

- **Linked actions.** An action linked to a Risk sets `raidEntryId`; one linked to a Dependency entry sets `dependencyId`. It carries `followUpDate` and is person-authored (`createdBy` set).
- **Work item.** The owner gets one `raid_action_due` work item (dedupe `raid.action:<actionItemId>:<ownerUserId>`, due = the action's due date, `messageKey: "raid.task.action_due"`).
  - An owner change cancels the previous owner's open item and creates the new owner's.
  - `done` or `cancelled` closes the item with that status.
- **Closed entries.** A closed entry refuses new actions: 422 `raid.closed`.
- **Action register.** It lists every action of the transformation. DG2 actions appear as `sourceKind: "none"`. Filters: `sourceKind`, `ownerUserId`, `status`, and `overdue` (due date before today's business date while `open`/`in_progress`; never when `done`).
- **Transitions.** Updates follow the DG2 transitions, with 422 `invalid_transition` "The record cannot move from cancelled to done."
- **DG2 stays byte-stable.** `POST`/`GET …/actions` show no P4 field.

## 3. Checks actually run

Environment for all runs:
- Node 24.21.0, offline; worktree `/home/user/wt/dg4-be-d`.
- Integration runs use a disposable PostgreSQL 16.13 (UTF8, C collation) from `tests/qa/support/with-pg.sh`, with `QA_PG_PORT=23500` and `MTH_PORT_POOL=23501-23549` (my 23500–23549 range).
- Empty `.claude/.cc-writes` directories inside source folders were removed before the test runs.

| # | Command | Exit | Result | Log (`docs/delivery/handbacks/DG4/T-DG4-BE-D-evidence/`) |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | all packages | `typecheck.txt` (final run, §6) |
| 2 | `pnpm -r build` | 0 | all packages | `build.txt` (final run, §6) |
| 3 | `pnpm lint` | 0 | — | `lint.txt` (final run, §6) |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.txt` (final run, §6) |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 485 operations` (contract unchanged by this task) | `openapi-lint.txt` |
| 6a | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | Vitest 1: **2085 passed** (106 files); Vitest 2: **259 passed, 2 skipped** (3 files) | `unit-locale-unset.txt` |
| 6b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | Vitest 1: **2085 passed** (106 files); Vitest 2: **259 passed, 2 skipped** (3 files) | `unit-c-utf8.txt` |
| 7 | `QA_PG_PORT=23500 MTH_PORT_POOL=23501-23549 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **1094 passed** (92 files) | `integration.txt` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical.txt` |

**Count deltas against D-098** (unit 2080 + 259/2, integration 1062):
- Unit: **+5**, the new `raid.test.ts` cases.
- Integration: **+32**, the three new `raid/*.test.ts` files (15 + 9 + 8). `contract.test.ts` keeps its 45 tests; the BE-D exercise `it` already existed and now does work.
- **Pinned count change:** the media-type pin goes `[205, 204, 1]` → **`[210, 209, 1]`**, a delta of **+5 JSON bodies**: `createRaidEntry`, `updateRaidEntry`, `closeRaidEntry`, `createRaidEntryAction`, `updateActionRegisterItem`. The operation-count pin (485) is unchanged.

**Non-zero exits and failures during the work (disclosed):**
1. **`raid-register-run1-failed.txt`.** The first run of `register.test.ts` had 3 failures; all were fixed before the final runs.
   - ADM-only got **403** on writes, not 404: `openWrite(…, { atCommit: true })` turns a read-gate 404 into a commit-time 403. Fix: a request-time `requireTransformationRead` before the commit-time gate, as T08's `createDependency` does. ADM-only now gets 404 (ADR-0031 §9), and a right revoked mid-request still gets 403.
   - Two failures came from my tests using `limit=200`, above the maximum of 100 (400). Fixed in the tests.
2. **`raid-run2-failed.txt`.** One failure. T08's unchanged `updateT08Dependency` refuses a RAID-created dependency without a To initiative (422 `dependency.to_required`). The test now asserts this behaviour explicitly and sets a To initiative where it needs T08 edits. This is an interop gap, reported in §5 item 1.
3. **`unit-locale-unset.run1-failed.txt` and `unit-c-utf8.run1-failed.txt`.** The first unit runs had two failures.
   - **`apps/api/src/architecture.test.ts`, both locales.** My `register.ts` used two computed member accesses with non-literal keys, which the F-DG1-124 rule forbids. Fixed by replacing them with explicit code; the test now passes.
   - **`apps/web/src/auth/session-identity.test.tsx`, locale-unset run only.** "Unable to find an element with the text: No transformations yet". This is not in my files; it passed in the C.UTF-8 run and in both final runs, so I classify it as **flaky**.
4. `raid-run3-pass.txt` (the RAID files alone, 32/32) and `contract-only.txt` (45/45) are intermediate passing runs. They came before the architecture-lint fix (a pure refactor of two expressions); runs 6–7 above came after it.

## 4. Operations routed (delta to my pending list)

`apps/api/test/support/p4-pending-be-d.ts`: **11 → 0**. Each operation is exercised through the validating client in `p4-exercises-be-d.ts` and mirrored in `P4_MIRRORS_BE_D`:

| Operation | Route | Mirror |
|---|---|---|
| `listRaidEntries` | `GET /api/v1/transformations/{t}/raid` | `raidEntryPage` |
| `createRaidEntry` | `POST /api/v1/transformations/{t}/raid` | `raidEntry` |
| `getRaidEntry` | `GET /api/v1/transformations/{t}/raid/{raidEntryId}` | `raidEntry` |
| `updateRaidEntry` | `PATCH /api/v1/transformations/{t}/raid/{raidEntryId}` | `raidEntry` |
| `closeRaidEntry` | `POST /api/v1/transformations/{t}/raid/{raidEntryId}/close` | `raidEntry` |
| `listRaidEntryActions` | `GET /api/v1/transformations/{t}/raid/{raidEntryId}/actions` | `raidActionPage` |
| `createRaidEntryAction` | `POST /api/v1/transformations/{t}/raid/{raidEntryId}/actions` | `raidAction` |
| `getRaidDecisionLog` | `GET /api/v1/transformations/{t}/raid-decision-log` | `raidDecisionLogPage` |
| `listActionRegister` | `GET /api/v1/transformations/{t}/action-register` | `raidActionPage` |
| `getActionRegisterItem` | `GET /api/v1/transformations/{t}/action-register/{actionItemId}` | `raidAction` |
| `updateActionRegisterItem` | `PATCH /api/v1/transformations/{t}/action-register/{actionItemId}` | `raidAction` |

Every request body is `application/json`, equal to the route's `config.consumes` (S-3). The contract test's `consumesDrift` check passes.

## 5. Contract or schema needs, and interpretations, for the orchestrator

1. **Interop gap: a RAID Dependency entry without a To initiative cannot be edited on the T08 path.** ADR-0031 §2 maps a RAID create without endpoints to `to_kind = other`. T08's unchanged `updateT08Dependency` requires a To initiative (422 `dependency.to_required`, "A T08 dependency's To is an initiative: set toInitiativeId."). So:
   - such an entry is listed and read by T08, edited and closed through RAID, and editable on T08 once a `toInitiativeId` is given;
   - REQ-PB-078 A01 (a T08 owner edit) holds for every dependency with a To initiative, which includes all T08-created ones.

   Options, for the orchestrator to decide: accept this as documented; have FE-D require a To initiative on the RAID form; or reopen T08's update rule (a DG3 change, not mine).
2. **`in_progress` on a Dependency entry is refused** with 422 `raid.status_transition`. A dependency has no In-progress status: its RAID status is Open (`open`/`at_risk`) or Closed (`resolved`). `status: "open"` is accepted and keeps `at_risk`. This is an interpretation; ADR-0031 does not state it.
3. **A closed Dependency entry shows `closedAt`, `closedBy` and `closureNote` as `null`.** The `dependency` row has no such columns. The closure note is recorded as the audit event's `reason`, and `recordStatus: "resolved"` shows the closure. A schema change (closure columns on `dependency`) would need a repair-range migration. I did not request one.
4. **One extra 400 error code: `validation.not_applicable`.** It is returned when a non-Dependency create names `fromInitiativeId`, `toInitiativeId` or `dependencyType`, or when a Dependency create gives conflicting `initiativeId` and `toInitiativeId`. It is a field error in a 400 `validation` problem, not one of the §11 problem codes. **FE-A must translate it**, along with the work-item message key `raid.task.action_due` (parameter `sourceCode`, e.g. `R-01`).
5. **`initiativeId` on a Dependency entry is its T08 To initiative** (the `raid_register` mapping). Changing it through RAID re-runs the cycle guard under the graph lock. Setting it to `null` on an edge with a From initiative gives T08's 422 `dependency.to_required`.
6. **`createLinkedAction` takes `(ctx: WriteContext, link, body)`, not `(tx, link, body)`.** The context carries the transaction, the audit context and the organization. BE-D2 calls it after `openActionCreate` (exported), its own locking, and refusing a closed case.
7. **`server.ts` has two changed lines**: the wiring line, plus the one `import { raidDependencyPort } from "./modules/workflows/t08-dependencies.ts"` line it needs. `workflows/index.ts` is not mine, so I used the KBE-C precedent of a direct import.
8. **ADM-only callers get 404 on writes** (ADR-0031 §9: "they get 404 on these transformation-scoped operations"). Slice B's precedent answers 403 instead. Both are non-disclosing, but they differ across slices.
9. **Work-item edge cases** follow from `createWorkItemOnce`'s dedupe:
   - reassigning an action back to an earlier owner does not create a second item for that owner (the cancelled one is "existing");
   - reopening a `done` action does not recreate its item.
10. **`db-errors.ts`:** `mapP4RaidError` is the slice E function. BE-D2 and BE-E add their lines inside it (after BE-D's). It is reached through `mapDatabaseGuardError` and is not exported from `platform/index.ts`.

## 6. What remains, and merge instructions

- **In BE-D's scope:** nothing open beyond the interpretations in §5.
- **REQ-S16-018:** stays open until BE-D2's entity-group test and BE-L's ChangeRequest land.
- **Separable second half (§E.2, BE-D2):** not part of this task. That is corrective cases, rules, signals, the four worker consumers, the entity-group test and its 11 operations (`p4-pending-be-d2.ts`).
- **Merge:** no migration to run.
- **Expected textual conflicts with tasks running in parallel:**
  - the pin line and comment in `contract.test.ts` (sum the JSON-body deltas);
  - the dispatch block in `mapDatabaseGuardError` (`db-errors.ts`);
  - `packages/shared/src/schemas/index.ts` (append-only lines);
  - `server.ts` (import block and module list).
- **Order:** BE-D2 must merge after this change (it appends to `raid/routes.ts`, `p4-exercises-be-d.ts` and `mapP4RaidError`, and reuses `createLinkedAction`).

**Final static checks** (rerun after this handback was written, so they cover the final tree; logs overwritten in place): see `typecheck.txt`, `build.txt`, `lint.txt` and `prettier.txt`. Each log's last line is its exit code. The end time is in `end-time.txt`.
