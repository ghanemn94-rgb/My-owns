# Handback T-DG5-BE-E3 (backend-workflow-engineer): closing BE-E2's bulk-edit gap (D-159 a)

- **Stage / gate:** P5, DG5 (BUILDING). Task T-DG5-BE-E3, a follow-up task to p5-work-split §B.4 (D-159 a).
- **Invocation:** `DG5-T-DG5-BE-E3-backend-workflow-engineer-20261016T070251Z-8f7eea60`, session `8f7eea60-3ae3-4fbe-8073-7507f87f59fc`.
- **Base:** branch `dg5/be-e3` at `b2d030f` (the integrated `HEAD`). The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** start `2026-10-16T07:03:06Z`; end `2026-10-16T09:04:34Z` (about 2 h 2 min; §9).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start (and at the end, §4).
- **Approvals:** none granted. A bulk edit approves nothing; no G1–G6 business approval, and no Finance or IT approval, is granted or implied. Product gate G6 is not DG7. All test data is synthetic.

## 0. Read first: one design point and two wiring lines outside my file list

The assignment says: export each PATCH core through the module's `index.ts`, and "register one line per register in the forms bulk map (`forms/bulk.ts`)". **`forms/bulk.ts` cannot import those cores.** The ADR-0002 module graph, which `apps/api/src/architecture.test.ts` enforces, forbids it:

- `forms.dependsOn` (`apps/api/src/modules.ts`) is `platform, audit, access, organization, transformations, methodology, evidence, tasks`. It names none of `raid`, `governance`, `portfolio`, `adoption`, `benefits` or `workflows`. Every import must respect `dependsOn` (architecture test 1).
- The architecture test also says **"No P5 module imports workflows"**. T04 (design decisions) lives in `workflows/decisions.ts`, so forms may never import it, whatever `dependsOn` says.
- The reverse direction is also closed: no P1–P4 module may import a P5 module.

Changing `modules.ts` or the architecture test would be a module-graph contract change. Following the assignment ("make no contract change"), I made none. Instead I used the codebase's established port pattern (the composition root wires a port, as D-159 did for `setMeetingPackAssembler`):

- **`forms/bulk.ts`** owns the bulk map: `interface FormBulkUpdaters`, with **one line per register** (T04, T05, T13, T14, T15, T16). It also owns its setter `setFormBulkUpdaters` and the lookup `updaterOf(rt)`: the module core first, then the register-kit updater. An unwired register fails closed with 422 `form_record.bulk_field_not_editable`, exactly as before.
- **Two wiring lines outside my named files** (needed for the map to be filled; please accept or redo them at the merge):
  1. `apps/api/src/modules/forms/index.ts`: `export { setFormBulkUpdaters, type FormBulkUpdaters } from "./bulk.ts";` (plus a comment line).
  2. `apps/api/src/server.ts`: one `setFormBulkUpdaters({ T04: updateDesignDecision, T05: updateInitiative, T13: updateStakeholderGroup, T14: updateBenefitRecord, T15: updateRaidEntry, T16: updateExecutiveDecision })` call next to the other port wirings. It also adds the six names to the existing import lines of those modules.
