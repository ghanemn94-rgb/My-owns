# Handback T-DG3-BE-D: prioritization (weight sets, scores, rankings with causes, overrides, comparison view)

- **Role:** backend-workflow-engineer. **Stage:** DG3 (BUILDING). **Task:** T-DG3-BE-D.
- **Invocation:** run `DG3-T-DG3-BE-D-backend-workflow-engineer-20261007T231244Z-7412e10b`, session `7412e10b-8381-43b0-a348-06987c3f736d`.
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-BE-D.md`. I verified sha256 `b41441df…5fd71` at the start.
- **Worktree:** `/home/user/wt/dg3-be-d`, branch `dg3/be-d`, base `8236d61` ("DG3: wave-2 assignments"). Nothing is committed; the orchestrator integrates.
- **Time:** start `Wed Oct  7 23:13:04 UTC 2026`, end `Wed Oct  7 23:40:12 UTC 2026` (the last check). The handback was written right after.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, exit 0, at the start (`validate-historical-DG2-start.log`) and at the end (`validate-historical-DG2.log`).
- **Business approvals:** product gates G1–G6, weight-set approvals and override decisions are business approvals inside the product. Every approval in the tests is a demo decision by a synthetic user on synthetic data, and approves nothing real. Nothing here reads or writes the DG0–DG7 records.

**Migrations:** none. The task uses the frozen `0021` tables and `0024` seeding only.

**Summary:** all six scope items are done. Every check passes except the unit suite, which has **1 failing test** in both locales. The cause is an allow-list in a file BE-A owns, which doesn't yet list the `@mth/shared/calc` import path the assignment requires. §6 has the requested one-line change and a run with it applied (1123/1123).

## 1. Files changed (all within my ownership list, plus the two pinned counts)

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/scores.ts` | Score routes: GET sheet, POST create, PATCH update/clear. Also the shared prioritization helpers: the active weight set, score maps, the append-only result writer (`appendResult`, with its cause), the `ScoreResult` presenter (display values from `scoring.ts`), the exact score comparator and the prioritization advisory lock (`730222`). |
| `apps/api/src/modules/portfolio/prioritization.ts` | Weight sets: list, propose, get, approve (activation plus rescoring), withdraw. The comparison view `GET …/prioritization` (`buildPrioritizationView`) with injectable flag sources. Contract zod mirrors for these operations. |
| `apps/api/src/modules/portfolio/rankings.ts` | Snapshot creation per ADR-0022 §4: tie-break, overrides, causes, `removed` entries, and submitted → ranked with an audit event per initiative. Also snapshot list and get, the history with `causeLabels`, the pure `rankOrder`, and the mirrors. |
| `apps/api/src/modules/portfolio/overrides.ts` | Overrides: list, propose, decide (approve/reject) and revoke, with the reason rules and separation of duties. |
| `apps/api/test/integration/portfolio/prioritization.test.ts` | **New**: 17 integration tests against real PostgreSQL (§3). |
| `apps/api/test/integration/contract/p3-exercises-be-d.ts` | Exercises all 17 operations through the validating client, registers the 17 zod mirrors, and adds the synthetic fixtures `insertInitiative` and `cancelInitiative`. |
| `apps/api/test/support/p3-pending-be-d.ts` | Now empty: all 17 operations are routed and exercised. |
| `apps/api/test/integration/contract/contract.test.ts` | **Only** the two pinned counts (§5). |
| `docs/delivery/handbacks/DG3/T-DG3-BE-D-*` | This handback and its evidence logs. |

## 2. API endpoints added (17 operations, frozen contract)

