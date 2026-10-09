# Handback T-DG4-BE-M (backend-workflow-engineer): slice K trace links, allocation, traceability view, orphan report, impact, PB-010

- **Stage:** DG4 (P4 "Execution value and sustainment"), wave W11. Section: `docs/architecture/p4-work-split.md` §J+K JK.1.
- **Invocation:** `DG4-T-DG4-BE-M-backend-workflow-engineer-20261009T184010Z-273a9c03` (session `273a9c03-0ba5-4642-a6de-016cded3ebb7`).
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-M.md`, sha256 `bbd0032c…0573b4`, verified at start.
- **Base:** `85cae06be8db43b6e322c842efc4e5541f383d43` (branch `dg4/be-m`). The changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-09T18:40:21Z`; end `2026-10-09T20:01:06Z`.
- **Product gates:** nothing here grants or records a business, Finance or IT approval. Every fixture is synthetic. Nothing reads or writes the engineering gates DG0–DG7.

## 0. Production wiring (D-107 lesson): nothing to wire

My routes need **no port and no setter**:

- The slice K reads and trace-link writes register through `registerReportingModule` (`reporting/index.ts`). BE-A already wired that hook in `server.ts`. My only change there is the `impact.ts` registration line.
- `setOutcomeContributionAllocation` registers inside `registerInitiativeLinkRoutes` (`portfolio/links.ts`), which `server.ts` already reaches through `registerPortfolioModule`.

Every integration test I added starts the real server through `startApi` → `buildServer` and wires nothing by hand. The contract test does the same, so these tests double as the D-107 proof:

- `reporting/{traceability,allocation,orphans,impact,one-source-of-truth}.test.ts`;
- `contract.test.ts` (it calls `exerciseP4BeMOperations`).

`apps/api/src/server.test.ts` now also asserts that `reporting` is `active`/`P4` with routes in the composed server.

## 1. Edits outside my file list (for the orchestrator to accept or redo)

These were needed to keep the required suites green. Each is minimal and marked in the source.

