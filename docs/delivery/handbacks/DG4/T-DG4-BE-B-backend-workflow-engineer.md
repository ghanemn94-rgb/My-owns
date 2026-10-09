# Handback T-DG4-BE-B: slice C groups, role mappings, delegations, approvals and the escalation timer (backend-workflow-engineer)

- **Stage:** P4 / DG4 (BUILDING). **Task:** T-DG4-BE-B, `docs/architecture/p4-work-split.md` §I+C.2.
- **Invocation:** `DG4-T-DG4-BE-B-backend-workflow-engineer-20261009T033605Z-50aa1d4c` (session `50aa1d4c-83ce-425e-970d-8819f49ee948`).
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-B.md` (sha256 `163267b9…cb6c57`, verified).
- **Base:** worktree `/home/user/wt/dg4-be-b`, branch `dg4/be-b`, `HEAD` `bfa1f984fd4fd370ddd4d0e1909c895665186f10`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** `date -u` gave 03:36:17 UTC at the start and 04:36:44 UTC at the end (`end-time.txt`); the final check run ended at 04:34:50.
- **Product gates:** G1–G6 are business approvals inside the product. Every approval in the tests is a demo business approval on synthetic data. No agent, job or seed decides one, and nothing here reads or writes DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/groups.ts` | 7 group routes (ADR-0026 §1). Also `effectiveGroupIds` and `currentGroupMemberIds` (membership "acts as the group" only inside its window). |
| `apps/api/src/modules/access/role-mappings.ts` | 5 routes: `listGovernanceParties`, role mappings, end, resolve preview. Also `resolveParty` (no fallback) and `routeToParty`, which gives 422 `routing.role_unmapped` / `routing.assignee_not_approver` (ADR-0026 §2, §8). Also `userHoldsApprovalDecide`, `approversOf` and `partyLabel`. |
| `apps/api/src/modules/access/delegations.ts` | 4 delegation routes, covering rules 1–9 of ADR-0026 §3. Also the shared `actsFor(db, principal, delegatorId, recordType, target, permission)`, with the capability evaluated at use time against the window, and `delegatorsOf`. `actsOnBehalfOf` (`records.ts`) and its ADR-0015 callers are unchanged. |
| `apps/api/src/modules/access/index.ts` | Exports for the approval service (appended lines only). |
| `apps/api/src/modules/workflows/approvals.ts` | The P4 approval service and 7 routes. **Final interface for BE-C:** `registerApprovalSubject(type, { currentVersion?, onOutcome? })`, `requestApprovalInTx(tx, audit, input)`, `setDecisionRightRouter(router)` / `DecisionRightRouter` / `defaultDecisionRightRouter`, `subjectVersionOf`, `toApprovals`, `APPROVAL_SUBJECT_LOCK_CLASS`, `approvalRefusals`, `StaleApprovalProblem`. |
| `apps/worker/src/handlers/approvals.ts` | `approval.escalation_scan` (`scanOverdueApprovals`). Uses `runOnce` with key `approval.escalate:<id>:<round>:<due>` and `createWorkItemOnce`, with actor `jobActor`. It never decides. |
| `apps/worker/src/handlers/access.ts` | `delegation.expiry_sweep` (`sweepExpiredDelegations`). Uses `runOnce` with key `delegation.expire:<id>`. It changes the displayed status only. |
| `apps/worker/src/queues/{approvals,access}.ts` | Queue specs for the two scheduled queues (standard retry policy and `ops.failed`), plus header comments. These were BE-A stubs marked "filled by BE-B". |
| `packages/shared/src/schemas/{groups,delegations,approvals}.ts` | zod mirrors (requests use the shared S-1 free-text rules). |
| `packages/shared/src/schemas/index.ts` | **3 export lines appended** (merge item, §5). |
| `apps/api/test/support/p4-pending-be-b.ts` | Emptied: all 23 operations are routed. |
| `apps/api/test/integration/contract/p4-exercises-be-b.ts` | Exercises all 23 operations through `ctx.mirrored`, with 23 zod mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | **Pinned-count change** (merge item, §5): request-media-type pin `[155, 154, 1]` → `[167, 166, 1]` (+12 JSON bodies), with a comment line in the BE-A precedent. |
| `apps/api/test/integration/approvals/approval-world.ts` | Test fixture: the P2 world plus BO×2, FIN, the T11 rows, a default calendar, BO and SP mapped, and a decision subject. Also `makeOverdue`, a test clock written with version + audit. |
| `apps/api/test/integration/approvals/approvals.test.ts` | 17 tests: routing, request, decide, resubmit, withdraw, union view. |
| `apps/api/test/integration/approvals/escalation.test.ts` | 4 tests: the timer (REQ-S10-019). |
| `apps/api/test/integration/approvals/adm-not-approver.test.ts` | 3 tests (REQ-S10-003). |
| `apps/api/test/integration/delegations/delegations.test.ts` | 13 tests (REQ-S10-010). |
| `apps/api/test/integration/groups/groups.test.ts` | 9 tests: groups, parties and mappings, and the REQ-S16-011 entity-group test. |
| `docs/delivery/handbacks/DG4/T-DG4-BE-B-evidence/*` | Check logs (§3). |