| Operation | Route | Permission | Notes |
|---|---|---|---|
| `getPrioritization` | `GET /transformations/{id}/prioritization` | `transformation.read` | Filters `status`, `waveId`, `completeness`, `flag` and `funding` (§7 item 3) |
| `listWeightSets` | `GET …/prioritization/weight-sets` | read | Newest first |
| `createWeightSet` | `POST …/prioritization/weight-sets` | `prioritization.edit` | 201, version 1, `Location` |
| `getWeightSet` | `GET …/weight-sets/{versionNo}` | read | ETag |
| `approveWeightSet` | `POST …/weight-sets/{versionNo}/approve` | `prioritization.approve` | If-Match, `TransitionNote` |
| `withdrawWeightSet` | `POST …/weight-sets/{versionNo}/withdraw` | `prioritization.edit` | If-Match, `ReasonRequest` |
| `getInitiativeScores` | `GET /initiatives/{id}/scores` | read | |
| `createInitiativeScore` | `POST /initiatives/{id}/scores` | `prioritization.score` | 201; 409 `prioritization.score_exists` if the criterion is already scored |
| `updateInitiativeScore` | `PATCH /initiatives/{id}/scores/{criterionCode}` | `prioritization.score` | If-Match; `score: null` clears |
| `listRankingSnapshots` | `GET …/prioritization/rankings` | read | Cursor |
| `createRankingSnapshot` | `POST …/prioritization/rankings` | `prioritization.edit` | 201, ETag `"1"`, `Location` |
| `getRankingSnapshot` | `GET …/rankings/{snapshotNo}` | read | |
| `getRankingHistory` | `GET …/prioritization/ranking-history` | read | `initiativeId`, cursor |
| `listRankingOverrides` | `GET …/prioritization/overrides` | read | Cursor |
| `createRankingOverride` | `POST …/prioritization/overrides` | `prioritization.edit` | 201 |
| `decideRankingOverride` | `POST …/overrides/{overrideId}/decision` | `prioritization.approve` | If-Match, `ApprovalDecision` |
| `revokeRankingOverride` | `POST …/overrides/{overrideId}/revoke` | `prioritization.approve` | If-Match, `ReasonRequest` |

Every mutation route follows the same pattern:
- It declares `config.access` and `config.consumes: ["application/json"]`, matching the contract's request media type.
- It parses through the shared strict UTF-8 parser (no route-local parser) and validates with strict zod objects. Free text goes through `freeText`; the override reason through `hasInvalidCharacter` and `hasText`.
- It re-authorises inside its transaction (`openWrite(…, { atCommit: true })`).
- It checks `If-Match` (428/409) where the contract declares it. Creates are version 1.
- It writes an audit event for every changed audited row.
- It does no client or remote I/O inside the transaction.

Weights and scores are `numeric`/`smallint` in SQL. Weights and weighted scores are decimal strings on the wire. No `Number()` is used on any weight, score or weighted score. Ordering compares the exact fixed-format `numeric(7,4)` strings (`compareScoreDesc`), and all arithmetic is in `@mth/shared/calc`.

## 3. Behaviour per requirement (acceptance texts quoted)

**REQ-PB-049: weight sets.**
- *"95%/105% → 422 with nothing written."* `validateWeightSet` runs before any write. The answer is 422 `urn:mth:problem:validation`, code `prioritization.weights_total`, detail `Weights must total 100% (got 95.00%)` (or `105.00%`), pointer `/weights`. The test asserts that the counts of `scoring_weight_set`, `scoring_weight` and their audit rows are unchanged.
- Other `validateWeightSet` problems on a schema-valid body are also 422 with the first problem, as ADR-0022 §2a requires. For example, `"0"` gives `prioritization.weight_range` at `/weights/1/weightPercent`. A body that breaks the contract schema is 400.
- *"v2 with risk_compliance 10 and strategic fit 15 accepted and approved by SP."* The proposal is created as `versionNo: 2`, `proposed`. The proposer gets 403 `approval.approver_is_proposer` even when they also hold SP, so the 403 comes from separation of duties, not a missing permission. AUD gets 403. If-Match gives 428 and 409. The Sponsor's approval returns 200 with `active`, `approvalBasis: approved`, `approvedBy` set to the Sponsor and the audit actor set to the Sponsor. v1 becomes `superseded`, with its own audit event.
- *"Activation appends results under v2 for every submitted initiative."* Activation appends one `weight_set_activated` result per eligible initiative (submitted, ranked, selected, funded, launched). Without a `risk_compliance` score the result is `incomplete` with `weightedScore` null. After scoring it, the v2 result is complete.
- *"v1 results keep v1."* The test asserts that the v1 rows are byte-identical before and after activation and still carry `weight_set_version_no = 1`. The v2 rows are new.
- *"Immutable (DB guard)."* The app role cannot UPDATE `scoring_weight` (permission denied). The owner role hits the append-only trigger. Changing a set's `rationale` raises `immutable`.
- Withdraw: `proposed → withdrawn` with a reason; an active set gives 422 `prioritization.weight_set_not_proposed`.

