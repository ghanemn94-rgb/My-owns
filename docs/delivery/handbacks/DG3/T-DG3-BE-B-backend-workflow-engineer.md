# Handback T-DG3-BE-B: initiatives, links, lifecycle transitions and portfolio selection (backend-workflow-engineer)

- **Stage:** DG3 (BUILDING). **Task:** T-DG3-BE-B.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-BE-B-backend-workflow-engineer-20261007T231205Z-b2988cf0","session_id":"b2988cf0-de67-4fe6-8464-538f622209f7"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-BE-B.md`. I checked its sha256 at the start: `3dc45d7e…8b27`, as given.
- **Working tree:** worktree `/home/user/wt/dg3-be-b`, branch `dg3/be-b`, base `HEAD` `8236d61` ("DG3: wave-2 assignments"). I committed nothing.
- **Time:** start `Wed Oct  7 23:13:05 UTC 2026`; end `Wed Oct  7 23:47:13 UTC 2026` (the final prettier check, run after this handback was written, exited 0).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` and exited 0, both at the start and at the end (`T-DG3-BE-B-evidence/validate-historical-DG2.log`).
- **Scope of the business records:** product gates G1–G6, selection and funding are business approvals inside the product. Every selection, funding decision, waiver and gate status in the tests is a synthetic demo record that approves nothing real. Nothing here reads or writes the DG0–DG7 records.

All five scope items are done. No migration was added and no dependency changed. The contract (`openapi.yaml`), the migrations and `schema.ts` are untouched.

## 1. API endpoints added (20 operations, all from the frozen contract)

| Operation | Route | Permission | Statuses exercised in tests |
|---|---|---|---|
| `listInitiatives` | `GET /api/v1/initiatives?transformationId=&status=&waveId=&cursor=&limit=` | `transformation.read` | 200, 400, 401, 404 |
| `createInitiative` | `POST /api/v1/initiatives` (optional `Idempotency-Key`) | `initiative.edit` | 201, 400, 403, 422 |
| `getInitiative` | `GET /api/v1/initiatives/{id}` | `transformation.read` | 200, 401, 404 |
| `updateInitiative` | `PATCH /api/v1/initiatives/{id}` (If-Match) | `initiative.edit` | 200, 400, 403, 409, 422, 428 |
| `submitInitiative` | `POST …/{id}/submit` (TransitionNote) | `initiative.edit` | 200, 403, 404, 409, 422, 428 |
| `withdrawInitiative` | `POST …/{id}/withdraw` (ReasonRequest) | `initiative.edit` | 200, 400, 403, 404, 409, 422, 428 |
| `selectInitiative` | `POST …/{id}/select` (SelectionRequest) | `portfolio.select` (business approval) | 200, 400, 403, 404, 409, 422, 428 |
| `deselectInitiative` | `POST …/{id}/deselect` (SelectionRequest) | `portfolio.select` | 200, 403, 404, 409, 422, 428 |
| `launchInitiative` | `POST …/{id}/launch` (TransitionNote) | `initiative.launch` | 200, 403, 404, 409, 422, 428 |
| `cancelInitiative` | `POST …/{id}/cancel` (ReasonRequest) | `initiative.edit` | 200, 400, 403, 404, 409, 422, 428 |
| `listPortfolioSelections` | `GET …/{id}/selections` (cursor, newest first) | `transformation.read` | 200 |
| `listInitiativeGapLinks` / `createInitiativeGapLink` / `removeInitiativeGapLink` | `GET\|POST …/{id}/gap-links`, `POST …/gap-links/{linkId}/remove` | read / `initiative.edit` | 200, 201, 400, 403, 404, 409, 422, 428 |
| `listInitiativeOutcomeContributions` / `create…` / `remove…` | `…/{id}/outcome-contributions` (+ `/{linkId}/remove`) | read / `initiative.edit` | 200, 201, 400, 403, 422 |
| `listInitiativeDecisionLinks` / `create…` / `remove…` | `…/{id}/decision-links` (+ `/{linkId}/remove`) | read / `initiative.edit` | 200, 201, 403, 409, 422 |

**Every mutation (14 of them) does the following:**

- **Write gate re-checked at commit (BE18A).** It runs `openWrite(…, { atCommit: true })` inside the write transaction. That call re-resolves the session and reloads the grants, before the body is validated, so a read-only auditor gets 403 whatever the body.
- **Validation** with the shared zod mirrors (`freeText` rules, 400 with pointers), then the business checks (422).
- **Optimistic concurrency.** `If-Match` gives 428 when missing and 409 with `currentVersion` when stale; the row is locked and its version checked. Creates are version 1.
- **One audit event per changed row,** with the prior and new version and the field diff.
- **No client or remote I/O inside the transaction.**

Every route declares `config.consumes: ["application/json"]`. Every operation's §5b statuses are already declared in the frozen contract, and the contract test's platform-status sweep passes for all 20.

## 2. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/repository.ts` (new) | `INI-nn` codes (UPSERT on `record_code_counter`, prefix `INI`), `readableInitiative` (404 without read access), `lockInitiativeForWrite` (If-Match/lock/409), the presenter (warnings, `fundingState`, `displayStatus`), `applyStatusChange` (one status step + audit), `runInitiativeAction` (the shared read → write-at-commit → validate → If-Match → step pipeline), and the problem helpers |
| `apps/api/src/modules/portfolio/initiatives.ts` | List/create/get/PATCH (T05) |
| `apps/api/src/modules/portfolio/links.ts` | Gap links, outcome contributions and decision links (list/create/remove) |
| `apps/api/src/modules/portfolio/transitions.ts` | Submit, withdraw, launch, cancel; `TRANSITION_REASONS` (exact texts); `launchFailures` |
| `apps/api/src/modules/portfolio/selections.ts` | Select/deselect (business approval, `portfolio_selection` row), selection history |
| `apps/api/src/modules/portfolio/funding.ts` | **Only `latestFundingState()`**, as the ARCH-02 ownership note allows (see §3, REQ-S09-003). No import changed and no route was added; the rest of the file is BE-E's |
| `apps/api/test/support/p3-pending-be-b.ts` | Now empty: all 20 operations are routed and exercised |
| `apps/api/test/integration/contract/p3-exercises-be-b.ts` | Exercises all 20 operations through `ctx.mirrored`, plus the `P3_MIRRORS_BE_B` map. Also exports the BE-B **test-only fixtures** (§5) and the API helpers my suites share. I put them here because this file is in my ownership list and a new shared helper file is not |
| `apps/api/test/integration/contract/contract.test.ts` | Only the two pinned counts (§6) |
| `apps/api/test/integration/portfolio/initiatives.test.ts` (new) | 12 tests |
| `apps/api/test/integration/portfolio/links.test.ts` (new) | 12 tests |
| `apps/api/test/integration/portfolio/transitions.test.ts` (new) | 20 tests |
| `docs/delivery/handbacks/DG3/T-DG3-BE-B-*` | This handback and its evidence |

