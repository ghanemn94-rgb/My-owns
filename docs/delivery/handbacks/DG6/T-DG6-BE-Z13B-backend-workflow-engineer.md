# T-DG6-BE-Z13B handback: id-bearing keys, channel fan-out, action register (D-227) (backend-workflow-engineer)

- **Stage:** DG6 (P6), FIXING after review round 8. This is an engineering delivery gate only. Nothing here grants or implies a product gate G1–G6 or any business, Finance or IT approval. All test data is SYNTHETIC.
- **Invocation:** `claude-code-cli-session`, run `DG6-T-DG6-BE-Z13B-backend-workflow-engineer-20261108T215900Z-36bdd126`, session `36bdd126-a63f-42e6-aa91-819e3a21f3e9`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z13B.md`. Its sha256 `4fd4d515…80b92` was verified at the start.
- **Base:** branch `dg6/be-z13b` at `055388ab4e8d66eb792901d454d111784d634b19`, clean tree at the start. Changes are left **uncommitted**.
- **Time:** started `2026-11-08T21:59:11Z`. The end time is in §8.
- **Decision implemented:** D-227 (1), (2) and (3). An author never closes their own finding: verification is for the reviewers.
- **Migrations:** none. **New dependencies:** none. **New endpoints:** none. **New operations:** none.

## 1. Changed files

### API (`apps/api/src`)

| File | Purpose |
| --- | --- |
| `modules/access/sensitive-reach.ts` | D-227 (1). Three new helpers. `maskHiddenIds(text, hidden)` replaces each hidden uuid in a text with `RESTRICTED_ID_MARKER`. `hiddenIdsInTexts(db, principal, texts)` returns the ids among the texts' uuids that name a sensitive record or any `SENSITIVE_CHILD_SOURCES` child the reader is not admitted to (via `restrictedIdsAmong`; one decision). `maskRestrictedIdsInFields(db, principal, items, fields)` masks top-level text fields and sets `includesRestrictedRecords: true` on an item where anything was masked. |
| `modules/access/index.ts` | Exports the three helpers. |
| `modules/automation/failures.ts` | `shownFailures` / `shownFailure`. `idempotencyKey` and `errorMessage` are masked on `listAutomationFailures`, `getAutomationFailure`, `retryAutomationFailure` and `dismissAutomationFailure`. |
| `modules/automation/executions.ts` | `shownExecutions`. `triggerKey`, every `actionResults[].idempotencyKey` and `errorDetail` are masked on `listAutomationExecutions` and `getAutomationExecution` (`loadExecutionForRead`). |
| `modules/integrations/routes.ts` | `shownRuns`, `shownRun`, `shownConnector` (`lastRun`), `shownWrite` and `shownWriteDetail`. `IntegrationRun.idempotencyKey` and `OutboundWrite.idempotencyKey` are masked in every response that serializes them (§2.1 lists the operations). |
| `modules/integrations/connectors.ts` | `IntegrationRunBody.includesRestrictedRecords?: true`. |
| `modules/raid/corrective-cases.ts` | `shownCases` / `shownCase`. `CorrectiveCase.sourceScopeKey` is masked on list, create, get, update and close. |
| `modules/tasks/deep-links.ts` | D-227 (3). `correctiveCasesOfActions(db, ids)` maps an action id to its corrective case. `restrictedWorkItems` (subject and link) and `restrictedNotifications` (link, params and stored target) treat an action id as naming its case, so the task and notification of an action on a restricted corrective case are restricted. |

### Worker (`apps/worker/src`)

| File | Purpose |
| --- | --- |
| `sensitive-children.ts` (new) | D-227 (2). `SENSITIVE_CHILD_SOURCES_TWIN` mirrors the API map; a test pins the two deep-equal. `sensitiveOwnersOfIds` resolves each id to its owners: the three sensitive types, every child source (column, pair, form pair, via), an action on a corrective case, and the parents of an evidence item. `restrictedForRecipient` checks the "marked sensitive, no active explicit grant" rule. It imports no API code. |
| `handlers/notifications.ts` | `recipientCanRead` now collects every uuid in the link, the message params, the stored target and the announced work item (subject and link), and applies `restrictedForRecipient`. A restricted send uses `inbox.restricted` with params `{}` and the transformation home link (else `/my-work`), and **issues no link token**. `NotificationChannelDeps.catalogue` is new (default `DEFAULT_CHANNEL_CATALOGUE`), so a test can prove that templates which would render codes are not used for a restricted recipient. New exports: `RESTRICTED_MESSAGE_KEY`, `restrictedChannelLink`. |

### Shared and contract

| File | Purpose |
| --- | --- |
| `packages/shared/src/schemas/sensitivity.ts` | `RESTRICTED_ID_MARKER = "[restricted]"`. |
| `packages/shared/src/schemas/automation.ts` | `automationExecution.includesRestrictedRecords` and `operationalFailure.includesRestrictedRecords` (optional literal `true`). |
| `packages/shared/src/schemas/corrective.ts` | `correctiveCase.includesRestrictedRecords` (optional literal `true`). |
| `docs/api/openapi.yaml` | Optional `includesRestrictedRecords: {type: boolean, const: true}` with a description on `AutomationExecution`, `OperationalFailure`, `IntegrationRun`, `OutboundWrite` and `CorrectiveCase`. Additive. |

### Tests

| File | Purpose |
| --- | --- |
| `apps/api/test/integration/access/served-keys-restricted-z13b.test.ts` (new, 6 tests) | D-227 (1), with real producers. The worker's `captureJobFailure` creates a job failure whose key is `benefit.variance_evaluated:<measurementId>` and whose error text names the benefit; ADM_TECH alone reads it (list, get, dismiss). The worker's `raid.corrective_benefit` handler as `DOMAIN_HANDLERS` registers it runs a real starter execution; AUD reads it (list, get). `runConnector` with an Idempotency-Key naming the benefit: the response, `listIntegrationRuns`, `getIntegrationRun` and the connector's `lastRun` (AUD). `executeOutboundWrite` with a key naming the benefit: AUD reads list and detail. A Value Review corrective case whose `findingRef` names the benefit: FIN reads list and get. Every response is checked to contain neither the hidden id nor the measurement id, and the stored rows to be unchanged. Negative checks: an unrelated key is untouched; other-organization readers get 404; AUD gets 404 on a job failure. Positive check: after an explicit grant, the real keys come back and the marker is gone. |
| `apps/api/test/integration/tasks/action-register-restricted-z13b.test.ts` (new, 6 tests) | D-227 (3), with real producers. The worker's corrective consumer opens the case. An admitted TL creates the action through `createCorrectiveCaseAction`, owned by `bo2`, who is not a party and holds no grant. Checked: the owner's 404 on the case; register list and item rows show `correctiveCaseId: null` plus the marker and no case id or code. `listMyWorkItems`, `getWorkItem`, `/me/work` and `listMyInbox` show `inbox.restricted`, params `{}`, `subjectId: null`, the home link and the marker, with no case code, action id or `/action-register/` link. Negative: an action on an open RAID entry keeps its `sourceCode`. Positive: after a grant, the case code and the action link come back. |
| `apps/api/test/integration/tasks/channel-fanout-restricted-z13b.test.ts` (new, 7 tests) | D-227 (2) and (3), with the e-mail channel **enabled** (in-process fake SMTP) and a catalogue whose templates would render `{{benefitCode}}`, `{{benefitACode}}`, `{{sourceCode}}` and `{{title}}`. Covers a Finance validation (worker producer shape), a benefit overlap (the real `POST /benefit-overlaps`) and an action on the restricted case (the real `createCorrectiveCaseAction`). Each message carries `inbox.restricted` and the home URL, and contains no code, child id, `/links/` or `/action-register/`; no token is issued. Control: an open benefit's message renders its template and a `/links/<token>` deep link. Positive: after a grant, the Finance message renders its template again. Also asserts `SENSITIVE_CHILD_SOURCES_TWIN` deep-equals `SENSITIVE_CHILD_SOURCES`. |
| `apps/api/test/support/sensitive-reference-inventory.ts` | 71 new kind-`"text"` rows, one for every text column named `key` or `*_key` in the migrated schema. Redacted (6, each exercised by the new test): `operational_failure.idempotency_key`, `automation_execution.trigger_key`, `automation_action_result.idempotency_key`, `integration_run.idempotency_key`, `outbound_write.idempotency_key`, `corrective_case.source_scope_key`. The rest are holder-restricted, cannot-name (codes, or keys whose writers build them from non-sensitive ids) or not-served, each with its reason. |
| `apps/api/test/integration/access/sensitive-reference-inventory.test.ts` | The catalog's text pattern widens from `(^|_)(link_path|href)$` to `(^|_)(link_path|href|key)$`. The text floor rises to 73. `KNOWN_OPEN` and `KNOWN_PENDING` are still pinned **empty**. |

## 2. Behaviour per requirement row

**REQ-S10-002**. Acceptance text, quoted: "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant". D-218, D-222 (1), D-226 and D-227 apply.

**REQ-S12-023** (channel part). Acceptance text, quoted: "A21: with no email adapter configured all workflows complete and notifications appear in the inbox". This is unchanged: with no enabled channel nothing is written, and `channel-fanout.test.ts` still passes. What changes is what an **enabled** channel sends for a restricted target.

### 2.1 Served keys (D-227 (1))

- A hidden id inside a served key, or inside the error text next to it, becomes `[restricted]`, and the item carries `includesRestrictedRecords: true`. A hidden id here means a sensitive benefit, business case or evidence item, or any child that carries one's values: a measurement, Finance validation, overlap, corrective case and so on. The stored row never changes, and a reader who is admitted sees the real key.
- Where it applies:
  - `OperationalFailure` (`idempotencyKey`, `errorMessage`): list, get, retry, dismiss.
  - `AutomationExecution` (`triggerKey`, `actionResults[].idempotencyKey`, `errorDetail`): list, get.
  - `IntegrationRun.idempotencyKey`: `listIntegrationRuns`, `runConnector`, `getIntegrationRun`, `retryIntegrationRun`, `testConnector`, and `lastRun` on `listConnectors`, `createConnector`, `getConnector`, `putConnector`, `enableConnector` and `disableConnector`.
  - `OutboundWrite.idempotencyKey`: `listOutboundWrites`, `executeOutboundWrite` (also on replay), `getOutboundWrite`, `confirmOutboundWrite`.
  - `CorrectiveCase.sourceScopeKey`: list, create, get, update, close.
- **Inventory:** every text `key` / `*_key` column of the migrated schema is classified, 71 rows. The catalog finds 73 text columns, including the two link columns from BE-Z13. Zero open, zero PENDING.
- **Why integration and corrective keys are included although D-227 names only three columns.** The inventory found them, and D-227 says "and any other served text column the inventory finds". The system builds integration keys from non-sensitive ids, but they embed the caller's text: `manual:<userId>:<Idempotency-Key>`, and the outbound caller's own key. The Value Review scope key embeds the case creator's finding reference. Free text can hold any id, so these keys are masked the same way, as D-223 does for automation literals.

### 2.2 Channel fan-out (D-227 (2))

- `recipientCanRead` now applies the child-source check: every uuid in the notification's link, params, stored target and announced work item is resolved through the worker's twin of `SENSITIVE_CHILD_SOURCES`. That covers `finance_validation`, `benefit_overlap` and every other child source, plus an action on a corrective case and evidence parents.
- A restricted send carries `inbox.restricted`, no params, and the transformation home link (else `/my-work`), and it issues **no** link token.
- **The decision is fail-closed.** Only an active explicit grant admits; the ADR-0051 §2 party clause is not restated, as before. So a party without an explicit grant gets the restricted text by e-mail, while the inbox shows them the full text. The worker can hide more than the API, never less.
- **Enterprise messaging (Teams) was not sent in the test.** No adapter ships in this release, and the database refuses an enabled row (`notification_channel_no_messaging_adapter`). Every channel kind goes through the same `sendDelivery` render path, which the e-mail test exercises.
- **Correction to the BE-Z13 handback §7 item 2.** By code reading, the shipped catalogue has no per-key templates (`DEFAULT_CHANNEL_CATALOGUE.messages` is empty), so the e-mail body never carried the benefit code. What it did carry, for a child-source target, was the generic "new notification" text and a `/links/<token>` deep link to the record. That link re-authorizes on open. Both are now replaced. The new test injects templates to prove the guarantee holds even when templates exist.

### 2.3 Action register (D-227 (3))

- **Verified, already correct (BE-Z12):** register list and item rows and the register report. Rows keep `sourceKind: "corrective_case"` with `correctiveCaseId: null` and the marker. The report's action rows carry no case id or code.
- **Repaired:** the owner's task (`raid.task.action_due`, `{sourceCode: <case code>}`, link `/action-register/<actionId>`) and its notification were **not** restricted before, because neither names the case id. `restrictedWorkItems` and `restrictedNotifications` now treat the action id as naming its case. As a result, `listMyWorkItems`, `getWorkItem`, `/me/work`, `listMyInbox`, `markInboxNotificationRead` and the deep-link resolution all redact them. In the worker, `sensitiveOwnersOfIds` does the same for the channel send.

## 3. Checks actually run

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, harness ports 31200–31249. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z13B-evidence/`.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `00-validate-historical-DG5.log` |
| 1 | `pnpm -r typecheck` | 0 | clean | `30-typecheck.log` |
| 2 | `pnpm -r build` | 0 | clean | `34-build.log` |
| 3 | `pnpm lint` | 0 | clean (`--max-warnings=0`) | `31-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 123, then 0 | First run: **exit 123** (6 of my files unformatted; see note a). After `prettier --write` on those 6 files the re-run exits 0 (§8). | `32-prettier.log`, `92-prettier-final.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `33-openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LANGUAGE pnpm test` | 0 | unit-node **190 files / 2899 passed**; unit-web **123 / 2086 passed**; unit-formula-nocodegen **3 / 259 passed, 2 skipped** | `40-pnpm-test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts in every invocation | `41-pnpm-test-c-utf8.log` |
| 8 | before-fix: `tests/qa/support/with-pg.sh npx vitest run --project integration <the 3 new files + the inventory test>` on the HEAD sources (§3.1) | 1 (expected) | **14 failed / 7 passed** (4 files) | `10-before-fix.log` |
| 20 | after-fix: `QA_PG_PORT=31203 tests/qa/support/with-pg.sh npx vitest run --project integration <files>` | 0 | **47 files / 589 passed** (432 s) | `20-after-fix-integration.log` |
| 21 | after-fix, supplementary: `QA_PG_PORT=31204 tests/qa/support/with-pg.sh npx vitest run --project integration <files>` | 0 | **41 files / 266 passed** (543 s); it ran at the same time as run 20 and the e2e run | `21-after-fix-integration-supplementary.log` |
| 9 | `E2E_PG_PORT=31210 E2E_API_PORT=31220 MTH_PORT_POOL=31200-31249 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --reporter=list` (both projects, chromium-en and chromium-ar) | 0 | **4 passed** in 4.0 min (a13: en 9.2 s, ar 7.1 s; a22: en 1.8 min, ar 1.8 min), no retry. It ran while runs 20 and 21 were going. | `50-e2e.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `90-validate-historical-DG5-end.log` |

