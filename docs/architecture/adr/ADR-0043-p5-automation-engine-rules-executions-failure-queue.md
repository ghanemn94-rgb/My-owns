# ADR-0043: Automation engine: versioned rules (trigger, conditions, actions, scope, owner, effective version), the action registry, dry run, enable/disable, execution history, the failure queue and repair, bounded retries with backoff, idempotency keys, service identity and per-action authorization, the human-only boundary, and the jobs operations view

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-03), 2026-10-14.
- **Requirements (slice D of `docs/architecture/p5-plan.md`):** REQ-S12-001, REQ-S12-002, REQ-S12-003, REQ-S12-020, REQ-S12-021, REQ-S12-022, REQ-S12-026. ADR-0044 covers slice E (the sixteen starters as rules, approval routes, conditional approval, notification policy, cut-off packs, dependency slips).
- **Sources (quoted where a design point has one):**
  - M0221 (§12): "Implement server-side event and schedule-driven automation with trigger, conditions, actions, scope, owner, effective version and execution history. Administrators need a readable rule builder, dry-run preview, enable/disable, retry and failure queue. Actions must respect the initiating/system service identity and the applicable permissions."
  - M0240 (§12): "Use durable background jobs, idempotency keys, bounded retries with backoff, transaction-safe event/outbox handling and an operational failure queue. Prevent duplicate reminders, actions and approvals after retries or restarts. Store scheduled runs and execution outcomes in the database. Expose last success, next run, failures and repair actions to authorized administrators."
  - M0242 (§12): "Automatic preparation, routing, calculation and reminders are mandatory. Human business judgment, investment decisions, gate approvals and Finance attestations remain accountable human actions within the platform."
  - M0155 (§6): "Publishing a configuration follows Draft → Preview/Test → Review where configured → Publish." (applied to rule versions, §4).
  - The playbook has no automation-engine block; the engine is a platform extension. The human-only boundary restates the playbook's accountable decision rights (B0099, decision rights; B0101, roles) and the gate model (B0023).
- **Decisions applied:** D-141 (carried rules), D-142 (the plan; **Q3** which starters may be disabled; **Q11** in-app only), D-143 (review required by default, switchable by TO only), D-144; D-088 §2 and F-DG3-100 (claims enumerated and exactly true).
- **Builds on:** ADR-0003 (persistence, optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization; technical admins never approve), ADR-0007 (API conventions, §5b statuses), ADR-0008 (worker, outbox relay, pg-boss, "5 attempts, then `ops.failed`"), ADR-0016 (P2 guards, lock registry), ADR-0025 (scheduled-job kit: `runOnce`, `createWorkItemOnce`, `job_schedule`), ADR-0026 (canonical approval), ADR-0039 (config review policy, `automation_rule_set` kind).
- **Physical model:** `0074_p5_automation_engine.sql` (this ADR), `0075_p5_starters_routes_policies.sql` (ADR-0044; the starter rows), `0076_p5_automation_permissions.sql`. Probe ids (G, S, AR, AV, DR, EX, AX, JR, OF, AO) refer to `docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/probe-output.txt`.
- **Two gate systems.** Product gates G1–G6 are business approvals inside the product. Nothing in this ADR reads or writes the engineering records DG0–DG7. No rule, job, seed or agent grants a business, Finance or IT approval (§6).

## Context

As built on `HEAD` `a818587` (DG4 APPROVED; slices A–C of P5 merged):

1. The worker (`apps/worker/src`) consumes outbox events through the relay (`relay.ts`; one pg-boss job per consuming queue, D-102) and runs one handler per queue (`handlers/**`). Every DG4 handler is idempotent through `runOnce(db, consumer, key, fn)` (the `processed_message` ledger) and `createWorkItemOnce` (UNIQUE `(organization_id, dedupe_key)` on `work_item` and `inbox_notification`).
2. Retries are pg-boss's: `RETRY_POLICY` = 5 retries, 10 s delay, exponential backoff, dead letter `ops.failed` (`queues/platform.ts`, ADR-0008 §4). Nothing records a failure in a table an administrator can read, and nothing re-sends a dead-lettered job.
3. `job_schedule` (created by `0028`) holds 9 recurring jobs after `0061` (cron + timezone; 3 seeded by `0028`, 6 by later P4 migrations); `GET/PATCH /admin/job-schedules` (DG4, `job.read`/`job.configure`, ADM_TECH) list and change them. No run history is stored; last success and next run are not exposed.
4. The sixteen M0224–M0239 starters are code-defined handlers (p4-plan §6 R5). There is no rule entity, no execution history, no dry run and no failure queue.
5. Slice A declared the configuration kind `automation_rule_set` and its review-policy row (`config_review_policy`, review required, reviewer TO; `0062`); no element type was given to it.
6. `outboxEnvelope` carries `outboxEventId`, `eventType`, `schemaVersion`, `idempotencyKey`, `organizationId` and a payload; the initiating user is a payload member only for some events (e.g. `transformation.created.createdBy`).