**No migration** was written. **No route registration file** was touched: the BE-A stubs already registered the four route files.

## 2. Behaviour delivered, per requirement row (acceptance quoted)

- **REQ-S16-011**: "the ERD and migrations contain every entity listed … and an integration test creates and reads each one through the API with authorization enforced".
  - `groups.test.ts` › "REQ-S16-011 …" creates and reads the following through the API, each with a refused caller:
    - Organization: ADM 201, TO 403.
    - BusinessUnit: ADM 201; TO 403; another organization 404.
    - User: ADM 201, TO 403.
    - Group: TO 201; ADM 403; another organization 404.
    - ScopedAssignment: ADM 201 and GET 200; TO 403.
    - Delegation: TO 201 and GET 200; AUD 403 on create and 404 on read.
  - It reads Role and Permission (200; a user without `role.read` gets 403). These two are seeded read-only catalogues; their "create" is the seed (ADR-0026 §10). That reading is the architect's, and I'm stating it here.
  - The ERD and migrations (`0029`) are the architect's (ARCH-01).
- **REQ-S10-008**: "a decision routed to 'Business Owner' reaches the mapped person; an unmapped role blocks routing with a visible error".
  - `approvals.test.ts` › routing:
    - The assignee is the BO-mapped user, who also gets an `approval_decision` task and sees the approval in `GET /approvals`.
    - SteerCo unmapped gives 422 `routing.role_unmapped` with the ADR text. Nothing is written: no audit event and no row.
    - `GET …/role-mappings/resolve?party=STEERCO` returns `status: "unmapped"`.
    - A mapped person who holds no approver role gets 422 `routing.assignee_not_approver`.
  - Mapping a party to a group is covered in `groups.test.ts` and `adm-not-approver.test.ts`: only the group's approver members get the task, and a member decides for the group.
- **REQ-S10-010**: "A delegating to B and B to A is rejected; an approval by B shows 'B on behalf of A' in audit; after expiry B loses the capability".
  - `delegations.test.ts`:
    - A→B then B→A gives 422 `delegation.loop`, even with another scope.
    - A→B→C then C→A is refused. After the B→C delegation is revoked, it is allowed.
    - Two concurrent halves of a loop: exactly one commits.
    - B decides A's approval. The approval and decision rows show `decidedBy = B` and `onBehalfOf = A`. The `audit_event` row has `actor = B` and `on_behalf_of = A`, and so does `GET …/audit` (the audit view's data).
    - A delegation that ended 2 s ago, with no sweep run yet, gives B 403 `approval.not_assignee`. The sweep then sets `expired` once, as the service actor.
    - Also tested:
      - self-delegation and the window rule;
      - an access administrator acting on request (a reason is required, never to themselves);
      - `not_delegator`, AUD 403, If-Match and `not_active` on revoke;
      - the pending-requester rule;
      - "capability is the delegator's": a delegator who has lost `approval.decide` gives the delegate nothing;
      - SoD through a delegation: acting on the requester's behalf gives 403;
      - commit-time denial;
      - an audit event asserted for every write.
- **REQ-S10-014**: "a decision without rationale is rejected; the stored record includes the request version".
  - A rationale of `""`, `"   "` or only invisible characters gives 422 `approval.rationale_required`, with the exact text.
  - The stored `approval_decision` holds `subject_version`, `rationale`, `comments`, `decided_by`, `decided_at` and `business_date`. The approval holds the assignee, the due date (or Unknown with a reason), `decidedAt` and `subjectVersion`.
  - A final approval is immutable: a further decision gives 422 `approval.not_open`.