The full file lists are on the command line at the top of each log.

**Run 20** covers:
- the 3 new files and the inventory test;
- `access/` `sensitive-reach-sweep`, `-escalation`, `-id-refs-z12`, `sensitive-reference-pending-z12b` and `automation-restricted-tokens-z13`;
- `contract/contract.test.ts` and `response-validation.test.ts`;
- `automation/automation-failures` (failure queue, retry, dismiss) and `starters-be-j`;
- `jobs/job-operations` and `job-schedules`;
- all of `operations/`, including the BE-Z6 race test `exception-recurrence-race.test.ts`, `exceptions.test.ts` and `concurrent-exception-recurrence`;
- `integrations/connectors`, `runs`, `outbound`, `run-failure-kpi-links` and `graceful-degradation`;
- all of `raid/` and all of `tasks/` (including `channel-fanout`, `deep-links`, `inbox-restricted-z13`, `notification-delivery` and `work-items`);
- `reporting/my-work` and `admin/notification-channels`;
- `tests/qa/integration` `a13-job-idempotency`, `a13-jobs-rerun`, `a13-starter-jobs`, `a13-p6-channel-send-kill-restart`, `a13-p6-outbound-write-once` and `a22-operational-readiness`.

**Run 21** covers:
- the worker jobs in `apps/worker/test/integration/`: `automation-failure-queue`, `job-runs`, `worker-attempt`, `outbox`, `starters`, `restart`, `schedules`, `benefits-queue`, `raid-corrective`, `connector-failure-exception`, `operations-freshness` and `heartbeat`;
- the rest of `automation/`;
- every other `tests/qa/integration/a13-*`, `a21-p6-adapters-disabled` and `a22-*`;
- the remaining `access/sensitive-reach*` files;
- `approvals/reminders` and `security/xss`.