**REQ-PB-047 / REQ-PB-048: scores.**
- *"Score 6 → 400."* 6, 0, 2.5 and `"4"` are 400 at `/score`, with nothing written.
- *"The weighted score is never accepted as input."* A body with `weightedScore` is 400 (strict object).
- *"5,4,3,2,1 under v1 → `3.3000` stored, `3.30` shown, `display100` `57.5` with the conversion label."* The test asserts the response: `weightedScore "3.3000"`, `weightedScoreDisplay "3.30"`, `display100 "57.5"`, `conversion "(score-1)/4*100"`. The view's `conversionLabel` is `0–100 view = (weighted score − 1) ÷ 4 × 100`. In the database, the `initiative_score_result` rows carry causes `initial`, then `score_change` ×4, with the last at `3.3000`. The audit diff of the score carries `weightedScore {from: null, to: "3.3000"}`.
- *"A missing score → incomplete with weightedScore null, never a number."* The test checks `completeness: incomplete` with `weightedScore`, `weightedScoreDisplay` and `display100` all null and the missing criteria listed. An initiative with no score at all returns a live incomplete result (`computedAt: null`), never 0.
- A `ScoringInputError` thrown while reading stored rows is rethrown as a plain error, so it gives a logged 500, as ADR-0022 §2a item 2 requires.

**REQ-S09-005: rankings and history.**
- The deterministic tie-break orders by the exact weighted score descending, then `code` ascending. In the test, `INI-00` and `INI-02` are both 3.25 under v1 and are ranked 2 and 3. Incomplete initiatives follow, unranked.
- Complete `submitted` initiatives become `ranked`, each with an `initiative.rank` audit event. Incomplete ones stay `submitted`.
- *"The history shows 'weight version 2' as the cause of a rank change."* After v2 activation, B moves 3 → 1 and A moves 1 → 2. Both carry `causes: ["weight"]` and `causeLabels: ["weight version 2"]`. `GET …/ranking-history?initiativeId=B` returns that change.
- The other causes are covered too:
  - `new`;
  - `score`, labelled `score change (strategic_fit, financial_value, customer_impact)`;
  - `relative`;
  - `override`, labelled `override: <reason>`;
  - `removed`, for a cancelled initiative, with its `previousRank` kept.
- The previous snapshot becomes `superseded`, with its own audit event.

**REQ-S09-005: overrides.**
- *"An override without a reason is rejected."* A missing reason or `""` is 400 with pointer `/reason`. Whitespace-only text and `U+200B U+200B U+200B U+2060` are 422 `prioritization.override_reason_required` at `/reason`.
- *"The proposer cannot approve."* The proposer gets 403 `approval.approver_is_proposer`, again even while holding SP. A direct SQL approval by the proposer is refused by `ranking_override_approver_not_proposer`.
- The Sponsor's approval applies from the next snapshot: the overridden initiative moves to rank 1 with `causes ["new","override"]`.
- Revoking, then taking a new snapshot, gives `relative`.
- A second live override for the same initiative is 409 `prioritization.override_exists`.
- Delegated decisions are refused with 422 `prioritization.on_behalf_not_supported`, the same design as BE-A's dispensations, so no approval loop is possible.

**REQ-S09-004 / REQ-S09-003: comparison view.**
- Per eligible initiative the view returns: the result, rank, the value axis (e.g. `4.1111`), the feasibility axis (e.g. `3.0000`), selection, funding and flags. Axes come from `axisScore`; Unknown is `null`, never 0.
- Ranking, selection and funding are separate columns. Funding uses `latestFundingState()`, which is `not_applicable` unless the initiative is selected, funded or launched.
- The `status`, `completeness` and `flag` filters are tested; a bad enum value is 400.
- Flags come from injected sources: `DEFAULT_FLAG_SOURCES = { scheduleFlags, capacityFlags }`, both returning nothing by default. `buildPrioritizationView(db, id, query, sources)` takes the sources as a parameter. A test injects a capacity flag and filters on `flag=capacity.over_allocated`. I don't import `schedule.ts` or `capacity.ts`.
- More than 500 eligible initiatives gives 422 `prioritization.portfolio_too_large`, tested with 501 synthetic initiatives (§7 item 3).

