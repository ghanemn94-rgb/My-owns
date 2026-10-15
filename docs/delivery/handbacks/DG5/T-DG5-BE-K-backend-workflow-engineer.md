# Handback T-DG5-BE-K: approval routes, conditional approval and condition escalation (p5-work-split §E.2)

- **Agent:** backend-workflow-engineer. Invocation `DG5-T-DG5-BE-K-backend-workflow-engineer-20261015T024502Z-927732d6` (session `927732d6-49e5-42b3-9e0f-596fc05a7a6b`).
- **Stage:** DG5 (P5). Worktree `/home/user/wt/dg5-be-k`, branch `dg5/be-k`. Base `HEAD` `5b4597ccb9477a521c1683a3bf5d91c99eb53208`, verified with `git rev-parse HEAD` at the start.
- **Time:** start `2026-10-15T02:45:16Z` (`date -u`). End `2026-10-15T04:27Z`. See §3.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-K.md`, sha256 `ee4128ee…369dfa` (verified).
- **Changes are uncommitted**, for the orchestrator to integrate.
- **Migrations:** none. `0078` (reserved for BE-K "only if route resolution needs a constraint") is **unused**. The `0075` guards (RS01–RS11, GC01–GC09) were enough.
- **Two gate systems:** these are product approvals inside the product. A route step, a G5 decision and a condition closure are human business actions. In the tests, synthetic test persons perform them, and they approve nothing real. Nothing here reads or writes DG0–DG7.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/approval-routes.ts` (new) | Zod mirrors: `approvalRouteDefinition(List)`, `approvalRouteStep`, `approvalRoute`, `approvalRouteStepDecision` (body), `trackedGateCondition(Page)`, `gateConditionClose` (body). |
| `packages/shared/src/schemas/index.ts` | One barrel line, with its comment. |
| `packages/shared/src/schemas/studio.ts` | The named line `conditionalApprovalEnabled: z.boolean().optional()` on the `gate` attributes (ADR-0044 §3). |
| `apps/api/src/modules/workflows/approval-routes.ts` | BE-A's stub, filled. Route resolution (pinned `approver_route` `approval.<type>`, or a procedure definition's mode and roles), step instantiation, step decision, completion through `decideApprovalInTx`, cancellation, and the 3 routes. Lock order: the approval row, 730226, then 730260. |
| `apps/api/src/modules/workflows/approvals.ts` | Named lines only, each marked `T-DG5-BE-K`: the import; the `approval.decide_through_route` refusal; in `decideApproval`, the routed-approval refusal after BE-C's `decideThroughSubject` line; the optional `routeStepActing` input of `decideApprovalInTx`, which replaces only check 3 for a route completion; step creation in `requestApprovalInTx` and `resubmitApprovalInTx` (instead of the DG4 assignee tasks for a routed approval only); step cancellation in `withdrawApprovalInTx`. |
| `apps/api/src/modules/workflows/conditional-approval.ts` | BE-A's stub, filled. Switch resolution (pinned `gate` attribute, else the catalogue default: G5 `true`, others `false`), the 422 `gate.conditional_approval_disabled` check, and the registration of `gate-conditions.ts`. |
| `apps/api/src/modules/workflows/gate-conditions.ts` (new) | `listGateConditions` (derived open/overdue/closed in the transformation's time zone; status filter; cursor) and `closeGateCondition` (owner only; the append-only closure, its audit event, and the condition's open `gate_condition_due`/`gate_condition_overdue` items completed in the same transaction). |
| `apps/api/src/modules/workflows/gates.ts` | Named lines after BE-J's: one import, and check "4c" after the DG4 scale-scope rule, before any write. |
| `apps/api/src/modules/workflows/workflows.test.ts` | **Outside my named files; disclosed (§5 item 1).** One commented exception line: `GET /api/v1/admin/approval-routes` declares `methodology.read` (ADR-0044 §9), not `transformation.read`. |
| `apps/worker/src/handlers/gates.ts` | **New function only:** `runGateConditionEscalationScan` (lock-free; `runOnce` key `gate.condition_escalation:<id>`, UNIQUE GC07/GC08, dedupe `gate_condition_overdue:<id>`). Plus its exported constants and one `GATES_HANDLERS` entry. |
| `apps/worker/src/queues/gates.ts` | **One queue line** (`gate.condition_escalation_scan`) beside DG4's expiry-scan line, so the 0075 schedule has its queue. Strictly outside the §E.2 file list; disclosed. |
| `apps/worker/src/handlers/approvals.ts` | The route-step lines: for a routed approval, the overdue reminder's "current assignee" is the holders of its **active** steps' roles. A waiting step's role is never reminded before activation. |
| `apps/api/test/integration/workflows/approval-routes.test.ts` (new) | REQ-S10-015 tests, 9 tests. |
| `apps/api/test/integration/workflows/gate-conditions.test.ts` (new) | REQ-S04-011 switch, scope and closure tests, 5 tests. |
| `apps/api/test/integration/workflows/route-fixtures.ts` (new) | A world with its own synthetic published methodology version (fresh key) and pin. |
| `apps/worker/test/integration/gate-condition-escalation.test.ts` (new) | The escalation job, 2 tests. |
| `apps/api/test/integration/contract/p5-exercises-be-k.ts` | Exercises all 5 operations and lists their mirrors. |
| `apps/api/test/support/p5-pending-be-k.ts` | Emptied (5 → 0). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-K-*` | This handback and its evidence. |

## 2. Behaviour delivered, per requirement row

### REQ-S10-015: "Support sequential or parallel approval rules"

> Acceptance (quoted): "A06;A08: in a sequential route step 2 is not notified until step 1 approves; in a parallel route both are notified at once"

**Configuration.** Routes are configured in Studio, as ADR-0044 §4 specifies; there is no new admin write.
- An `approver_route` element with key `approval.<approval_type>`, mode `sequential` or `parallel`, and 2–6 `approverRoleCodes` is resolved through the transformation's **pin**, never "the latest".
- For `procedure_step` approvals, the procedure definition's `approval_mode` and `approval_role_codes` apply (key `procedure.<code>`).
- With no element, mode `any`, a single role, or a `decideThroughSubject` type, the approval is the DG4 single-step approval with **no route rows**.

**Sequential.** Step 1 is `active` and the others are `waiting`.
- Only an active step's role holders get an `approval_decision` work item, with its inbox notification. Dedupe key: `approval_route:<id>:<round>:<step>:<user>`. The requester never gets one under `requester_excluded`.
- Step 2's holder has **no work item and no notification** until step 1 approves. It is notified at activation.
- Test: `approval-routes.test.ts` "step 2 has no work item or notification until step 1 approves…". It asserts the work items and the `inbox_notification` rows before and after.

**Parallel.** All steps are `active`, and every holder is notified at once. Test: "every step is notified at once…".

**Decision:** `POST /approvals/{id}/route/steps/{n}/decision`.
- Who may decide: `approval.decide` in scope, re-checked at commit time, plus the step's role or the DG4 delegate (`actsFor`) of a holder.
- Refusals, in order, with nothing written:
  - 403 `approval_route.not_step_approver`;
  - 403 `approval_route.self_decision`;
  - 403 `approval_route.one_step_per_person`;
  - 428/409 `If-Match` on the approval;
  - 422 `approval_route.step_not_active`;
  - 409 `approval.stale_version` (the subject moved).
- Completion:
  - Every step approved: `decideApprovalInTx` decides `approve` with the **last decider**. There is one canonical `approval_decision` row, and the `0031` guard is satisfied.
  - One `reject` or `request_changes`: the approval becomes `rejected` / `changes_requested`, and the other open steps are `cancelled` with their tasks.
  - A resubmission creates the next round's steps; the previous round's route is reused.
  - A withdrawal cancels the open steps.
- DG4 `POST /approvals/{id}/decisions` on a routed approval returns 422 `approval.decide_through_route` with the exact ADR text, and nothing is written.
- One audit event is written per step row (create, activate, decide, cancel).
- AUD gets 403.

**DG4 regression.** "no route (shipped v1)" and "no route (any)" check that there are no steps, the DG4 `approval.assign` task exists, and the DG4 decision route decides the approval.

**Reads.**
- `GET /approvals/{id}/route` uses the approval's read rule and carries an ETag of the approval version. It returns every round's steps.
- `GET /admin/approval-routes` requires `methodology.read`.
  - A BO gets 403; TL and AUD get 200.
  - It takes an optional published `versionId`, of kind methodology or procedure. The default is the newest published methodology version.
  - An unknown version returns 400 `validation.unknown_version` (the contract declares no 404).

### REQ-S04-011: "Offer conditional approval as a configurable extension … never authorizing unrestricted scaling"

> Acceptance (quoted): "A08: a conditional G5 approval limited to one region blocks a scale transition for another region; a conditional approval with no scope is rejected". The behaviour text, also quoted: "When enabled in Studio, an approver may approve with conditions; the platform allows only the permitted scope and tracks each condition to closure; overdue conditions escalate".

- **Scope (A08, DG4 re-run).** A conditional G5 limited to BU a1 blocks a scale transition for BU a2: 422 `scale.outside_approved_scope`. A G5 approval with no scope: 422 `gate.scale_scope_required`, with nothing written. Test: `gate-conditions.test.ts` "a conditional G5 limited to one BU…".
- **Enabled in Studio (D-142 Q2).**
  - The `gate` attribute `conditionalApprovalEnabled` is resolved through the pin. When absent, the catalogue default applies: G5 `true`, G1–G4 and G6 `false`.
  - A published v2 with G5 switched off refuses conditions with 422 `gate.conditional_approval_disabled` (exact ADR text), and no decision or condition is written. The same approval without conditions gets 201.
  - Switched on explicitly, conditions are accepted. v1-pinned transformations are unchanged; the switch resolves to `true`.
  - Tests: the three "Studio switch" tests.
- **Tracked to closure.**
  - `GET …/gate-conditions` derives each status as `open`, `overdue` (due date before today in the transformation's time zone) or `closed`. It has a status filter, AUD reads it, a caller outside scope gets 404, and a bad filter gets 400.
  - `POST …/{conditionId}/close` is for the owner only. Another user gets 403 `gate_condition.not_owner`; AUD gets 403. A blank note gets 400. The owner gets 201 with one closure and one audit event. A second close gets 422 `gate_condition.already_closed`.
  - Test: "open / overdue / closed; only the owner closes, once…".
- **Overdue conditions escalate.** The job `gate.condition_escalation_scan` (schedule seeded in `0075`) writes, per overdue open condition and **once**:
  - one `gate_condition_escalation` row (`overdue_since` = due date + 1), escalated to `gate_decision.decided_by`, with an audit event by `service`;
  - one `gate_condition_overdue` work item (an urgent kind), with its notification, to that approver.

  It writes nothing on the due date itself, nothing for a closed condition, and nothing on a second run or replay. It decides nothing. Test: `apps/worker/test/integration/gate-condition-escalation.test.ts`.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Disposable PostgreSQL 16.13 from `tests/qa/support/with-pg.sh` on harness ports 23801–23849. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-K-evidence/`.

