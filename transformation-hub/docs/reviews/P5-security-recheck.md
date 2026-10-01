# P5 security re-check: the P5 QA fixes (QA-P5-01/-02/-03/-05/-08/-10) and the SEC-P5-01..06 fixes at the new revision

| Item | Value |
|---|---|
| Reviewer | `security-privacy-reviewer`, independent re-check in its own context (REVIEW mode). The reviewer wrote none of the code under review. It added one probe spec (`apps/api/test/reviews/p5-secr-ai.spec.ts`) and this document. It changed no implementation file, migration, seed or existing test. |
| Revision reviewed | **`598f25a`** (`598f25a735c078cb8814c4122ffed1ee4735010f`, head of `origin/claude/mobily-transformation-hub`). `git fetch` + `git merge` → "Already up to date". Frozen for the whole re-check. The QA fixes are `c3c7e59` (QA-P5-03), `7172f91` (QA-P5-01/-02/-05/-08/-09/-10), `917f912` (QA-P5-04/-06); the SEC-P5 fixes were merged at `0ab423e`. |
| Scope | The brief's list: QA-P5-03 (project classification on every AI channel), QA-P5-02 (own-run reads), QA-P5-01 (dedupe key, cooldown setting, advisory lock and lock order), QA-P5-08 (GET proposal by id), QA-P5-05 (`people` in the proposal DTO), QA-P5-10 (`ai_run.policy_version` NOT NULL); re-verification that SEC-P5-01..06 still hold and that the test set-ups the QA fixes changed still prove the original rules. Code: `apps/api/src/modules/ai/**`, `platform/policy.service.ts`, `platform/hub.guard.ts`, `platform/audit.service.ts` + `packages/db/sql/post-migrate.sql` (audit chain), `packages/contracts/src/ai.ts`, the AI part of the policy matrix, `docs/ai/scheduling-policy.md`, `docs/ai/tool-permissions.md`, `docs/security/ai-threat-cases.md` (AIT-27). |
| Databases | Own: `hub_test_p5secr` and `hub_test_p5secr_boot` (`HUB_DATABASES="hub_test_p5secr hub_test_p5secr_boot" bash scripts/dev/pg-init-roles.sh`). Every vitest run used `hub_test_p5secr`. No other database was touched (the lock probe filters `pg_locks` to its own database). |
| Processes | `pnpm`, `tsc`, `vitest`, `gitleaks`, and read-only `grep` of the PostgreSQL server log for the deadlock message. No server, no Docker, no external host. Only the Simulated mock provider (and a scripted Simulated provider installed through the registry's test hook) was used; the OpenAI-compatible and Anthropic adapters stay **Not configured**. The full API suite ran once, at the end (one other suite was running; `free -g` → 12–13 GB available). |
| **Verdict P5 (security)** | **PASS WITH CONDITIONS.** No Critical, High or Medium is open. The QA fixes hold for confidentiality and widen nothing: all 21 AI routes answer 404 to a member cleared below the project's classification, worker execution re-checks requester, approver and recipient, own-run reads stay self-scoped, GET-by-id applies the list's visibility, and `people` names only the people of a proposal the reader may read. SEC-P5-01..06 still hold. Two new **Low** findings in the QA-P5-01 deduplication: **SEC-P5R-01** (lock-order inversion between the per-key dedupe lock and the per-organisation audit-chain lock — a PostgreSQL deadlock, reproduced) and **SEC-P5R-02** (a twin the delegating user may not see suppresses their action and is named by id). The SEC-P5-01 regressions of the two earlier probe files now pass through the new project gate rather than the content rule; this re-check adds probes that prove the content rule on its own (they pass). |

Severity scale (as in the P1–P5 security reviews): **Critical** isolation or security bypass; **High** a control the gate relies on
does not work or is unverified; **Medium** a control materially weaker than documented, with compensation elsewhere; **Low** limited
exposure or a defence-in-depth gap; **Info** observation or documentation point.

---

## 1. Commands run and real results

All commands ran in `transformation-hub/` of the worktree `/home/user/My-owns/.claude/worktrees/agent-ab2b507fb5ecaaeb4`. Every vitest run used
`TEST_DATABASE_URL=postgres://hub_app:…@127.0.0.1:5432/hub_test_p5secr` and `TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:…@127.0.0.1:5432/hub_test_p5secr`.

### 1.1 Environment
```
$ git fetch origin claude/mobily-transformation-hub && git merge origin/claude/mobily-transformation-hub
  → Already up to date.            HEAD 598f25a735c078cb8814c4122ffed1ee4735010f
$ pg_isready -h 127.0.0.1 -p 5432  → accepting connections
$ HUB_DATABASES="hub_test_p5secr hub_test_p5secr_boot" bash scripts/dev/pg-init-roles.sh
  → roles hub_owner/hub_app and databases ready: hub_test_p5secr hub_test_p5secr_boot
$ pnpm install --frozen-lockfile --prefer-offline → Done in 3.5s;   pnpm build:packages → exit 0
$ (apps/api) npx tsc -p tsconfig.build.json → exit 0
```

### 1.2 Baseline before any probe: the AI specs and every earlier P5 / P3-P4 AI probe file
```
$ (apps/api) npx vitest run test/ai test/reviews/p5-qa-ai.spec.ts test/reviews/p5-sec-ai.spec.ts test/reviews/p5-sec-egress.spec.ts \
                            test/reviews/p34-sec-re-jv-ai.spec.ts test/reviews/p34-sec-re-fixes.spec.ts
  Test Files  16 passed (16)
       Tests  173 passed (173)          Duration 165.27s     EXIT 0
```
(The 16 files: the 12 of `test/ai` incl. `p5-sec-fixes.spec.ts` and `p5-qa-fixes.spec.ts`, plus the four review files. Every
SEC-P5 and QA-P5 probe runs as a plain "(fixed, regression)" test; none is an expected failure any more.)

### 1.3 This re-check's probe (`apps/api/test/reviews/p5-secr-ai.spec.ts`, single run)
```
$ (apps/api) npx tsc -p tsconfig.json --noEmit           → exit 0 (src + tests incl. the probe)
$ (apps/api) npx vitest run test/reviews/p5-secr-ai.spec.ts --reporter=verbose
  Test Files  1 passed (1)
       Tests  16 passed | 3 expected fail (19)            Duration 36.53s     EXIT 0
  Printed evidence (ids shortened):
  SEC-P5-01 re-check: project confidential; mid project 200, memo 404, own ask 201; autopilot → proposals 0, refused
    [{"name":"propose_internal_notification","reason":"recipient_not_cleared_for_content (recipient 53fd06b3-…): the recipient may
    not read every record this message was drafted from"}], delivered to mid 0; sponsor CONTROL delivered 1;
    revise → mid {"status":422,"code":"ai.recipient_not_cleared"} (version kept true), reworded to the sponsor 201
  QA-P5-03 re-check: below the project's classification {"GET settings":404,"PUT settings":404,"POST autopilot-policy/approve":404,
    "POST autopilot-policy/revoke":404,"POST killswitch/activate":404,"POST killswitch/release":404,"POST ask":404,"GET runs":404,
    "GET runs/:id":404,"GET status":404,"GET costs":404,"GET detections":404,"GET tools":404,"GET proposals":404,
    "GET proposals/:id":404,"POST proposals/:id/approve":404,"POST proposals/:id/reject":404,"POST proposals/:id/revise":404,
    "GET briefings":404,"POST briefings":404,"GET artifacts":404}; cleared at it {"GET status":200,"GET tools":200,
    "GET proposals":200,"GET runs":200,"GET detections":200}; approver lowered after approval
    {"status":"invalidated","reason":"approver_no_longer_authorized","notes":0,"approve":201}
  QA-P5-02 re-check: {"mineCarries":true,"list":{"status":200,"total":1,"ids":["01a0f869-3a77-…"]},"ownCount":1,"getMine":200,
    "getTheirs":404,"otherProject":404,"otherProjectList":404,"afterReclass":{"status":200,"carriesText":false,"carriesTitle":false},
    "afterDrop":{"get":404,"list":404},"restored":200,"afterRevoke":{"get":404,"list":404}}
  QA-P5-01 re-check: {"byRole":{"pm":403,"secretary":403,"contributor":403,"chair":403},"unchanged":true,
    "invalid":{"negative":400,"fraction":400,"over":400,"string":400},"sponsor":200,
    "audit":{"actor":true,"before":24,"after":0,"reason":"P5 re-check: cooldown off (synthetic)"},
    "rate":{"n0":1,"n1":2,"created":2,"statuses":["executed:","invalidated:ai.rate_limited"],"delivered":1},
    "cross":{"a":"created","b":"created","sameKey":true}}
  QA-P5-01 hidden twin: PM GET hidden 404, sponsor GET 200; PM run proposals 0, refused [{"name":"propose_internal_notification",
    "reason":"duplicate_within_cooldown: the same action for the same target and recipient is already awaiting review or execution
    (proposal 01a0f869-43cd-7061-af71-b34a5831b99b)"}]; revise 422 {…"code":"ai.duplicate_within_cooldown","detail":"The same action
    for the same target is already awaiting review or execution","details":{"duplicateOf":"01a0f869-43cd-7061-af71-b34a5831b99b"},…}
  QA-P5-01 lock order: interleaving {"executionHeldKey":true,"runWaitedOnAdvisory":true}; execution {"result":{"status":"executed",
    "mode":"approved",…,"deduplicated":false},"error":null,"status":"executed","notes":1}; second run {"status":409,
    "code":"db.serialization_failure","refused":[]}
  QA-P5-05/08 re-check: {"draftRefused":[],"pm":404,"sponsor":200,"people":[{"userId":"0c9662e0-…","displayName":"Demo Secretary /
    CPMO"}],"pmListHas":false,"techLead":403,"msgPeople":[3 ids],"msgPeopleKeys":["displayName","userId"],"expectedPeople":[same 3 ids],
    "emails":false,"unknownTech":403,"knownTech":403}
```
The 3 expected fails are this re-check's DEFECT probes (SEC-P5R-01 ×1, SEC-P5R-02 ×2). The file ran alone twice (the same 16 passed
+ 3 expected fail both times; the second, verbose, run is quoted). Afterwards only a leftover variable and a comment were removed;
the final file ran in the full suite (§1.4).