**AUD 403:** the read-only auditor gets 403 on all nine mutations: weight-set create, approve and withdraw; score create and update; snapshot create; override create, decide and revoke.

**Commit-time authorization (BE18A), all nine mutations, with a control.** The request is paused on a lock of its own session row. `touchSession` in the identity hook runs after the grants were loaded, so the pause comes after the identity check and before the handler. The caller's only grant is revoked during the pause, then the lock is released. Each mutation answers 403, and the state (sets, scores, snapshots, overrides) is unchanged. In the control case, the same pause without a revocation commits with 201. That shows the 403 comes from the re-check inside the transaction, not from the request-start snapshot.

## 4. Checks run (Node 24.21.0, pnpm, offline, PostgreSQL 16.13; logs in `T-DG3-BE-D-evidence/`)

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)` (start and end) | `validate-historical-DG2{-start,}.log` |
| `pnpm -r typecheck` | 0 | | `pnpm_-r_typecheck.log` |
| `pnpm -r build` | 0 | | `pnpm_-r_build.log` |
| `pnpm lint` | 0 | | `pnpm_lint.log` |
| `pnpm openapi:lint` | 0 | `OpenAPI 3.1.1, 270 operations` | `pnpm_openapi_lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style | `prettier-ls-files.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **1** | 55 files, **1122/1123**. The 1 failure is `architecture.test.ts` "allowed packages" (§6). | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | Same: 1122/1123, same single failure | `unit-c-utf8.log` |
| The same two unit runs (`vitest --project unit-node --project unit-web`) in a disposable copy under `$TMPDIR` with only the §6 one-line change | 0 / 0 | 55 files, **1123/1123** in both locales | `unit-*-with-requested-allowlist-change.log`, `requested-allowlist-change.diff` |
| `QA_PG_PORT=23310 MTH_PORT_POOL=23311-23349 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 43 files, **655/655**; "applied 25 migrations to a fresh database" | `integration.log` |
| Prioritization suite, verbose | 0 | 17/17 | `prioritization-verbose.log` |

- **Ports:** 23300–23312, all inside my 23300–23349 range.
- **Integration log scan:** I searched for "unhandled", "timeout" and "failed to". The only matches are expected outputs of passing DG2 tests: request-timeout sweeps that print 408 by design, and the BE17 `db-econnreset` probe. There are no hook timeouts and no failed suites.

**Earlier non-zero runs (disclosed):**
- My first focused run of the new suite: exit 1, 1 of 16 failed (`prioritization-run1-failed.log`). The immutability probe expected the append-only message, but the app role is refused earlier with `permission denied`. I fixed the **test**: the app role now asserts permission denied, and an owner-role probe asserts append-only. No product code changed for this.
- The unit failure above, explained in §6.

**New tests:**
- `prioritization.test.ts`: 17 tests.
- The contract seam exercises all 17 operations, with success and selected 4xx cases, through the validating client and zod mirrors.

## 5. Pinned-count changes (`contract.test.ts`, only these two lines)

| Count | Old → new | Why |
|---|---|---|
| Media-type triple | `[90, 89, 1]` → **`[99, 98, 1]`** | 9 new JSON request bodies: weight-set create, approve and withdraw; score create and update; snapshot create; override create, decision and revoke. |
| Rate-limit floor | `>= 167` → **`>= 184`** | 17 more live operations. |

The total `toHaveLength(270)` is unchanged. The contract test passes with these values in the full integration run. P3 pending: BE-D has 0.

## 6. Changes needed in files I do not own

1. **`apps/api/src/architecture.testkit.ts` (BE-A), line 135.** Add `"@mth/shared/calc"` to `SHARED_ALLOWED`:
   ```diff
   -const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db"]);
   +const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/shared/calc", "@mth/config", "@mth/db"]);
   ```
   - **Why:** the assignment and ARCH-02 require BE-D, and later KBE-C, to import the arithmetic from `@mth/shared/calc`. ARCH-02 created the subpath but didn't add it to the API module checker. That's the only unit failure.
   - **Evidence:** with this line, all unit tests pass in both locales (`requested-allowlist-change.diff` and the two `*-with-requested-allowlist-change.log` files).
   - I did not edit the file.
