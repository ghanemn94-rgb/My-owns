# Handback T-DG4-BE-B2 (backend-workflow-engineer): the REQ-S10-003 literal 403 and the approval reminders

- **Stage:** DG4 (BUILDING). **Task:** T-DG4-BE-B2. **Scheduled by:** D-094 (it reads D-089 and BE-B handback §4.1/§4.2).
- **Invocation:** `DG4-T-DG4-BE-B2-backend-workflow-engineer-20261009T054133Z-9f68726a`, session `9f68726a-049b-4e3f-b9cb-95cd26893850`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-B2.md`, sha256 `0d1e3472…29632ee` (verified).
- **Base:** `b48147a8f2a89b7002cc1591b3052fe67de7664f` on branch `dg4/be-b2`. The changes are **uncommitted**, as the assignment asks.
- **Time:** started 05:41:49 UTC, ended 06:14:32 UTC (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0. I ran it before starting and again at the end.

No real business, Finance or IT approval was granted. All test data is synthetic. Product gates G1–G6 are unrelated to DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/technical-admin.ts` (new) | The shared helper. `TECHNICAL_ADMIN_ROLES`, `isTechnicalAdminOnly(principal, orgId)` (moved here from `approvals.ts`, unchanged) and `technicalAdminRefusal(principal, err, permission)`. The last one maps a read-gate refusal to 403 `forbidden` only for a technical-admin-only caller. |
| `apps/api/src/modules/access/index.ts` | Exports the three names above. |
| `apps/api/src/modules/workflows/approvals.ts` | Uses the shared `isTechnicalAdminOnly`; its local copy is removed and its behaviour is unchanged. On approve or reject, it creates the requester's `approval_outcome` reminder with `createWorkItemOnce`. |
| `apps/api/src/modules/workflows/gates.ts` | `decideGate` read gate: wraps `requireTransformationRead` with `technicalAdminRefusal(…, "gate.decide")`. |
| `apps/api/src/modules/kpi/baselines.ts` | `validateBaseline` read gate: wraps `writeScope` with `technicalAdminRefusal(…, "finance.validate")`. |
| `apps/api/src/modules/kpi/value-pools.ts` | `validateValuePool`: the same wrap. |
| `apps/api/src/modules/transformations/register-kit.ts` | `openWrite` gets an opt-in option, `technicalAdminRefusal?: Permission`. When it is unset (every other caller of `openWrite`), the code path is unchanged. |
| `apps/api/src/modules/kpi/business-cases.ts` | `validateBusinessCaseBaseline` passes `technicalAdminRefusal: "finance.validate"` (one line). |
| `apps/api/src/modules/kpi/formula-versions.ts` | `validateBenefitFormulaVersion` passes `technicalAdminRefusal: "finance.validate"` (one line). |
| `apps/worker/src/handlers/approvals.ts` | `escalateOne` creates `approval_overdue` reminders for the requester and the current assignee in every case, whether the escalation found a target or hit a routing error. The overdue re-check now also returns today's business date, which names the delay. |
| `packages/db/migrations/0058_p4_approval_reminder_kinds.sql` (new) | The two `work_item_kind` rows. The Arabic is marked PROVISIONAL. |
| `packages/db/src/seed.test.ts` | Updates the migration-id pin. The planned ids (< 0058) stay contiguous from 0001, and repair ids must sit in 0058–0069 (D-089). The old pin required 1..N contiguity, so it failed with 0058 present before 0047–0057 land (§3.3). |
| `apps/api/test/integration/approvals/adm-not-approver.test.ts` | Pins the 403 on five endpoints, replacing the old 404 divergence. Adds the unchanged-caller matrix (§2.1). |
| `apps/api/test/integration/approvals/reminders.test.ts` (new) | 7 tests for the reminders (§2.2). |
| `apps/api/test/integration/approvals/escalation.test.ts` | BE-B's assertion "every work item of the approval is `done` after the decision" is narrowed to the approver task kinds. The new reminders stay `open` by design, and the test now pins them. |
| `docs/delivery/handbacks/DG4/T-DG4-BE-B2-evidence/*.log` | Command logs (§3). |

Not changed, because nothing needed it:
- `packages/db/src/schema.ts`: no new column or table.
- `packages/db/test/integration/catalogue.test.ts`: no new table, grant or guard.
- The contract `docs/api/openapi.yaml`: every affected operation already declares 403 (§2.1).

## 2. Behaviour delivered

### 2.1 REQ-S10-003: "A12: an ADM-only user calling a gate or Finance approval endpoint gets 403"