## 3. Behaviour delivered, per requirement

**REQ-S16-016: "Initiative created and read through the API with authorization."**

- `POST /api/v1/initiatives` creates a draft: 201, version 1, `ETag "1"`, `Location /api/v1/initiatives/{id}`, `code` `INI-nn`, and one audit event `initiative.create` with `{from: null, to}` per set field.
- `GET` returns it to the lead and to the read-only auditor (200).
- A user without access gets 404, so existence is never disclosed. With no session the answer is 401.
- Test: `initiatives.test.ts`, "creates a draft with every T05 card field…" and "a caller without access…".

**REQ-PB-045: T05, 14 fields, the 3–7 warning.**

- Every field of the ADR-0021 §2 storage map has its home:
  - eleven columns on the card (name, executive owner, workstream lead, problem statement, objective, scope in and out, financial and customer benefit, risks), plus wave and planned dates;
  - gap links (field 4), contributions (field 8) and decision links (field 14) through my link routes;
  - deliverables, dependencies and milestones (fields 7, 11 and 13) through BE-C's routes.
- `warnings[]` carries `initiative.deliverable_count` (active deliverables outside 3–7), `initiative.no_gap_link` and `initiative.no_owner`. These are warnings, never rejections; a test shows each one appear and clear.
- `planned_end >= planned_start` is checked: violating it gives 422 `initiative.planned_range` at `/plannedEnd`, on create and on PATCH, and the CHECK constraint backs it up.
- **Archive, never delete.** There is no DELETE route. A cancelled or completed initiative and its links are read-only (422 `initiative.read_only`).
- Drafting is allowed before G1.