- **REQ-S10-016**: "the requester approving their own scope change returns 403 under the default policy". The sponsor requests a Business scope change, which routes to SP, i.e. to themselves. Their decision gets 403 `approval.sod_requester` with the exact text. The denial is audited and the approval stays pending.
- **REQ-S10-017**: "approving version 3 after the record moved to version 4 returns 409". The decision is edited to v3, the approval requested at v3, and the decision edited to v4. Deciding with `subjectVersion: 3` returns 409 `approval.stale_version` with `currentVersion: 4`, `requestedVersion: 3` and the exact ADR text. No decision row is written.
- **REQ-S10-018**: "'request changes' returns the item to the requester without closing it; 'defer' requires a new date".
  - `request_changes`: the status becomes `changes_requested` (open). The requester gets an `approval_changes_requested` task, and the assignee's task closes. A resubmit with a newer version opens round 2, which is then rejected.
  - `defer` without a date, or with a past date, gives 422 `approval.defer_date_required`. With `2099-03-02` the status becomes `deferred`, `dueDate` moves, and the assignee's task stays open with the new due date.
  - `approve` and `reject` are final.
- **REQ-S10-019**: "after the due date plus retries, the approval is escalated exactly once and remains undecided".
  - `escalation.test.ts`:
    - Nothing happens before the due date.
    - After the due date: one `approval_escalation` row (BO → SP); `escalation_level` 1; status `pending`; no decision row; audit `approval.escalate` with actor `service`/`worker`; one `approval_escalated` task for SP.
    - 4 sequential re-runs (the same job id, retries, a restart) and 4 concurrent runs add nothing.
    - The escalation target can decide.
    - An exhausted chain (Business scope change, SP only) gives `no_next_authority`. An unmapped SP gives `party_unmapped`. Either way the routing error is visible on the approval, and nothing is decided.
    - A deferral to a new date allows exactly one more escalation for that date.
    - An approval whose due date is Unknown (`no_steerco_scheduled`) is never selected.
- **REQ-S10-003**: "A12: an ADM-only user calling a gate or Finance approval endpoint gets 403". **Partly met; see §4.1.**
  - On this task's endpoint, `decideApproval`, an ADM-only user (ADM_TECH, ADM_ACCESS and ADM_METHOD at the organization) gets **403**, also as a member of the assignee group. The only audit event is `authorization.denied`. A business user who cannot read the transformation still gets 404.
  - The catalogue check: no technical-admin role holds a `business_approval` or `finance_validation` permission.
  - The product-gate decision (G1) and `validateBaseline` (Finance) answer **404** to the same user. The refusal holds and nothing is written, but the literal 403 does not.

Shared rules:

- **S-1:** request text uses `freeText`, `name` and `reason`. A blank rationale is checked with `hasText`.
- **S-2:** strict UTF-8 comes from the platform parser; no route-local parser.
- **S-3:** `config.consumes` is `application/json` on all 12 body routes; the contract media-type test passes.
- **S-4:** every mutation re-checks authorization at commit time (`refreshPrincipal`), validates its input, requires `If-Match` (428/409; creates are version 1) and writes its audit event in the same transaction. Tests cover each.
- **S-5:** no money is stored. Unknown due dates are `NULL` with a reason, never a date.
- **S-6:** work items store `messageKey` plus params.
- **S-11:** the ADR texts are used verbatim.
- **S-13:** `runOnce` and `createWorkItemOnce`; the service actor never decides.
- **S-14:** this task is the approval service.

## 3. Checks actually run (final tree, after the last code change)

All logs are in `docs/delivery/handbacks/DG4/T-DG4-BE-B-evidence/`. Node is 24.21.0 and the run was offline. The harness ports were 23851 (PG) and the pool 23852–23899.

| Command | Exit | Result / counts | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (before starting and at the end) | 0 | `PASS gate DG3 (historical)` | `validate-historical-DG3.log` |
| `pnpm -r typecheck` | 0 | — | `typecheck.log` |
| `pnpm -r build` | 0 | — | `build.log` |
| `pnpm lint` | 0 | eslint `--max-warnings=0` | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (re-run at the end, including this handback) | `prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 405 operations` (contract untouched) | `openapi-lint.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | unit 89 files / **1713 passed**; formula project **259 passed, 2 skipped** | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | **1713 passed**; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| `QA_PG_PORT=23851 MTH_PORT_POOL=23852-23899 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **66 files, 892/892 passed** (base was 846: +46 new tests, namely approvals 17, escalation 4, adm 3, delegations 13, groups 9). The contract test has 44 tests, all passing. No retry, flake or timeout appears in the log. | `integration.log` |