**The rule (D-094).** The caller must fail the read gate on `transformation.read`, and their **every** grant in the transformation's organization must be a technical-admin role (`ADM_TECH`, `ADM_ACCESS`, `ADM_METHOD`, taken from the `ROLES` catalogue `kind = technical_admin`). Such a caller gets:
- 403;
- `type urn:mth:problem:forbidden`;
- `code forbidden`;
- `detail "You do not have permission for this action."`.

This is exactly `problems.forbidden()`, the same problem `decideApproval` uses. The denial is re-stated for the approval right, so the failed-mutation audit records `authorization.denied … requires gate.decide | finance.validate` on the transformation. Every other error passes through unchanged.

**Endpoints whose ADM-only response changed** (before: measured on the base commit in a disposable clone, log `baseline-HEAD-adm-probe.log`; after: `integration.log`):

| Operation | Route | Before (ADM-only) | After (ADM-only) |
|---|---|---|---|
| `decideGate` | `POST /transformations/{id}/gates/{gateCode}/decision` | **404** `not_found` | **403** `forbidden` "You do not have permission for this action." |
| `validateBaseline` | `POST /transformations/{id}/baselines/{baselineId}/validation` | **404** `not_found` | **403** `forbidden` (same text) |
| `validateValuePool` | `POST /transformations/{id}/value-pools/{valuePoolId}/validation` | **404** `not_found` | **403** `forbidden` (same text) |
| `validateBusinessCaseBaseline` | `POST /business-cases/{id}/baseline-validation` | 403 `forbidden` "Your access to this record changed while the request was in progress." (commit-time read gate) | 403 `forbidden` "You do not have permission for this action." (**status and code unchanged; only the detail text changed**) |
| `validateBenefitFormulaVersion` | `POST /benefit-formulas/{id}/versions/{versionNo}/validation` | 403 `forbidden`, the commit-time text above | 403 `forbidden`, the decideApproval text (detail text only) |

`decideApproval` was already 403 (BE-B) and is unchanged. All six operations already declare 403 in the contract (`200|201,400,401,403,404,409,422,…`), so **no contract change** was needed.

**Other callers are unchanged.** The test `unchanged: a reader without the approval right, AUD, a non-member, …` pins status and code for 7 callers × 5 endpoints. **It passes identically on the base commit**: the same test file ran in a disposable clone of `b48147a` with the old route code (`baseline-HEAD-adm-not-approver.log`). There the only failure is the A12 test, at the old 404. The 7 callers:
- the transformation's TL, who reads but holds no approval right: 403 `gate.not_approver` or 403 `forbidden`;
- AUD: the same;
- TO of another organization (non-member): 404, or the commit-time 403 on the two `openWrite atCommit` endpoints;
- a user without grants: the same;
- an org TL who cannot read this transformation: the same;
- a **mixed** user holding ADM_TECH plus TL at an unrelated business unit, who is not technical-admin-only: the same;
- an ADM_TECH of **another** organization, with no grant in the target organization: the same.

**Gate and Finance endpoints found and deliberately not changed:**
- `POST …/gate-dispensations/{id}/decision` and `…/revoke` (`gate.decide`, `portfolio/dispensations.ts`). They already answer 403 to an ADM-only caller through the commit-time read gate, so A12's literal status holds, and D-094 names only the gate decision on the gate side. I left them untouched to keep the reopen narrow. If the orchestrator wants the identical text there, it is a one-line `technicalAdminRefusal: "gate.decide"` on their `openWrite` calls.
- `POST /transformations/{id}/benefits/{benefitId}/baseline-validation` (`decideBenefitBaseline`, P4 slice B). It is in the contract, but `benefits/finance-validation.ts` is still a stub owned by **KBE-E**, so there is no route to change. Slice B's `register.ts` pattern already answers 403 to technical admins (`holdsAnywhere` first). **KBE-E should keep that, or pass `technicalAdminRefusal`.**
- The other `business_approval` permissions are not "gate or Finance" endpoints and are out of D-094's scope: `kpi_target.approve`, `portfolio.select`, `prioritization.approve`, `funding.approve`, `executive_decision.decide`. Not touched.

### 2.2 The approval reminders (ADR-0026 §4, §6; D-094 (2); migration 0058)

**`approval_outcome`.** In `decideApproval`, on approve or reject only, `createWorkItemOnce` runs:
- for the requester;
- with kind `approval_outcome`, `messageKey` `approvals.task.outcome`, and params `{title, roundNo, outcome}`;
- with dedupe key `approval.outcome:<id>:<round>:<requester>`;
- with the deciding user as the audit actor, inside the deciding transaction.

It creates one work item plus one inbox notification, each with its audit event.