| File | Edit | Why |
|---|---|---|
| `apps/api/test/integration/contract/malformed-input.ts` (BE-A boundary file, frozen) | +2 lines in `wellFormed`: `recordType` and `allocationTargetType` → `"benefit"` | The generic "malformed id → 400 at `/params/<last>`" probe fills unknown path parameters with a UUID. My two **enum** path parameters (`getRecordImpact` `recordType`, `getAllocationSet` `allocationTargetType`) then also failed validation, giving 2 pointers instead of 1. This is the same fix BE-A made for `jobCode`/`matrixKind`. Without it, `contract.test.ts` failed (1 test). |
| `apps/api/src/modules/reporting/reporting.test.ts` (P1 scaffold suite) | The test "registers no route" now asserts exactly the 9 slice K routes and an `active`/`P4` registration | The P1 assertion cannot hold once the first reporting route lands. `reporting/index.ts` (BE-A) already switches to `{status: "active", deliversIn: "P4"}` when routes exist. KBE-G/KBE-G2 will extend the list. |
| `apps/api/src/server.test.ts` | The `reporting` expectation goes from `scaffold`/`P5`/`[]` to `active`/`P4` with routes | Same reason. The `/report/i` URL guard is unchanged, and no slice K path matches it. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[292, 291, 1]` → `[296, 295, 1]` plus one comment line | Sanctioned by the assignment. Delta: **+4 JSON bodies** (`createTraceLink`, `updateTraceLink`, `removeTraceLink`, `setOutcomeContributionAllocation`). |
| `portfolio/links.ts`, `benefits/register.ts` | Import lines outside the named blocks. In `register.ts`, two lines inside `presentRegisterRows` call the block and add `initiatives`, and its return type widens | A named block cannot be reached without these. |

## 2. Contract and schema needs (orchestrator)

1. **The zod mirror `benefitRegisterRow` lacks the optional `initiatives[]` member.** It lives in `packages/shared/src/schemas/benefits.ts` (KBE-D's file, not mine). OpenAPI already has the member (ARCH-08, D-106 (d)), and BE-M now fills it on every register row (an empty array when the benefit has no current allocation set).
   - The contract test stays green only because KBE-D's `listBenefits` exercise lists an **empty** register.
   - A strict-mirror parse of a non-empty page would reject the new key.
   - **Requested one-line change** in `benefitRegisterRow`: `initiatives: z.array(z.strictObject({ id: uuid, code: z.string(), name: z.string() })).optional()`. Define it inline: `schemas/traceability.ts` already imports from `benefits.ts`, so importing `initiativeRef` back would make the imports circular.
   - Until then, no web or API code parses register rows with that mirror (checked by `grep`).
2. **No migration needed.** I used no migration number.
3. **Refusals not in ADR-0038 §12.** These are validation responses I chose (they need architect acceptance and EN/AR keys, FE-G):
   - 400 `validation.basis_needs_share` ("An allocation basis needs a share.") for a basis without a share, on create, update and contribution allocation;
   - 400 `validation.share_range` and 400 `validation.decimal_measure_scale` for a share outside (0, 1] or with more than 6 decimals;
   - a `getTraceability` root that is not a record of that type in the transformation → 422 `trace_link.record_not_found` (reusing the §12 code and text). The operation declares 422.

## 3. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/traceability.ts` (new) | The slice K zod shapes: link, create/update, page, allocation set and member, contribution allocation, graph, node, edge, orphan item/page, impact record, dashboard ref, impact, `initiativeRef`. Also the pure helpers `traceAllocationTotals` (decimal total and unallocated rest) and `allocationExceedsText` (the exact §12 text), and `traceShareDecimal` (numeric(7,6), 0 < s ≤ 1). |
| `packages/shared/src/schemas/index.ts` | Its export line. |
| `apps/api/src/modules/reporting/traceability.ts` | `getTraceability`, `listTraceLinks`, `createTraceLink`, `getTraceLink`, `updateTraceLink`, `removeTraceLink`, `getAllocationSet`. Also the shared chain helpers: records read in place, edges from `traceability_edge`, the `href` builder, the §5 orphan rule, the lock and allocation members, and the read-only transaction helper. |
| `apps/api/src/modules/reporting/orphans.ts` | `getOrphanReport` (the ADR-0038 §5 rules, filters, cursor). |
| `apps/api/src/modules/reporting/impact.ts` (new) | `getRecordImpact`: the §6 downstream walk and the dashboard/T10-area mapping. |
| `apps/api/src/modules/reporting/index.ts` | The `impact.ts` registration (import plus call). |
| `apps/api/src/modules/portfolio/links.ts` | The named block "BE-M: contribution share": `setOutcomeContributionAllocation` (lock, If-Match, audit), registered inside `registerInitiativeLinkRoutes`. |
| `apps/api/src/modules/benefits/register.ts` | The named block "BE-M: initiatives[]": `registerInitiativesOf`, which fills `BenefitRegisterRow.initiatives[]` by join. |
| `apps/api/src/modules/platform/db-errors.ts` | The first slice J/K block: `mapP4TraceabilityError` (the ADR-0038 §12 mappings of the `0055` trace constraints), called after BE-L's mapper. |
| `apps/api/test/support/p4-pending-be-m.ts` | Emptied (10 → 0). |
| `apps/api/test/integration/contract/p4-exercises-be-m.ts` | 10 mirrors and the exercises. Also exports the `seedTraceWorld`, `insertAudited` and `insertSubmittedInitiative` fixtures, which BE-M2/BE-M3 may reuse. |
| `apps/api/test/integration/reporting/traceability.test.ts` | 9 tests: many-to-many, hrefs, §12 refusals, AUD, If-Match, audit, commit-time, never deleted, scope. |
| `apps/api/test/integration/reporting/allocation.test.ts` | 8 tests: the 100 % rule, the exact 110 % text, `unallocatedShare`, concurrency, the trigger backstop, contribution shares, DG3 responses unchanged. |
| `apps/api/test/integration/reporting/orphans.test.ts` | 3 tests: an initiative linked only to a finding, drafts, hrefs, cursor, scope. |
| `apps/api/test/integration/reporting/impact.test.ts` | 3 tests: a KPI target change via a new KPI version, the benefits and dashboards affected, distances and edge kinds, cursor, scope. |
| `apps/api/test/integration/reporting/one-source-of-truth.test.ts` | 2 tests: one rename shows in the roadmap, the traceability node and the register `initiatives[]`; one initiative row. |
| Edits outside my file list | See §1. |

## 4. Behaviour delivered, per requirement row

### REQ-S03-006

Acceptance: *"A01;A10: one initiative links to two gaps and two KPIs; an allocation link set totalling 110% is rejected; changing a KPI target lists the linked benefits and dashboards as affected"*