**Disclosed non-zero exits during the work.** Each was fixed and re-run to exit 0; details are in `unit-first-run-failures.txt`.

- The first `pnpm test`, in both locales, exited 1 with 4 failures. All were repository guard tests catching my first draft:
  - computed member keys, in `groups.ts` and `approvals.ts`;
  - lock-class numbers spelled out in comments;
  - `GET /approvals` declared `authenticated` instead of the workflows convention `transformation.read`.
- The first `pnpm -r typecheck` exited 2, from a test destructuring.
- The first `pnpm lint` exited 1, from an unused helper.
- During development, the first contract run failed on the media-type pin (`[167,166,1]` vs `[155,154,1]`). That is the pinned-count change listed in §5.
- One delegation test first failed because it used `limit=200`, which is above the maximum (400 response). The test was fixed.

## 4. Known gaps, divergences and needs for the orchestrator

### 4.1 REQ-S10-003: the literal 403 on the gate and Finance endpoints is not met (not my files)

An ADM-only user holds no `transformation.read`. So the DG1/DG2-approved read gate of `POST …/gates/{code}/decision` (`workflows/gates.ts`) and of `POST …/baselines/{id}/validation` (`kpi`) answers **404** before the approval check.

`adm-not-approver.test.ts` pins this behaviour and states the divergence. I didn't edit those files: they're outside my ownership, and changing their 404 is a DG1–DG3 behaviour change.

For `decideApproval` I implemented the 403 that ADR-0026 §8 states: a caller whose every grant in the approval's organization is a technical-admin role gets 403 instead of 404. Everyone else who cannot read gets 404.

**Decision needed:** either accept 404 as the "refused" form on the DG1–DG3 endpoints (an interpretation of A12), or assign the same narrow "technical-admin-only → 403" rule to the owners of `workflows/gates.ts` and the Finance routes. That second option is a reopen candidate.

### 4.2 Schema need: two `work_item_kind` rows (repair range `0058`–`0069`)

ADR-0026 §4 and §6 call for inbox reminders that no seeded kind fits:

- the requester's reminder when the approval is **approved or rejected**;
- the **requester's and current assignee's** reminder when the timer escalates (naming the delay and any routing error).

BE-A's only creation path is `createWorkItemOnce`, which needs a `work_item_kind` (S-13). I did not insert notifications directly. **These reminders are not created yet.** The routing error is still visible as data on the approval (`escalations[].routingError`) and in the audit event, but not in an inbox.

Proposed migration (orchestrator to number it):

```sql
INSERT INTO work_item_kind (code, owner_module, label_en, label_ar, source_ref) VALUES
  ('approval_outcome', 'workflows', 'Your approval request was decided', 'تم البت في طلب الموافقة الخاص بك', 'M0213'),
  ('approval_overdue', 'workflows', 'An approval you follow is overdue', 'موافقة تتابعها متأخرة', 'M0213');
```

Once it lands, about 15 lines are needed:

- in `decideApproval`, for approve/reject: `createWorkItemOnce` with kind `approval_outcome` and dedupe `approval.outcome:<id>:<round>:<requester>`;
- in `escalateOne`: kind `approval_overdue` for the requester and the current assignee, with dedupe `approval.overdue:<id>:<round>:<due>:<user>`.

### 4.3 The T11 routing seam (BE-C)

`requestApproval` routes through a `DecisionRightRouter`. My `defaultDecisionRightRouter` implements ADR-0026 §5 / D-089 Q6 with the data available today:

- `working_days`: `computeWorkingDayDueDate`, or Unknown `calendar_not_configured`;
- `next_steerco_or_urgent`: urgent means `urgent_working_days` and needs a reason (otherwise 422 `urgent_reason_required` / `urgent_not_configured`); otherwise Unknown `no_steerco_scheduled`, because no `NextForumDateProvider` exists yet;
- `release_plan`: the milestone's `approved_date`, otherwise Unknown `no_release_date`.