**REQ-PB-040 and REQ-PB-046: TOM ≠ portfolio, gap links.**

- `gap-links` accepts 1..n links to `tom_gap` or `diagnostic_finding`; the tests use one of each.
- `tom_canvas_cell`, `capability`, `journey` and `tom_dimension` each give **422 `urn:mth:problem:validation`, code `initiative.not_tom_evidence`, detail exactly "A project portfolio is not a Target Operating Model: an initiative cannot be attached as G3 TOM evidence."**, pointer `/targetType`. Nothing is written. There is one parameterised test per type.
- Any other well-formed type gives 422 `initiative.gap_target_type`. A malformed type gives 400.
- A target that is foreign or archived gives 422. A duplicate active link gives 409 `initiative.gap_link_duplicate`.
- **G3 test:** `links.test.ts`, "G3 completeness is identical with and without initiatives and gap links". It compares `criteria` and `canSubmit` of `GET …/gates/G3` before and after adding two initiatives with gap links; they are deep-equal.

**REQ-PB-032: a contribution needs an outcome.**

- A missing `outcomeId` gives **400** with pointer `/outcomeId`.
- A KPI of another outcome gives 422 `initiative.kpi_not_in_outcome` at `/outcomeKpiId`.
- The DB trigger `initiative_contribution_kpi_matches_outcome` is proven directly: a raw insert raises `23514` with that constraint, and `mapDatabaseGuardError` maps it to 422 validation. The contribution then appears in BE-A's outcome hierarchy.

**Decision links.**

- Only canonical `decision` rows of the same transformation can be linked; a decision from another transformation gives 422 at `/decisionId`.
- A duplicate gives 409. A link is removed, never deleted.

**REQ-PB-007 and REQ-PB-022: "no portfolio entry before G1".**

- Submit before G1 gives **422 `urn:mth:problem:invalid-transition`, `initiative.g1_not_approved`, detail exactly "Case for change not yet approved (G1): leadership agreement on problem, baseline and material value pools is required before an initiative enters the portfolio"**.
- `errors[]` lists every failing precondition (G1, plus outcome-before-activity when that fails too). Nothing is written.
- **Modular:** an accepted inherited approval of G1, with verified evidence, satisfies the rule, and no `gate_decision` is created. When that approval is revoked, `select` gives the G1 422 again.

**REQ-PB-006: "Outcome before activity".**

- With G1 approved and no measurable link, submit gives **422 `urn:mth:problem:validation`, code `initiative.outcome_before_activity`, detail "Outcome before activity: link at least one measurable outcome with a KPI before submitting for prioritization", `errors[0].pointer = "/outcomeContributions"`**.
- A contribution without a KPI does not count.
- Once a contribution with a KPI exists, submit is 200 (`submitted`, version + 1, audit `initiative.submit`).

**REQ-PB-004: "End-to-End launch 422 … succeeds after G2+G3".** The test follows the acceptance literally:

1. A funded End-to-End initiative is launched with a fixed `If-Match`: **422 `initiative.direction_not_approved` "North Star, outcomes and target state not yet approved"**, and nothing is written.
2. With G2 approved, the same call still gives 422.
3. With G3 approved as well, **the same call gives 200 `launched`**, with `launchedAt`/`launchedBy` set and the audit event written.

**Precondition order** (ADR-0021 §3 notes), each tested:

- A selected-but-unfunded End-to-End initiative gets the direction reason first, and `errors[]` lists `[direction_not_approved, selected_unfunded]`.
- A draft launched before G1 lists `[g1_not_approved, direction_not_approved, not_launchable]`.

**End-to-End vs Modular (ADR-0021 §5).**

- With G2 approved and an accepted G3 waiver for the initiative, launch is 200, and G3 stays unapproved.
- A Modular transformation launches without G2 or G3.
- The rules come only from BE-A's `sequencing.ts` (`checkG1` and `checkDirectionForLaunch`), using the facts from `loadSequencingFacts`.

**REQ-S09-003: "ranking ≠ selection ≠ funding; 'Selected - unfunded' cannot launch".**