**No reminder on defer or request-changes.** ADR-0026 §4, "Outcome behaviour", quoted:
- approve: "The requester gets an inbox reminder.";
- reject: "The requester gets a reminder.";
- request changes: "Returns to the requester: a work item `approval_changes_requested` for the requester." This is its own, pre-existing kind, unchanged;
- defer: "The assignee's task stays open with the new due date." It names no requester reminder.

So defer and request-changes create none. I added nothing beyond the ADR.

**`approval_overdue`.** In `escalateOne`, in every case (a target found, or `no_next_authority`, `party_unmapped` or `party_not_approver`), `createWorkItemOnce` runs for:
- the requester;
- the current assignee: the assignee user, or the assignee group's current members who hold `approval.decide`, the same rule BE-B uses for the group's tasks.

It uses kind `approval_overdue` and dedupe key `approval.overdue:<id>:<round>:<due>:<user>`. The `messageKey` is `approvals.task.overdue`, or `approvals.task.overdue_routing_error` when routing failed. The params name the delay and the error:

```
{title, roundNo, dueDate, overdueAsOf, level, escalatedToParty, routingError, routingParty, recipientRole}
```

The delay is named by business dates: overdue since `dueDate`, as of `overdueAsOf`, which is today's business date in the approval's calendar timezone, or else the organization's. No day count is computed, so no elapsed days appear where working days apply. The reminders sit in the same `runOnce` transaction as the escalation row, behind its ledger key and the `approval_escalation_once` unique key, and behind their own `(organization_id, dedupe_key)` key.

**Tests** (`reminders.test.ts`, 7, all pass), each against a real PostgreSQL:
- approve creates exactly one reminder for the requester, with its notification and audit. It is visible in the requester's `/me/inbox` and not in the decider's. A refused second decision adds nothing;
- reject creates exactly one;
- defer, then request-changes, create none. After resubmit, approve in round 2 creates one, keyed by round 2;
- an escalation creates one reminder each for the requester and the BO assignee. Retries, a restart and 3 concurrent scans add nothing. The timer decides nothing: no outcome reminder is created and the status is unchanged;
- a routing error (`no_next_authority`) is named in both reminders;
- a deferral to a new date gives one more reminder per person, keyed by the new due date;
- with a group assignee, the group's current approver gets a reminder and a non-approver member gets none.

**The Arabic labels are PROVISIONAL** ('تم البت في طلب الموافقة الخاص بك', 'موافقة تتابعها متأخرة') and marked so in 0058.

## 3. Checks actually run (final tree, after the last code change)

The environment was this worktree with Node and pnpm as installed, and PostgreSQL 16.13 disposable clusters on the harness ports 23400–23449.

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` | `PASS gate DG3 (historical)`, **exit 0** | `validate-dg3-historical.log` |
| `pnpm -r typecheck` | **exit 0** | `typecheck.log` |
| `pnpm -r build` | **exit 0** | `build.log` |
| `pnpm lint` | **exit 0** (`--max-warnings=0`) | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | "All matched files use Prettier code style!", **exit 0** | `prettier.log` |
| `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 485 operations`, **exit 0** | `openapi-lint.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 102 files / **2049 passed**; plus 3 files / **259 passed, 2 skipped**; **exit 0** | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | the same counts, **exit 0** | `unit-c-utf8.log` |
| `QA_PG_PORT=23400 MTH_PORT_POOL=23401-23449 tests/qa/support/with-pg.sh pnpm test:integration` | 47 migrations applied; **76 files, 975/975 passed**; **exit 0** | `integration.log` |

The 975 integration tests are D-097's 967, plus 1 new ADM test (the old single G1/Finance test became 2), plus 7 reminder tests.

The prettier and lint logs were produced before I wrote this handback. Prettier was re-run on this file afterwards; see §3.4.

### 3.1 Disclosed non-zero exits and failures (all fixed before the final runs above)

1. **The first targeted integration run** (`approvals-first-run.log`, `vitest run --project integration apps/api/test/integration/approvals/`) **exited 1: 31 passed, 1 failed.** BE-B's `escalation.test.ts` asserted that every work item of the approval is `done` after the decision. The new reminders stay `open` by design: they are informational, and their owner dismisses them.

   **Fix:** I narrowed the assertion to `approval_decision`/`approval_escalated` and pinned the reminders explicitly. It is a test-only change in BE-B's file of the same feature.

2. **The first `pnpm test` in both locales exited 1: 2 failed, 2047 passed.**
   - (a) `packages/db/src/seed.test.ts` "strictly increasing ids". The pin required ids 1..N contiguous, and 0058 is in the D-089 repair range before 0047–0057 exist. **Fix:** the pin now checks that planned ids (< 58) are contiguous and that repair ids stay within 58–69.
   - (b) `apps/api/src/architecture.test.ts` found a stray `apps/api/src/modules/.claude/` directory. Empty `.claude/.cc-writes` directories were created by the agent tooling in each directory my shell `cd`'d into, and were not part of my change. **Fix:** I removed the five empty directories with `rmdir`, which fails on anything non-empty, and ran every later command from the repository root.

   Both re-runs exited 0 (table above).