The automation-recovery path is covered three ways: the worker's `automation-failure-queue`, the API's `automation-failures`, and the A13 e2e spec.

Notes on non-zero exits and discarded attempts (evidence honesty):
- a. **Prettier, first run, exit 123.** xargs reports 123 when a batch fails. Prettier flagged formatting in 6 of my files (3 new tests, `sensitive-children.ts`, `corrective-cases.ts` and the inventory support file). I formatted exactly those 6, with no semantic change. Runs 20, 21 and 9 ran on the formatted files; the before-fix run 8 used the unformatted test files.
- b. **Before-fix, first attempt, discarded.** It used `git checkout -- <files>`, which failed on the read-only git index (`index.lock: Read-only file system`). That run therefore used the fixed code (21/21 passed) and is not evidence. The log was overwritten by the real before-fix run, which uses `git show HEAD:<path> > <path>`; its header says so.
- c. **After-fix, first attempt, never ran.** It was started inside a detached `&` subshell that was killed when its wrapper exited, and it wrote no test output. `20-after-fix-integration.log` is the re-run, and its header says so.
- d. No test failed, flaked or timed out in runs 20, 21 and 9.

### 3.1 Before-fix and after-fix

Method: the 13 changed source files (`apps/api/src`, `apps/worker/src/handlers/notifications.ts`, `packages/shared` and the inventory rows) were written back to their HEAD `055388ab4` content with `git show HEAD:<path> > <path>`. This task's new tests, the new `apps/worker/src/sensitive-children.ts` (only the twin-equality test uses it) and the widened catalog pattern were kept. I ran the 4 files, then restored my versions from a backup, and `git diff` was byte-identical to the saved patch (`cmp`).