PostgreSQL's own record of the SEC-P5R-01 reproduction (server log, read-only `grep`, own database only):
```
2026-10-01 17:00:46.732 UTC [12551] hub_app@hub_test_p5secr ERROR:  deadlock detected
  DETAIL:  Process 12551 waits for ExclusiveLock on advisory lock [6653519,245925921,657465308,1]; blocked by process 12461.
           Process 12461 waits for ExclusiveLock on advisory lock [6653519,3362023458,4180707449,1]; blocked by process 12551.
           Process 12551: select pg_advisory_xact_lock(hashtextextended('hub_ai_dedupe:' || $1, 0))
           Process 12461: insert into "audit_event" (…)
```

### 1.4 Full API suite (once, at the end, own database)
```
$ free -g → available 13 GB before the start (one other agent's full suite was running; at most two at a time)
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p5secr TEST_DATABASE_MIGRATION_URL=…/hub_test_p5secr pnpm test --reporter=verbose
  (tsc -p tsconfig.build.json && vitest run)
  Test Files  145 passed (145)
       Tests  1150 passed | 5 expected fail (1155)
    Start at  17:04:40 UTC;  Duration  1768.75s;  EXIT 0
  The 5 expected fails = this re-check's 3 DEFECT probes + the 2 open probes DOM-P2F-02 / DOM-P2F-04 (p2-domain-final.spec.ts).
  The lead's run at 598f25a: 144 files, 1134 passed + 2 expected fail; the difference is exactly this re-check's file
  (+1 file, +16 passed, +3 expected fail).
  In this run the probe printed the same results (lock order: second run {"status":409,"code":"db.serialization_failure"}, the
  execution executed with 1 notification; hidden twin named by id). PostgreSQL server log: 3 "deadlock detected" entries for
  hub_test_p5secr in total (16:59:59, 17:00:46, 17:05:55 UTC) = the three runs of the probe; no other deadlock in this database.
```