- **One test pin outside my named files:** `apps/api/src/modules/workflows/workflows.test.ts` pins the exact export list of `workflows/index.ts`. I added `"updateDesignDecision"` to it (2 lines). My first `pnpm test` run failed on that pin (§4.2), which is how I found it. No other affected module pins its exports.
- **Decisions are two modules, not one.** "Decisions (T04/T16)" are owned by `workflows` (T04, `workflows/decisions.ts`) and `governance` (T16, `governance/executive-decisions.ts`). So six `index.ts` files carry an export, not five.
- **Keyed by record type, not by table.** T04 and T16 share the `decision` table (discriminator `kind`), so the BE-E2 kit registry keyed by table could not hold both. The forms map is keyed by `form_record_type.code`.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/raid/register.ts` | `updateEntry` takes `{transformationId, raidEntryId, body, expected}` and returns `{id, version}`. New export `updateRaidEntry: RegisterUpdater` (T15). The PATCH route passes `request.body` and `() => requireIfMatch(request)`. |
| `apps/api/src/modules/raid/index.ts` | `export { updateRaidEntry } from "./register.ts";` |
| `apps/api/src/modules/workflows/decisions.ts` | The PATCH closure is extracted, unchanged, into `updateDecision(tx, request, {decisionId, transformationId?, body, expected})`. `finishDecisionLock` gets an optional `expectedVersion` thunk (defaulting to `requireIfMatch(request)`, so its other four callers are unchanged). New export `updateDesignDecision: RegisterUpdater` (T04; it adds a 404 when the decision is not in the given transformation). |
| `apps/api/src/modules/workflows/index.ts` | `export { updateDesignDecision } from "./decisions.ts";` |
| `apps/api/src/modules/workflows/workflows.test.ts` | Public-surface pin: + `"updateDesignDecision"`. |
| `apps/api/src/modules/governance/executive-decisions.ts` | The PATCH closure is extracted, unchanged, into `updateExecutiveDecisionRow(tx, request, {transformationId, decisionId, body: ExecutiveDecisionUpdate, expected})`. The route still runs `checkUpdateOptions` and `parseBody` before the transaction, as before. New export `updateExecutiveDecision: RegisterUpdater` (T16): the same body checks, then the core. |
| `apps/api/src/modules/governance/index.ts` | `export { updateExecutiveDecision } from "./executive-decisions.ts";` |
| `apps/api/src/modules/portfolio/initiatives.ts` | The PATCH closure is extracted, unchanged, into `updateInitiativeRow(tx, request, {initiativeId, transformationId?, body, expected})`. New export `updateInitiative: RegisterUpdater` (T05; 404 when not in the given transformation). |
| `apps/api/src/modules/portfolio/repository.ts` | `lockInitiativeForWrite` gets an optional `expectedVersion` thunk (default `requireIfMatch(request)`; its other callers are unchanged). |
| `apps/api/src/modules/portfolio/index.ts` | `export { updateInitiative } from "./initiatives.ts";` |
| `apps/api/src/modules/adoption/register.ts` | `updateGroup` takes `{transformationId, stakeholderGroupId, body, expected}`; the route parses params inside the same transaction, as before. New export `updateStakeholderGroup: RegisterUpdater` (T13). |
| `apps/api/src/modules/adoption/index.ts` | `export { updateStakeholderGroup } from "./register.ts";` |
| `apps/api/src/modules/benefits/register.ts` | `updateBenefit` gets an optional `{body, expected}` (default: the request's body and If-Match, so the route call is unchanged). New export `updateBenefitRecord: RegisterUpdater` (T14). |
| `apps/api/src/modules/benefits/index.ts` | `export { updateBenefitRecord } from "./register.ts";` |
| `apps/api/src/modules/forms/bulk.ts` | The forms bulk map `FormBulkUpdaters` (one line per register), `setFormBulkUpdaters`, `updaterOf(rt)`, and the header comment. |
| `apps/api/src/modules/forms/index.ts` | Exports the setter and the map type (see §0). |
| `apps/api/src/server.ts` | The one wiring call and six import names (see §0). |
| `apps/api/test/integration/forms/form-bulk-registers.test.ts` | **New**, 21 integration tests (§2). |
| `apps/api/test/integration/forms/form-records.test.ts` | BE-E2's T15-refusal assertion is **removed** (assignment test 4), and the test title is updated to match. |

Each core keeps the If-Match read at exactly the point where its PATCH read it (after the same gates and the same validation), through an `expected: () => number` thunk. The single-record PATCH routes therefore answer the same status in the same order (403/404/400/428/409/422) as before. The bulk path passes `() => item.version`. Every `RegisterUpdater` uses the existing exported type from `transformations/index.ts` (all six modules already depend on `transformations`), with the signature BE-E2 proposed: `(tx, request, {transformationId, recordId, expectedVersion, body})`.

## 2. Behaviour delivered

**The assignment's literal tests** (D-159 a), all in `form-bulk-registers.test.ts`, against a real PostgreSQL:

1. *"Bulk edit of owners on 3 T15 records succeeds, with one audit event each and the versions incremented."*
   - Test `T15 > owners on 3 T15 records: all committed through the module's own update, one raid_entry.update audit event each, versions + 1`.
   - It asserts 200, response items `{recordId, version + 1}`, and each `raid_entry` row's `owner_user_id` and `version + 1` read from the table.
   - It also asserts exactly one `raid_entry.update` audit event per record for the request, with `prior_version → new_version = v → v + 1`.