## Decision

### 1. Rule and rule version (REQ-S12-001)

A **rule** (`automation_rule`) is an identity; its content lives in **versions** (`automation_rule_version`). Rules are not Studio elements: a rule has its own versions, its own enable/disable switch and its own execution history, which a configuration version of the whole methodology cannot hold per rule. The `automation_rule_set` kind (ADR-0039 §1) therefore stays **declared and unused** in P5; its `config_review_policy` row **is** used, as the review policy of rule versions (§4).

| M0221 term | Where it lives |
|---|---|
| trigger | `automation_rule_version.trigger_codes` (1–6 codes of `automation_trigger`; §2) |
| conditions | `automation_rule_version.conditions` (JSON array, 0–20 items, Zod-validated; §2) |
| actions | `automation_rule_version.actions` (JSON array, 1–10 items, Zod-validated) and `action_types` (the same codes as a `text[]`, so the database can refuse human-only types; CHECK `automation_rule_version_actions_match`, AV07) |
| scope | `automation_rule.scope_level` (`platform` for starters only; `organization`; `transformation`) with `organization_id`/`transformation_id` (CHECK `automation_rule_scope_complete`, `automation_rule_origin_shape`; AR06, AR09) |
| owner | `automation_rule.owner_user_id` (admin rules) or `owner_role_code` (starters; never AUD: `automation_rule_owner_not_auditor`, AR10); exactly one (CHECK `automation_rule_one_owner`) |
| effective version | `automation_rule.effective_version_id`: the rule's one `published` version, checked at COMMIT (constraint trigger `automation_rule_effective_check`, AV20; exclusion `automation_rule_version_one_published`, deferred, AV18) |
| execution history | `automation_execution` and `automation_action_result` (§5) |

**Rule fields:** `id`, `code` (UNIQUE, `^[a-z][a-z0-9_.]{2,63}$`, never changes), `origin` (`starter` | `admin`), `source_ref` (`M0224`…`M0239` for starters), `name_en/ar`, `description_en/ar`, scope, owner, `enabled`, `disable_allowed`, `disabled_reason`, `effective_version_id`, P2 stamps and `version`. Invariants (trigger `automation_rule_guard`): code, origin, source, scope level and `disable_allowed` never change (AR07); a starter is inserted only by a migration (AR04); a rule is enabled only with an effective version (CHECK `automation_rule_enabled_needs_version`, AR08); a rule with `disable_allowed = false` is always enabled (CHECK `automation_rule_guarantee_kept`, AR05; D-142 Q3).

**Version fields:** `automation_rule_id`, `version_no` (the next number of the rule, `automation_rule_version_next_number`, AV06), `status`, `trigger_codes`, `conditions`, `actions`, `action_types`, `run_as` (`initiating_user` | `service`), `service_permission_codes` (0–20), `parameters` (JSON object; starter settings, ADR-0044 §1), `content_sha256`, `change_summary`, `authored_by`, `submitted_at`, `reviewed_by`, `reviewed_at`, `review_note`, `published_by`, `published_at`, `superseded_at`, `discarded_at`, P2 stamps and `version`.

**Content hash.** The API computes `content_sha256` as SHA-256 (hex) of the UTF-8 canonical JSON (keys sorted by code point, no insignificant whitespace; ADR-0039 §1 rules) of `{triggerCodes, conditions, actions, runAs, servicePermissionCodes, parameters}`, and recomputes it on every content write. The seeded starter versions carry an opaque hash set by `0075` that is never recomputed (the ADR-0039 §1 precedent).

### 2. Triggers, conditions and the action registry (REQ-S12-001, REQ-S12-003)