- **"one initiative links to two gaps and two KPIs".** `traceability.test.ts` › *one initiative links to two gaps and two KPIs…*
  - It creates two DG3 gap links and two DG3 contributions, one per outcome KPI.
  - `getTraceability` rooted at the initiative returns two `gap_initiative` edges (gap 1, gap 2) and two `initiative_kpi` edges (KPI 1, KPI 2).
  - Capabilities, KPIs and benefits take any number of trace links (the next test).
- **"an allocation link set totalling 110% is rejected".** `allocation.test.ts`:
  - A capability → KPI link at 0.6 plus a contribution share at 0.4 gives `getAllocationSet` `total` `"1.000000"` and `unallocatedShare` `"0.000000"`.
  - One more 0.1 gives **422 `trace_link.allocation_exceeds_total`** at `/allocationShare`, with the exact detail **"The allocations into this record would total 110%, more than 100%."**
  - Raising a member, or the contribution share, is refused with the same code and text.
  - Into a benefit, 0.7 + 0.4 is refused the same way.
  - A set at 0.4 shows `unallocatedShare` `"0.600000"`. An empty set shows `"1.000000"`, never 0 %.
  - Decimals stay exact (0.1 + 0.2 = `"0.300000"`).
- **Concurrency.** Three rounds of two concurrent 0.6 writes into one benefit: exactly one 201 and one 422 ("…120%…") per round. The database sum stays `0.600000`.
  - The API takes lock class `traceAllocationSet` (730249) on the target id before reading the set, and the `0055` trigger takes the same lock.
  - A direct over-100 % insert hits the trigger (`constraint trace_allocation_total`). `mapDatabaseGuardError` maps it to the same code and text.
- **"changing a KPI target lists the linked benefits and dashboards as affected".** `impact.test.ts`:
  - The test creates a P4 KPI version with `targetValue` 72 (slice A) on the KPI definition.
  - `getRecordImpact` on the `kpi_definition` and on its `outcome_kpi` lists both linked benefits, each with `valueAffected: true`:
    - the one reached by a `kpi_benefit` trace link;
    - the one measured by the KPI (`kpi_benefit_measure`).
  - It also lists the dashboards: `transformation`/`executive` with `outcomes` and `value`, `finance`/`value`, and the unscoped `transformation` and `executive` entries.
  - A deliverable's impact walks capability → KPI → benefits, with distances 1/2/3, the path's edge kinds, and the `portfolio` area.
- **Clickable nodes and downstream impact for every record:** `getTraceability` nodes carry `href`, and `getRecordImpact` covers the 8 node types plus `kpi_definition`.

### REQ-PB-044

Acceptance: *"A01: an initiative without a TOM gap appears in the orphan report; clicking a node opens the linked record"*

- **"an initiative without a TOM gap appears in the orphan report".** `orphans.test.ts`:
  - An initiative linked only to a diagnosed finding is listed with `missing` upstream (or both) and `expected` containing **"tom_gap → initiative"**.
  - After a `tom_gap` link it leaves the upstream list.
  - Drafts are never orphans. Gaps without an `issue_gap` link expect "diagnostic_finding → tom_gap".
  - The filters, the cursor (which refuses reuse with other filters) and the scope 404 are tested.
- **"clicking a node opens the linked record".** API half: every node type's `href` returns 200 with that record's id. This covers all 8 types in `traceability.test.ts` and every orphan type in `orphans.test.ts`. The click itself is FE-G's (e2e).

### REQ-PB-010

Acceptance: *"A01: renaming an initiative changes it in roadmap, scorecard and benefits register views in one update; no duplicate initiative rows exist in the database"*

`one-source-of-truth.test.ts` does one `PATCH /api/v1/initiatives/{id}` of `name`, then reads the result in three places:

- `getRoadmap` shows the new name;
- the `getTraceability` node label shows it (read by join through `traceability_edge` + `initiative`);
- `listBenefits` `initiatives[]` shows `{id, code, name}` with the new name.

`SELECT count(*) FROM initiative WHERE transformation_id = $1 AND code = $2` returns 1.

**The scorecard read is not asserted on the T10 Portfolio area.** That is KBE-G's read model (D-106 (d)) and is not merged in this tree. As JK.1 allows, the test asserts the traceability node label instead and records this. When KBE-G merges, a one-line assertion on `getTransformationDashboard` should be added (§7).