2. *"A stale version on one of the 3 gives the recoverable conflict listing for that record only, and the others are not written."*
   - Test `T15 > a stale version on one of owners on 3 T15 records: …`.
   - It asserts 409 `form_record.bulk_conflict` with the exact ADR-0041 §10 detail, and `errors` equal to exactly one entry, `/items/1/version`, with that record's id and current version.
   - All 3 rows are unchanged, and the request wrote no audit event.
3. *"The same for one T04/T16, T05, T13 and T14 field each."* The same two tests run on 2 records each (so "the others are not written" is observable):
   - T04 `due_date` (`decision.update`);
   - T16 `owner` (`executive_decision.update`);
   - T05 `workstream_lead` (`initiative.update`);
   - T13 `current_stance` (`stakeholder_group.update`);
   - T14 `owner` (`benefit.update`).
   For T16, the owner change also reassigns the owner's My Work item (T16's own follow-up write). Those are other records' audit events, so the per-record count filters on the register's own record type.
4. *"Remove BE-E2's test that asserts the T15 refusal, and say so in the handback."* **Removed**: the block `// T15 (RAID) has bulk-editable owners, but its register exposes no update function …` in `form-records.test.ts` ("refusals" test), and "register without an exposed update" in its title.

**Additional tests (authorization and the module's own rules, positive and negative):**

- AUD gets 403 on the bulk edit of each of the six registers, and nothing is written (6 tests).
- **The owning module's validation applies:** a T16 bulk edit whose second item names an owner who does not hold `executive_decision.decide` (the TL) gets T16's own 422 `executive_decision.owner_not_executive`. The first, valid item is rolled back, and no audit event is written.
- **The T04/T16 discriminator holds:** a T16 decision sent to the T04 bulk edit is 404, and nothing is written.
- **A field not marked `bulk_editable` stays refused** on a module-owned register (T15 `description` → 422 `form_record.bulk_field_not_editable`).
- **Mutation check (not kept):** with the module map disabled in `updaterOf`, 14 of the 21 tests fail (every success, stale, rule and discriminator test). The 7 that still pass are the six AUD 403s and the not-editable field, which hold either way. The file was restored right after (`grep -c "false as boolean"` = 0). Log: `T-DG5-BE-E3-evidence/mutation-check.log`.

**Single-record PATCH routes unchanged:** every DG2–DG4 integration suite of raid, workflows (decisions), governance (executive decisions), portfolio (initiatives), adoption and benefits runs inside the full `pnpm test:integration` and passes (§4.3).

**Requirement row REQ-S05-001.** Acceptance (quoted): *"A01;A14: for T01 and T14, a saved draft reopens, a new version is listed in history, a comment and attachment persist, export returns the rows, and a conflicting concurrent save returns a recoverable conflict"*.

- This task does not change any of those behaviours. BE-E2's tests of them stay green (`form-records.test.ts`, 18/18).
- It completes the row's input field "Bulk editing" and procedure "with optimistic concurrency on save" for the six registers that BE-E2 could not serve. It also completes §B.4's literal test "bulk edit of owners on 3 T15 records". As D-142 says, the row is judged on its own acceptance text, which does not name bulk edit.
- The record types keep `bulk_edit_allowed = true`. That flag is now true for their source fields as well as their extension values.

## 3. Operations routed (pending-list delta)

**None.** This task adds no operation and no route: it serves more registers through BE-E2's existing `bulkUpdateFormRecords`. There is no `p5-pending-be-e3.ts` (none was created for this task, and none is needed), and `p5-exercises-be-e2.ts` (on T01) is unchanged. **Pinned-count deltas for `contract.test.ts`:** media-type triple +0, rate-limit floor +0.

## 4. Checks run (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-E3-evidence/`)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Harness ports: `QA_PG_PORT=23000`, `MTH_PORT_POOL=23001-23049`.

### 4.1 Static checks

| Command | Exit | Log |
|---|---|---|
| `pnpm -r typecheck` | 0 | `typecheck.log` (07:20Z), `typecheck-final.log` (after the last source edit) |
| `pnpm -r build` | 0 | `build.log` (after every source change. The later edit was a test file only, which is not built.) |
| `pnpm lint` (`eslint . --max-warnings=0`) | 0 | `lint.log`, `lint-final.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`, `prettier-final.log` ("All matched files use Prettier code style!" in every xargs batch) |
| `pnpm openapi:lint` | 0 | `openapi-lint.log` (`PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations`, unchanged) |

### 4.2 Unit (`pnpm test`)

Every Vitest invocation of `pnpm test` (three: `unit-node`, `unit-web`, `unit-formula-nocodegen`):

| Run | Locale | Exit | unit-node | unit-web | unit-formula-nocodegen | Log |
|---|---|---|---|---|---|---|
| 1 | unset | **1** | **1 failed** / 2119 passed (2120) | 1429/1429 | 259 + 2 skipped | `test-locale-unset-run1-FAILED.log` |
| 2 | unset | **1** | **1 failed** / 2119 passed (2120) | 1429/1429 | 259 + 2 skipped | `test-locale-unset-run2-TIMEOUT.log` |
| 3 | `C.UTF-8` (`LANG`, `LC_ALL`) | 0 | 2120/2120 | 1429/1429 | 259 + 2 skipped | `test-c-utf8.log` |
| 4 | unset | 0 | 2120/2120 | 1429/1429 | 259 + 2 skipped | `test-locale-unset.log` |

- **Run 1 failure: mine, now fixed.** `workflows/workflows.test.ts` › "has a public index.ts exposing …" pins the exact export list of `workflows/index.ts`, and my new `updateDesignDecision` export was not in it. I added it to the pin (§0). The file then passes alone (14/14).
- **Run 2 failure: not in this task's code; a load timeout.** `packages/reporting/src/pdf/pdf.test.ts` › "renderPdf: Arabic (REQ-S13-009) › the glyph-run check …" hit `Test timed out in 5000ms` (vitest's default).
  - This task does not touch `packages/reporting`, and the same test passed in run 1.
  - The machine's load average was about 18–19 then (`uptime` at 07:57Z), with four W14 tasks running at once.
  - Run alone afterwards, the file passes 13/13 (`pdf-test-alone.log`, exit 0). Run 3 passed it too.
  - It is a candidate for the F-DG4-143–148 determinism lesson (an explicit timeout on that test). Its owner is BE-N; I did not edit it, because it is outside my files.