End of work: `2026-10-15T04:27Z`, about 1 h 42 min. Every exit code below is the command's real one.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 4 | `node tools/gates/validate.mjs --historical --stage DG4`, at the start and at the end | **0 / 0** | `PASS gate DG4 (historical)` | `validate-dg4-historical.txt`, `validate-dg4-historical-end.txt` |
| 1a | `pnpm -r typecheck` (final run, after the last edit) | **0** | | `typecheck.txt` |
| 1b | `pnpm -r build` (final) | **0** | | `build.txt` |
| 1c | `pnpm lint` (final) | **0** | `eslint . --max-warnings=0` | `lint.txt` |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final) | **0** | "All matched files use Prettier code style!" | `prettier.txt` |
| 1e | `pnpm openapi:lint` (final) | **0** | `PASS … OpenAPI 3.1.1, 846 operations` (the contract is unchanged) | `openapi-lint.txt` |
| 2a | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test`, **run 3 (final)** | **0** | unit-node 107 files / **1902** passed; unit-web 72 / **1400** passed; unit-formula-nocodegen 3 / **259** passed + 2 skipped (by design) | `unit-locale-unset-run3.txt` |
| 2b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | 1902 / 1400 / 259 + 2 skipped, every Vitest invocation passed | `unit-c-utf8.txt` |
| 3 | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **239 files, 2311 tests: 2310 passed, 1 failed.** The one failure is the pinned media-type triple in `contract.test.ts`: `expected [ 363, 362, 1 ] to deeply equal [ 361, 360, 1 ]`. That is the +2 delta of §4, left for the orchestrator to reconcile. Every other test passed, including the 3 new suites (9 + 5 + 2 tests). Duration 2218 s. | `integration.txt` |
| 3b | The same harness (port 23820), `contract.test.ts` alone, with line 902 **temporarily** set to `[363, 362, 1]`, then restored with `sed` (`git diff` of the file is empty afterwards; `git checkout` was refused by the read-only `.git`) | **0** | 74/74 passed | `contract-with-reconciled-pin-TEMP.txt` |

**Targeted runs during development** (same harness, ports 23801–23805):

| Run | Exit | Result | Log |
|---|---|---|---|
| `approval-routes.test.ts` | 0 | 9/9 | `targeted-approval-routes.txt` |
| `gate-conditions.test.ts` and the worker's `gate-condition-escalation.test.ts` | 0 | 7/7 | `targeted-gate-conditions-and-escalation.txt` |
| `contract.test.ts` | 1 | 73/74; only the same pin failed | `targeted-contract-pin-only-failure.txt` |

**Non-zero exits and flakes, disclosed:**
- **Unit run 1, locale unset: exit non-zero, 2 failures, both mine, both fixed.** One was the lock class numbers written in a comment. The other was the `workflows.test.ts` GET convention (§5 item 1). Its raw log was lost to a redirect race in my own two background shells; the facts I captured are in `unit-run1-FAILED-note.md`.
- **Unit run 2, locale unset: exit 1, 1 failure** in `unit-web`: `src/pages/raid/raid.test.tsx` "action register: … edit sends If-Match". It took 6377 ms, then `Unable to find role="link" and name "Synthetic call the vendor"`. unit-node passed 1902/1902 in that run.
  - This run shared the CPU with the full integration suite. I changed no web file (`git status apps/web` is empty).
  - Rerun alone: 18/18 passed (`unit-web-raid-rerun.txt`). Run 3, the full suite, passed (2a).
  - I report it as a load-sensitive flake in a test I did not touch, for the web owner (F-DG4-143 to F-DG4-148 class).
- **Integration exit 1** is the pin only (3 and 3b).

**Migrations:** none. **API endpoints added:** `GET /api/v1/admin/approval-routes`, `GET /api/v1/approvals/{approvalId}/route`, `POST /api/v1/approvals/{approvalId}/route/steps/{stepNo}/decision`, `GET /api/v1/transformations/{transformationId}/gate-conditions`, `POST /api/v1/transformations/{transformationId}/gate-conditions/{conditionId}/close`. **Worker:** the queue and handler `gate.condition_escalation_scan`.

## 4. Operations routed (delta to `p5-pending-be-k.ts`)

All 5 were removed (5 → 0). Each is exercised in `p5-exercises-be-k.ts` through the validating client, with its mirror:

| Operation | Route | Exercised responses |
|---|---|---|
| `listApprovalRoutes` | `GET /api/v1/admin/approval-routes` | 200, 400, 401, 403 |
| `getApprovalRoute` | `GET /api/v1/approvals/{approvalId}/route` | 200, 400, 401, 404 |
| `decideApprovalRouteStep` | `POST /api/v1/approvals/{approvalId}/route/steps/{stepNo}/decision` | 200, 400, 401, 403, 404, 409, 422, 428 |
| `listGateConditions` | `GET /api/v1/transformations/{transformationId}/gate-conditions` | 200, 400, 401, 404 |
| `closeGateCondition` | `POST /api/v1/transformations/{transformationId}/gate-conditions/{conditionId}/close` | 201, 400, 401, 403, 404, 422 |

**Pinned-count delta, for the orchestrator to reconcile (rule 14, the D-149 precedent).**
- The media-type triple in `contract.test.ts` line 902 goes from `[361, 360, 1]` to **`[363, 362, 1]`**. That is +2 `application/json` request bodies: `decideApprovalRouteStep` and `closeGateCondition`.
- I did **not** edit `contract.test.ts`. On this tree that one assertion fails, and only that one (see §3).
- The rate-limit floor is unchanged: its assertion passes.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **`workflows.test.ts` exception line** (DG2 test, outside §E.2's list). Its convention requires every workflows GET to declare `transformation.read`. ADR-0044 §9 makes the route list `methodology.read`, and the handler checks it (the Studio read rule). Declaring `transformation.read` would be untrue, so I added a commented exception, as for D-108's two catalogue reads. Please accept the line, or tell me the alternative you prefer.
2. **Outbox events not emitted.** `approval_route.step_activated` v1 and `gate_condition.closed` v1 (ADR-0044 §8) have no schema in `packages/shared/src/schemas/events.ts`. That file is not in my ownership; BE-J holds named lines there. workflows also cannot import `jobs/outbox.ts`; the `enqueueGateEvent` precedent writes the row locally. The REQ behaviour does not depend on them: activation work items and the condition item completion happen in the same transaction. **Need:** the two payload schemas as named lines in `events.ts`. A follow-up then emits them from `approval-routes.ts` and `gate-conditions.ts`. There is no consumer yet.
3. **Field-level 400 codes not in ADR-0044 §10** (rule 15). None is a business refusal:
   - `validation.step_no`, "Step number 1–6" (path parameter);
   - `validation.unknown_version`, "Choose a published methodology or procedure version." (listApprovalRoutes, which has no 404 in the contract);
   - `validation.reference`, "Choose evidence of this transformation." (`closeGateCondition.evidenceId`; the key already exists in `problems.json`).
4. **`closeGateCondition` has no `If-Match`.** The contract declares none: it creates the closure, version 1. Concurrency is the UNIQUE `gate_condition_closure_once_key`, mapped to 422 `already_closed`.
5. **Completion rationale.** The canonical `approval_decision.rationale` of a route completion is the deciding step's note. When the note is omitted (the contract makes it optional), it is a fixed English record text: "Every step of route … approved in round n (m steps)." or "Step n of route … recorded <outcome> …". If you prefer a note required for every step outcome, that needs a contract change: `note` required.
6. **No dependency** is needed.

## 6. User-facing texts

No existing en/ar string calls approval routes, condition closure or escalation "planned" or "later". `nav.json` "Approval routes … Sequential and parallel approval routes per procedure or record type." is now true. `gates.json` "Conditions are optional…" stays true for v1. **For the web i18n owner (FE-D)**, the missing texts:
- `myWork.json` `gates__task__gate_condition_overdue`, from the worker's new message key `gates.task.gate_condition_overdue` with params `{gateCode, ordinal, dueDate}`. Proposed en: "Condition {{ordinal}} of the {{gateCode}} decision is overdue since {{dueDate}}". ar (provisional): "الشرط {{ordinal}} من قرار البوابة {{gateCode}} متأخر منذ {{dueDate}}". Until it exists, My Work shows the kind label "Overdue condition of a conditional approval escalated to you" (en/ar present).
- `problems.json` en/ar for: `approval_route.step_not_active`, `approval_route.not_step_approver`, `approval_route.self_decision`, `approval_route.one_step_per_person`, `approval.decide_through_route`, `gate.conditional_approval_disabled`, `gate_condition.already_closed`, `gate_condition.not_owner` (English texts exactly as in ADR-0044 §10), plus `validation.step_no` and `validation.unknown_version`.
- Route step tasks reuse `approvals.task.decide`, with the extra params `stepNo` and `stepRole`. It renders today.

## 7. What remains / known gaps

- **The two outbox events** (§5 item 2).
- **A step whose role has no holder in scope** stays `active` with no work item. Nothing refuses the request. The DG4 escalation scan still reminds the requester, and its routed "current assignee" is then empty. ADR-0044 does not define a refusal. A candidate is a 422 at request time, like `routing.role_unmapped`.
- **Notification urgency.** `gate_condition_overdue` is an urgent *kind* (`0075`). Delivering urgent notifications at once is BE-L's delivery line in `kit.ts`, which runs in parallel. My test asserts the kind's urgency, not the notification's.
- **No web screen.** FE-D owns the approval-routes screen and the conditions list.

## 8. Merge instructions

- No migration to run.
- **Expected conflicts:**
  - `workflows/approvals.ts`: BE-K lines only; no other W9 task edits it.
  - `apps/worker/src/handlers/gates.ts` and `queues/gates.ts`: append-only additions.
  - `packages/shared/src/schemas/index.ts`: one appended line; BE-L appends one too. Keep both.
  - `contract.test.ts`: the pin needs reconciling (§4).
- BE-L (parallel) edits `kit.ts`/`tasks/service.ts`; I did not touch them.