- **Ranking never selects:** after a ranking the status is `ranked` and there are no `portfolio_selection` rows.
- **Select:**
  - It needs status `ranked` *and* a complete entry in the current ranking snapshot. Otherwise the answer is 422 `initiative.not_ranked` "The initiative is not in the current proposed ranking". Then G1 is checked.
  - It needs a rationale (400 without one) and `portfolio.select`: TL gets 403 and SP is allowed.
  - It writes a `portfolio_selection` row (`selected`, with `ranking_snapshot_id`, `decided_by` and the rationale) plus its audit event, and the initiative steps to `selected` with its own audit event.
- **Deselect:**
  - It applies to `selected` or `funded` only and goes to `ranked`, writing a `deselected` row.
  - From `ranked`, or once `launched`, it gives 422 `initiative.not_deselectable`.
- **The 'Selected - unfunded' label:**
  - A selected initiative without a current approved funding decision has `fundingState: "unfunded"` (or `"revoked"`) and `displayStatus: "initiative.status.selected_unfunded"`, the contract's i18n key for 'Selected - unfunded'.
  - Launching it gives **422 `initiative.selected_unfunded` "Selected - unfunded: a funding approval is required before launch"**. This also holds after a rejected or deferred decision, and after a revoked one (funded → selected).
  - Any other non-funded status gives **422 `initiative.not_launchable` "Only a funded initiative can be launched"**.
- **`latestFundingState()`** is a read-only query over `funding_decision`. The latest row (`decided_at desc, id desc`) decides: `approved` → `funded`, `revoked` → `revoked`, `rejected` or `deferred` → `unfunded`, and no decision → `unfunded` (fail closed).
  - Launch requires status `funded` **and** `latestFundingState() === "funded"`.
  - The test sequence is none → approved → deferred → revoked.

**Selection delegation (`onBehalfOfUserId`).** It is one hop only, through `actsOnBehalfOf(…, "portfolio_selection", …)`: a delegate never re-delegates, so there is no approval loop. The person acted for must hold `portfolio.select` on the transformation, and the caller must also pass the `portfolio.select` write gate. Otherwise the answer is 403 `selection.not_delegated`. When delegation is used, the audit context carries `onBehalfOfUserId`. **This is a design choice the ADR does not fix**; see §7.

**Withdraw and cancel.**

- Withdraw needs a reason (400 without one) and moves `submitted` or `ranked` to `draft`. From any other status it gives 422 `initiative.not_withdrawable`.
- Cancel applies to every non-terminal status, from draft through funded (all five tested). It needs a reason and sets `cancelled_at`, `cancelled_by` and `cancel_reason`. On a launched or cancelled initiative it gives 422 `initiative.not_cancellable`.

**Authorization tests, on every mutation I route.**

- **AUD 403 with the denial audited** (`authorization.denied`, nothing written) on:
  - create and PATCH (`initiatives.test.ts`);
  - the 3 link creates and 3 link removes (`links.test.ts`);
  - all 6 transitions, each with its real body and with `{}` (`transitions.test.ts`, `it.each`).
- **Role negatives:** SP has no `initiative.edit` and gets 403 on edit and on a link create; WL has no `initiative.launch`; TL has no `portfolio.select`.
- **BE18A commit-time re-check**, `initiatives.test.ts` "BE18A: …":
  1. A connection holds `LOCK TABLE initiative`, so the PATCH handler blocks *after* its principal was loaded.
  2. The caller's grant is revoked meanwhile and the lock is released. The answer is **403**, the denial is audited and the row is unchanged.
  3. **Negative control:** with `atCommit` temporarily removed, the same test fails with 200 instead of 403 (`be18a-negative-control.log`). I restored the file afterwards.

## 4. Problem codes added (i18n keys; the English texts are verbatim ADR text where the ADR fixes one)