- The counts match the D-159 baseline (2120 / 1429 / 259 + 2 skipped). My one unit change is an edited assertion, not a new test.

### 4.3 Integration (`tests/qa/support/with-pg.sh pnpm test:integration`)

`QA_PG_PORT=23000 MTH_PORT_POOL=23001-23049 tests/qa/support/with-pg.sh pnpm test:integration` → **exit 0**: **267 files, 2557 passed + 1 skipped (2558)**, 08:02Z–08:53Z (`integration.log`).

- The delta against D-159's verified 2536 + 1 skipped is **+21**, exactly the new `form-bulk-registers.test.ts`. The T15 assertion I removed sat inside an existing test, so the test count did not change.
- The skipped test is the same BE-O `it.runIf` as in D-159.
- Every DG2–DG4 suite of the six touched modules passes in that run, among them:
  - `raid/register.test.ts` 15, `raid/dependency-entries.test.ts` 9;
  - `governance/executive-decisions.test.ts` 17;
  - `portfolio/initiatives.test.ts` 12;
  - `adoption/stakeholder-groups.test.ts` 11;
  - `benefits/register.test.ts` 17;
  - `registers.test.ts` 23 (T04 design decisions);
  - `forms/form-records.test.ts` 18, `forms/form-bulk-registers.test.ts` 21.
