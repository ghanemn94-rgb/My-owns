# P5 security review: Proactive AI PM (authority modes, tools, proposals, scheduling, kill switch, budgets, retrieval, egress, prompt injection), plus the P4 gate condition C1

| Item | Value |
|---|---|
| Reviewer | `security-privacy-reviewer`, independent review in its own context (REVIEW mode). The reviewer wrote none of the code under review. It added two probe specs (`apps/api/test/reviews/p5-sec-ai.spec.ts`, `apps/api/test/reviews/p5-sec-egress.spec.ts`) and this document. It changed no implementation file, migration, seed or existing test. |
| Revision reviewed | **`c990f5c`** (head of `origin/claude/mobily-transformation-hub` at the time of the review). `git fetch` + `git merge` reported "Already up to date". The worktree head `da2ad1f` is `c990f5c` plus one commit that adds only `docs/reviews/P3-P4-domain-rereview.md` and `apps/api/test/reviews/p34-domain-re3-tsa.spec.ts` (`git diff --stat c990f5c HEAD` → 2 files, 255 insertions). The application code, migrations, seeds and existing tests are the same as `c990f5c`. |
| Scope | Spec §12 (knowledge sources, capabilities, authority modes and prohibitions §12.3, action engine and scheduling §12.4, agent security §12.5), §15, §16; acceptance tests AT-17, AT-18, AT-19, AT-20, AT-21, AT-22, AT-28 and AT-03 (AI retrieval isolation). Code: `apps/api/src/modules/ai/**`, `packages/domain/src/ai.ts`, the AI permissions of the policy matrix, `docs/ai/*`, `docs/security/ai-threat-cases.md`, and the web AI PM Center (disclosure and labelling only). Also covered: the lead's fix in `ai-proposals.service.ts` `approve()` (`invalidateDetached`), and the P4 gate condition **C1**: re-verification of SEC-P34R-05 and SEC-P34R-07. |
| Databases | Own databases on the shared cluster `127.0.0.1:5432`: `hub_test_p5sec` and `hub_test_p5sec_boot`, created with `HUB_DATABASES="hub_test_p5sec hub_test_p5sec_boot" bash scripts/dev/pg-init-roles.sh`. Every vitest run used `hub_test_p5sec`. No other database was touched. PostgreSQL was already running. |
| Processes | Only `pnpm`, `tsc`, `vitest`, `node` (module-boundary check, gitleaks) and `psql` (read-only queries on the own database) from this worktree. The egress probe starts two HTTP listeners on **loopback only** (127.0.0.1 and 127.0.0.2) inside the vitest process; they are closed in `afterAll`. No server, no Docker, no external host was contacted. The full API suite was run once, at the end. |
| **Verdict P5** | **FAIL**. There is one open **High**: SEC-P5-01. When an AI message is sent, its recipient is re-authorised only for the message's target, never for the content the model drafted. A document carrying an injected instruction can therefore make the AI deliver content to a project member who may not read it. Under policy-limited autopilot this happens with no human review; in assisted mode the approval is accepted, although AIT-07 says the uncleared recipient must be refused. AT-17 ("do not disclose content") is therefore **not met**. Open Mediums: SEC-P5-02 (emergency stop / rejection race in autopilot execution), SEC-P5-03 (the provider ceiling under-classifies committee actions), SEC-P5-04 (provider adapters follow redirects to unapproved hosts). Open Lows: SEC-P5-05, SEC-P5-06. Everything else in scope holds and is tested (see §4). |
| **Lead fix** (`invalidateDetached`) | **VERIFIED.** The invalidation and its `AI_APPROVAL_INVALIDATED` row now survive the 409 refusal. They are written under the approver's own RLS context, only after authorisation, and do not deadlock with concurrent approvers. No other throw-after-write path exists in the AI module (§3). |
| **P4 C1** | **SEC-P34R-05: CONFIRMED. SEC-P34R-07: CONFIRMED** (§5). |

Severity scale (as in the P1–P4 reviews):
- **Critical**: an isolation or security bypass.
- **High**: a control the gate relies on does not work, or is unverified.
- **Medium**: a control is materially weaker than documented, with compensation elsewhere.
- **Low**: limited exposure, or a defence-in-depth gap.
- **Info**: an observation or a documentation point.

---

## 1. Commands run and real results

All commands ran in `transformation-hub/` of the review worktree `/home/user/My-owns/.claude/worktrees/agent-ae9060ccf417da9c8`.
The two variables used by every vitest run are:
`TEST_DATABASE_URL=postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test_p5sec` and
`TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test_p5sec`.