| Code | Type | Text |
|---|---|---|
| `initiative.g1_not_approved` | invalid-transition | ADR text (from `sequencing.ts`) |
| `initiative.outcome_before_activity` | **validation**, pointer `/outcomeContributions` | ADR text |
| `initiative.direction_not_approved` | invalid-transition | ADR text (from `sequencing.ts`) |
| `initiative.selected_unfunded` | invalid-transition | ADR text |
| `initiative.not_launchable` | invalid-transition | ADR text |
| `initiative.not_ranked` | invalid-transition | ADR text |
| `initiative.not_withdrawable`, `initiative.not_deselectable`, `initiative.not_cancellable`, `initiative.not_submittable` | invalid-transition | My wording; the ADR names a code but gives no text (or names neither) |
| `initiative.not_tom_evidence` | validation, `/targetType` | ADR text |
| `initiative.gap_target_type`, `initiative.kpi_not_in_outcome`, `initiative.link_target_archived`, `initiative.planned_range`, `initiative.read_only`, `initiative.link_removed` | validation / invalid-transition | My wording |
| `initiative.gap_link_duplicate`, `initiative.decision_link_duplicate` | duplicate (409) | My wording |
| `selection.not_delegated` | forbidden (403) | My wording |

## 5. Test-only fixtures (disclosed, as the assignment asks)

These are in `p3-exercises-be-b.ts`. Each runs in **one transaction through the app role, with the audit events the database requires**:

- **`stageFunding(api, initiativeId, deciderId, outcome)`** inserts:
  - a canonical **`decision` row of kind `executive`** (`DEC-nn` from `record_code_counter`, status `decided`, `decided_by`/`decided_at`) and its audit event;
  - the **`funding_decision` row** (outcome, amount `"1500000.0000"` SAR, rationale, `approver_role_code` SP) and its audit event.

  It then mirrors the status the way ADR-0023 §7 says BE-E's route will: `approved` moves selected → funded, and `revoked` moves funded → selected, each with an audit event. It stands in for `POST /funding-decisions`, which BE-E owns and which does not exist yet.
- **`stageRanked(api, initiativeId, actorId)`** adds a complete `ranking_entry` (score `"3.3000"`) to the current `ranking_snapshot` under the active weight set, creating the snapshot with its audit event if none exists. It then moves submitted → ranked with an audit event. It stands in for BE-D's ranking transaction.
- Gate statuses are staged with BE-A's `setGateStatus` (`portfolio/fixtures.ts`, imported and not edited).

All of this data is synthetic, and none of it approves anything real.

## 6. Checks run (Node 24.21.0, pnpm 10.33.0, offline, PostgreSQL 16.13, ports 23200–23249)

All logs are in `docs/delivery/handbacks/DG3/T-DG3-BE-B-evidence/`.

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` (start and end) | `PASS gate DG2 (historical)`, exit 0 | `validate-historical-DG2.log` |
| `pnpm -r typecheck` | exit 0 | `pnpm_-r_typecheck.log` |
| `pnpm -r build` | exit 0 | `pnpm_-r_build.log` |
| `pnpm lint` | exit 0 (final run) | `pnpm_lint.log` |
| `pnpm openapi:lint` | exit 0, "OpenAPI 3.1.1, 270 operations" | `pnpm_openapi_lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `prettier-ls-files.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0; 55 files, **1123/1123** | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0; 55 files, **1123/1123** | `unit-c-utf8.log` |
| `QA_PG_PORT=23220 MTH_PORT_POOL=23221-23249 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0; **45 files, 682/682**; "applied 25 migrations to a fresh database" | `integration.log` |

