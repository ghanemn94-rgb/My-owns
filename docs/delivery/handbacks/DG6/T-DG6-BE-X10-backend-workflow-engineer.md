# T-DG6-BE-X10 handback: rule version at occurrence (D-204) (backend-workflow-engineer)

- **Stage:** P6, gate DG6 (BUILDING). **Branch:** `dg6/be-x10`, starting `HEAD` `c86e70ee21e024ac4bd76eb5ddff55629647b6ff` (clean tree).
- **Invocation:** run `DG6-T-DG6-BE-X10-backend-workflow-engineer-20261101T033753Z-81ecf307`, session `81ecf307-12fe-4c3f-a087-cb3ce0a800c9`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-X10.md`, sha256 `d2489708…e84f598f` (verified with `sha256sum`).
- **Time:** start `Sun Nov 1 03:38:06 UTC 2026`. End: see §9.
- **Changes are uncommitted**, for the orchestrator to integrate.
- **Approvals:** nothing here grants or records a business, Finance or IT approval. Product gates G1–G6 are untouched, and nothing reads or writes DG0–DG7. All test data is synthetic. The test rules only create tasks.

## 0. Contradiction in the assignment (reported, not guessed)

The assignment's binding section is "`docs/architecture/p6-work-split.md` pre-freeze repair: rule version at occurrence (D-204)". **That section does not exist** in this tree: `grep -n "D-204\|BE-X10\|rule version at occurrence"` on the file finds nothing. BE-X9 reported the same gap for its section.

So I worked from these sources only:
- the assignment text;
- D-203 and D-204 in `docs/delivery/decisions.md`;
- the BE-X9 handback §6 item 2;
- the §2 shared rules.

I touched only files the repair needs (§1). The orchestrator should confirm file ownership at merge.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0123_p6_automation_rule_enablement_disable.sql` | **New migration, id 0123** (the next above 0122 on this branch, D-196). Completes the 0122 ledger so it holds the full interval history of each rule. (1) The trigger function is replaced (`CREATE OR REPLACE`, still `SECURITY DEFINER`, PUBLIC execute revoked) so it also writes a `disable` row, with the version that stopped, when an enabled rule is disabled. (2) The source CHECK gains `disable` and `backfill_disable`. (3) A lookup index `(automation_rule_id, enabled_from DESC, id DESC)`. (4) A backfill of past disables from their own `automation_rule.disable` audit events, at the stored audit time. |
| `apps/worker/src/automation/engine.ts` | `candidates(…, outboxEventId)`: for an event, the evaluating version is the one in the newest ledger row at or before the event's stored occurrence time (`outbox_event.created_at`), not the current effective version. No row, or a disable row, means no candidate. That version may be `published` or `superseded`. New export `DISABLE_SOURCES`. Ticks are unchanged (current effective version). |
| `packages/db/src/schema.ts` | Doc comment of `AutomationRuleEnablementTable.source` lists the two new sources. No column change, so `SCHEMA_COLUMNS` is unchanged. |
| `apps/api/test/integration/automation/automation-version-at-occurrence.test.ts` | **New.** 5 tests on the real API, relay and worker, on a scratch database that is first migrated only up to 0122 (§2). |
| `apps/api/test/integration/automation/automation-backlog-enablement.test.ts` | BE-X9's disable/re-enable test: **one expectation changed.** The ledger is now `["enable", "disable", "enable"]` (was `["enable", "enable"]`), because 0123 records the disable. Its behavioural assertions are unchanged, and all 4 BE-X9 tests still pass. |
| `packages/db/src/seed.test.ts` | The free-id example moves from 0123 (now shipped by this task) to 0124, following the comment chain every migration task extends. |
| `packages/db/test/integration/catalogue.test.ts` | New test "0123: …": the source CHECK, the lookup index, and the writer function still `SECURITY DEFINER`, with no PUBLIC execute and with the disable branch. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X10-*` | This handback and its evidence. |

## 2. Behaviour delivered

D-204 assigns no new requirement row, and I changed no row's acceptance text. The repair serves these rows:
- **REQ-S12-001**, acceptance "A13: each execution is recorded with rule version, trigger event and outcome". The recorded `automation_rule_version_id` is now the version in force when the event occurred.
- **REQ-S12-021**, acceptance "A13: replaying the same event three times yields one reminder, one action and one approval task". Every evaluation and replay of an event resolves the same version, so the UNIQUE (rule version, trigger key) still gives one execution.
- **REQ-PB-093**, the versioning principle D-203 cites: a record keeps the configuration version in force when it was made.

### The rule (D-204, with D-203 kept)

For an event, the engine takes, per rule, the **newest `automation_rule_enablement` row whose `enabled_from` is at or before the event's stored occurrence time** (`outbox_event.created_at`). Ties are ordered by `id`. The comparison runs in SQL, at microsecond precision.
- **No row** means the event occurred before the rule's first enablement. **No action** (D-203).
- **A `disable` / `backfill_disable` row** means the event occurred while the rule was disabled. **No action** (D-203).
- **Otherwise**, that row's version evaluates the event, even if a newer version has been published since. The older version is then `superseded`; the 0074 execution guard already accepts `published` and `superseded`.
- **The trigger must be one of that version's triggers.** If version N+1 adds a trigger, an event of that trigger from before N+1 is not acted on.
- **Evaluation time is never used.** An unknown occurrence time (no outbox row) still throws `automation.occurrence_time_unknown` (BE-X9, unchanged).

### Exactly-once

- **Unchanged layers:** the execution UNIQUE `automation_execution_once_key` is still per (rule version, trigger key). Lock 730258, the action keys and the effect keys are also unchanged.
- **Why one execution per rule:** the ledger is append-only and the occurrence time is fixed. Every evaluation, retry and replay of one event therefore resolves the same version, so a rule acts on an event once.
- **What BE-X9 did instead:** the version switch dropped the event altogether.

### The ledger now records disables (migration 0123)

- **Why it was needed.** The 0122 ledger recorded only enables and version changes while enabled. Without disables, the state at a past instant cannot be read: after disable, then re-enable, an event in the window would resolve to the earlier enable row.
- **The trigger.** It now writes `disable` (with `OLD.effective_version_id`) on `enabled` true → false. A no-op disable writes nothing, because the API does not update the row.
- **The backfill.** Each `automation_rule.disable` audit event that follows a ledger row of the same rule gets a `backfill_disable` row:
  - at its `occurred_at`, which is the disabling transaction's `now()`, the same instant the trigger would store;
  - with the version of the preceding ledger row.
  The migration's own clock is never used. A disable before the rule's first ledger row needs no row, because no row already means "not enabled".

### A choice I made, for the orchestrator or architect to confirm: the kill switch

- **What the code does.** The rule must **also be enabled at evaluation time**. If an admin disables a rule, its not-yet-evaluated events, including ones that occurred while it was enabled, are not acted on. A test covers this: "kill switch …".
- **Why.** It keeps disable an immediate stop for a misbehaving rule during a backlog.
- **The other reading.** D-204's text ("the version that was effective and enabled at its occurrence time") could also be read as acting on such events. If that reading is wanted, the change is to remove `.where("r.enabled", "=", true)` for events in `candidates`, plus that test.

### The required integration tests

All are in `automation-version-at-occurrence.test.ts`, with the real API, relay and worker:

| Test | What it proves |
| --- | --- |
| "an event under v1, v2 published before evaluation: acted on exactly once, by v1, also when replayed" | v1 published and enabled; event A occurs; v2 drafted, reviewed and published (v1 becomes `superseded`; ledger `enable v1`, `effective_version v2`); event B occurs; **then** the worker starts. Result: A has exactly one execution, by v1; B has one, by v2. A replay of A (a new job id, the same envelope, through pg-boss) resolves v1 again: still 2 executions and 2 action results. |
| "disable/re-enable window across a version switch: …" | Event under v1; disable; event in the window; v2 published **while disabled**; re-enable (on v2); event after. Ledger `enable v1`, `disable v1`, `enable v2`. Evaluated afterwards: first event by v1, window event by nobody, last event by v2. |
| "kill switch: …" | An event while enabled, then the rule disabled before evaluation: 0 executions. |
| "each disable recorded under 0122 is backfilled at its audit event's time, with the version that stopped" | The scratch database is migrated **only up to 0122**. One rule is enabled, disabled and re-enabled through the API, and another is enabled then disabled; the 0122 ledger shows no disable. Then 0123 is applied: `enable`, `backfill_disable`, `enable` and `enable`, `backfill_disable`, with the right version. `enabled_from = audit_event.occurred_at`, compared in SQL. |
| "after 0123 the trigger writes a disable row … and nothing for a no-op" | Plus: `mth_app` cannot INSERT into the ledger (permission denied). |

**Negative control.** I ran the new file with `HEAD`'s (BE-X9's) `engine.ts` swapped in temporarily, then restored it (sha256 `cc790523…a361ea` before and after).
- **The 2 D-204 tests fail.** The v1 event gets no execution: received 1 execution, expected 2.
- **The 3 others pass**, as expected: 0123 and the kill switch do not depend on the engine change.
- Log: `T-DG6-BE-X10-evidence/negative-control-head-engine.log`.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0, offline. PostgreSQL is disposable through `tests/qa/support/with-pg.sh` on ports 27700–27749. Before the test runs I checked for empty `.claude/.cc-writes` directories; none were found.

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `evidence/validate-dg5-start.log` |
| targeted integration: the new file, `automation-backlog-enablement`, `catalogue` (`QA_PG_PORT=27700 MTH_PORT_POOL=27701-27749`) | 0 | 3 files, **46 passed** (5 new + 4 BE-X9 + 37 catalogue) | `evidence/integration-targeted-1.log` |
| negative control (`HEAD` engine) | 1 (expected) | 2 failed, 3 passed | `evidence/negative-control-head-engine.log` |
| `pnpm -r typecheck` | 0 | all packages | `evidence/typecheck.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` | `evidence/lint.log` |
| prettier `--check` over `git ls-files -co --exclude-standard` (first run) | **123** | the new test file needed formatting; fixed with `prettier --write` (layout only) | (overwritten by the rerun) |
| prettier `--check` (rerun) | 0 | "All matched files use Prettier code style!" in every batch | `evidence/prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `evidence/openapi-lint.log` |
| `pnpm test`, locale unset | 0 | unit-node 187 files / **2817** passed; unit-web 120 / **2018** passed; unit-formula-nocodegen 3 / **259** passed, 2 skipped | `evidence/unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts | `evidence/unit-c-utf8.log` |
| full `QA_PG_PORT=27710 MTH_PORT_POOL=27711-27749 tests/qa/support/with-pg.sh pnpm test:integration`, locale unset (03:55–04:48 UTC) | 0 | **Test Files 410 passed (410). Tests 4144 passed, 1 skipped, 2 todo (4147).** 0 failed; 0 Vitest retries (`(retry x` occurs 0 times). This includes the worker and db integration files, all API files, and all **45 `tests/qa/integration` files**. | `evidence/integration-full.log` |
| `pnpm test`, locale unset (rerun after the `seed.test.ts` edit) | 0 | the same counts as above | `evidence/unit-locale-unset.log` (overwritten by the rerun) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (rerun after the `seed.test.ts` edit) | 0 | the same counts | `evidence/unit-c-utf8.log` (overwritten by the rerun) |
| `pnpm -r build` (04:49, after the last source change) | 0 | all packages | `evidence/build.log` |
| end: `pnpm -r typecheck` | 0 | all packages | `evidence/typecheck-final.log` |
| end: `pnpm lint` | 0 | `eslint . --max-warnings=0` | `evidence/lint-final.log` |
| end: prettier `--check` over `git ls-files -co --exclude-standard` | 0 | 0 `[warn]` lines | `evidence/prettier-final.log` |
| end: `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | `evidence/validate-dg5-end.log` |

Disclosures:
- **Concurrent load.** Both `pnpm test` runs (each locale twice) ran while the full integration run was in progress, on the same host. All passed.
- **Unit runs repeated.** The first `pnpm test` pair, with the same counts and exit 0, ran before I edited `seed.test.ts`. The rerun pair, on the final unit sources, is the evidence.
- **Build order.** `pnpm -r build` ran after the integration run, deliberately, so no `dist` file was rewritten while tests ran. Vitest resolves workspace packages from `src` (the `@mth/source` condition), and no non-test source changed after the integration run started.
- **Pinned-count change:** total integration tests rise from BE-X9's 4141 (409 files) to 4147 (410 files): the new file's 5 tests and the catalogue's 1.

## 4. Operations routed (pending list delta)

**None.** No HTTP operation was added or changed, so `openapi.yaml` and the zod mirrors are unchanged. There is no `p6-pending-*`/`p6-exercises-*` delta, and the contract pins are unchanged (932 operations).

## 5. For the orchestrator: contract, schema, dependency

- **Migration `0123_p6_automation_rule_enablement_disable.sql`** (forward-only). Renumber it at merge if a higher id has shipped. The seed free-id example that moved to 0123 (commit `c86e70ee2`) should move to 0124. It replaces one function (`automation_rule_enablement_record`, same signature and security) and one CHECK, adds one index, and inserts only ledger rows.
- **No new dependency, configuration, error code or endpoint.**
- **Pinned counts:** `catalogue.test.ts` gains one test (36 → 37 in that file). No `contract.test.ts` pin changed.
- **For the architect (ADR-0043, T-DG6-ARCH-09):**
  1. D-204 as implemented (§2);
  2. that the ledger now records disables (0123), so its rows form the interval history;
  3. the kill-switch choice (§2), to confirm or reverse;
  4. the residual race in §8;
  5. `docs/architecture/data-dictionary.md` should list the `disable` and `backfill_disable` sources.

## 6. User-facing texts

**No en/ar string is made untrue.** I searched `apps/web/src/i18n/en/*.json` for strings about publish, enable, disable and versions in automation. None states which version handles an earlier event, or what disabling does to queued events.

## 7. Requirement → test

| Item | Test |
| --- | --- |
| D-204 version switch (exactly once, by N, also on replay) | `automation-version-at-occurrence.test.ts` › "an event under v1, v2 published before evaluation…" |
| D-204 + D-203 disable/re-enable window | same file › "disable/re-enable window across a version switch…" |
| kill switch (my choice, §2) | same file › "kill switch…" |
| 0123 backfill | same file › "each disable recorded under 0122 is backfilled…" |
| 0123 trigger, no-op, app cannot write | same file › "after 0123 the trigger writes a disable row…" |
| 0123 catalogue | `packages/db/test/integration/catalogue.test.ts` › "0123: …" |
| D-203 kept | `automation-backlog-enablement.test.ts` (all 4 BE-X9 tests) |

## 8. Known gaps and residual risks

- **A rule transaction older than the event that commits after the event is evaluated.** Ledger and outbox times are both transaction start times (`now()`). Suppose a publish or enable transaction starts **before** an event's transaction but commits only **after** the relay and worker have already evaluated that event. The ledger then gains a row with `enabled_from` before the event's occurrence, so a later replay could resolve a different version. The window is one short API transaction overlapping a full relay-and-evaluate cycle. BE-X9's cutoff has the same class of race. Closing it fully would need commit-ordered times (for example, a per-rule lock held by both the publish/enable path and the engine), which would change ADR-0043's lock design, so I did not do it. It is untested.
- **Ticks** are unchanged and still use the current effective version (BE-X9 §6 item 4).

## 9. Final results and what remains

All acceptance checks of the assignment ran and exit 0 (§3):
1. typecheck, build, lint, prettier and `openapi:lint` (932 operations);
2. `pnpm test` in both locales: 2817 + 2018 + 259 (2 skipped);
3. the full `pnpm test:integration`: 410 files, 4144 passed, 1 skipped, 2 todo, 0 failed;
4. the DG5 historical validator, at the start and at the end.

**What remains:**
1. **Missing section (§0).** The `p6-work-split.md` section the assignment names does not exist, so the orchestrator should confirm file ownership.
2. **For the orchestrator or architect:** confirm or reverse the kill-switch choice (§2).
3. **For the architect:** record D-204, 0123 and the residual race in ADR-0043, and add the two new ledger sources to the data dictionary (§5).
4. **Not repaired:** the race in §8.
5. **Not run under `C.UTF-8`:** integration ran with the locale unset only. The cluster `with-pg.sh` starts is always UTF8/C.

**End time:** `Sun Nov  1 04:58:38 UTC 2026` (about 81 minutes).