### Also proven, as JK.1 requires

- **DG3 contribution routes' responses unchanged.** The list item and the remove response have exactly the DG3 key set and parse with the strict DG3 mirror `initiativeOutcomeContribution`, before and after a share is set. Every field except the P2 stamps (`version`, `updatedAt`, `updatedBy`) is byte-identical. A DG3-style remove still commits.
- **AUD 403 on every write:** create, update, remove and the contribution allocation. An ADM-only caller gets 403 on the transformation-scoped writes (route permission gate) and 404 on the initiative-scoped allocation path (no read), as on every DG3 initiative-link route.
- **If-Match:** 428 when missing and 409 when stale on update, remove and the allocation. Creates are version 1 (`ETag "1"`).
- **One audit event per mutation:** `trace_link.create`, `.update`, `.remove` and `initiative_outcome_contribution.allocation_set`, each with its changes. Commit-time re-authorisation is tested: a grant revoked while a create or allocation waited gives 403 and writes nothing.
- **A removed link is never deleted:** the row stays `removed`. It shows only with `includeRemoved=true`, is not a graph edge and leaves its allocation set. Re-removing or editing it gives 422 `trace_link.not_active`, "This link has been removed."
- **Exact §12 refusals** (code, text, pointer): `pair_not_allowed` (/linkKind), `record_not_found` (/fromId or /toId; also a record of another transformation), `record_inactive` (an archived capability), `duplicate` (409), `share_not_allowed` (/allocationShare), `not_active`, `contribution.allocation_needs_kpi`, `contribution.not_active`. Blank free text gives 400 through the shared rule.
- **Read models store nothing.** Graph, orphans and impact run in a read-only transaction (`repeatable read`). `getAllocationSet` runs in a read-only `read committed` transaction after taking the lock. The impact test checks that no audit or impact row is written.
- **Scope:** another organization's caller gets 404 on the graph, the links, the orphans, the allocation set, the impact and the initiative-scoped allocation.

### Interpretations (for review)

- **`record_inactive`** applies when the record is:
  - a finding that is archived or rejected;
  - an archived gap, deliverable, capability or outcome;
  - an outcome KPI or benefit that is not active;
  - a cancelled initiative.
- **`expected` strings** read `"<from type> → <to type>"`.
- **`missing` filter:** `upstream`/`downstream` include records missing both; `both` lists only those.
- **Executive dashboard refs** have `transformationId: null`.
- **A workstream dashboard ref** has `areaCode: "portfolio"`.
- **For a `kpi_definition` root,** its outcome KPIs are listed at distance 1 with empty `edgeKinds` (no view edge joins a definition to its T02 rows).
- **`hiddenCount`** is computed, but is 0 by construction: every view edge joins records of one transformation (composite FKs), and the caller can read it.
- **Graph membership:** without a root, the graph shows every record that is not archived, rejected or cancelled, plus every edge endpoint.

## 5. Operations routed (pending-list delta)

`apps/api/test/support/p4-pending-be-m.ts`: **10 → 0**. Removed:

- `getTraceability`
- `getOrphanReport`
- `getRecordImpact`
- `listTraceLinks`
- `createTraceLink`
- `getTraceLink`
- `updateTraceLink`
- `removeTraceLink`
- `getAllocationSet`
- `setOutcomeContributionAllocation`

Each is exercised through `ctx.mirrored` in `p4-exercises-be-m.ts`, with its zod mirror in `P4_MIRRORS_BE_M`.

## 6. Checks actually run

Environment:

- Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline.
- A disposable PostgreSQL 16.13 per run through `tests/qa/support/with-pg.sh` (`QA_PG_PORT=24700`, `MTH_PORT_POOL=24701-24749`).
- Disk before the full runs: 20–22 GB free.
- I removed the empty `apps/api/.claude/.cc-writes` and `packages/shared/.claude/.cc-writes` before the tests.

