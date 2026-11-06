# Handback T-DG6-ARCH-15 (solution-architect): ADR-0053 records the shipped acknowledge/resolve and recurrence rules (F-DG6-341), plus the round-5 ADR sweep

- **Stage:** DG6 (P6), FIXING after review round 5.
- **Invocation:** `DG6-T-DG6-ARCH-15-solution-architect-20261106T022715Z-afdbc172`, session `afdbc172-f3ed-4853-a9d2-37651c348ab7`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-ARCH-15.md`, sha256 `91a19538006d8d31ed9978c0e4e6d218f70abc78ab415de9e46e3140466b13a5` (verified with `sha256sum` before reading).
- **Starting revision:** branch `dg6/arch-15` at `a600bf63b` ("DG6: ARCH-15 brief (F-DG6-341, ADR sweep)"). `git status` was clean.
- **Time:** started `2026-11-06T02:27:30Z` (`date -u`). The end time is at the bottom.
- **Commits:** none. All changes are left uncommitted for the orchestrator.
- **Scope:** documentation only. No product code, test, schema, migration, OpenAPI or zod file was changed.

No business, Finance or IT approval was granted. Product gates G1–G6 were not touched, and nothing here implies any DG0–DG7 result. Acknowledging an operational exception approves nothing.

## Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` exited **0** and printed `PASS gate DG5 (historical)` (`T-DG6-ARCH-15-evidence/validate-dg5-historical.log`), before any edit.

Because this task appends amendments to a DG4 ADR (ADR-0037) and a DG5 ADR (ADR-0045), I re-ran the historical validators after those edits:
- `--historical --stage DG4`: exit **0**, `PASS gate DG4 (historical)` (`validate-DG4-historical-after-edit.log`);
- `--historical --stage DG5`: exit **0**, `PASS gate DG5 (historical)` (`validate-DG5-historical-after-edit.log`).

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0053-p6-operations-service-identities-exceptions-logs-heartbeat.md` | Item 1 (F-DG6-341): §2 gains "Optimistic concurrency of acknowledge and resolve" (the `rebaseOverSystemOccurrences` rule, the `based_on_version` audit field, the resolve-after-recurrence consequence). Item 2 (BE-Z8, F-DG6-380): §2 gains "How a recurrence moves `last_occurred_at`". §2's refusal-codes sentence and §9 "Every mutation" point to the rule. The status line is updated, and a dated amendment records the history. |
| `docs/architecture/adr/ADR-0051-p6-authorization-boundary-read-scope-sensitive-records-deep-links.md` | Item 3 (sweep against BE-Z7B): §2 "Totals and rollups" is corrected (absent, not `false`, when nothing is sensitive). It gains three paragraphs: "Which responses carry `includesRestrictedRecords`" (a table with each response's owning ADR), "Totals that are the same for every reader" and "The drill-down rule". The status line is updated, and a dated amendment records the history. |
| `docs/architecture/adr/ADR-0037-p4-dashboards-t10-my-work-overview-header.md` | Item 4: a dated amendment records the contract change `ExecutiveOverview.includesRestrictedRecords` (additive, optional). |
| `docs/architecture/adr/ADR-0045-p5-generated-outputs-report-snapshots-owner-updates-presentation-evidence.md` | Item 4: a dated amendment records the read-time section member `includesRestrictedRecords` on `ReportDocument` (additive, optional). |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-15-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-15-evidence/*.log`, `00-summary.txt` | The logs of every check below. |

## 2. What was recorded, item by item (each checked against the code at `a600bf63b`)

### Item 1: F-DG6-341, the acknowledge and resolve version rule (ADR-0053 §2, §9)

The rule as recorded is the code of `rebaseOverSystemOccurrences`, `basedOn`, `acknowledgeException` and `resolveException` in `apps/api/src/modules/operations/exceptions.ts`, as described in the T-DG6-BE-Z6 handback §2.
- **The order of the checks.** The row is read `FOR UPDATE`. Authorization is re-checked at commit first, then the version rule runs, then the state-machine refusals.
- **A version behind the row only by system recurrences is accepted.** Every history event in `(loaded, current]` must exist, with no gap, and be `recurred` with `actor_user_id IS NULL`.
- **A conflict between two humans still returns 409.** So do an automatic `recovered` resolution, an `updated` event, and a version that is not an integer, below 1 or above the row's version. A missing If-Match is still 428.
- **The audit event records the prior, new and base versions:**
  - the true `prior_version`, which is the locked row's version;
  - `new_version`;
  - `changes.based_on_version = {from, to}`, only when the action was rebased.