3. **The baseline clone run** (`baseline-HEAD-adm-not-approver.log`) **exited 1 on purpose.** It is the new ADM test run against the **old** route code: the A12 test fails at the old 404, and the "unchanged" matrix passes. That shows that only the ADM-only response changed. The probe run (`baseline-HEAD-adm-probe.log`, exit 0) printed the five "before" values used in §2.1.

   The clone was `git clone` of this worktree at `b48147a`, with `node_modules` symlinked from this worktree, so workspace packages such as `@mth/db` resolve to this tree. The test file was copied in, plus a log-only probe test that exists only in the clone.

No test was flaky, and no timeout occurred.

### 3.2 Output tails

```
integration.log:   Test Files  76 passed (76)
                        Tests  975 passed (975)          EXIT=0
unit (both):       Test Files  102 passed (102) / Tests 2049 passed (2049)
                   Test Files  3 passed (3) / Tests 259 passed | 2 skipped (261)   EXIT=0
baseline probe:    BASELINE-ADM decideGate (G1) 404 not_found null
                   BASELINE-ADM validateBaseline 404 not_found null
                   BASELINE-ADM validateValuePool 404 not_found null
                   BASELINE-ADM validateBusinessCaseBaseline 403 forbidden "Your access to this record changed while the request was in progress."
                   BASELINE-ADM validateBenefitFormulaVersion 403 forbidden "Your access to this record changed while the request was in progress."
```

### 3.3 Migration numbering note

0058 is applied after 0046 in this tree (`applied 47 migrations`). The migrator (`packages/db/src/migrate.ts`) applies pending files in file order and has no ordering refusal. So 0047–0057 landing later on a database that already has 0058 is applied cleanly. 0058 depends only on 0028's `work_item_kind` table.

### 3.4 Prettier on this handback

I ran `npx prettier --check docs/delivery/handbacks/DG4/T-DG4-BE-B2-backend-workflow-engineer.md` after writing this file. The result is in `prettier-handback.log`.

## 4. Known gaps, interpretations and notes

1. **"Current assignee" for the overdue reminder** means the approval's assignee: the user, or the assignee group's current approver members. It does not include an earlier escalation target, who already holds an `approval_escalated` task. ADR-0026 §6 says "the current assignee", singular. Flagged for review.
2. **Reminders are not closed automatically.** `approval_overdue` and `approval_outcome` items stay `open` after the approval closes; their owner completes them in My Work. Neither kind is in `SYSTEM_MANAGED_KINDS`, so the owner can mark them done. No ADR text requires auto-closing.
3. **Web i18n:** the message keys `approvals.task.outcome`, `approvals.task.overdue` and `approvals.task.overdue_routing_error` are new. No web catalogue holds any `approvals.task.*` key yet, and BE-B's keys aren't there either. FE needs to translate them, in both EN and AR.
4. **Changes outside the listed "may edit" files, by necessity:**
   - `transformations/register-kit.ts`: the opt-in `openWrite` option, which is the shared read gate of the two `openWrite` Finance routes. It is inert for every other caller.
   - `escalation.test.ts`: §3.1 (1).
   - `seed.test.ts`: the assignment's "seed test pins".
   - `approvals.ts`: the helper moved to `access/`.
5. **Dispensation endpoints and `decideBenefitBaseline`:** see §2.1. They are not changed, and the reasons are given there.
6. **D-094's watch item ("BE-B2 finds the narrow rule affects another caller"):** none was found. The 7-caller matrix is identical before and after.

## 5. Merge instructions

- **Migration:** `packages/db/migrations/0058_p4_approval_reminder_kinds.sql` (D-094, repair range). Run `mth-db migrate`. It is an INSERT into `work_item_kind` only, with no DDL, and is safe in any order relative to 0047–0057.
- **Endpoints added:** none. **Endpoint behaviour changed:** the five in the §2.1 table, for ADM-only callers only.
- **Expected conflicts:**
  - `apps/worker/src/handlers/approvals.ts` and `workflows/approvals.ts` if BE-C (T11 routing seam) edits `escalateOne`/`resolveNext` or `decideApproval`'s downstream block;
  - `packages/db/src/seed.test.ts` if a planned migration task also edits the id pin;
  - `transformations/register-kit.ts` `OpenWriteOptions` if another task adds an option. Keep both.
- The changes are left uncommitted in `/home/user/wt/dg4-be-b2` on `dg4/be-b2`.