**Triggers** (`automation_trigger`, read-only catalogue; 31 rows after `0075`): `event` (an outbox event type), `schedule` (a `job_schedule` code) and `request` (evaluated inside the owning module's request; starters only, CHECK `automation_trigger_request_starter_only`). Each row lists `condition_fields` (the payload members a condition may test) and `initiating_user_field` (the payload member naming the user who caused the event; NULL when there is none, and always NULL for schedules, CHECK `automation_trigger_schedule_no_user`). `admin_selectable` marks the triggers the builder offers; admin rules use only those (`automation_rule_version_admin_catalogue`). Admin schedule rules use the two engine ticks `automation.tick_hourly` (minute 7 of every hour) and `automation.tick_daily` (00:20), both Asia/Riyadh, seeded as `job_schedule` rows by `0074` (S04).

**Conditions** (Zod in `packages/shared/src/schemas/automation.ts`, BE-H): an array of `{ field, op, value? }`, all of which must hold (AND). `field` ∈ the trigger's `condition_fields`; `op` ∈ `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`, `present`, `absent`; `value` is a string, a decimal string, a boolean or an array of strings (≤ 50). Numeric comparisons use decimal.js on decimal strings, never floats; a numeric comparison whose payload value is missing or not a decimal string evaluates to **not met** and records the finding `automation.condition_unknown_value` in the execution (never "0"). A rule with several triggers tests only fields common to all of them (refused otherwise, `automation_rule.condition_invalid`).

**Action registry.** `automation_action_type` (read-only catalogue; 11 rows) lists every action code with `action_class` (`automatic` | `human_only`), `owner_module`, `required_permission_code` and `admin_selectable`. The **port** `AutomationActionRegistry` (in `apps/api/src/modules/automation/registry.ts`, wired in `server.ts`; the P4 `GateFactsProvider` pattern, so `automation` imports no domain module) maps each automatic code to a descriptor `{ parametersSchema (Zod), requiredPermission, plan(tx, ctx) → PlannedAction }` used by validation and dry run; the worker executes the same codes through `apps/worker/src/automation/actions/**` (ADR-0002 rule 5: the worker imports no API code; each executor has a parity test with its API planner, the `createWorkItemOnce` precedent). The P5 automatic actions are:

| Code | Effect | Permission checked | Exactly-once key |
|---|---|---|---|
| `create_task` | `createWorkItemOnce` (kind `automation_task`) with its in-app notification | the target role holds `transformation.read` in the target transformation | `automation:<rule code>:<trigger key>:<ordinal>:<assignee>` |
| `notify` | one `inbox_notification` (no work item) | as above | same pattern |
| `escalate` | `createWorkItemOnce` for the holders of a business role (kind `automation_task`, urgency of the kind) | as above | same pattern |
| `launch_procedure` | launch of a published procedure with `launch_key` (ADR-0042 §7) | `procedure.launch` (§3) | `launch_key` = the action key |
| `starter_handler` | calls the starter's DG4/P5 handler function unchanged (ADR-0044 §1); starters only | the handler's own DG4 rules | the handler's own DG4 key |

**Human-only boundary (REQ-S12-026, M0242).** Six codes are catalogued as `human_only` and are never `admin_selectable` (CHECK `automation_action_type_human_never_selectable`): `approve_gate`, `decide_approval`, `decide_investment`, `attest_finance_value`, `decide_executive_ask`, `approve_methodology_migration` (S03). The API refuses a rule version naming one with 422 `automation_rule.human_only_action` (§9) before any write; the database refuses it again on the version (trigger `automation_rule_version_human_only`, AV01) and on any action result (`automation_action_result_human_only`, AX05). A service identity never holds a `business_approval` or `finance_validation` permission (`automation_rule_version_service_permission`, AV04). The automatic preparation, routing, calculation and reminder starters all run (ADR-0044 §1; D-142 Q3).

### 3. Identity and per-action authorization (REQ-S12-003)

Each execution runs as exactly one identity, recorded on the execution (`run_as`, `initiating_user_id`; CHECK `automation_execution_identity`):

- **`initiating_user`**: the user named by the trigger's `initiating_user_field` in the event payload. Allowed only when every trigger of the version names one (`automation_rule_version_initiating_user`, AV03). The executor reloads that user's grants inside the action's transaction (the commit-time re-authorization rule) and checks the action's permission in the **target's** scope (organization, business unit, transformation; ADR-0006).
- **`service`**: a constrained service identity. It holds exactly the version's `service_permission_codes` (none may be an approval right, AV04), and only inside the rule's scope (`organization_id`, plus `transformation_id` for transformation-scoped rules). The audit actor is `service`, source `worker`, `onBehalfOfUserId` = null (`jobActor`, ADR-0025).

A target outside the rule's scope, or a missing permission, is **not retried**: the action result is `forbidden` with `error_code = automation.action_forbidden`, the execution becomes `failed` with that code, and a `rule_execution` row enters the failure queue at once (§5). This is REQ-S12-003's literal case: "a rule configured to create records in a transformation outside its scope fails with an authorization error in the failure queue". Starters run as `service` and keep their DG4 authorization behaviour (they call the DG4 handler unchanged).

### 4. Lifecycle: draft, dry run, review where configured, publish, enable/disable (REQ-S12-002)

**State machine** (trigger `automation_rule_version_guard`; AV08–AV19):

```text
draft     -> in_review | published (only when the policy requires no review) | discarded
in_review -> approved | draft (changes requested) | discarded
approved  -> published | draft | discarded
published -> superseded (only when a newer version of the rule is published)
```

- A new version starts as `draft` (AV08) by copying the effective version (or empty for a new rule). At most one open (`draft`/`in_review`/`approved`) version per rule (unique index `automation_rule_version_one_open_key`). Content changes only in `draft` (`automation_rule_version_content_frozen`; AV14, AV16): published versions are immutable.
- **Dry run (preview/test).** `POST …/dry-runs` evaluates the draft against a sample event (validated against the trigger's payload schema) inside a **read-only transaction that is rolled back**: conditions are evaluated, each action's `plan()` returns what it would do (target, assignee, key) and each permission check is run. It writes only its own `automation_dry_run` row (append-only; DR04, AO): never a work item, notification, business record or execution — REQ-S12-002's "a dry-run creates no tasks". A run tests exactly the current `content_sha256` of a draft (`automation_dry_run_current_draft`, DR01); a failing run lists its findings (`automation_dry_run_fail_has_finding`, DR02). Leaving `draft` (to `in_review` or `published`) needs a `pass` run for the current hash (`automation_rule_version_dry_run_required`; AV10, DR03).
- **Review where configured (M0155).** The `config_review_policy` row `automation_rule_set` (review required, reviewer TO, switchable by TO only; D-143 (5)) decides. When it requires review, publishing straight from `draft` is refused (`automation_rule_version_review_required`, AV11), and a holder of `automation.review` (TO by default) other than the author approves (`automation_rule_version_review_sod`, AV13). A rule review is a configuration review, not a business approval. Submitting creates one `automation_rule_review` work item per reviewer (dedupe `automation_rule_review:<versionId>:<userId>`).
- **Publish** (lock 730258 is not needed; the publish takes the rule row `FOR UPDATE` with `If-Match` on the rule): in one transaction, in this order: (1) the new version → `published` (`published_by`, `published_at`); (2) the rule's `effective_version_id` → the new version; (3) the previous published version → `superseded`. The exclusion "one published version per rule" and the effective-version check are both deferred to COMMIT (AV17, AV18, AV20). A version is effective from its `published_at`; there is no future-dated effective date in P5.
- **Enable / disable.** `enable` needs an effective version (AR08). `disable` needs a reason (3–1000 characters) and is refused for a rule with `disable_allowed = false` (the sixteen starters; 422 `automation_rule.guarantee_protected`, AR05). An admin rule starts disabled.

### 5. Execution, retries, failure queue and repair (REQ-S12-001, REQ-S12-002, REQ-S12-020, REQ-S12-021)

**Event path (transaction-safe outbox, unchanged).** A domain change writes its outbox event in its own transaction (ADR-0008); the relay sends one pg-boss job per consuming queue. P5 adds the queue `automation.evaluate`, mapped from every `event` trigger with `admin_selectable = true` (BE-H2's `apps/worker/src/queues/automation.ts`); the starters keep their DG4 queues (ADR-0044 §1).

**One execution** (`apps/worker/src/handlers/automation.ts`, BE-H2): for each enabled rule whose effective version names the event's trigger and whose scope contains the event's organization (and transformation): take lock **730258** on `"<ruleVersionId>:<triggerKey>"` (`trigger_key` = the envelope's `idempotencyKey`, or `<schedule code>:<ISO minute of the slot>` for ticks); insert the execution (`running`, attempt 1; UNIQUE `automation_execution_once_key` makes a second insert for the same key impossible, EX04); evaluate the conditions (not met → `skipped` with `conditions_met = false`, CHECK `automation_execution_skipped_complete`, EX10); run each action in its own transaction, recording one `automation_action_result` per action and attempt; finish `succeeded` or `failed`. A rule-execution row exists only for a `published` (or, while in flight, `superseded`) version that names the trigger (`automation_execution_published_version`; EX01, EX02).

**Exactly once (REQ-S12-021).** Three layers, each proved: (1) the execution's UNIQUE `(rule version, trigger key)` (EX04); (2) per action, the idempotency key `<rule code>:<trigger key>:<ordinal>`, of which at most one `done` result can exist (partial unique index `automation_action_result_effect_once_key`, AX02); (3) the effect's own key (`work_item`/`inbox_notification` `(organization_id, dedupe_key)`, `procedure_instance.launch_key`, the DG4 handlers' `runOnce` ledgers). A replay of the same event ×3, a pg-boss retry or a worker restart therefore yields one reminder, one action and one approval task; the effect already present is recorded `existing`.

**Bounded retries with backoff (REQ-S12-020).** Transient errors (a thrown error other than an authorization or validation finding) are retried by pg-boss under the unchanged `RETRY_POLICY`: 5 retries, 10 s initial delay, exponential backoff (ADR-0008 §4). The worker passes the attempt (`JobAttempt`, DG4 T-DG4-BE-R2); on the **last** attempt (`retryCount >= retryLimit`) the handler records the failure (below) before rethrowing, so the job still reaches `ops.failed` as in DG4. A worker killed mid-job leaves no partial effect (each action commits atomically with its result row) and pg-boss re-delivers the job after its expiry; the execution resumes and completes once.

**Failure queue** (`operational_failure`): one row per failed unit of work that an administrator must see. `source = 'rule_execution'` names the execution and its organization; `source = 'job'` names the queue, the pg-boss job id, the original `job_data` and its `idempotency_key` (the envelope key, or `<schedule code>:<slot>`), and the `job_schedule_code` when the job is scheduled (CHECK `operational_failure_source_shape`, OF08). At most one `open`/`retrying` row per `(source, queue, idempotency key)` (unique index `operational_failure_one_open_key`, OF02); a later failure of the same key updates `attempts` and `last_failed_at`. The capture lines in `apps/worker/src/kit.ts`/`worker.ts` (BE-I) write job failures for **every** domain queue on the last attempt; this is how M0239 "Connector/job fails → visible operational exception" is met (ADR-0044 §1, starter 16).

```text
open     -> retrying (retry: retry_count + 1, at most 20) | dismissed (reason required)
retrying -> resolved (the retry succeeded) | open (it failed again)
```

(trigger `operational_failure_guard`; OF03–OF07). **Retry** (`POST /admin/automation-failures/{id}/retry`, lock **730259**): for a rule execution, the execution moves `failed → running` with `attempt_no + 1` (EX07, EX08) and re-runs every action whose key has no `done` result; for a job, the original `job_data` is sent again to the original queue (`boss.send`, outside the transaction, after COMMIT of the `retrying` state; ADR rule "no remote I/O inside a transaction"), and the handler's `runOnce` ledger skips completed work. Retry never creates a duplicate (REQ-S12-002 "succeeds on retry without duplicating actions"). The retry outcome is written by the worker (`resolved` or back to `open`). **Dismiss** records who, when and why (OF07).

### 6. Jobs operations view (REQ-S12-022)

`job_run` stores one row per finished pg-boss job of a **scheduled** queue and attempt (`job_id`, `attempt_no` UNIQUE, JR03; `outcome` `succeeded`/`failed` with `error_code`, JR04), written by the worker; append-only operational history without an audit event (like `processed_message`; JR01, JR02). `GET /admin/jobs` lists every `job_schedule` row with:

- **last success** = the newest `finished_at` of a `succeeded` run, else `null` shown as "Never run" (never as a time or as "OK");
- **next run** = the next instant matching the five-field cron in the schedule's time zone after now, computed by a pure function `packages/shared/src/time/cron-next.ts` (BE-I2; no dependency: `*`, lists, ranges and steps, searched minute by minute up to 366 days ahead); a disabled schedule shows `null` "Disabled", and a cron with no match in 366 days shows `null` "Unknown";
- **last run outcome**, **open failures** (count of `open`/`retrying` `operational_failure` rows of the schedule) and **repair actions**: retry or dismiss a failure (`job.repair`), and **run now** (`POST /admin/jobs/{jobCode}/run`, `job.repair`, refused for a disabled schedule) which sends one job with the singleton key `run-now:<code>:<ISO minute>`.

Authorization: `job.read` (ADM_TECH, DG4) for the view, so a non-admin, AUD included, gets 403 (REQ-S12-022 "a non-admin gets 403"). DG4's `GET/PATCH /admin/job-schedules` are unchanged.

### 7. Locks, events and jobs

Lock classes (ADR-0016 §6 registry, `platform/advisory-locks.ts`): **730258** `automationRuleExecution` (key `<ruleVersionId>:<triggerKey>`), **730259** `failureRepair` (key `<operationalFailureId>`), 730260 and 730261 (ADR-0044 §6); **730262 stays reserved**. New queues: `automation.evaluate`, `automation.tick_hourly`, `automation.tick_daily`. New outbox events (schema_version 1): `automation_rule.published` `{ruleId, versionId}` (cache invalidation only), `job.failed` `{queueName, jobScheduleCode|null, failureId}` (internal; the starter-16 trigger).

### 8. Authorization (permissions matrix §20)

| Operation group | Permission | Role defaults (`0076`) |
|---|---|---|
| Read rules, versions, dry runs, executions, failures, catalogue | `automation.read` | ADM_METHOD, ADM_TECH, TO, AUD |
| Create/update rules and versions, dry run, submit, publish, discard, enable, disable | `automation.configure` | ADM_METHOD |
| Decide a rule-version review | `automation.review` | TO |
| Retry/dismiss a `rule_execution` failure | `automation.repair` | ADM_TECH, ADM_METHOD |
| Jobs view | `job.read` (DG4) | ADM_TECH |
| Retry/dismiss a `job` failure; run now | `job.repair` | ADM_TECH |

AUD is read-only (403 on every write); no code above is a `business_approval` or `finance_validation` code (seed test, S05). Scope: rules are listed to a reader only inside the organizations where the reader holds `automation.read`; a platform starter is visible to any holder. Every mutation re-checks the permission inside its transaction, validates, requires `If-Match` (428 missing, 409 stale; creates send `If-Match: "0"`), writes one audit event per row (`automation_rule.*`, `automation_rule_version.*`, `automation_dry_run.create`, `operational_failure.*`) and does no remote I/O inside the transaction.

### 9. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 422 | `automation_rule.human_only_action` | Approvals, investment decisions and Finance attestations are human decisions and cannot be automated. |
| 422 | `automation_rule.trigger_unknown` | The trigger is not one an automation rule can use. |
| 422 | `automation_rule.action_unknown` | The action is not one an automation rule can use. |
| 422 | `automation_rule.condition_invalid` | A condition must test a field of the trigger with a valid operator and value. |
| 422 | `automation_rule.action_parameters_invalid` | The action's settings are not valid for its type. |
| 422 | `automation_rule.initiating_user_unavailable` | This trigger has no initiating user; run the rule as the service identity. |
| 422 | `automation_rule.service_permission_forbidden` | A rule's service identity cannot hold an approval or Finance validation right. |
| 422 | `automation_rule.scope_invalid` | A rule applies to one organization or one transformation in your scope. |
| 422 | `automation_rule.guarantee_protected` | This starter automation implements a guarantee approved in an earlier stage and cannot be disabled. You can change its settings in a new version. |
| 422 | `automation_rule.starter_fixed` | A starter automation keeps its trigger and handler and takes no conditions; only its settings can change. |
| 422 | `automation_rule.no_effective_version` | Publish a version before enabling the rule. |
| 409 | `automation_rule.code_taken` | A rule with this code already exists. |
| 409 | `automation_rule_version.draft_exists` | This rule already has an open version. |
| 409 | `automation_rule_version.not_editable` | Only a draft version can be changed; published versions never change. |
| 422 | `automation_rule_version.invalid_transition` | This version cannot move to that state. |
| 422 | `automation_rule_version.dry_run_required` | Run a dry run of the current content before submitting or publishing. |
| 422 | `automation_rule_version.review_required` | This version needs its configured review before it is published. |
| 403 | `automation_rule_version.self_review` | You cannot review a version you authored. |
| 422 | `automation.dry_run_sample_invalid` | The sample event does not match the trigger's event fields. |
| 422 | `automation_failure.not_open` | Only an open failure can be retried or dismissed. |
| 422 | `automation_failure.retry_limit` | This failure has been retried 20 times; dismiss it or fix its cause first. |
| 422 | `job.schedule_disabled` | Enable the schedule before running it now. |

Execution error codes (stored in `automation_execution.error_code` / `operational_failure.error_code`, shown translated in the queue): `automation.action_forbidden` "The acting identity lacks the permission for this action, or its target is outside the rule's scope."; `automation.action_failed` "The action failed; see the error message."; `automation.retries_exhausted` "The retries ran out; the work is in the failure queue."; `automation.condition_unknown_value` "A condition could not be evaluated because the event has no usable value." Generic codes (401, 403 `forbidden`, 404, 409 `version_conflict`, 428 `precondition_required`, 400 validation) are ADR-0007's.

### 10. Decimal and Unknown semantics

The engine stores no money, rate or FTE. Condition values that are numbers are decimal strings compared with decimal.js; a missing or non-decimal value makes the condition not met and records `automation.condition_unknown_value` (never treated as 0). In the jobs view, a never-run job shows "Never run", a disabled job's next run "Disabled", and an uncomputable next run "Unknown"; none is shown as a time, as 0 or as green. Counts are integers.

## Alternatives considered

1. **Rules as Studio elements of the `automation_rule_set` kind.** Rejected for P5: per-rule enable/disable, per-rule effective versions and per-version execution history do not fit a single version of the whole set, and pinning rules per transformation would let a DG4 transformation miss a guarantee starter. The kind's review policy is reused instead (§4).
2. **A separate queue service or workflow engine.** Rejected: M0310 and ADR-0008 keep pg-boss on the product PostgreSQL; no new dependency (D-142 Q8 applies to exports only).
3. **Free-form condition expressions through the formula engine.** Rejected: the formula engine computes values (ADR-0024); a typed `{field, op, value}` list is readable in the builder (REQ-S12-002 "readable") and needs no grammar change (rule 9).
4. **Retrying authorization failures.** Rejected: an out-of-scope action does not become authorized by waiting; it enters the failure queue at once (§3).
5. **Run history inside pg-boss's own tables.** Rejected: pg-boss archives and deletes jobs on its own retention; REQ-S12-022 needs runs "in the database" under the product's own schema and grants.

## Consequences

- The sixteen DG4 behaviours gain rule rows, versions and execution history without a changed idempotency key or lock class (ADR-0044 §1; p5-plan R3).
- `job_run` grows by one row per finished scheduled job attempt. With the 14 schedules that exist after `0075` (three every 15 minutes, one hourly, the rest daily or weekly) that is about 320 rows a day without failures. P5 does not purge it; a retention rule is a later decision.
- Admin rules can only use catalogued triggers and actions; a new action type is a migration plus a registry entry (owned by the module that implements it).
- The failure queue makes `ops.failed` dead letters visible and repairable; `ops.failed` itself is unchanged.

## Verification

- **Database (probe, 133/133 PASS on PostgreSQL 16.13):** G00–G05 (migrations, fresh and over P4 data), S01–S06 (seeds), AR01–AR10, AV01–AV24, DR01–DR04, EX01–EX10, AX01–AX06, JR01–JR04, OF01–OF09, AO (no UPDATE/DELETE grant on append-only tables) in `docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/probe-output.txt`.
- **Catalogue and seed pins:** `packages/db/test/integration/catalogue.test.ts` (tables, triggers, grants, mutable `version` tables), `packages/db/src/seed.test.ts` (`0076` equals `P5_AUTOMATION_PERMISSIONS`/`_ROLE_PERMISSIONS`; no approval code; AUD automation.read only), `apps/api/src/modules/platform/advisory-locks.test.ts` (distinct classes).
- **Implementer tests (literal, p5-work-split §D):** saving a rule with action `approve_gate` → 422 `automation_rule.human_only_action` (REQ-S12-026); a dry run creates no work item, notification or execution (REQ-S12-002); an out-of-scope `create_task` fails with `automation.action_forbidden` and appears in the failure queue (REQ-S12-003); a failed execution succeeds on retry without a second effect (REQ-S12-002); a worker killed mid-job and restarted completes once, and after the retry limit the job is in the failure queue (REQ-S12-020); replaying one event ×3 yields one reminder, one action and one approval task (REQ-S12-021); the jobs view shows last success and next run per schedule, and a non-admin gets 403 (REQ-S12-022); each execution shows its rule version, trigger event and outcome (REQ-S12-001); AUD 403 on every write; `If-Match` 428/409; one audit event per mutation.

## Amendment (2026-10-14, T-DG5-ARCH-05; D-146): the action parameter schemas, three codes and idempotent enable/disable (as built by BE-H)

D-146 confirms these points from BE-H's handback (`docs/delivery/handbacks/DG5/T-DG5-BE-H-backend-workflow-engineer.md` §5). They are part of §2, §4 and §9 from now on.

1. **Action parameter schemas** (§2; `packages/shared/src/schemas/automation.ts`; the builder catalogue publishes each one as JSON Schema in `parametersSchema`):
   - `create_task`: `{assigneeRole, messageKey, dueInWorkingDays?, targetTransformationId?}`, where `dueInWorkingDays` is an integer from 1 to 60;
   - `notify`: `{recipientRole, messageKey, targetTransformationId?}`;
   - `escalate`: `{toRole, messageKey, targetTransformationId?}`.
   In all three, `messageKey` is one of the four keys `automation.message.follow_up`, `automation.message.review_needed`, `automation.message.update_due` and `automation.message.attention_required` (parameters `ruleName` and `triggerLabel`). The worker executors (BE-H2, BE-I) and the rule builder (FE-D) use exactly these shapes.
2. **Three codes added to the §9 table** (status, code and English text exactly as BE-H returns them):
   - 422 `validation.user_invalid`, "A named person must be an active user of the rule's organization.": a non-active or foreign `ownerUserId`. This reuses the DG3 register-kit code.
   - 422 `automation_rule.starter_fixed`, the §9 text of that code: a `PATCH` of a starter rule that names anything other than its names (for example its description or owner).
   - 400 `validation.service_permissions_need_service`: a version with `runAs: initiating_user` that lists service permissions. This is a request-validation error that mirrors the CHECK `automation_rule_version_service_permissions`.
3. **Enable and disable are idempotent** (§4). Enabling a rule that is already enabled, or disabling one that is already disabled, returns 200 and writes nothing: no version step and no audit event.
4. **Not changed:** `launch_procedure` stays catalogued but reports `adminSelectable: false` until BE-J registers its descriptor; a rule that uses it before then gets 422 `automation_rule.action_unknown`. A version-level `parameters` value other than `{}` on an admin rule gets 422 `automation_rule.action_parameters_invalid`.

## Amendment (2026-10-17, T-DG5-ARCH-R1; D-163, D-164 (d), D-166): §4, the dry-run sample and `AutomationTrigger.samplePayload`

Sources: D-163 (QA-A O-1), D-164 (d) (the contract addition approved), D-166 (W20 integrated), the T-DG5-BE-C3 handback §3, the T-DG5-BE-C4 handback §2.2 and the T-DG5-FE-D3 handback. Nothing above is removed. This amendment states what §4's "a sample event (validated against the trigger's payload schema)" means as built.

### S1. The dry-run sample is the trigger's complete payload of schema version 1 (T-DG5-BE-C3)

- **Event trigger with an outbox payload schema** (`outboxPayloadSchema(code, 1)` is not null; for example `gate.submitted`, `gate.decided`). The sample's `payload` is the **complete** event payload of schema version 1, exactly as the outbox carries it: every member the schema requires and no other member. It is not only the trigger's `conditionFields`. For example, `gate.submitted` v1 has 10 members.
- **Schedule trigger, or an event without a payload schema.** The payload holds only the trigger's `conditionFields`, its initiating-user field and `transformationId`, each a string, number, boolean or null.
- **Limits and refusal.** At most 16384 bytes of JSON. Any other sample is refused with 422 `automation.dry_run_sample_invalid` (§9 text unchanged), and no `automation_dry_run` row is written.
- **Code and contract.** The server already behaved this way (`apps/api/src/modules/automation/dry-run.ts` `validateSample`). BE-C3 corrected the contract text: `AutomationDryRunRequest.description`, plus an `examples:` entry with a complete synthetic `gate.submitted` v1 payload. The schema is unchanged.
- **Test.** `apps/api/test/integration/automation/dry-run-sample-shape.test.ts`. A condition-fields-only sample of `gate.submitted` gets 422 and writes no row. The documented example, with its `transformationId` pointed at a transformation of the rule's organization, gets 201 with `conditionsMet: true` and writes exactly one row.

### S2. `AutomationTrigger.samplePayload` (D-164 (d); T-DG5-BE-C4 serves it, T-DG5-FE-D3 pre-fills from it)

- **Contract** (`docs/api/openapi.yaml`, the `AutomationTrigger` schema; zod mirror `packages/shared/src/schemas/automation.ts`, `samplePayload: z.record(z.string(), z.unknown()).optional()`).
  - An optional object, present only for an event trigger whose outbox event has a payload schema, and absent for every other trigger.
  - It is an example payload of schema version 1, valid against that schema (the complete payload of S1), and every id in it is synthetic.
  - No operation, request or response media type changes.
- **Served by** `GET /api/v1/admin/automation-catalogue` (`apps/api/src/modules/automation/catalogue.ts` `samplePayloadField`, through `samples.ts` `samplePayloadOf`).
  - There is one sample per event trigger with a schema: the 16 events of `0074`/`0075`.
  - Schedules and requests have none. At `f78afff`, `dependency.slipped` has none either: its schema `dependencySlippedV1` is deliberately not registered in `OUTBOX_EVENT_SCHEMAS` (`packages/shared/src/schemas/events.ts:42–49`), and `samplePayloadOf("dependency.slipped", "event")` is undefined (`apps/api/src/modules/automation/samples.test.ts:49`).
  - _Amended 2026-10-17 (T-DG5-ARCH-R2; D-167; QA-F2 D-QA-F2-1):_ `dependency.slipped` v1 is registered in `OUTBOX_EVENT_SCHEMAS`, and the catalogue serves its `samplePayload` (the complete v1 payload under S1: `slipId`, `dependencyId`, `transformationId` and `slipDays`, as `dependencySlippedV1` defines it at `events.ts:49–54`, with synthetic ids), so "every event trigger with a schema has one" stays true. The dry-run tests that sampled it by its condition fields only move to the complete v1 payload. This is **decided by D-167, implemented by T-DG5-BE-T5 (W22)**. It lands during this amendment's run and is not described here as built (ADR-0044 amendment B4).
  - Each sample is parsed with its schema before it is served, and a sample that fails to parse is omitted. Every response gets a fresh copy.
- **The placeholder `transformationId`.** When the event has a `transformationId`, the sample holds the fixed placeholder `00000000-0000-7000-8000-000000000000` (`samples.ts` `SAMPLE_TRANSFORMATION_ID`).
  - The builder (`apps/web/src/pages/automation/RulePage.tsx:456` `dryRunTemplate`) copies the sample as served. For a transformation-scope rule it replaces the top-level `transformationId` with the rule's transformation.
  - An organization-scope rule keeps the placeholder in the editable sample.
  - Without `samplePayload`, the builder keeps the earlier template: `transformationId` plus every condition field set to `""`.
- **Example data only.** A sample is not a record, a decision or an approval. The dry run stays rolled back and writes only its own row (§4).
- **Tests.** `apps/api/test/integration/automation/catalogue-sample-payload.test.ts` (every served sample parses with its schema, and the `gate.submitted` sample gives a 201 dry run) and `apps/api/src/modules/automation/samples.test.ts`. On the web side: `apps/web/src/pages/automation/fed.test.tsx` › "D-164 d".

Requirement row: REQ-S12-002 ("dry-run preview"; A06, A13: "a dry-run creates no tasks"). Nothing here touches product gates G1–G6 or the engineering gates DG0–DG7.