| Test | Before (HEAD sources) | After |
| --- | --- | --- |
| served keys: failure queue (key + error text, list, get, dismiss) | FAIL: `expected 'benefit.variance_evaluated:01a1bd49-5…' to be 'benefit.variance_evaluated:[restricte…'` | PASS |
| served keys: execution history (trigger key + action result keys) | FAIL: the same, on `triggerKey` | PASS |
| served keys: integration runs (response, list, detail, `lastRun`) | FAIL: no marker, key names the benefit | PASS |
| served keys: outbound writes (list, detail) | FAIL: no marker | PASS |
| served keys: corrective case `sourceScopeKey` | FAIL: no marker | PASS |
| served keys: after a grant, real keys (positive) | pass (control) | PASS |
| action register: control (404 on the case; register row already redacted by BE-Z12) | pass (control) | PASS |
| action register: `listMyWorkItems` + `getWorkItem` | FAIL: the item kept `raid.task.action_due`, `{sourceCode}` and the `/action-register/` link | PASS |
| action register: `/me/work` | FAIL: `messageParams: {"sourceCode":"CA-01"}`, `href …/action-register/…` | PASS |
| action register: `listMyInbox` | FAIL: not redacted | PASS |
| action register: open RAID action never redacted (negative) | pass (control) | PASS |
| action register: after a grant (positive) | pass (control) | PASS |
| fan-out: twin equals the API map | pass (new module) | PASS |
| fan-out: control 404s | pass (control) | PASS |
| fan-out: Finance validation e-mail | FAIL: the generic text, not `inbox.restricted` | PASS |
| fan-out: overlap e-mail | FAIL: the same | PASS |
| fan-out: action e-mail | FAIL: `expected 'لديك إشعار جديد في صندوق الوارد…' to contain 'لم تعد لديك صلاحية الوصول…'` | PASS |
| fan-out: open benefit renders its template (control) | FAIL: the HEAD worker has no `catalogue` dependency, so the generic text was sent | PASS |
| fan-out: after a grant renders its template (positive) | FAIL: the same reason as the row above | PASS |
| inventory: every catalog column classified | FAIL: `a reference column of the schema is not in the inventory: expected [ …(71) ]` | PASS (`text=73`, open 0, PENDING 0) |
| inventory: operations, exercises, statuses | pass | PASS |

