# Handback T-DG4-BE-D2 (backend-workflow-engineer): corrective-action cases, rules, signals and the four consumers

- **Stage:** P4, gate DG4 (BUILDING). **Section:** `docs/architecture/p4-work-split.md` §E.2.
- **Invocation:** `DG4-T-DG4-BE-D2-backend-workflow-engineer-20261009T082534Z-437958f2` (session `437958f2-df9c-4055-9422-3e56b5f1fa1f`).
- **Base:** branch `dg4/be-d2` at `56c85b687f0238b2353cfaeb48fdc88eb053eb6e`. The changes are **uncommitted**, as the assignment asks.
- **Time:** started `2026-10-09T08:25:53Z`, ended `2026-10-09T09:19:17Z`. This is within the 100-minute mark, so nothing was cut.
- **Product gates:** G1–G6 are business approvals inside the product. Closing a case or changing a rule is never a business approval. The worker's actor is the service, and it decides nothing. Nothing here reads or writes DG0–DG7. All test data is synthetic.

## 1. Changed files

### Created (all inside §E.2 ownership unless noted)

| File | Purpose |
|---|---|
| `apps/api/src/modules/raid/corrective-cases.ts` | `listCorrectiveCases`, `createCorrectiveCase` (Value Review), `getCorrectiveCase`, `updateCorrectiveCase`, `closeCorrectiveCase`, `listCorrectiveCaseSignals`, `listCorrectiveCaseActions`, `createCorrectiveCaseAction` (through BE-D's `createLinkedAction`). Also the follow-up work item, the correctiveCase lock and the ADR-0031 §11 refusals. |
| `apps/api/src/modules/raid/corrective-rules.ts` | `listCorrectiveActionRules` (the four kinds, with `isDefault`), `createCorrectiveActionRule`, `updateCorrectiveActionRule`, and the rule-shape refusals. |
| `apps/api/src/modules/raid/corrective.test.ts` | Unit tests: rule shape, defaults, the Value Review scope key, and the db-error last lines. |
| `packages/shared/src/schemas/corrective.ts` | zod mirrors of `CorrectiveCase*`, `CorrectiveSignal*` and `CorrectiveActionRule*`. Also the shared rule parts: `CORRECTIVE_RULE_DEFAULTS`/`correctiveRuleDefault`, `kpiOffTrack`, `consecutiveOffTrack`, and the consumed payload schemas. |
| `packages/shared/src/schemas/corrective.test.ts` | Unit tests of the defaults, the off-track reading, the consecutive count and the payloads. This new test file sits next to the owned schema file. |
| `apps/worker/test/integration/raid-corrective.test.ts` | Worker integration test: the four consumers driven with synthetic events, through the production worker and a restart. |
| `apps/api/test/integration/raid/corrective-cases.test.ts` | Case API: authorization, validation, If-Match, audit, commit-time, work items, owner_required, signals, case actions. |
| `apps/api/test/integration/raid/corrective-rules.test.ts` | Rule API: defaults, configure rights, refusals, If-Match, audit, commit-time. |
| `apps/api/test/integration/raid/entity-group.test.ts` | REQ-S16-018 entity-group test (ADR-0031 §12). |
| `docs/delivery/handbacks/DG4/T-DG4-BE-D2-evidence/*.log` | The check logs cited in §4. |

### Modified

| File | Change |
|---|---|
| `apps/api/src/modules/raid/routes.ts` | Two registration lines, after BE-D's. |
| `apps/api/src/modules/platform/db-errors.ts` | The corrective lines of the slice E block, after BE-D's (ADR-0031 §11). |
| `apps/worker/src/handlers/raid.ts` | The four consumers and the engine `applySignal`. See §5.1 for why the engine is here. |
| `apps/worker/src/queues/raid.ts` | The four queues, and the event-to-queue map. |
| `packages/shared/src/schemas/index.ts` | One export line, `./corrective.ts`. |
| `apps/api/test/support/p4-pending-be-d2.ts` | Emptied (all 11 operations are routed). |
| `apps/api/test/integration/contract/p4-exercises-be-d.ts` | BE-D2 mirrors appended to `P4_MIRRORS_BE_D`, plus `exerciseP4BeD2Operations`, called at the end of BE-D's function. |
| `apps/api/test/integration/contract/contract.test.ts` | **Outside §E.2 ownership. Disclosed.** Only the media-type pin changed: `[210, 209, 1]` → `[216, 215, 1]`, with one comment line naming my 6 JSON-body operations. No seam was added. Without this change the integration suite fails, and BE-D made the same kind of edit (D-099). |

The untracked environment files at the top level (`.bashrc`, `.zshrc`, `.profile`, `CLAUDE.local.md`, `.idea`, `.vscode`, …) were already present or are created by the environment. They are not part of this change.

## 2. Behaviour delivered, per requirement row

### REQ-PB-085

**Acceptance text:** "A04;A11;A13: a benefit below plan creates one corrective action; repeated evaluation does not duplicate it; a KPI deviation persisting two cycles under a two-cycle rule creates one case and the third cycle updates it".

- **The consumers.** Each runs inside `runOnce(consumer, <event idempotency key>)`. They are `raid.corrective_kpi` (`kpi.deviation_evaluated`) and `raid.corrective_benefit` (`benefit.variance_evaluated`). Each takes `pg_advisory_xact_lock(730236, hashtext('<t>:<kind>:<scope>'))` before it reads the open case. A second line of defence is the `corrective_signal_event_key` check.
- **The rule.**
  - It is the stored rule or the ADR-0031 §5.2 default: KPI red for 2 periods, the other kinds 1 cycle, 5 working days.
  - The consecutive count takes the latest signal per period, newest period first. An amber, Unknown, stale or not_computable period, or a green one, ends the run.
  - An open case is updated: version + 1, `consecutive_off_track`, `signal_count`, and an audit event `corrective_case.signal_applied` with the service actor.
  - Otherwise a case is created once the count reaches the persistence: `created_source = 'worker'`, `created_by` NULL, audit `corrective_case.created`.
  - An on-track or Unknown signal never edits or closes a case.
  - Every event appends one `corrective_signal` row with its outcome.
- **Proof in `raid-corrective.test.ts`:**
  - Red in periods 1 and 2 opens exactly one case (`CA-01`) at the second event. Red in period 3 updates it to version 2, `consecutive_off_track` 3, still one case.
  - The same event redelivered returns `duplicate` and changes nothing.
  - Amber, then unknown, then green leave the case open at version 1. Red, stale, red gives no case.
  - A benefit with `offTrack: true` opens one case. A repeated evaluation updates it (version 2, signal_count 2). `offTrack: null` is recorded and changes nothing.
- **Person actions in `corrective-cases.test.ts`:**
  - BO, TL and FIN create a Value Review case. AUD gets 403. ADM-only users and outsiders get 404.
  - A second open case for the same finding gets 409 `corrective_case.already_open` with the open case's code.
  - `closeCorrectiveCase` without an owner gets 422 `corrective_case.owner_required`.
  - A closed case is final.
  - An owner change moves the follow-up work item.
  - Closing the case closes the item.
- **Configured rule** (`corrective-rules.test.ts`): TL and TO configure. BO, FIN and AUD get 403. Each refusal of §11 is tested.

### REQ-S12-016

**Acceptance text:** "A11;A13: a failed control check creates one owned action with a follow-up date".

The "action" here is the corrective case. This is the ADR-0031 §6 reading, accepted in D-093 (2).

- `raid.corrective_control` and `raid.corrective_adoption` consume the ADR-0031 §5.4 payload, validated strictly by `checkFailedPayload`.
- **Proof in `raid-corrective.test.ts`, through the production worker:**
  - A `control_check.failed` event creates one case with the payload owner.
  - The follow-up date is `2026-10-15`: 5 working days after business date 2026-10-08, a Thursday, on the default Sun–Thu calendar. The calendar id and version are stored with the date.
  - Exactly one `corrective_case_follow_up` work item is created, with dedupe key `corrective.follow_up:<case>:<owner>` and the due date.
  - A redelivery, then a restarted worker receiving the event again, creates no second case, no second item and no second signal.
- **Owner resolution:**
  - With no owner in the payload and no lead, the case has owner NULL (`ownerStatus: "unassigned"` in the API) and no work item.
  - An inactive payload owner falls back to the transformation lead.
- **Calendar:** with no default calendar, the follow-up date is NULL. The API shows `followUpUnknownReason: "calendar_not_configured"`.
- **Disabled rule:** the event is recorded as `rule_disabled` and no case is created.

### REQ-S16-018 (entity-group test only; the row is not complete)

**Acceptance text:** "A09: the ERD and migrations contain every entity listed (Risk, Assumption, Issue, Action, Decision, ChangeRequest, Approval) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced".

- `entity-group.test.ts` creates and reads, through the API, a Risk, an Assumption, an Issue, an Action (a RAID-linked one and a DG2 one), a design Decision and an Approval (`requestApproval` on a synthetic decision).
- For each one it checks owner and status on the read, 403 for AUD on the write, and 404 on both the write and the read for an other-organization user and for the ADM-only technical admin.
- **ChangeRequest is missing.** BE-L adds it in slice H (ADR-0031 §12), so REQ-S16-018 stays incomplete until then.

## 3. Operations routed: delta to `p4-pending-be-d2.ts`

The list went from 11 entries to 0. Routed and exercised in `p4-exercises-be-d.ts` through the validating client:

1. `listCorrectiveCases`
2. `createCorrectiveCase`
3. `getCorrectiveCase`
4. `updateCorrectiveCase`
5. `closeCorrectiveCase`
6. `listCorrectiveCaseSignals`
7. `listCorrectiveCaseActions`
8. `createCorrectiveCaseAction`
9. `listCorrectiveActionRules`
10. `createCorrectiveActionRule`
11. `updateCorrectiveActionRule`

`contract.test.ts` passes 45/45. The media-type pin is now `[216, 215, 1]`.

**Endpoints added**, all under `/api/v1/transformations/{transformationId}`. Every body route has `config.consumes` = `application/json` (S-3).

| Method | Path |
|---|---|
| `GET`, `POST` | `/corrective-actions` |
| `GET`, `PATCH` | `/corrective-actions/{correctiveCaseId}` |
| `POST` | `/corrective-actions/{correctiveCaseId}/close` |
| `GET` | `/corrective-actions/{correctiveCaseId}/signals` |
| `GET`, `POST` | `/corrective-actions/{correctiveCaseId}/actions` |
| `GET`, `POST` | `/corrective-action-rules` |
| `PATCH` | `/corrective-action-rules/{sourceKind}` |

**Migrations:** none. BE-D2 has no migration number (§E.4).

## 4. Checks, with real exit codes

Environment: Node 24.21.0, offline. Harness ports: `QA_PG_PORT=23600`, `MTH_PORT_POOL=23601-23649`, disposable PostgreSQL 16.13. Before the runs, the empty `.claude/.cc-writes` directories under `packages/shared`, `apps/worker` and `apps/api` were removed. A later one under `apps/api` was removed again before the final unit and integration runs.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical.log` |
| 2 | `pnpm -r typecheck` | 0 | | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | | `build.log` |
| 4 | `pnpm lint` | 0 | | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 570 operations` | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | Invocation 1: 108 files, **2102 passed**. Invocation 2: 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | Same counts: 2102; 259 + 2 skipped | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23600 MTH_PORT_POOL=23601-23649 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 96 files, **1128/1128 passed**. PostgreSQL bound port 23600 on attempt 1, with no port retry. | `integration.log` |

All logs are under `docs/delivery/handbacks/DG4/T-DG4-BE-D2-evidence/`.

**Count deltas** against D-099 (unit 2088 + 259/2, integration 1095):

- **Unit:** +14 = 10 in `corrective.test.ts` (shared) + 4 in `raid/corrective.test.ts`.
- **Integration:** +33 = 10 worker + 12 cases + 5 rules + 6 entity group.
- **Pinned counts:** only the media-type pin changed (`[210, 209, 1]` → `[216, 215, 1]`). The operation count stays at 570.

### Non-zero exits during development (disclosed; all fixed before the final runs above)

1. **Validator.** The first `validate.mjs --historical --stage DG3` was started in the background inside a shell call that returned at once. The process was killed with the shell and wrote an empty log. It was re-run in the foreground and exited 0 (row 1). This was not a validator failure.
2. **Worker test, run 1:** 2 of 10 failed. My fixture inserted `app_user.status = 'inactive'`, but the allowed values are `active` and `disabled`. This was a test defect, fixed in the fixture.
3. **Case test, run 1:** 2 of 12 failed.
   - (a) The test seeded signals with v4 ids, while the list ordered by id. I changed the API to order signals by `received_at DESC, id DESC`, with a full-microsecond keyset cursor, and added a pagination check.
   - (b) The test assumed BO lacks `action.update_own`. BO holds it, so it may create an action for itself. The test now asserts the 201 for itself and the 403 for another owner (the ADR-0031 §9 rule).
4. **Contract test, run 1:** the media-type pin failed (`[216, 215, 1]` vs `[210, 209, 1]`). Fixed by the pin edit disclosed in §1.
5. **Unit run 1, both locales:** 2 failed.
   - `architecture.test.ts`: a computed member `CORRECTIVE_RULE_DEFAULTS[kind]` in an API module. It is now read through `correctiveRuleDefault(kind)`.
   - `advisory-locks.test.ts`: the class number written out in two comments, in `corrective-cases.ts` and in my `db-errors.ts` line. The numbers were removed from the comments.

There were no flaky tests and no timeouts.

## 5. Contract, schema and design notes for the orchestrator

1. **Where the engine lives (deviation from §E.2's file list).** §E.2 puts `applySignal` in `apps/api/src/modules/raid/corrective-engine.ts`, called by the worker. ADR-0002 rule 5 (`apps/*` → `packages/*` only) and the kit's rule ("the worker imports no API code") forbid that import. So:
   - `applySignal` lives in `apps/worker/src/handlers/raid.ts`, which I own;
   - `corrective-engine.ts` was **not** created;
   - the rule parts that the API and the worker share are in `packages/shared/src/schemas/corrective.ts`.

   The lock class 730236 is a named constant in the worker, since the worker cannot import the API registry. `advisory-locks.test.ts` only scans `apps/api/src/modules`, so it does not check this constant.
2. **Work-item kind not system-managed.** `corrective_case_follow_up` is not in `tasks/routes.ts` `SYSTEM_MANAGED_KINDS`, which BE-A owns and which is frozen for me. ADR-0031 §5.6 says the item closes with the case, and the case close does close it. But until the kind is added, the assignee can also complete the item by hand. **Request:** add `corrective_case_follow_up` to `SYSTEM_MANAGED_KINDS`.
3. **Follow-up date changes and work items.** A change of follow-up date with the same owner does not move the open work item's due date. The ADR dedupe key `corrective.follow_up:<case>:<owner>` is per owner, and no tasks-module service updates a due date. Likewise, an owner change A → B → A leaves A's earlier item cancelled, and `createWorkItemOnce` returns it as "existing", so A gets no new open item. Both need a tasks-module service ("reschedule" or "reopen"), or a dedupe key that includes the date. That is a decision for BE-A or the architect.
4. **The `corrective_case_one_open_key` text.** The database last line cannot know the open case's code. It answers with the §11 text, with `(unknown)` where `{code}` goes. The API path decides under the same lock first and names the real code. The backstop is reached only by a programming error.
5. **Event fan-out.** `RAID_EVENT_QUEUES` maps `kpi.deviation_evaluated` to `raid.corrective_kpi`. Before this change that event had no queue, and the relay recorded it as a failure. `QUEUE_FOR_EVENT` allows one queue per event type. If KBE-F's below-trajectory consumer (FG.3) also consumes `kpi.deviation_evaluated`, the orchestrator must decide on fan-out. A second map entry would silently override the first.
6. **The benefit payload.** KBE-E has not merged `benefit.variance_evaluated`, so `benefitVarianceEvaluatedPayload` is loose:
   - required: `benefitId`, `periodStart`, `periodEnd`, `offTrack` (nullable);
   - optional: the rest;
   - extra fields are kept.

   When KBE-E registers its schema in `OUTBOX_EVENT_SCHEMAS`, the consumer validates against that schema as well. The check events have no registered schema yet; their producers (slices F and G) must add them, or the relay refuses with "no schema".
7. **422 vs 400 for `status: "closed"`.** For `status: "closed"` in `updateCorrectiveCase`, the API answers 422 `corrective_case.status_transition`, as the OpenAPI summary and ADR-0031 §11 say, rather than a 400 from the enum. BE-D's RAID PATCH answers 400 for the same input. Reviewers may want the two to match.
8. **Audit action names.** Case audit actions are `corrective_case.created`, `.updated`, `.closed` and `.signal_applied`, after the ADR's `created` and `signal_applied`. Rule audit actions are `corrective_action_rule.create` and `.update`.
9. **i18n keys for FE-A.** The new message key is `raid.task.corrective_follow_up` (param `caseCode`). FE-A should also translate the problem codes of ADR-0031 §11 that start with `corrective_case.` and `corrective_rule.`.

## 6. What remains

- **REQ-S16-018:** the ChangeRequest case in `entity-group.test.ts` belongs to BE-L (slice H).
- **Items 2 and 3 of §5:** they need a tasks-module change outside my ownership.
- **Real producers:** end-to-end tests with the real producers for benefit, adoption and control events wait for KBE-E and slices F and G. The consumers are proven with synthetic envelopes, as §E.2 says.
- **Nothing else** in §E.2 is open.

## 7. Merge instructions

- There are no migrations.
- **Merge order:** after BE-D, which is already in `HEAD`.
- **Expected conflicts:**
  - `p4-exercises-be-d.ts` and `routes.ts`: these lines sit after BE-D's.
  - `db-errors.ts`: my lines are appended inside `mapP4RaidError` after BE-D's. BE-E appends budget and schedule lines in the same function, so merge by union.
  - `schemas/index.ts`: a union of export lines.
  - `contract.test.ts`: the media-type pin. Add BE-E's JSON bodies to `[216, 215, 1]`.
- `RAID_QUEUES` adds four pg-boss queues. `ensureQueues` creates them, and `maintenance.test.ts` reads `DOMAIN_QUEUES` dynamically.
- **Closing `date -u`:** see the line below, appended at the end of the run.
- `date -u` at the end: `2026-10-09T09:19:17Z`. `validate.mjs --historical --stage DG3` was run again at the end: exit 0 (`validate-dg3-historical-end.log`).