- Earlier targeted run of the two forms suites: 39/39, exit 0 (`forms-suites-first-run.log`).
- The mutation check (`mutation-check.log`) exits 1, as expected: 14 failed / 7 passed (§2).
- **Pinned counts:** no change (§3).
- Before the run I removed empty `.claude/.cc-writes` sandbox directories under the source folders. Two reappeared (`apps/api/src`, `apps/api/src/modules/workflows`) after my own edits, and I removed them during the run. No test failed.

### 4.4 Gate validator

- Start (07:03Z): `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0 (`validate-dg4-historical-start.log`).
- End (08:53Z): the same → `PASS gate DG4 (historical)`, exit 0 (`validate-dg4-historical.log`).

## 5. Contract, schema or dependency needs (for the orchestrator)

- **No contract change, no migration, no new dependency, no OpenAPI change, no new problem code.** All refusals are existing codes.
- **Module-graph point (§0):** I did not change `modules.ts` or the architecture rule. The design needs the two composition-root wiring lines (`forms/index.ts` export and `server.ts` call) and the one `workflows.test.ts` pin line. All three are outside my named files, and I disclose them here for acceptance at the merge.
- **Merge conflicts to expect:** `server.ts` (import lines of adoption, benefits, governance, raid, portfolio, workflows and forms, plus the wiring block above the `T-DG5-BE-H` registry line), if another W14 task edits the same lines. Resolve them by keeping both sides.

## 6. User-facing texts made untrue

None. I searched `apps/web/src` (en/ar i18n, `api/p5.ts`, screens) and `docs/api/openapi.yaml` for bulk-edit texts:

- The en/ar strings for `form_record.bulk_*` stay true: `bulk_field_not_editable` is still returned for fields that are not bulk-editable.
- No web string lists which registers are served.
- The OpenAPI and ADR-0041 §5 text ("through the register's own update") now holds for the six registers too.

## 7. Known gaps and notes (stated plainly)

1. **RAID Dependency entries:** `updateRaidEntry` passes no `RaidDependencyPort`. A T15 form record is a `raid_entry` row, and forms locks it in `raid_entry` (discriminator-aware) before calling the core, so the Dependency branch cannot be reached through the bulk path. Were it reached, it would fail closed (500), as an unwired PATCH does. Dependency rows are T08 records, bulk-edited through T08's own kit updater.
2. **Bulk on T05 and T14 re-checks authorization at commit** (`openWrite … { atCommit: true }`), exactly as their PATCHes do. I did not add a separate commit-time race test per register; BE-E2's bulk commit-time test (on T03) covers the bulk route's own re-check.

## 8. Merge instructions

- No migration. Apply the uncommitted diff of the 18 modified files and the 1 new file (§1). Rebuild is not needed for `@mth/shared`/`@mth/db` (unchanged).
- If the orchestrator prefers a different wiring for §0, the in-module exports and `forms/bulk.ts` stay as they are; only the `setFormBulkUpdaters` call moves.
- Remove any empty `.claude/.cc-writes` sandbox directories under source folders before tests. I removed 12 such empty directories in this tree (D-159 f precedent); they were not product code.

## 9. Time

- `date -u` at start: `Fri Oct 16 07:03:06 UTC 2026`; at end: `2026-10-16T09:04:34Z`.
- Most of the time went to the long verification runs under shared load: the full integration run took 51 min, and each `pnpm test` took about 10 min.

## 10. What remains

- **Nothing in scope.** All four literal tests pass, and every acceptance check exits 0 in its final run. Two earlier `pnpm test` runs failed and are disclosed in §4.2: run 1 on my own export pin (fixed), run 2 on an unrelated load timeout.
- **For the orchestrator:**
  - accept or redo the composition-root wiring (§0);
  - optionally, give BE-N's `pdf.test.ts` glyph-run test an explicit timeout (§4.2).