**BE-C** owns `routeByDecisionRight` and the SLA computation. It can call `setDecisionRightRouter(routeByDecisionRight)` at registration, or reuse the default. Either way the service is unchanged: the router returns `{ decisionRightId, approvePartyCode, slaType, urgentReason, due }`, and the service resolves the party itself through `routeToParty`.

BE-C registers `governance_matrix_change` with `registerApprovalSubject('governance_matrix_change', { onOutcome })` and requests it through `requestApprovalInTx`.

The escalation job reads the chain from `transformation_decision_right.escalation_chain`. For approvals without a T11 row it uses `[assignee party, SP]` (D-089 Q7).

### 4.4 Interpretations (no ADR text; flagged for review)

- **Extra refusal codes.** Some field-level checks have no code in the ADR, so I added these. FE-A needs i18n keys for them:
  - groups: `group.code_taken`, `group.member_exists`, `group.member_other_organization` (all three are named in the OpenAPI summaries), `group.owner_invalid`, `group.archived`, `group.member_removed`, `group.member_window_invalid`;
  - role mappings: `role_mapping.party_unknown`, `role_mapping.target_invalid`, `role_mapping.ended`;
  - delegations: `delegation.delegate_unknown`, `delegation.scope_invalid`;
  - approvals: `approval.decision_right_unknown`, `approval.subject_unknown`, `approval.calendar_not_configured`.
  - A resubmit of an approval that isn't `changes_requested` uses `invalid_transition`.
- **Rule 2 (the caller holds `approval.decide`) also applies to a delegate,** as the ADR's check table says. So a delegate must hold SP, BO or FIN in the transformation. The capability check additionally requires the delegator to hold it, at use time.
- **A deferral of a working-days approval whose due date was Unknown** stamps the organization's default calendar, to satisfy `approval_working_day_calendar`. If there is none, it gives 422 `approval.calendar_not_configured`.
- **A deferral replaces the assignee's dated task:** the old one is cancelled and a new one created with the new due date. This keeps to BE-A's services; a domain module never updates `work_item`.
- **`resubmit` keeps the assignee and the due date.** Round 2 can therefore be escalated at once if the date has already passed. The ADR doesn't say.
- **Escalation:** in the 0031 CHECK, `approval_escalation.level` must be at least 1 even when there is no target. A routing-error row records `level = current + 1`; the approval's own level only rises when a target was found.
- **`listMyApprovals` (role `assignee`)** includes approvals assigned or escalated to people who delegate to the caller, whatever the delegation's scope or record types. Deciding still checks them in full.
- **Delegations recorded on request** need `reasonText` (400 if missing). The audit event's `reason` says so.

### 4.5 What remains

Nothing else in my section is open: all 23 operations are routed and exercised, the pending list is empty, and both jobs are implemented and tested.

The open items are §4.1 (an orchestrator decision) and §4.2 (a migration number, then about 15 lines). The separable second half named in the work split (approvals and the escalation timer) was **completed**.

## 5. Merge instructions

1. **No migration.** §4.2 asks for one from the repair range.
2. **Lines outside the strict ownership list**, each an append following the precedents:
   - `packages/shared/src/schemas/index.ts`: 3 `export *` lines (groups, delegations, approvals), in the KBE-B/KBE-C precedent.
   - `apps/api/src/modules/access/index.ts`: appended exports for the approval service.
   - `apps/api/test/integration/contract/contract.test.ts`: the media-type pin `[155,154,1]` → `[167,166,1]`, plus a comment, in the BE-A precedent.
   - `apps/worker/src/queues/{approvals,access}.ts`: the queue specs that the BE-A stubs assigned to BE-B.
   - `apps/api/test/integration/approvals/approval-world.ts`: a non-test helper in my test directory. `p4-exercises-be-b.ts` imports it.
3. **Expected conflicts:**
   - `contract.test.ts` pin, if another W3 task also adds JSON bodies. Add the counts.
   - The `index.ts` append lines.
4. **Merge order:** BE-C integrates after this. Its approval needs are met by the interfaces listed in §1 (`approvals.ts` row).
5. **The worker** now starts handlers for `approval.escalation_scan` and `delegation.expiry_sweep` (`DOMAIN_HANDLERS`), so `syncSchedules` schedules both seeded rows. The existing `schedules.test.ts` passes its own handled set and is unaffected (integration 892/892).