The before-fix run has **14 failures and 7 passes**. The 7 passes are controls and positives by design, plus the twin equality, which needs only the new module. The two "renders its template" rows fail before the fix because the injectable catalogue is new in this task, not because of the redaction itself. I disclose this so the count is not overstated. The after-fix results are in runs 20 and 21.

## 4. Operations routed (delta to the pending list)

None. No new operation. No `apps/api/test/support/p6-pending-*.ts` list names an operation this task touched. I searched all 28 files for the failure, execution, integration, outbound, corrective-case, work-item and inbox operations. Three files match (`p6-pending-be-l.ts`, `-be-l2.ts`, `-be-n2.ts`), but only in comments; their lists are empty. `contract.test.ts` is green in run 20 (§3).

## 5. Contract, schema and dependency needs (for the orchestrator)

- **Contract (additive):** optional `includesRestrictedRecords` (`const: true`) on `AutomationExecution`, `OperationalFailure`, `IntegrationRun`, `OutboundWrite` and `CorrectiveCase`, in OpenAPI and in the zod mirrors that exist (automation, corrective; `IntegrationRun` and `OutboundWrite` have no zod mirror). `pnpm openapi:lint` passes.
- **Changed response content:**
  - the served keys and error texts listed in §2.1 show `[restricted]` in place of a hidden id;
  - a restricted channel message links to the transformation home and issues no token;
  - an action on a restricted corrective case gets a restricted task and notification view.