### 1.5 Secret scan
```
Before committing (the two new files copied to a scratch directory, project configuration):
$ gitleaks dir <scratchpad>/glcheck-secr --config scripts/ops/gitleaks.toml --redact=100
  INF scanned ~73386 bytes (73.39 KB) in 25.3ms
  INF no leaks found
After committing (committed tree of HEAD, project script):
TREE_SCAN_PLACEHOLDER
```

---

## 2. Findings

| ID | Severity | Where | Finding (one line) |
|---|---|---|---|
| **SEC-P5R-01** | Low | `ai/ai-proposals.service.ts:184` (createFromTool takes `hub_ai_dedupe:<key>` inside the run's transaction, after earlier tool calls of the same run wrote audit rows — `:163`, `:211`), `:764` + `:838` (execution phase 2: dedupe lock, then the audit row); `packages/db/sql/post-migrate.sql:253` (every audit insert takes `hub_audit:<org>` until commit); `ai/ai-runtime.service.ts:470` (one transaction for all tool calls of a run) | The two locks are taken in opposite orders: a run that already wrote an audit row (its first proposal, or any refusal) waits for the dedupe key held by an execution of the twin, while that execution waits for the audit-chain lock the run holds. PostgreSQL detects the deadlock and aborts one side. Reproduced: the PM's synchronous ask → 409 `db.serialization_failure`. The documented lock order "autopilot → dedupe key → proposal row → approval" omits the audit-chain lock. |
| **SEC-P5R-02** | Low | `ai/ai-proposals.service.ts:186` (refusal reason `… (proposal <id>)`), `:415` (422 `details.duplicateOf`), `:460-469` (`duplicateOf`: every proposal of the project, visible to the delegating user or not; pending twins without age limit) | A proposal the delegating user may NOT see (SEC-P34R-05 rule: 404 for them) suppresses their identical action, and its id and state ("awaiting review or execution") are disclosed in their run output, the audit reason and the revision refusal. Existence-only disclosure, no content; the suppression lasts while the hidden twin is pending (proposals never expire). |
| SEC-P5R-I1 | Info | `ai/ai-settings.service.ts` `activateKillSwitch` / `releaseKillSwitch` (first statement `assertProjectVisible`) | QA-P5-03 also gates the emergency stop by the project's classification: a holder of `ai.killswitch.activate` cleared below the project gets 404 (probe: `POST killswitch/activate` → 404). The stop reveals no content. Consistent with "a member who cannot see the project gets 404 everywhere", but it narrows the people who can stop the AI. Owner decision together with SEC-P5-I5 (no organisation-wide stop). |
| SEC-P5R-I2 | Info | `apps/api/test/reviews/p5-sec-ai.spec.ts` › "SEC-P5-01 (fixed, regression) (policy-limited autopilot)" / "(assisted, AIT-07)"; `apps/api/test/ai/p5-sec-fixes.spec.ts` › creation (d) and revision (c) | Since QA-P5-03 these SEC-P5-01 regressions use a recipient cleared BELOW the project, who is refused by the new project gate (`recipientAllowed` returns at `:286` before the content check `:291`). They no longer prove the content rule. The approval / execution cases of `p5-sec-fixes.spec.ts` (source reclassified above a recipient cleared AT the project's classification) and "send financials" still do. This re-check's probes restore the proof for creation (autopilot) and revision; they pass. |
| SEC-P5R-I3 | Info | `ai/ai-runtime.service.ts:161` (async ask retried only while `queued`), `:201` (briefing retried → `already_ran`) | Stated from the code, not executed: when `finalize` fails after the run row was committed (e.g. the SEC-P5R-01 deadlock victim is a worker run), the job's retry finds the run `running` / the slot already used and does nothing: the async answer or the scheduled briefing of that slot is lost and the run stays `running`. Pre-existing; SEC-P5R-01 adds a trigger. |
| SEC-P5R-I4 | Info | `ai/ai-settings.service.ts` `update` (`reason` optional), contract `actionCooldownHours` 0–168 | The cooldown is a single-person setting of `ai.settings.manage` (sponsor, portfolio admin), audited with before / after / actor (probe CONTROL); no reason is required to switch deduplication off (0). Same as quiet hours and budgets; only the autopilot policy is two-person. Cooldown 0 does not lift the autopilot daily limit (probe CONTROL). Optional: require a reason when lowering it. |

### SEC-P5R-01 (Low): lock-order inversion between the dedupe-key lock and the audit-chain lock

**What the code does.**
- Every audit insert takes `pg_advisory_xact_lock(hashtextextended('hub_audit:' || org_id, 0))` in the `hub_audit_chain` trigger
  (`post-migrate.sql:253`) and keeps it until the transaction ends.
- A run's `finalize` processes all model tool calls in ONE transaction (`ai-runtime.service.ts:470`). Each proposable call goes to
  `createFromTool`, which takes the per-key lock `hub_ai_dedupe:<key>` (`ai-proposals.service.ts:184`) and then writes an audit row
  (`ai.proposal.create` `:211`, or a refusal `:163`). From the first such audit row on, the run holds `hub_audit:<org>` and every
  later call of the same run takes its dedupe lock AFTER the audit lock.
- Execution phase 2 takes the dedupe lock first (`:764`) and writes its audit row last (`:838`).
- So: run R holds `hub_audit` and waits for key K; execution E holds K and waits for `hub_audit` → deadlock. The same cycle exists
  between two runs (R2 holds `hub_audit` and waits for K1; R1 holds K1 and waits for `hub_audit` to audit its proposal).
- `docs/ai/scheduling-policy.md` and `docs/ai/tool-permissions.md` document "autopilot → dedupe key → proposal row → approval"; the
  audit-chain lock, which every one of these transactions also takes, is not in that order.

**Reproduction** (probe › "QA-P5-01 lock order …"; production paths only, one deterministic pause):
- An approved reminder P (PM → contributor about task 5; cooldown 24 h) is executed through `AiProposalsService.executeJob` (the job
  taken off the queue with the owner pool, as the SEC-P5-06 probe does). A spy on `lockDedupe` holds the execution right after it
  acquired P's key — the interleaving a busy worker produces naturally, widened.
- Meanwhile the PM's synchronous ask (scripted Simulated model) prepares (1) a reminder to the legal member about task 6 — a new key,
  a proposal and an audit row — then (2) the same reminder as P.
- The watcher sees the run waiting on an advisory lock (`pg_locks`, own database) and releases the execution.
- Result: `second run {"status":409,"code":"db.serialization_failure"}`; the execution committed (`executed`, 1 notification);
  PostgreSQL log: "deadlock detected … waits for … advisory lock … blocked by process …; Process 12551: select
  pg_advisory_xact_lock(hashtextextended('hub_ai_dedupe:' …)); Process 12461: insert into "audit_event"".
- `DEFECT SEC-P5R-01` asserts the required outcome (the run waits, then completes with its twin refused; the execution executes):
  expected failure. `CONTROL` (interleaving reached, P executed exactly once) passes.

**Impact.** Availability only: no duplicate, no disclosure, no lost approval (PostgreSQL aborts one transaction and the other
commits). A user's synchronous ask or briefing fails with 409 (retry works). A worker run that loses is not re-run (SEC-P5R-I3, from
the code): its scheduled briefing slot is lost. An execution that loses is retried by the job queue. The window in production is
short (an execution holds the key for a few statements before its audit row), so the deadlock is rare, but it is reachable through
the normal flow (a briefing that proposes several reminders while an approved twin executes).

**Recommendation.** Take the dedupe locks of a run before it writes any audit row, in a deterministic order (compute the keys of all
proposable tool calls, lock them sorted, then create / refuse); or use `pg_try_advisory_xact_lock` in `createFromTool` and treat a
held key as "a twin is being executed" (refuse as `duplicate_within_cooldown`, fail closed). Add the audit-chain lock to the
documented lock order; keep the probe as a regression.

### SEC-P5R-02 (Low): a twin the delegating user may not see suppresses their action and is named

**What the code does.** `duplicateOf` (`:460-469`) looks for any proposal of the project with the same key — whoever prepared it and
whatever its visibility — and counts pending twins without an age limit (pending proposals have no expiry; `expired` is never set).
The refusal names it: `(proposal <id>)` in the run's refused tool calls and the `AI_ACTION_DEDUPLICATED` audit reason (`:186`), and
`details.duplicateOf` in the 422 of a revision (`:415`).

**Reproduction** (probe › "QA-P5-01 — a proposal the delegating user may NOT see …"):
- The secretary's run (a restricted memo sent to the model) prepares a message to the sponsor about task 3. The PM (cleared
  confidential) gets **404** on `GET /ai/proposals/<id>` (SEC-P34R-05 rule, run input above the PM); the sponsor gets 200.