2. **`docs/api/openapi.yaml` (architect): `getPrioritization`.** The assignment and ADR-0022 §7 call for a `funding` filter and for 422 `prioritization.portfolio_too_large` above 500 initiatives. The frozen contract has neither the `funding` query parameter nor a `422` response on this operation.
   - **What I did:** I implemented both as assigned. I tested them through `buildPrioritizationView` directly instead of HTTP, because the validating test client would flag the undeclared parameter and status.
   - **Request:** add `funding` (enum `not_applicable|unfunded|funded|revoked`) and `"422": BusinessRule` to `getPrioritization`.
3. **Contract versus assignment naming (no change needed; I followed the contract):**
   - The assignment says `PUT …/weight-sets`; the contract and ADR-0022 §1 have `POST`.
   - The assignment says `GET …/rankings/history`; the contract has `GET …/prioritization/ranking-history`.
4. **Shared zod mirrors.** No `packages/shared/src/schemas/prioritization.ts` exists. BE-A's `portfolio.ts` covers only the portfolio-tag operations, and I don't own `packages/shared`. So the prioritization mirrors live in my route files (`weightSet`, `initiativeScore`, `scoreResult`, `rankingEntry`, `rankingOverride` and others) and are imported by the contract seam. If FE-B needs them from `@mth/shared/schemas`, the orchestrator could move them there.

## 7. Design choices and open points (please confirm)

1. **Problem codes without an ADR text.** These codes are mine, and the English detail texts are mine too:
   - `prioritization.score_exists` (409);
   - `prioritization.weight_set_not_proposed`, `override_not_proposed`, `override_not_revocable` (422 invalid-transition);
   - `prioritization.override_exists` (409);
   - `prioritization.override_not_eligible` (422: the initiative must be submitted or later, and not cancelled);
   - `prioritization.on_behalf_not_supported` (422);
   - the detail texts of `prioritization.override_reason_required` ("An override needs a reason.") and `prioritization.portfolio_too_large`.

   Separation of duties reuses `approval.approver_is_proposer` with the `db-errors.ts` text. FE-B needs i18n keys for these.
2. **Initiative presenter.** BE-B's presenter wasn't available, so the view uses a local one. Its `displayStatus` is 'Selected - unfunded' when an initiative is selected and not funded. Its `warnings` is `[]`: the T05 3–7 deliverable warning belongs to BE-B. At integration, the view could switch to BE-B's presenter.
3. **Flag injection (for BE-E).** BE-E replaces only the two lines in `DEFAULT_FLAG_SOURCES` in `prioritization.ts`. The source type is `FlagSource = (db, transformationId, initiativeIds) => Promise<Map<initiativeId, ScheduleFlag[]>>`.
4. **Ranked but now incomplete initiatives keep `ranked`.** ADR-0022 doesn't say what happens to them. They appear as `incomplete` entries with rank null.
5. **Advisory lock.** Weight-set proposal and activation, snapshot creation and score writes serialize per transformation on `pg_advisory_xact_lock(730222, hashtext(transformation_id))`. This avoids races on the next version or snapshot number and on the "latest result". BE-C's dependency lock uses 730221.
6. **Scoring a draft initiative is allowed.** Its results are appended. Activation and ranking consider only the eligible statuses. If an eligible initiative has no result under the active set, ranking computes one and appends it with cause `initial`.

## 8. Merge instructions

- No migration, no dependency change, no lockfile change.
- Apply the §6 item 1 line together with this change, or the unit suite stays at 1122/1123.
- No conflicts are expected: every file is in my ownership list, apart from the two pinned-count lines in `contract.test.ts`. The orchestrator reconciles those across tasks. My delta is +9 bodies and +17 live operations.

## 9. Not done

Nothing in the assigned scope is left undone. The open items are outside my ownership: §6 items 1, 2 and 4, and the confirmations in §7.