### 1.1 Environment
```
$ git fetch origin claude/mobily-transformation-hub && git merge origin/claude/mobily-transformation-hub
  → Already up to date.        (HEAD da2ad1f = c990f5c + domain re-review report/probe; git diff --stat c990f5c HEAD → 2 files)
$ pg_isready -h 127.0.0.1 -p 5432                         → accepting connections
$ HUB_DATABASES="hub_test_p5sec hub_test_p5sec_boot" bash scripts/dev/pg-init-roles.sh
  → roles hub_owner/hub_app and databases ready: hub_test_p5sec hub_test_p5sec_boot
$ pnpm install --frozen-lockfile --prefer-offline          → Done in 3.1s
$ pnpm build:packages                                      → exit 0
$ (apps/api) npx tsc -p tsconfig.build.json                → exit 0
$ node --version                                           → v22.22.2 (fetch ignores proxy env; NODE_USE_ENV_PROXY unset)
```

### 1.2 Baseline: the existing AI specs and the P3/P4 re-check regression specs (before any probe was written)
```
$ (apps/api) npx vitest run test/ai test/reviews/p34-sec-re-jv-ai.spec.ts test/reviews/p34-sec-re-fixes.spec.ts
  Test Files  11 passed (11)
       Tests  103 passed (103)
```
Domain unit tests and static checks:
```
$ (packages/domain) npx vitest run src/ai-runtime.test.ts          → Test Files 1 passed; Tests 20 passed (20)
$ (apps/api) npx tsc -p tsconfig.json --noEmit  (src + test, incl. the new probes)   → exit 0
$ (apps/api) node scripts/check-module-boundaries.mjs
  → module boundary check passed: 43 cross-module imports, 19 module edges, acyclic, only published surfaces
```

### 1.3 New probe specs (final versions, single-file runs on `hub_test_p5sec`; record ids shortened)
```
$ (apps/api) npx vitest run test/reviews/p5-sec-egress.spec.ts --reporter=verbose
  SEC-P5-04 observed (anthropic, 307): generate resolved; approved host hits 1; unapproved host hits 1;
    [{"method":"POST","url":"/v1/messages","xApiKeyForwarded":true,"contextCanaryInBody":true}]
  SEC-P5-04 observed (anthropic, 302): unapproved host hits 1; [{"method":"GET","xApiKeyForwarded":true,"contextCanaryInBody":false}]
  SEC-P5-04 observed (openai_compatible, 307): unapproved host hits 1;
    [{"method":"POST","url":"/v1/chat/completions","authorizationForwarded":false,"contextCanaryInBody":true}]
  Test Files  1 passed (1)
       Tests  1 passed | 3 expected fail (4)

$ (apps/api) npx vitest run test/reviews/p5-sec-ai.spec.ts --reporter=verbose
  lead fix observed: refused callers {"contributor (no ai.proposal.approve)":403,"pm.b (other project)":404,"pm (the requester)":403,
    "after refused callers: proposal status":1,"after refused callers: AI_APPROVAL_INVALIDATED rows":0};
    secretary approve → 409 ai.approval_invalidated; concurrent approvals → {"statuses":[409,409],
    "codes":["ai.approval_invalidated","ai.approval_invalidated"],"ms":430}
  SEC-P34R-05 re-verification (reach): WS1 proposal approve 404 not_found, reject 404 not_found;
    WS0 proposal approve 403 policy.forbidden, reject 403 policy.forbidden
  SEC-P5-03 observed: action item in the run snapshot [{"id":"01a0f6bd-…","tool":"list_decisions_awaiting_action","type":"action_item",
    "version":1,"classification":"internal","sentToProvider":true}]; provider requests 1; context items carrying the action title:
    [{"key":"action_item:01a0f6bd-…","classification":"internal","title":"ACT-001 P5SECHERON renegotiate the exclusivity terms (synthetic)"}]
  SEC-P5-05 observed: warnings at run time ["Source \"P5SEC-OSPREY legacy capacity memo (synthetic)\" was last updated on 2026-03-15
    (older than 90 days) — check it is still current."]; reclassify → 201; GET run after → 200; title still present: true; warnings now [same]
  SEC-P5-01 observed: autopilot proposal executed; messages to the internal-cleared member carrying the confidential canary: 1
    ["Confidential pricing memo P5SECKESTREL: the synthetic exclusivity fee terms remain under n"];
    assisted: approve → 201, delivered [{"to":"internal-cleared member","body":"Confidential pricing memo P5SECKESTREL: …"}]
  SEC-P5-02 observed: kill switch → 201; proposal status right after the stop: cancelled;
    after the job: {"finalStatus":"executed","notifications":1,"executeAudit":1}
  SEC-P5-06 observed: autopilot executions today before 2, limit 3, after 4; results [{"status":"executed","mode":"autopilot",…},
    {"status":"executed","mode":"autopilot",…}]
  Test Files  1 passed (1)
       Tests  13 passed | 6 expected fail (19)
```
How the probes were built:
- The probes went through two revisions; only the final versions are reported.
- The first run of `p5-sec-ai.spec.ts` showed two broken CONTROLs, both caused by the set-up, not by the code under review:
  - A workstream lead cannot call `GET /ai/proposals` at all (403). This is now recorded as an OBSERVED test.
  - The kill-switch request was issued from inside the job's AsyncLocalStorage transaction context. DbService refuses that nested run (500). The request is now issued from a continuation created outside that context.