- **Worker configuration:** `NotificationChannelDeps.catalogue` is optional. It defaults to the shipped catalogue, so `main.ts` is unchanged.
- **No** migration, **no** dependency, **no** new problem code.

## 6. User-facing texts this work made untrue

- **For the solution architect (owner; not edited by me):**
  - `docs/architecture/adr/ADR-0051-…md` line 151: "The channel adapters of ADR-0054 send only the token link and a neutral subject". A restricted message now sends the transformation home link and no token. The same ADR does not yet describe the D-227 key masking (§2.1) or the action→case rule (§2.3).
  - `docs/architecture/adr/ADR-0054-…md` line 94: "The message carries the deep link (re-authorized on open)". This is now true only for a recipient who is not restricted. The restricted case has the home link and no token.
- **For the frontend owner (`apps/web`; not edited by me).** The failure queue (`pages/automation/FailuresPage.tsx`, lines 100, 167, 311, 363) and the run detail (`pages/integrations/ConnectorsPage.tsx`, line 822) print the keys as text. A reader who is not admitted now sees `[restricted]` inside the key. D-218 asks the screen to show the restricted label, so these items should show `RestrictedRecordsLabel scope="item"` when `includesRestrictedRecords` is set. No en/ar string in `apps/web/src/i18n` is made untrue by this task.
- **Fixed:** the OpenAPI descriptions of the five new properties.

## 7. What remains, and observations for routing

All three items of the brief are done. Nothing from my scope is left except the two hand-offs in §6: ADR text and the web label. Observations:

1. **Cross-organization ids.** `restrictedIdsAmong` checks the records marked sensitive in the **reader's** organizations, so a hidden id of organization A inside a key served to a reader in organization B is not masked. This is reachable only through a key or text that names another organization's record. An example is `handleBenefitVariance`'s error text when an envelope names a benefit of another organization, which is itself a fault path. This matches every other D-218 helper. I did not change it.
2. **Error texts in general.** I masked `errorMessage` / `errorDetail` only on the failure queue and executions, next to the D-227 keys: `handleBenefitVariance` really throws `benefit <id> is not in organization …`. Other served error columns, such as `integration_run.error_message`, are not in the inventory's name pattern. If a reviewer wants them classified, the catalog pattern can widen to `(^|_)error_(message|detail)$` in the same way.
3. **The residual race from the BE-Z13 handback §5** (token ordinals while grants change) is unchanged and outside this brief.

## 8. Final checks and time

- `node tools/gates/validate.mjs --historical --stage DG5` at the end: exit 0, `PASS gate DG5 (historical)` (`90-validate-historical-DG5-end.log`).
- The prettier re-check over the whole tree, including this handback and its evidence logs, is in `92-prettier-final.log` (exit code on its last line).
- `pnpm lint` and `pnpm -r typecheck` were re-run on the final tree, after the prettier formatting: both exit 0 (`93-lint-final.log`, `94-typecheck-final.log`).
- Started `2026-11-08T21:59:11Z`, finished `2026-11-08T23:01:13Z` (`date -u`), within the 2-hour limit.
- The tree is left uncommitted on `dg6/be-z13b`.