**New integration tests: +3 files, +44 tests** (BE-A's run had 42 files and 638 tests):

- `initiatives.test.ts`: 12;
- `links.test.ts`: 12;
- `transitions.test.ts`: 20.

The contract test's "P3 BE-B operations" case exercises all 20 operations and passes.

**Pinned counts in `contract.test.ts`.** I changed only the two assertion values; the comments above them still describe BE-A's numbers.

- Media-type triple: `[90, 89, 1]` → **`[104, 103, 1]`**, because my 14 mutations add 14 JSON request bodies.
- Rate-limit floor: `>= 167` → **`>= 187`**. That is 167 + 20 BE-B operations, and the live sweep checked all of them.

**Log scan of `integration.log`.** The only matches for "unhandled", "timeout" or "failed to" are the expected outputs of passing tests: the BE17 ECONNRESET probe, the 408 requestTimeout probes and the bounded-checkout tests. No suite failed and no hook timed out.

**Non-zero exits during the work (all disclosed; each was fixed before the final runs above):**

1. **Contract test, first targeted run:** exit 1. One failure, the media-type pin `[104, 103, 1]` vs `[90, 89, 1]`, which is expected after routing (`dev-contract-run1-pin-failed.log`). I updated the pin.
2. **`initiatives.test.ts`, first run:** exit 1, 1/12 failed (`dev-initiatives-run1-failed.log`). My first BE18A test used *create*. On create, `openWrite` runs before anything touches `initiative`, so the table lock could not hold the request between principal load and write gate. I moved the proof to PATCH, which reads the row first; that run passed 12/12 (`dev-initiatives-run2.log`). Create uses the same `atCommit` gate.
3. **`links.test.ts`, first run:** exit 1, 2/12 failed (`dev-links-run1-failed.log`). This was test data: the TOM dimension codes `data` and `process` don't exist; the right codes are `data_analytics` and `journeys_processes`. The rerun passed 12/12.
4. **BE18A negative control:** exit 1, **as intended** (`be18a-negative-control.log`).
5. **`pnpm lint`, first run:** exit 1, two `eqeqeq` errors (`!= null` in `assertPlannedRange`). I fixed them; the first log was overwritten by the passing run.
6. **Unit, first runs (both locales):** exit 1, 2/1123 failed in `apps/api/src/architecture.test.ts` (`unit-*-run1-failed.log`). There were two causes:
   - **My code.** Two non-literal computed keys (`[target.column]` in `links.ts` and `TRANSITION_REASONS[code]` in `transitions.ts`) bypass the module-interface checker. I fixed both.
   - **A session-harness artefact.** Empty `.claude/.cc-writes` directories appeared in every subdirectory my shell had `cd`'d into, including `apps/api/src/modules/.claude`, which the "only mapped module directories" test flags. I removed those empty, untracked directories, and never touched the root `.claude/`. A clean checkout never has them.

## 7. Changes needed in files I do not own, and open points

1. **`apps/api/src/modules/platform/db-errors.ts` (BE-A).** Add `["initiative_contribution_kpi_matches_outcome", "/outcomeKpiId"]` to `P3_CHECK_POINTERS`.
   - Today the trigger maps to 422 `validation.constraint` with an empty pointer.
   - The API always answers first with 422 `initiative.kpi_not_in_outcome` at `/outcomeKpiId`, so this is defence in depth only.
2. **`apps/api/src/modules/portfolio/funding.ts` header comment (BE-E or the integrator).** Lines 2–3 still say "Until BE-E lands, latestFundingState() answers 'unfunded'". It now reads `funding_decision`. I left the comment alone because the ownership note limits me to the function and its imports.
3. **ADR-0021 §2 (architect).** It lists `archived_*` among the initiative's further columns, but `0020` has no archive columns on `initiative`, and the contract has no archive route or archive fields on `Initiative`.
   - I implemented "archive, never delete" as: no DELETE, `cancelled` is the terminal retirement, and cancelled or completed initiatives (and their links) are read-only.
   - The ADR wording may need aligning.
4. **Funding mirror after deselect (BE-E to decide).** Deselecting a `funded` initiative moves it to `ranked` and leaves its approved funding decision as the latest row.
   - If it is selected again, the status is `selected` while `latestFundingState()` is `funded`, so `displayStatus` is `initiative.status.selected`.
   - Launch still refuses it (`selected_unfunded`), because launch requires status `funded`.
   - BE-E's funding route should decide whether a deselection voids funding, or whether re-selection re-mirrors to `funded`.
5. **`flags[]` on the initiative is always `[]`.** The schedule and capacity flags are BE-C's `schedule.ts` and BE-E's `capacity.ts`. Whoever wires them into the initiative representation should add one call in `presentInitiatives` (`repository.ts`).
6. **Selection delegation design (architect to confirm).** As §3 describes: one hop, the delegator must hold `portfolio.select`, and the caller must hold it too. If the ADR prefers "delegated selection not supported" (like dispensations), it is a three-line change in `selections.ts`.
7. **`contract.test.ts` comments.** I changed only the two values, so the integrator may want to update the comments above them (they still say "+ the 6 BE-A P3 operations").
8. **Merge:** no migration and no conflicts expected. BE-E later edits `funding.ts` around my function. The contract pins need reconciling across BE-C, BE-D, BE-E and KBE-B (+20 operations and +14 JSON bodies from BE-B).

**Not done:** nothing in scope is left undone. The `presentInitiatives` flags in item 5 belong to other tasks.