Logs are in `docs/delivery/handbacks/DG4/T-DG4-BE-M-evidence/`.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` | `validate-historical-DG3.log` |
| 1 | `pnpm -r typecheck` | 0 | — | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | — | `build.log` |
| 3 | `pnpm lint` | 0 | eslint `--max-warnings=0` | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier-check.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 645 operations` | `openapi-lint.log` |
| 6 | `pnpm test` (locale unset: `env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | 2293 passed (120 files); 259 passed + 2 skipped (3 files) | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 2293 passed (120 files); 259 passed + 2 skipped (3 files) | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=24700 MTH_PORT_POOL=24701-24749 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **1507/1507** passed (147 files), run 2 (19:38–19:55Z) with nothing else running. That is +25 against the D-107 baseline of 1482: my 9 + 8 + 3 + 3 + 2 new tests. | `integration.log` |

**Disclosed non-zero exits and failures during development.** Each was fixed and re-run; the final runs above are the ones that count.

1. **Unit, first full run (both locales):** exit 1, 5 failed out of 2293.
   - 2 tests (architecture boundary): my code indexed objects with computed non-literal keys. I rewrote it with `switch` functions and a `Map`.
   - 1 test (lock registry): my comments spelled the class number 730249. They now name `traceAllocationSet`.
   - 2 tests: the P1 "reporting registers no route" assertions in `reporting.test.ts` and `server.test.ts` (§1).
2. **`contract.test.ts`, first run:** 1 failed (the malformed-path-param probe, §1).
3. **Targeted runs of my new tests** first failed on fixture mistakes in my own tests:
   - an invalid `valueClass`;
   - ADM expected 404 where the route gate gives 403 (and the reverse on the initiative-scoped path);
   - `updatedBy` included in the byte-identical comparison;
   - a KPI version body without `submissionRoute`.
4. **Full integration, run 1:** `integration-run1-concurrent.log`, exit 1, 1505/1507. I ran it **at the same time as** the unit suites, which disclosed two failures:
   - `workflows/g5-g6.test.ts` › G6: this test hashes every file under `docs/delivery/` before and after the G6 approval, to prove G6 writes nothing there. My concurrent unit run was writing `unit-locale-unset.log` into my evidence directory meanwhile, and that one file's hash changed. This is an artefact of my running two jobs at once, not a product write. For run 2, I wrote the log to `$TMPDIR` and copied it afterwards.
   - `kpi-p4/data-quality.test.ts` › AUD/ADM 403: the KBE-B fixture `kbe-b-fixtures.ts:86` draws `ad_hoc` period dates with `Math.random()`, and two collided ("overlaps another ad_hoc period"). D-098 already records this as a known test defect for repair. It is unrelated to slice K.

   Run 2 passed 1507/1507 (row 8).
5. **Integration pin:** the media-type pin changed (§1). No other pinned count changed: operations stay 645, and there are no migrations.

## 7. What remains (not done)

- **The REQ-PB-010 scorecard assertion on the T10 Portfolio area:** add it after KBE-G merges (`getTransformationDashboard` Portfolio area shows the renamed initiative). It is asserted today on the traceability node label.
- **The zod mirror `benefitRegisterRow.initiatives`** (§2.1), a one-line change in KBE-D's file.
- **FE-G:** the clickable graph (REQ-PB-044 e2e "clicking a node opens the linked record"), the orphan, impact and allocation-set screens, and EN/AR keys for the ADR-0038 §12 codes plus the §2.3 validation codes.
- **REQ-S03-006, REQ-PB-044 and REQ-PB-010** therefore have their backend halves done here. Their UI halves are FE-G's, and the PB-010 scorecard read is KBE-G's.
- **No unit-test file for the pure helpers** (`traceAllocationTotals`, `orphanFlagsOf`, `walk`, `walkDownstream`). My file list names no unit-test file. The integration tests exercise them.

## 8. Merge instructions

- **No migration.** The `0055` and `0057` objects are used as they are.
- **Integration order (JK.8):** BE-M2 and BE-M3 append to `p4-exercises-be-m.ts` and to the slice J/K block of `db-errors.ts` (`mapP4TraceabilityError`, called right after BE-L's `mapP4ChangeControlError`). KBE-G's db-errors block also goes after BE-M's.
- **Expected conflicts:**
  - the media-type pin in `contract.test.ts` (+4 here; reconcile with BE-K2/BE-L2/KBE-G);
  - `schemas/index.ts` export lines (union);
  - `reporting.test.ts` and `server.test.ts` (KBE-G adds dashboard routes: extend the route list);
  - `malformed-input.ts`, if KBE-G adds enum path parameters too.
- **For BE-M2/BE-M3:** `seedTraceWorld` and `insertAudited` in `p4-exercises-be-m.ts` give a transformation with one record of every chain node type.