- Every DEFECT has a CONTROL that holds before and after a fix. Scenarios run in `beforeAll`. So a broken set-up turns a CONTROL red and cannot hide behind an expected failure.

### 1.4 Full API suite (once, at the end, own database `hub_test_p5sec`)
```
$ free -g   → available 11 GB (≥ 6 GB required; one other agent's e2e stack and suite were running)
$ (apps/api) TEST_DATABASE_URL=…/hub_test_p5sec TEST_DATABASE_MIGRATION_URL=…/hub_test_p5sec pnpm test   (tsc build + vitest run)
  Test Files  140 passed (140)
       Tests  1073 passed | 12 expected fail (1085)
    Duration  1710.16s
  (exit 0. The 12 expected fails are this review's 9 DEFECT probes — 6 in p5-sec-ai.spec.ts, 3 in p5-sec-egress.spec.ts —
   plus 3 pre-existing open probes of earlier reviews declared through `const defect = … it.fails` aliases.)
```

### 1.5 Secret scan of the new files
```
Before committing (the three new files copied to a scratch directory, project configuration):
$ gitleaks dir <scratch>/glcheck --config scripts/ops/gitleaks.toml --redact=100
  INF scanned ~83236 bytes (83.24 KB) in 45ms
  INF no leaks found
After committing (committed tree of HEAD, project script):
$ GITLEAKS=<scratchpad>/gitleaks-8.30.1 bash scripts/ops/secret-scan.sh tree
  tree: 1171 committed files at HEAD 1f36462
  INF scanned ~14858393 bytes (14.86 MB) in 1.62s
  INF no leaks found
  PASS  tree: no findings
  SECRET SCAN (tree): PASS
(1f36462 is the review commit with the probes and this report; the only later change is this result block.)
```

---

## 2. Findings