- **Consequences recorded**, as F-DG6-341's suggested repair asks:
  - an acknowledgement covers the occurrences that arrived after the page loaded;
  - a resolution keeps the folded occurrences counted on the resolved row;
  - `resolved` stays final, and the next failure opens a new exception.
- **Strict elsewhere.** `putServiceIdentity` keeps the strict rule. I checked `apps/api/src/modules/access/service-identities.ts:236`, and §9 says so.

### Item 2: T-DG6-BE-Z8, the recurrence timestamp (ADR-0053 §2)

- **The expression.** `last_occurred_at = greatest(now(), operational_exception.last_occurred_at)`, computed in SQL. It is in `raiseOperationalException` (`exceptions.ts:769`) and `raiseOperationalExceptionTwin` (`apps/worker/src/kit.ts:1038`).
- **How it is serialized.** Both run after `lockException` (lock 730305, `pg_advisory_xact_lock`) and the `FOR UPDATE` read.
- **Effect.** Every concurrent failure is captured once (F-DG6-380). The guard is unchanged, with no migration and no retry. The test is named.

### Item 3: ADR-0051 §2 swept against T-DG6-BE-Z7B

- **`includesRestrictedRecords` on the Executive Overview and on every report section.** It is now in the table of responses that carry the member, which names each response's owning ADR. `AdoptionDashboard` filters its items but has no member; this is stated as a latent limit (see §6).
- **Totals that are the same for every reader.** The ADR lists them:
  - the headlines and area statuses;
  - the overview's `transformations[]`;
  - the drill-down's `value` and calculation expression, rule key and rounding;
  - `BenefitTotals`;
  - the report table totals and metrics.

  It also records the flag rule: `true` whenever the shared rule removed an entry (`restrictedFieldAfter`).
- **The drill-down rule.** The ADR now records:
  - every metric goes through `withoutRestrictedRefs`: items, `calculation.inputs` and evidence;
  - the facts' own lines are checked first (including `benefit_plan_value`), then `SENSITIVE_CHILD_SOURCES`;
  - an evidence entry is checked as its line and as its evidence item;
  - items are filtered before pagination;
  - a restricted `subjectId` is refused with 422 `dashboard.metric_subject_mismatch`.
- **One correction to the existing text.** §2 said the field is `false` when none of the included records is sensitive. The code (`benefits/restricted.ts` `restrictedField` and both `restricted.ts` files in `reporting/`) and the contract descriptions omit it, which keeps DG4/DG5 responses byte-identical. The ADR now says "absent". This changes the documentation only, not the behaviour.

### Item 4: the two contract changes, recorded in the ADRs that own the API

- `ExecutiveOverview.includesRestrictedRecords` is recorded in **ADR-0037**, which owns `getExecutiveOverview` (§2, §8).
- The section-level `includesRestrictedRecords` on `ReportDocument` is recorded in **ADR-0045**, which owns the document model (§3).
- Both amendments state that the member is additive, optional and absent until a record is marked sensitive. No existing member changes, so this is not a breaking change and no gate needs reopening. Both members were already in `docs/api/openapi.yaml` (1.5.0-p6) and the zod mirrors (T-DG6-BE-Z7B). I did not change the contract files.
- ADR-0051's new table also names ADR-0030 as the owner of `BenefitTotals`. That member came from T-DG6-BE-B2, not from this task's two contract changes, so I added no amendment to ADR-0030. See §7.

## 3. Behaviour delivered, per requirement row

This task changes documentation only. No row's behaviour changed. The rows whose ADR text now matches the shipped code:

- **REQ-S20-022** (F-DG6-341). Acceptance: *"A22: Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated"*. ADR-0053 now states the acknowledge/resolve rule that the A22 operability path relies on. A watch recurrence between the page load and the acknowledgement no longer makes the acknowledgement fail.
- **REQ-S12-019.** Acceptance: *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*. ADR-0053 now records how a concurrent recurrence of that one exception is written (BE-Z8).
- **REQ-S20-013.** Acceptance: *"A13: Retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable"*. ADR-0053 now records that concurrent final failures are each captured once (one failure row, one `job.failed`, one recurrence), whatever the commit order.
- **REQ-S10-002.** Acceptance: *"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"*. ADR-0051 §2 now enumerates where a sensitive benefit is hidden and labelled: the overview, the drill-down and report sections. ADR-0037 and ADR-0045 record the contract members.

