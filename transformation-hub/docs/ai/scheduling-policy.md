# AI runtime — scheduling, execution and operations policy (spec §12.4, ADR-0004)

## Jobs

| Job kind | Trigger | Identity | Idempotency |
|---|---|---|---|
| `ai.briefing` | `scheduled_job` (cron + IANA timezone, default `30 7 * * *` Asia/Riyadh; weekly default `0 8 * * 0`) owned by the subscriber | `JobContextFactory.forUser(owner, project)` before AND after the provider call; `null` → run recorded `skipped` (`owner_access_revoked`), nothing sent | one run per `schedule:<id>:<slot>` (re-delivery returns `already_ran`); notification dedupe key `ai-briefing:<schedule>:<slot>` |
| `ai.run` | `POST …/ai/ask` with `async: true` | `forUser(requester)` before and after the provider call | job key `ai-run:<runId>` |
| `ai.execute_proposal` | human approval (or autopilot) | phase 1 service principal (checks) → phase 2 the approver (or, under autopilot, the delegating user), which locks the proposal (autopilot: first the project's advisory lock `hub_ai_autopilot:<projectId>`) and re-checks status, version, approval, emergency stop, mode, autopilot policy and daily limit before the effect (SEC-P5-02, SEC-P5-06) | job key `ai-exec:<proposal>:<approval>`; effect + approval consumed + proposal executed in ONE transaction, the final update only while the proposal is still pending at the checked version; notification dedupe key `ai-proposal:<id>` |
| `ai.invalidate_derived` | outbox `permission.changed`, `document.changed`, `evidence.changed` | service principal `svc-ai-pm` (no domain permissions) | per outbox event |

Briefings are delivered **to the subscriber only** (policy choice for AIQ-02: per-recipient generation under each
recipient's ACL by each recipient subscribing; no shared briefing across clearances).

## Modes

| Mode | Retrieval / analysis / drafts / proposals | Execution |
|---|---|---|
| Off (default) | none; ask → 422 `ai.disabled`; briefings recorded `skipped (ai_off)` | none — rules-only detections remain (`GET …/ai/detections`) |
| Advisory (default when enabled) | yes | none (approval refused with `ai.mode_forbids_execution`) |
| Assisted | yes | after a bound human approval |
| Autopilot | yes | allowlisted eligible actions within the approved policy's daily limit and expiry; everything else needs approval |

Autopilot policy: proposed in settings by an `ai.settings.manage` holder, approved by a different person holding
`ai.autopilot_policy.approve`; allowlist ⊆ `create_internal_notification, request_update_from_owner,
draft_status_summary, flag_risk`; 1–50 actions/day; expiry required, ≤ 90 days; revocable at once (mode drops to
Assisted). The daily limit is counted and consumed under the project's advisory lock, so concurrent executors (several worker
replicas) never exceed it (SEC-P5-06).

## Guards

* **Kill switch** (`ai.killswitch.activate`; release by someone else): blocks asks, cancels queued `ai.run`,
  `ai.briefing`, `ai.execute_proposal` jobs, invalidates valid approvals, cancels pending proposals, cancels queued AI
  delivery-ledger rows; checked again before every tool call, after the provider call (output discarded), before every
  execution and once more under the execution's proposal lock right before the effect — a stop (or a rejection, or a
  revision) that commits before that lock wins and nothing is sent; one that commits later waits for the execution and
  then skips the executed proposal (SEC-P5-02). Every writer locks a proposal before its approvals (the stop updates
  proposals first, then approvals), so a stop and an execution never deadlock. History is preserved (rows are marked,
  never deleted). AI in-app notifications are only written at
  execution time, so "unsent" AI messages are exactly the queued jobs/proposals that are cancelled.
* **Budgets**: monthly token budget required to enable AI; per-run token limit (context trimmed); optional monthly cost
  budget with currency. Exhaustion → run status `budget_exceeded`, audit `AI_BUDGET_EXHAUSTED`, no provider call.
* **Timeouts**: per-run timeout (sync asks capped at 25 s because they run inside the request transaction).
* **Circuit breaker**: 3 consecutive provider failures → open for 15 minutes; open → run `failed (circuit_open)` without a
  provider call; a success closes it.
* **Quiet hours** (local hours in the project timezone): message actions are deferred to the end of the window.
* **Deduplication and cooldown** (§12.4, AIT-27, QA-P5-01; project setting `actionCooldownHours`, 0–168, default 24, 0 =
  off): every proposal carries a deduplication key (`aiDedupeKey`) — for a message the action, the target and the
  recipient (whichever run, schedule or delegating user prepared it and however it is worded); for a draft, task or risk
  the action, the target and the delegating user; without a target, the identical payload. A proposal is not created
  when a twin was created (and still awaits review or execution) or was executed within the window — the tool call is
  refused (`duplicate_within_cooldown`, audited `AI_ACTION_DEDUPLICATED`, listed in the run's refused tool calls); a
  revision into such a twin is refused (422 `ai.duplicate_within_cooldown`); and the execution re-checks, under a per-key
  advisory lock (`hub_ai_dedupe:<key>`, taken after the autopilot lock and before the proposal row lock), that no twin was
  executed within the window — otherwise the proposal is invalidated `duplicate_within_cooldown` and nothing is sent. A
  rejected, invalidated, cancelled or expired twin does not count, nor a pending twin older than the window (SEC-P5R-02).
  Retries of one execution stay exactly-once (AT-20).
  - **Lock order** (SEC-P5R-01): autopilot → dedupe key → proposal row → approval → audit chain. Every `audit_event`
    insert takes the organisation's audit-chain lock (`hub_audit:<org>`) and holds it until commit, so a transaction that
    has already written an audit row must not wait for any of the earlier locks. The execution and the revision write
    their audit rows last and wait for the key; a run (whose transaction has written audit rows before its tool calls)
    only TRIES the key — when another transaction holds it, a twin is being prepared, revised or executed right now and
    the tool call is refused as a duplicate.
  - The refusal names the twin (id and state) only to a delegating user who may read that proposal (`ai.proposal.read`
    and the proposal's visibility rule); anyone else gets a generic reason without its id or state (SEC-P5R-02).
* **Tool-call cap**: 12 model tool calls per run; the rest are refused (`tool_call_limit`).
* Scheduled slots missed during an outage are not replayed in bulk (ADR-0004); the next briefing covers the period.

## Operations

`GET …/ai/status`: mode, provider label (Simulated / Not configured / …), health (`off`, `ok`, `degraded`,
`circuit_open`, `budget_exhausted`, `kill_switch`, `not_configured`), failure reason, the caller's own last run (runs are
never shared; health uses the project's latest run status and error code only — SEC-P5-I2), next run, circuit state,
budget used this month, manual fallback text. `GET …/ai/costs`: tokens and estimated cost per month (estimates only).
Every run stores trigger, requester, evidence snapshot (items with id, version, classification, sent-to-provider flag,
cited ids), output, tokens, cost estimate, policy version (required: `ai_run.policy_version` is NOT NULL — REQ-AI-029,
QA-P5-10) and status. Logs/audit carry ids and codes only, never prompts
or outputs (C-37).

## Manual fallback

AI is optional: all project, committee, gate, readiness and reporting functions work without it; the rules-only
detections, the plan, the decision/action registers and the standard reports replace the briefing when AI is off,
over budget, or unavailable.