| ID | Severity | Where | Finding (one line) |
|---|---|---|---|
| **SEC-P5-01** | **High** | `ai/ai-proposals.service.ts:201-213` (`recipientAllowed`: `if (!targetType \|\| !targetId) return true;` at :209), used at creation :193-197, approval :253-256 and execution :556-557 | An AI message recipient is re-authorised for the message's **target** only. The content the model drafted from the run's inputs is never checked against the recipient. An injected instruction in a document makes the AI deliver content the recipient may not read: with no human review under autopilot, and through an accepted approval in assisted mode (contradicts AIT-07 / C-33). AT-17 is not met. |
| **SEC-P5-02** | Medium | `ai/ai-proposals.service.ts:578-626` (phase 2 checks only `status === 'executed'` :581 and, for approvals, the approval status :582-585; the final update :620-623 has no status predicate) | An autopilot execution ignores an emergency stop, or a rejection, that commits between its checks (phase 1) and its effect (phase 2). The message is sent and the proposal's `cancelled` status is overwritten with `executed`. |
| **SEC-P5-03** | Medium | `ai/ai-tools.service.ts:33-42` (`action_item: 'internal'`), :240; `ai/ai-detections.service.ts:216-229` (no `classification` in the action's meta); `ai/ai-gateway.service.ts:61-83` | The provider-ceiling filter (the primary egress control, AIT-30) classifies every committee action as `internal`. An action of a restricted or strictly confidential decision is sent to a provider whose ceiling is lower. "Strictly confidential never goes to any provider" does not hold for actions. |
| **SEC-P5-04** | Medium | `ai/providers/http.providers.ts:72-86` and `:145-153` (`fetch` without `redirect`) | Both provider adapters follow HTTP redirects. A 3xx from the approved, allowlisted endpoint makes the platform send the full context (307/308) and the `x-api-key` header (any 3xx) to a host that is not on `HUB_EGRESS_ALLOWLIST`. This bypasses the AT-22 egress guard. |
| **SEC-P5-05** | Low | `ai/ai-runtime.service.ts:521-525` (stale-source warnings carry source titles); `ai/ai-ops.service.ts:58-71` (`getRun` re-checks claims, detections and conflicts, not warnings); `ai/ai-artifacts.service.ts:43-56` (draft artefacts are checked against their target only) | A stored run keeps, and shows on every later read, the titles of sources its requester can no longer see. Executed drafts are checked only against their target, not the run inputs they were drafted from. |
| **SEC-P5-06** | Low | `ai/ai-proposals.service.ts:524-532`, `:629-636` | The autopilot daily limit is counted in phase 1 without any lock. Two executors (two worker replicas) both see "under the limit" and both execute: the approved limit is exceeded. |
| SEC-P5-I1 | Info | `ai/ai-proposals.service.ts:347-359` (:356) | The detached invalidation in `approve()` has no version predicate. A stale `approve()` that races a requester's `revise()` can invalidate the freshly revised proposal. Availability only: the requester revises again. Add `eq(version, p.version)`. |
| SEC-P5-I2 | Info | `ai/ai-ops.service.ts:82, 98` | `GET …/ai/status` returns the project's last run (id, kind, status, error) whoever requested it. Every other run route is "own runs only". The data is content-free; scope it to the caller, or drop the id. |
| SEC-P5-I3 | Info | policy matrix `ai.provider.configure` (no route uses it); `ai-settings.service.ts:155-199` | The project-level `ai.settings.manage` (sponsor, portfolio admin) sets `maxClassificationToProvider` up to the provider's hard maximum. The matrix assigns classification ceilings to the organisation-level `ai.provider.configure`, which no route uses. Owner decision (keep or move). |
| SEC-P5-I4 | Info | `platform/config.ts:58, 244`; `ai-config.ts:28` | `HUB_PRIVATE_MODE` has no runtime consumer. Private-mode egress control is exactly the `HUB_EGRESS_ALLOWLIST` check (default empty), so SEC-P5-04 matters. |
| SEC-P5-I5 | Info | `ai-settings.service.ts:338-368`; matrix `ai.killswitch.activate` ("organisation or project") | The emergency stop exists per project only. There is no organisation-wide stop. |
| SEC-P5-I6 | Info | `ai-config.ts` (`syncTimeoutCapMs = 25_000`); `ai-runtime.service.ts:120-139` | A synchronous ask holds its request transaction (a pool connection) for up to 25 s while the provider answers. The circuit breaker opens after 3 failures, which bounds this. A burst of concurrent asks against a hanging provider can still hold many connections at once (AT-21 resilience). Consider async-by-default or releasing the transaction during the call. |
| SEC-P5-I7 | Info | `ai-proposals.service.ts:595-600` | An executed AI message is stored as kind `ai_action` with the model's title and body. The platform adds no "AI-generated (Simulated)" marker; the mock writes "Simulated" into its own text. There is no inbox UI yet (P6). When it ships, the marker must come from the platform. |
| OBS-P5-01 | Info (QA) | `ai-proposals.service.ts:390` | A workstream-scoped `ai.proposal.read` / `ai.proposal.approve` holder (a workstream lead) gets 403 on `GET /ai/proposals`. The list needs a project-level grant. This is functional, not a leak. Probe: OBSERVED in `p5-sec-ai.spec.ts`. |

### SEC-P5-01 (High): the AI message recipient is never re-authorised for the content

**What the code does.**
- `validatePayload` (creation), `approve()` and the execution phase 1 all call `recipientAllowed(...)`.
- That function checks that the recipient is an active, internal, full project member. It then checks only that the recipient can see the **target**.
- Without a target it returns `true` (:209).
- The message body is free text (≤ 500 characters) written by the model. The model wrote it from the run's context: up to 40 items, at most the project ceiling (`confidential` in the test settings; `restricted` allowed for local or mock providers).

**What is documented.**
- `notifications.message.send`: "each recipient is re-authorised for the content at send time".
- AIT-07 (`docs/security/ai-threat-cases.md:165-171`): "each recipient is re-authorised for the derived classification … Bodies ≤ internal (C-33)". Expected: "uncleared … recipients are removed … before approval".
- AT-17: "do not … disclose content".
- SEC-P34R-05 already applies exactly this rule to **readers** of the proposal: `visibleSql` checks the run inputs. It does not apply it to the **recipient** of the message the proposal sends.

**Reproduction.**
- Probe `p5-sec-ai.spec.ts` › "DEFECT SEC-P5-01 (policy-limited autopilot)" and "DEFECT SEC-P5-01 (assisted, AIT-07)", with their CONTROL. Production runtime path (`POST /ai/ask` → `finalize` → `createFromTool` → worker `ai.execute_proposal`).
- The only stand-in is a scripted Simulated provider: a model that follows an instruction found in its sources ("notify <member> with the memo text"). It is installed through `ProviderRegistry.override`.
- Setup:
  - The PM (clearance confidential) asks about a **confidential** memo.
  - The recipient is a full project member (contributor role) cleared only to **internal**.
  - CONTROL: the recipient gets 404 on the memo, and their own AI answer does not carry it.
- Autopilot, with `create_internal_notification` allowlisted by an approved policy: the proposal is **executed** with no human review. The member receives `"Confidential pricing memo P5SECKESTREL: the synthetic exclusivity fee terms remain under n…"`.
- Assisted: the secretary (cleared restricted, holds `notifications.message.send` and `ai.proposal.approve`) approves → **201**, and the same text is delivered.
- The same path carries any content the run retrieved within the ceiling to any full project member who lacks the corresponding read permission or reach. For example, approved financial figures can reach a member without `finance.record.read`, and CP titles a member without `jv.deal.read` ("a document instructs the AI to send financials", AT-17).

**Compensation.**
- Recipients are internal full project members only. External addresses and e-mail, Teams and SMS are refused or disabled.
- Autopilot needs a two-person policy approval and an allowlisted message action.
- A real model must follow the injection; the mock never does, and no real model is configured here. The project's own threat model says containment must not depend on the model (`ai-threat-cases.md` §4.2).

**Recommendation.**
- Bind the content to the recipient. At creation, approval and execution, require the recipient to pass the same check the proposal's readers pass: `AiProposalsService.visibleSql` for that recipient (target + every input sent to the provider + the delegate-clearance rule for targetless drafts), or a stored derived classification and finance flag compared with the recipient's (finance-domain) clearance.
- Refuse or narrow uncleared recipients **before approval** (AIT-07), and audit them.
- Optionally apply C-33 (bodies at most `internal`, reference plus link only) to AI messages.
- Add the probe's two cases as regressions.

### SEC-P5-02 (Medium): the emergency stop and a rejection do not stop an autopilot execution already past its checks

**What the code does.**
- `executeJob` runs phase 1 (all checks) in one service-principal transaction that takes no lock.
- Phase 2 then runs in another transaction. It locks the proposal and returns only if it is already `executed` (:581). For an approved proposal it also returns if the approval is no longer `valid` (:582-585). The kill switch and `reject()` both invalidate approvals, so the **approval** path is covered.
- An **autopilot** proposal has no approval. If the kill switch (which sets the proposal `cancelled`) or a human `reject()` commits between the two phases, phase 2 still inserts the notification and overwrites the status with `executed` (:620-623, no status predicate).
- AIT-28 says the switch is checked "before each send". Phase 2 is the send.

**Reproduction.**
- Probe › "DEFECT SEC-P5-02" with CONTROL.
- The window is opened deterministically: the PM activates the emergency stop through the API while phase 1 re-checks the recipient.
- `kill switch → 201; proposal status right after the stop: cancelled; after the job: {"finalStatus":"executed","notifications":1,"executeAudit":1}`.
- The rejection variant follows the same code path. It is stated from the code and was not executed.

**Compensation.**
- The window is short (phase 1 queries).
- Autopilot actions are low-impact in-app messages.
- The approval path is covered.

**Recommendation.** In phase 2, under the `FOR UPDATE` lock:
- re-read the proposal status and require `proposed` / `approved`;
- re-read `ai_project_settings.kill_switch`;
- make the final update conditional on the locked status.

### SEC-P5-03 (Medium): committee actions are always "internal" for the provider ceiling

**What the code does.**
- Retrieval of overdue actions is correct: `ai-knowledge.service.ts:262-267` applies the decision's classification through `RecordVisibility`.
- But the context item's classification comes from `d.meta.classification ?? RECORD_CLASSIFICATION[entityType]`. For actions the meta has no classification, so the item is `'internal'`.
- The decision detections do set the decision's own classification, so the derived rule exists. It is not applied to the decision's actions.

**Reproduction.**
- Probe › "DEFECT SEC-P5-03" with CONTROL.
- The secretary drafts a **restricted** paper and an action on it. CONTROL: the PM (confidential) gets 404 on the action; the secretary gets 200.
- The action is made overdue (owner pool). The project ceiling is set to `confidential`.
- The secretary asks "Which committee actions are overdue?". The Simulated provider receives `{"key":"action_item:…","classification":"internal","title":"ACT-001 P5SECHERON renegotiate the exclusivity terms (synthetic)"}`.
- The run snapshot records `classification: internal, sentToProvider: true`.
- Under an external gateway (hard maximum `internal`), the title of a restricted or strictly confidential decision's action would leave the platform.

**Compensation.**
- No external provider is configured in this build.
- Only the action's code and title are sent.

**Recommendation.**
- Carry the decision's classification into the action's detection meta (join `decision` in `decisionsAwaiting`).
- Default every derived item to its parent's classification. Fail closed: treat an unknown classification as `strictly_confidential`, not `internal`.
- Add the probe as a regression.

### SEC-P5-04 (Medium): provider adapters follow redirects to non-allowlisted hosts

**What the code does.**
- `assertDestination` checks the configured URL against `HUB_EGRESS_ALLOWLIST`, and the gateway preflight does the same.
- But `fetch(…)` runs with the default `redirect: 'follow'`.

**Reproduction.**
- Probe `p5-sec-egress.spec.ts`, loopback only. The approved endpoint is 127.0.0.1 (allowlisted); it answers with a redirect to 127.0.0.2 (not allowlisted).
- CONTROL: a provider configured directly on 127.0.0.2 is refused before any request.
- Results:
  - Anthropic adapter, 307: POST to the unapproved host with the context and `x-api-key`.
  - Anthropic adapter, 302 (for example a login redirect): GET with `x-api-key`.
  - OpenAI-compatible adapter, 307: POST with the context. Undici dropped `Authorization` on the cross-origin hop.

**Compensation.**
- The endpoint must itself be approved and allowlisted, and https in production (config validation).
- No endpoint is configured here.

**Recommendation.**
- Use `redirect: 'error'` (or `'manual'` and treat 3xx as a provider error) in both adapters.
- Optionally route provider traffic through one egress helper that re-checks every hop.
- Add the probe as a regression.

### SEC-P5-05 (Low): stored runs and drafts keep what the reader can no longer see

**Stored runs.**
- `finalize` writes up to five stale-source warnings, each naming the source title (:521-525).
- `getRun` re-checks claims, detections and conflicts on every read (§12.1), but returns warnings unchanged.
- Probe › "DEFECT SEC-P5-05" with CONTROL:
  - The PM's run cites an aged confidential memo. The secretary reclassifies it to restricted (API, 201).
  - The PM then gets 404 on the document, and the run no longer cites it.
  - But `GET /ai/runs/:id` still shows `Source "P5SEC-OSPREY legacy capacity memo (synthetic)" was last updated on 2026-03-15 …`.

**Draft artefacts (stated from the code, not executed).**
- An executed draft's artefact stores the payload. `sourceRefs` contains the target only (`ai-proposals.service.ts:611-615`), so `listMine` and `document.changed` invalidation never consider the run inputs the draft was written from.
- The ACL fingerprint does not change when a document is reclassified.

**Exposure.** Only the requester, who saw the title or content at run time.

**Recommendation.**
- Store warnings as codes plus citations and re-check them on read like claims, or drop titles from stored warnings.
- Key draft artefacts to the run inputs (as SEC-P34R-05 does for proposals).

### SEC-P5-06 (Low): the autopilot daily limit can be exceeded by concurrent executors

**What the code does.** `autopilotActionsToday` is read in phase 1 without a lock or serialisation.

**Reproduction.**
- Probe › "DEFECT SEC-P5-06".
- Two queued autopilot executions run at once, as two worker replicas would. The limit is today's count + 1 = 3.
- Result: `before 2, limit 3, after 4`.

**Recommendation.**
- Take a per-project advisory lock (for example `hub_ai_autopilot:<projectId>`) in phase 2, before re-counting.
- Or count and insert under the proposal lock with a re-check.

---

## 3. Lead fix: `approve()` invalidation in an autonomous transaction (verified)

**Static review** of `ai-proposals.service.ts:228-273, 341-359` and `platform/db.service.ts:165-182`.

The sequence in `approve()`:
1. `loadVisible` (SEC-P34R-05).
2. The separation-of-duties check and `policy.assert('ai.proposal.approve', { withinAuthority, requesterUserId })`.
3. The version and state checks, the kill switch and the mode.
4. Then, and only then, the hash and target-version comparison.
5. On a mismatch, `invalidateDetached` writes the approvals and the proposal in `db.runDetached(ctx, …)`. That is a new connection with **the approver's own** `app.org_id` / `app.project_ids` / `app.user_id` (the same `applyContext` as requests), so RLS is the approver's. The audit row is then written with `audit.recordDetached`.

Why this does not lock up:
- The request transaction has written nothing and locked nothing before this point (reads only).
- So the detached update cannot wait on a lock held by its own request.
- The per-organisation audit-chain advisory lock (`post-migrate.sql:253`) is not held by the request transaction either, because nothing was audited in it yet.

**Executed** (probe "Lead fix …", 4 CONTROLs, all pass):
- Callers refused before the binding check leave no trace: the contributor (403), a Project B PM (404), and the requester (403 `ai.self_approval`). The proposal stays `proposed` and no `AI_APPROVAL_INVALIDATED` row is written.
- The secretary gets **409** `ai.approval_invalidated`. The proposal is `invalidated` / `target_version_changed`, persisted. No approval row exists. There is exactly one audit row, with `actor_user_id` = the secretary and `outcome` = `rejected`.
- Two approvers at once: `[409, 409]` in 430 ms. There is no 5xx, no lock wait and no approval row.
- The lead's own assertions in `at-18-ai-approval-binding.spec.ts` pass (baseline §1.2).

**Throw-after-write search** across the AI module (every `throw` was checked):
- The only throws after a write are `approve()` :269 and `revise()` :325. Both are optimistic-concurrency conflicts that must roll back the write.
- `ask()` audits the kill-switch refusal with `recordDetached` before throwing (:127).
- The worker's phase 1 returns (it does not throw) after its invalidations.
- Residual: Info SEC-P5-I1 (no version predicate in the detached update).

---

## 4. Scope checklist

| Area | Status | Evidence |
|---|---|---|
| Authority modes (Off / Advisory / Assisted / Autopilot), per-project | Met | `assertActionExecutable`, `toolAllowedInMode`; Off → 422 `ai.disabled`; advisory approval → 422 `ai.mode_forbids_execution` (APB-02); autopilot needs a two-person approved, unexpired policy (settings spec). |
| Prohibited actions unreachable (§12.3); AI never approves, waives or signs | Met | No tool exists for any `AI_PROHIBITED_ACTIONS` entry; the hostile mock's `verify_cp`, `approve_gate`, `declare_closing`, `create_waiver`, `grant_vdr_access`, `make_admin`, `send_email`, `shell` and `sql` are refused and audited, and `authoritySnapshot` is unchanged (INJ-*-02, PRQ-*). `svc-ai-pm` has an empty permission list. Approvals come only from interactive human sessions (APB-01). Draft actions create no record in the owning module. |
| Typed, narrow tools; retrieval runtime-controlled | Met | `AI_TOOLS` catalogue; model-issued retrieval refused (`retrieval_is_runtime_controlled`); no project or room argument; 12-call cap. |
| Proposals and approval binding (hash, recipient, target version, expiry, approver still authorised, single use) | Met, with the content-to-recipient gap (SEC-P5-01) | APB-01…06 pass; lead fix §3. |
| Scheduling (durable jobs, fresh authorisation, idempotency, quiet hours) | Met | AT-19 / AT-20 specs pass; `forUser` before and after the provider call; dedupe keys; deferral re-checks everything. |
| Kill switch | **Partly**: SEC-P5-02 | The settings spec (blocks asks, cancels queued jobs, approvals and proposals, release by another person) and DUP-06 pass; autopilot in-flight race open. |
| Budgets and circuit breaker fail closed | Met | `evaluateBudget` refuses a budget of 0, per-run and monthly overruns; AT-21 specs pass; budget usage summed per project under project RLS (`ai_run` generic isolation). |
| Retrieval ACL inside SQL (classification, rooms, clean team, finance clearance, reach) for answers, citations, briefings, detections | Met | `ai-knowledge.service.ts` (one SQL with ACL before `ts_rank`; `RecordVisibility` / `grantSql` / `reachSql`); retrieval-ACL, AT-28 and the P3/P4 re-check specs pass; citations re-checked before output and on read. |
| Provider ceiling / room exclusion / DLP before egress | **Partly**: SEC-P5-03 | `filterContext`: room items never sent; ceiling = min(project, provider hard maximum); redaction. |
| Private-mode egress guard | **Partly**: SEC-P5-04, I4 | The allowlist is checked at save time, in preflight and in the adapter (EGR-01/02); redirects are not. |
| Prompt-injection handling of document text | **Not met for disclosure**: SEC-P5-01 | Instruction-like text is flagged and quoted as data (INJ-EN/AR-01). The hostile mock is contained. The content-to-recipient path is not. |
| Logging without sensitive payloads | Met | Audit rows carry ids, codes, hashes and counts only (`ai.proposal.create` / `execute` / `run`); the AI module has no `Logger` calls with content; reasons carry tool names and codes. |
| Mock labelled Simulated; no real endpoint contacted | Met (I7 for the future inbox) | API: `simulated`, `providerLabel` "Simulated (mock provider)", disclaimer, briefing title "(Simulated)". Web: `SimulatedBadge` / `SimulatedNotice` on status, answers, runs and proposals; no "connected" state (`bits.tsx:116`). The mock has no network code (`destination()` → null). AT-17 asserts zero `fetch` calls (pass). The real adapters are "Not configured" here. |
| AT-03 (AI retrieval isolation) | Met | Cross-project specs pass; probe CONTROL: a Project B PM gets 404 on approve. |
| AT-17 | **Not met**: SEC-P5-01 | See above. |
| AT-18 | Met | APB-01…06 and the lead fix (§3). |
| AT-19 | Met (Low SEC-P5-05 for stored-run warnings) | AT-19 spec; execution re-authorises requester, approver and recipient. |
| AT-20 | Met | AT-20 spec (dedupe, `FOR UPDATE`, one notification per slot or proposal). SEC-P5-06 concerns the daily cap, not duplicates. |
| AT-21 | Met (I6) | AT-21 spec; deterministic detections with AI Off, over budget or with the provider down. |
| AT-22 | **Partly**: SEC-P5-04 | See above. |
| AT-28 | Met | AT-28 spec (missing evidence with owner roles; no demo or other-project data in a non-demo project). |

---

## 5. P4 C1 re-verification (SEC-P34R-05, SEC-P34R-07)

### SEC-P34R-05: CONFIRMED

**Static.**
- `AiProposalsService.visibleSql` (`ai-proposals.service.ts:413-441`) is applied in SQL to the list and its `total` (:389-411) and to every response, through `get`.
- Through `loadVisible` (404 like an unknown id) it is applied to `approve` (:229), `reject` (:276) and `revise` (:292).
- It requires all of the following:
  1. the target, under `refVisibleSql` (per-type owning-module rules, `CASE`-guarded `::uuid`, unknown type → hidden);
  2. every run input with `sentToProvider`;
  3. for targetless drafts, a reader clearance and finance-domain clearance at least the delegate's, recorded in the run snapshot.
- The activity feed shows `ai_proposal` events through `RecordVisibility.viaTarget`. Their audit rows carry no payload (action, ids, hash).

**Executed.**
- The fixer's regressions pass (baseline §1.2).
- Independent CONTROLs in `p5-sec-ai.spec.ts`, on cases the fix tests do not cover:
  - **Workstream reach**: the WS0 lead gets 404 on approve and reject of a proposal about a WS1 task they cannot read (`GET task` 404). On the WS0 proposal, which they can see, they get 403 (no authority). Nothing changes.
  - **Document input above clearance**: a task proposal from the secretary's run, which sent a **restricted** document to the model, is hidden from the PM (confidential; document 404) and shown to the sponsor. The PM's approve → 404, and the list contains no trace of the canary.
  - **Lead-fix probe**: a Project B PM's approve → 404.
- Observation OBS-P5-01: workstream leads cannot list proposals at all (403). Functional, for QA.
- The P4 exit criterion "financial data only with the finance-domain clearance and reach" now holds in the AI proposals list.

### SEC-P34R-07: CONFIRMED

**Static.**
- `EvidenceService.assertTargetWrite` (`documents/evidence.service.ts:107-113`) = the target's work permission (`EVIDENCE_TARGET_PERMISSION`) + `assertTargetCommand` (gate-criterion owner rule, requester-only rule on a draft or submitted paper).
- `link` (:231), `flagConflict` (:346, both links share the target through `assertConflictMarkable`) and `supersede` (:363) call it before any state change.
- Read visibility is checked first (`loadLink` / `linkDoc` → 404).

**Executed.**
- The fixer's regressions pass (baseline §1.2).
- Independent CONTROLs:
  - **Closing condition**: Finance (reads the CP, holds `documents.evidence.link`, no `jv.cp.manage`) supersede → 403 `evidence.target_permission`. The secretary (cannot read the CP) → 404. The link stays `active`. Legal (`jv.cp.manage`) → 201.
  - **Draft paper flag-conflict** (not in the fix tests): Finance → 403 `governance.decision.not_requester`, both links stay `active`; the requester → 201.

---

## 6. Not verified / NOT EXECUTED

- **No real model was run.** Only the Simulated mock exists here; the OpenAI-compatible and Anthropic adapters are Not configured. SEC-P5-01 uses a scripted Simulated provider in place of a model that follows an injection. Whether a given real model follows such an instruction is not measured, and containment must not depend on it.
- **SEC-P5-02 rejection variant**: stated from the code (same phase 2 check), not executed.
- **SEC-P5-05 draft-artefact variant**: stated from the code, not executed.
- **Multi-replica worker deployment**: SEC-P5-06 runs two executions concurrently in one process, standing in for two replicas. A real multi-replica worker was not run (no Docker or Helm here).
- **Playwright and the web AI PM Center**: not executed. Disclosure and labelling were reviewed statically (`apps/web/src/app/(app)/projects/[projectId]/ai/**`, `i18n/messages/{en,ar}/ai.json`).
- **Load and connection-pool behaviour under concurrent synchronous asks** (SEC-P5-I6): not measured.

---

## 7. Verdict and conditions

**P5: FAIL.** SEC-P5-01 (High) is open, and AT-17 is not met. After SEC-P5-01 is fixed, and its two DEFECT probes turn red and become regressions, the expected verdict is **PASS WITH CONDITIONS**, with these conditions:
- Fix SEC-P5-02, -03 and -04 (Medium) before the P5 gate, each with its probe turned into a regression.
- Track SEC-P5-05 and -06 (Low).
- Take owner decisions on SEC-P5-I3 and -I5.
- Record SEC-P5-I1, -I2, -I4, -I6, -I7 and OBS-P5-01.

**P4 C1:** SEC-P34R-05 **CONFIRMED**; SEC-P34R-07 **CONFIRMED**.

---

## 8. Files added by this review

- `apps/api/test/reviews/p5-sec-ai.spec.ts`: 19 tests.
  - 6 `DEFECT` expected fails: SEC-P5-01 ×2, -02, -03, -05, -06.
  - 1 `OBSERVED`: OBS-P5-01.
  - 12 `CONTROL`: lead fix ×4, SEC-P34R-05 ×2, SEC-P34R-07 ×2, and the preconditions of SEC-P5-01, -02, -03 and -05.
- `apps/api/test/reviews/p5-sec-egress.spec.ts`: 4 tests: 3 `DEFECT` expected fails (SEC-P5-04 ×3) and 1 `CONTROL`.
- `docs/reviews/P5-security-review.md`: this report.

Probe convention: a `DEFECT` is `it.fails` asserting the required behaviour. Once fixed it turns red; the implementer then renames it "… (fixed, regression)" and turns it into a plain `it`.