## 4. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, in the worktree. No empty `.claude/.cc-writes` folders existed in source folders before the tests (`find` printed none). Logs are in `docs/delivery/handbacks/DG6/T-DG6-ARCH-15-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (before any edit) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical.log` |
| 0a | `node tools/gates/validate.mjs --historical --stage DG4` (after the ADR-0037 edit) | 0 | `PASS gate DG4 (historical)` | `validate-DG4-historical-after-edit.log` |
| 0b | `node tools/gates/validate.mjs --historical --stage DG5` (after the ADR-0045 edit) | 0 | `PASS gate DG5 (historical)` | `validate-DG5-historical-after-edit.log` |
| 1 | `pnpm -r typecheck` | 0 | every package Done | `10-typecheck.log` |
| 2 | `pnpm -r build` | 0 | every package Done | `11-build.log` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0`, clean | `12-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `13-prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `14-openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node 190 files / 2899 tests passed; unit-web 122 files / 2062 tests passed; unit-formula-nocodegen 3 files / 259 passed, 2 skipped (261) | `20-test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts | `21-test-c-utf8.log` |
| 8 | `npx prettier --check` on this handback, after it was written (row 4 ran before it existed) | 0 | "All matched files use Prettier code style!" | `15-prettier-handback.log` |

All rows ran through one script whose exit codes are in `00-summary.txt`. Disclosures:
- **Skipped tests.** The 2 skipped tests are in `packages/shared/src/formula/fuzz.test.ts`, which was already skipped before this task and which I did not touch.
- **Order of the ADR-0051 edit.** I made one last ADR-0051 edit, splitting `FinanceDashboard` into its own table row, after the script had started but before its Prettier step (row 4). Row 4 therefore checked the final ADR text.
- **Failures.** None of the checks failed, and none was flaky or timed out.

**Integration tests:** none run. This task touches no product code and no integration file, so no integration file is affected. The full `pnpm test:integration` is not required here (assignment, acceptance 3).

## 5. Operations routed (delta to the pending list)

None. No operation was added or routed, and no `p6-pending-*.ts` or `p6-exercises-*.ts` file was changed.

## 6. Proposed findings (code that contradicts the ADRs)

**None.** I checked every rule recorded above against the code at `a600bf63b` and found no contradiction.

One latent limit is recorded in ADR-0051 §2, not as a finding. `getAdoptionDashboard` filters its items through `withoutRestrictedItems`, but `AdoptionDashboard` has no `includesRestrictedRecords` member. Its items are adoption KPIs, which are never a sensitive type or a child of one, so nothing can be removed today. T-DG6-BE-Z7B states the same limit in §7 item 3. The ADR now requires that a change which lets an adoption item be restricted adds the member in the same change. If the orchestrator prefers to track it, it fits a Low, non-mandatory observation (`F-DG6-ARCH-15-1`).

## 7. Contract, schema, migration and dependency needs (for the orchestrator)

- **Contract:** no change made. The two additive optional members (item 4) were already in `docs/api/openapi.yaml` and the zod mirrors. They are now recorded in ADR-0037 and ADR-0045. Neither is breaking, so no gate needs reopening.
- **Optional, not done:** ADR-0030 (`BenefitTotals`) and ADR-0037's other dashboards carry the earlier BE-B2 member without an amendment of their own. ADR-0051 §2's table now names them with their owning ADRs. Adding the same kind of amendment to ADR-0030 would make the record uniform; that is outside this assignment's four items.
- **Migration:** none. **Dependency:** none.

## 8. User-facing texts made untrue

None. No en/ar string was changed or made untrue. The labels named in the ADRs (`access.includesRestrictedRecords`, `problems.version_conflict`, `myWork.ui.conflictReloaded`) already exist and stay true.

## 9. What remains

- **In my scope:** nothing.
- **F-DG6-341** closes only through a non-author reviewer's verification.
- **Merge notes:**
  - The edits are appended amendments plus inserted paragraphs in §2/§9 of ADR-0053 and §2 of ADR-0051.
  - A conflict is possible only if another branch edits the same paragraphs or appends to the end of the same four ADRs.

Ended: 2026-11-06T02:51:48Z (`date -u`).