- The PM's own run prepares a reminder to the sponsor about task 3: refused `duplicate_within_cooldown … already awaiting review or
  execution (proposal 01a0f869-43cd-…)`. The PM's revision of another reminder onto task 3: 422 with `"details":{"duplicateOf":
  "01a0f869-43cd-…"}`.
- Two `DEFECT SEC-P5R-02` probes (run output; revision) assert that the refusal does not name a proposal the requester may not
  see: expected failures. The CONTROL (hidden from the PM, shown to the sponsor, refused as a twin) passes.

**Impact.** Existence, id (a UUID v7, so its creation time) and state of a proposal the PM may not read; no content. The PM's
legitimate reminder is suppressed by an action they can neither see nor reject, for as long as that twin stays pending (the
cross-user deduplication itself is the documented QA-P5-01 rule: "whichever run, schedule or delegating user").

**Recommendation.** Name the twin (and its state) only when the delegating user may see it (`visibleSql` for that user), otherwise
refuse with a generic reason; consider counting pending twins only within the cooldown window, or expiring unreviewed proposals,
so a hidden pending twin does not suppress indefinitely. Keep the probes as regressions.

---

## 3. Re-verification per item of the brief

| Item | Result | Evidence |
|---|---|---|
| **QA-P5-03** project classification on every AI channel | **Holds** | Static: every one of the 21 controller methods (`ai.controller.ts`) calls `AiKnowledgeService.assertProjectVisible` first (settings get/update, autopilot approve/revoke, stop activate/release, ask, runs list/get, status, costs, detections, tools, proposals list/get/approve/reject/revise, briefings list/subscribe, artefacts); `projectSql` is inside `vis` / `readable` (every retrieval), `refVisibleSql` (citations, proposal targets and run inputs), `visibleCitationKeys`, `inputsVisible` and the proposals' `visibleSql`; worker: async ask and briefing before and after the provider call, execution requester and approver (`projectVisible` with the CURRENT clearance from `hub_auth_user_by_id`), recipient (`recipientAllowed` `:286`). `projectVisible` uses `policy.canSee` (also refuses room-only principals); the SQL form checks the classification and is always combined with `visibilitySql`, which refuses room-only principals on non-room tables. Executed: a member holding sponsor + PM + secretary + auditor roles, cleared `internal` in this `confidential` project, gets **404 on all 21 routes**, nothing changed (proposal still `proposed`, stop not set); cleared at the project → 200 on the read routes (CONTROL). An approved message whose approver drops below the project before execution → `invalidated` `approver_no_longer_authorized`, 0 notifications. The QA regressions (ask / briefing / detections, REV-EN-03) pass (§1.2). |
| **QA-P5-02** own runs with `ai.assistant.use` / `ai.briefing.subscribe` | **Holds; widens nothing** | Static: `assertOwnRunsReader` (`ai-ops.service.ts:48-50`) only replaces the role check; both queries keep `requestedBy = caller` and the project; the guard still 404s a project outside the caller's scope for `access: 'authenticated'` (`hub.guard.ts:153-156`); `getRun` re-checks claims, detections, conflicts, warnings and model-written prepared requests. Executed (contributor, no `ai.run.read`): own run 200; another user's run 404; list = own runs only, `total` = own-run count (1 = 1); the own run through another project 404 (list 404); a cited source reclassified above the reader → run 200 with neither the memo text nor its title anywhere in the DTO; clearance below the project → run and list 404 (restored → 200); role revoked through the portfolio API → 404. The QA test's clean-team and "proposals still 403" checks pass (§1.2). |
| **QA-P5-01** dedupe key, cooldown, lock | **Holds, with SEC-P5R-01 / -02 (Low)** | Who sets it: only `ai.settings.manage` — PM, secretary, contributor, chair → 403, nothing saved; −1, 1.5, 169, "0" → 400; the sponsor's change → 200, audited (`ai.settings.manage`, actor = sponsor, before 24 → after 0, reason). No two-person rule (SEC-P5R-I4). Cooldown 0 vs the autopilot limit: two identical reminders from two runs with the limit = today + 1 → one `executed`, one `invalidated ai.rate_limited`, one delivery. Across projects: the identical targetless message to the same member in two projects has the same key and is created in both (`duplicateOf` filters the project; the global advisory lock only serialises). Within the project: SEC-P5R-02. Lock order: SEC-P5R-01. The QA tests DUP-07 / DUP-08 and the revision / execution cases pass (§1.2). |
| **QA-P5-08** GET proposal by id | **Holds** | `getOne` = project gate → `ai.proposal.read` project-wide (`assert` with no workstream) → `loadVisible` (the list's `visibleSql`). Executed: the secretary's targetless draft (free-draft rule, delegate cleared restricted) → PM 404 and absent from the PM's list, sponsor 200; a proposal whose run input is above the PM → PM 404 (SEC-P5R-02 CONTROL); a workstream-only lead → 403 for a known id, an unknown id and a draft alike (no existence oracle: the 403 comes before the row is read). QA test: unknown id, other project, below-classification → 404 (§1.2). |
| **QA-P5-05** `people` | **Holds** | Names are computed only for rows already returned under `visibleSql` (`toDtos`), only for ids the DTO already carries (delegating user, `payload.recipientUserId`, approvers of that proposal), and carry `{ userId, displayName }` only. Executed: message proposal → exactly requester, recipient, approver; keys `displayName`, `userId`; no e-mail in the DTO; a draft → only the delegating user; hidden proposals → 404 / absent (no names). Partner-room / clean-team people cannot be involved: recipients must be active internal full-scope members (`recipientAllowed`), requesters need `ai.assistant.use` and approvers `ai.proposal.approve` (no room role holds either), and room-only principals are refused every AI route by `canSee`. |
| **QA-P5-10** `ai_run.policy_version` NOT NULL | **Holds** | Schema `packages/db/src/schema/ai.ts:84` and migration `0000_initial_schema.sql:2933` (table `ai_run`) NOT NULL; `createRun` always sets it from the settings row (NOT NULL default `ai-policy-1`); the QA-P5-10 test (owner insert without it → rejected; 0 runs without it) passes (§1.2). |
| SEC-P5-01 content rule | **Holds** (evidence restored) | See SEC-P5R-I2. New probes with a recipient cleared AT the project's classification (project 200, own ask 201, memo 404): under autopilot the message drafted from the restricted memo is refused at creation `recipient_not_cleared_for_content`, nothing delivered (CONTROL: the same instruction to the sponsor is executed and delivered); a revision to that recipient → 422 `ai.recipient_not_cleared`, version unchanged (CONTROL: a reworded revision to the sponsor → 201). Approval and execution: `p5-sec-fixes.spec.ts` (source reclassified above a confidential recipient) passes. |
| SEC-P5-02 stop / rejection race | **Holds** | Phase 2 still locks the proposal and re-reads status, version, approval and the stop under the lock; the new dedupe lock is taken before the proposal row; the stop and `reject()` take no dedupe lock, and `revise()` takes the new key before the proposal row (the execution's order), so no new cycle with them (static; the audit-chain cycle is SEC-P5R-01). Regression and the rejection / revision variants pass (§1.2). |
| SEC-P5-03 derived action classification | **Holds** | Unchanged code path; regression + meeting-action case pass (§1.2). |
| SEC-P5-04 redirects | **Holds** | `http.providers.ts` unchanged since `df7809e`; the three regressions pass (§1.2). |
| SEC-P5-05 stored runs / drafts | **Holds** | Regressions pass; independently, a reclassified source leaves no text or title in a stored run read through the new own-run path (QA-P5-02 row). |
| SEC-P5-06 autopilot daily limit | **Holds** | Regression passes; the cooldown-0 CONTROL above shows the limit is enforced under the autopilot lock whatever the cooldown. |

**Changed test set-ups of the QA "Fix status" (the brief's question "does each still prove the original rule?")**
- `p5-sec-ai.spec.ts` SEC-P5-01 CONTROL (own ask 201 → 404): the CONTROL is now correct for QA-P5-03, but the two SEC-P5-01
  regressions that rely on it pass because of the project gate, not the content rule → **no longer prove SEC-P5-01** (SEC-P5R-I2);
  proof restored by this re-check's probes.
- `p5-sec-fixes.spec.ts` approval / execution (recipient lowered below the project → source reclassified above a confidential
  recipient): **still prove** the content rule (the recipient passes the project gate; refused by `inputsVisible`).
- `p5-sec-fixes.spec.ts` creation (d) and revision (c) (recipient `low`, cleared internal): **no longer prove** the content rule
  (project gate); creation is still proven for the finance dimension by "send financials"; both proven again by the new probes.
- `at-19` REV-EN-03 (now: lowered to the project's classification → runs without the higher content; below it → skipped, 404):
  asserts the correct rule.
- `ai-settings-ops.spec.ts` runs-list 403 → 200 with own runs only and the PM's run 404: consistent with QA-P5-02 (independently
  probed above).

## 4. Not verified / NOT EXECUTED

- **No real model.** Only the Simulated mock and a scripted Simulated provider; the HTTP adapters are Not configured.
- **SEC-P5R-01 in a multi-replica deployment / under real load:** reproduced in one process with a deterministic pause; its
  frequency in production was not measured. The worker-run consequence (SEC-P5R-I3) is stated from the code, not executed.
- **Two-run variant of SEC-P5R-01** (run vs run on the same key): stated from the code, not executed.
- **Playwright / web:** not run. The web changes of the QA fixes (own-run tab, `people` display) were not reviewed beyond the DTOs.
- QA-P5-04 / -06 (Arabic texts) were read only for new data in the DTOs (codes, dates, statuses already in the English detail): no
  security impact found; not probed.

## 5. Verdict and conditions

**P5 security: PASS WITH CONDITIONS** at `598f25a`.
- No Critical, High or Medium open. The QA-P5-03 High is fixed and its rule holds on every route and worker path probed; the QA
  fixes widen no access; SEC-P5-01..06 hold.
- Conditions:
  1. SEC-P5R-01 and SEC-P5R-02 (Low) fixed with the DEFECT probes turned into regressions, or carried by the lead with an owner.
  2. Keep (or port into `p5-sec-fixes.spec.ts`) the new SEC-P5-01 content probes, since the earlier SEC-P5-01 regressions now pass
     through the project gate (SEC-P5R-I2).
  3. Owner decision on SEC-P5R-I1 (emergency stop for holders below the project's classification) with SEC-P5-I5; record
     SEC-P5R-I3 and -I4.

## 6. Files added by this re-check

- `apps/api/test/reviews/p5-secr-ai.spec.ts`: 19 tests — 3 `DEFECT` expected fails (SEC-P5R-01 ×1, SEC-P5R-02 ×2), 16 CONTROL /
  rule tests (SEC-P5-01 content rule ×3, QA-P5-03 ×2, QA-P5-02 ×3, QA-P5-01 ×4, QA-P5-05/-08 ×3, SEC-P5R-01 CONTROL ×1).
- `docs/reviews/P5-security-recheck.md`: this report.

Probe convention: a `DEFECT` is `it.fails` asserting the required behaviour; once fixed it turns red and the implementer renames it
"… (fixed, regression)" and makes it a plain `it`.
