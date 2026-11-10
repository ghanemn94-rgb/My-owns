# T-DG6-ARCH-17 handback: architecture and contract texts for BE-Z13 to BE-Z13C (D-226 to D-229) (solution-architect)

- **Stage:** DG6 (P6), FIXING after review round 8. This is an engineering delivery gate only. Nothing here grants or implies a product gate G1–G6 or any business, Finance or IT approval.
- **Invocation:** `claude-code-cli-session`, run `DG6-T-DG6-ARCH-17-solution-architect-20261109T001209Z-aea472c1`, session `aea472c1-606e-428f-9eee-a3b613e3bf31`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-17.md`. Its sha256 `84d0c7bd…4d6014` matched at the start.
- **Base:** branch `dg6/arch-17` at `553f278b016073e7da3e2ee36a3702d4c018bc4d`, with a clean tree at the start. Changes are left **uncommitted**.
- **Time:** started `2026-11-09T00:12:20Z`. The end time is in §8.
- **Scope:** documents and contract descriptions only, with no behaviour change. **Migrations:** none. **Dependencies:** none. **Schema changes:** none (description texts only). **Operations routed:** none.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited **0** at the start, with `PASS gate DG5 (historical)` (`validate-historical-DG5.log`).

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0051-p6-authorization-boundary-read-scope-sensitive-records-deep-links.md` | **New amendment of 2026-11-09**, parts A–F: D-226/D-228 (1) tokens, inbox and channel redaction, D-227 key masking and the action→case rule, D-228 error texts and the item label, D-229, inventory counts, contract list, and the code check. **Four in-place corrections**, each with a pointer to the amendment: (1) §3 "Inbox redaction" (line ~151, BE-Z13B §6). It said "shape unchanged", "`linkPath` … unchanged", "exactly `messageKey` and `messageParams`", and "adapters send only the token link". (2) The automation row of the shapes table of 2026-11-08 part B (old marker `"[restricted]"`). (3) The automation re-save bullet of part C (old `keepRestrictedLiterals` four-way pairing). (4) The status line now lists every amendment. |
| `docs/architecture/adr/ADR-0054-p6-identity-storage-notification-channels.md` | **New amendment of 2026-11-09**: what a channel sends to a restricted recipient (D-227 (2), (3)). **In-place corrections:** the "Message content" sentence (line ~94, BE-Z13B §6), the `ChannelMessage.deepLinkUrl` comment ("always … `/links/<token>`"), fan-out step 2 (the shipped worker never sets `recipient_restricted`), and the status line. |
| `docs/architecture/adr/ADR-0043-p5-automation-engine-rules-executions-failure-queue.md` | **New amendment of 2026-11-09**: records 422 `automation_rule.restricted_marker_unknown` with its exact English text, beside the §9 "exact" refusal table. The table itself is not edited, because `fed.test.tsx` parses it (see §3, run 22). The status line points to the amendments. |
| `docs/api/openapi.yaml` | **Descriptions only** (17 lines). New descriptions on `InboxNotification.linkPath` and `.messageKey`; `AutomationExecution.triggerKey` and `.errorDetail`; `AutomationActionResult.idempotencyKey`; `OperationalFailure.idempotencyKey` and `.errorMessage`; `IntegrationRun.idempotencyKey`; `OutboundWrite.idempotencyKey`; `CorrectiveCase.sourceScopeKey`; `ConnectorActionableError.params`; `ConnectorConfig.credentialRefs` and `.fieldMappings` (D-229); and `NotificationDelivery.skipReason`. Extended descriptions on `InboxNotification.includesRestrictedRecords` and `WorkItem.includesRestrictedRecords` (action→case, D-227 (3)), and on `AutomationRuleVersion.includesRestrictedRecords` (k per D-228 (1)). No type, pattern, `required` entry, enum value or operation changed. `pattern` strings were checked byte-identical. |
| `docs/architecture/data-dictionary.md` | A pointer bullet in each of the 12 affected table sections: `work_item`, `inbox_notification`, `corrective_case`, `automation_rule_version`, `automation_execution`, `automation_action_result`, `operational_failure`, `operational_exception`, `notification_delivery`, `connector_config_version`, `integration_run` and `outbound_write`. **New final section "P6 read-time classifications after round 8 (no migration)"**: the catalogue widening and counts, and one row per changed or classified column (kind, what it can hold, OpenAPI member and operations, status and rule, task and decision, exercise). It also has a `notification_delivery` note and a read-time validation-rules table. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-17-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-17-evidence/*` | The logs cited in §3. |

## 2. Behaviour delivered, per requirement row

No runtime behaviour changes. What this task delivers is design and contract text that matches the shipped code for these rows:

- **REQ-S10-002.** Acceptance, quoted: "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant". ADR-0051 (amendment of 2026-11-09, A–F), the OpenAPI member descriptions and the data dictionary now state how a sensitive record stays hidden on these surfaces: automation conditions, keys, error texts, inbox, work items and channel messages. Each surface states its own rule (D-218, D-226, D-227, D-228, D-229).
- **REQ-S12-024.** Acceptance, quoted: "A12: a forwarded link opened by an unauthorized user returns 403 without leaking the record title". ADR-0051 §3 is corrected. It now says that a restricted notification has the home link and the restricted text, that `resolveDeepLink` answers 403 for it (also for child routes and for actions on a restricted case), and that a restricted channel message issues no token.
- **REQ-S12-023** (channel part). Acceptance, quoted: "A21: with no email adapter configured all workflows complete and notifications appear in the inbox". ADR-0054's amendment states that A21 is unchanged, and records what an **enabled** channel sends to a restricted recipient.
- **REQ-S12-002 / REQ-S17-005** (labels only). ADR-0051 part D records the item label on the failure queue, the execution detail, the run detail and the actionable-error panel. These rows' acceptance behaviour is unchanged, and still passes (§3: e2e a13; the integration failure-queue files).

**Code checked against the text** at `553f278b0`, with no contradiction found. The full list is at the end of the ADR-0051 amendment. In short:
- `automation/versions.ts` (`literalPositions`, `resolveRestrictedTokens`, the 422);
- `tasks/deep-links.ts` and `tasks/routes.ts` (`notificationFor`);
- the worker's `handlers/notifications.ts` and `sensitive-children.ts`;
- `access/sensitive-reach.ts` (the masking helpers);
- the inventory;
- the en/ar `adminP6.json` and `problems.json`.

The inventory counts I cite (fk 54, uuid 59, json 84, array 2, text 77; redacted 60, holder-restricted 54, cannot-name 135, D-219 2, not-served 22, own-input 3) were re-printed by my own run 30 (`30-integration-api.log` lines 254, 257).

## 3. Checks actually run

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, harness ports 31300–31349. The logs are in `docs/delivery/handbacks/DG6/T-DG6-ARCH-17-evidence/`.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `validate-historical-DG5.log` |
| 1 | `pnpm -r typecheck` | 0 | clean | `10-typecheck.log` |
| 2 | `pnpm -r build` | 0 | clean | `11-build.log` |
| 3 | `pnpm lint` | 0 | clean | `12-lint.log` |
| 4 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `14-openapi-lint.log` |
| 5 | `node tools/gates/validate.mjs --register DG6` | 0 | `PASS register rules at DG6` | `15-validate-register-DG6.log` |
| 6 | `env -u LANG -u LC_ALL -u LANGUAGE pnpm test` | 0 | unit-node **190 files / 2899 passed**; unit-web **123 / 2094 passed**; unit-formula-nocodegen **3 / 259 passed, 2 skipped** | `20-test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts in every invocation: 190 / 2899; 123 / 2094; 3 / 259 passed, 2 skipped | `21-test-c-utf8.log` |
| 8 | `(apps/web) npx vitest run src/pages/automation/fed.test.tsx`, locale unset, then `C.UTF-8` (after the ADR-0043 amendment; see note a) | 0, 0 | **1 file / 28 passed** in each locale | `22-fed-test-after-adr0043.log` |
| 9 | `env -u LANG … QA_PG_PORT=31300 MTH_PORT_POOL=31300-31319 tests/qa/support/with-pg.sh npx vitest run --project integration <31 files>` | 0 | **31 files / 443 passed** (535 s) | `30-integration-api.log`, list in `30-integration-api-files.txt` |
| 10 | `env -u LANG … QA_PG_PORT=31320 MTH_PORT_POOL=31320-31329 tests/qa/support/with-pg.sh npx vitest run --project integration <12 worker files>` | 0 | **12 files / 75 passed** | `31-integration-worker.log` |
| 11 | `E2E_PG_PORT=31330 E2E_API_PORT=31335 MTH_PORT_POOL=31336-31349 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --reporter=list --project=chromium-en --project=chromium-ar` | 0 | **4 passed** in 4.0 min (a13 en 11.3 s, ar 9.4 s; a22 en 1.8 min, ar 1.8 min), no retry | `40-e2e-a22-a13.log` |
| 12 | the prettier check over the whole tree, and the closing validator run | see §8 | see §8 | `90-final.log` |

**Run 9 (API set)** covers:
- `contract/contract.test.ts` and `response-validation.test.ts`, the contract checks against the edited OpenAPI;
- the failure queue and automation recovery: `automation/automation-failures`, `starters-be-j`, `automation-rules` and `automation-engine`;
- `jobs/job-operations` and `job-schedules`;
- **all** of `operations/`: the BE-Z6 race test `exception-recurrence-race`, plus `exceptions`, `concurrent-exception-recurrence`, `exception-last-known-value`, `freshness-scan`, `log-redaction` and `service-identity-scope`;
- the files that exercise the classified columns: `access/automation-restricted-tokens-z13`, `served-keys-restricted-z13b`, `served-error-text-restricted-z13c`, `sensitive-reference-inventory` and `sensitive-reference-pending-z12b`; `tasks/inbox-restricted-z13`, `action-register-restricted-z13b`, `channel-fanout-restricted-z13b` and `deep-links`;
- `tests/qa/integration` `a13-durable-automation`, `a13-job-idempotency`, `a13-jobs-rerun`, `a13-starter-jobs`, `a13-starters-run`, `a22-operational-readiness` and `a22-p6-operability`.

**Run 10 (worker set)** covers `automation-failure-queue` (automation recovery), `job-runs`, `worker-attempt`, `outbox`, `starters`, `restart`, `schedules`, `benefits-queue`, `raid-corrective`, `connector-failure-exception`, `operations-freshness` and `heartbeat`.

Runs 9, 10, 11 and 7 ran at the same time as one another.

Notes (evidence honesty):
- a. **Ordering.** I wrote the ADR-0043 amendment after run 6 finished and while run 7 was in progress. Only one test reads ADR-0043: `fed.test.tsx` parses its `| 4xx | \`code\` |` rows. The amendment adds no table row. I re-ran that file in both locales on the final text (run 8): 28/28 each. No other test reads ADR-0043 (`grep` over `apps`, `packages` and `tests`). The other three documents were final before run 6.
- b. **The ADR-parsing tests** `problems-p6.test.ts` and `problems-all.test.ts` (ADR-0051, ADR-0054) match only `| 4xx | \`code\` |` and `| \`code\` … | 4xx |` rows. The new ADR tables start with a response member or a status name, so the pinned row counts are unchanged. Both tests are in runs 6 and 7.
- c. No test failed, flaked, retried or timed out in any run above.

## 4. Operations routed (delta to the pending list)

None. This task routes no operation and has no `p6-pending-*.ts` list. `contract.test.ts` is green in run 9.

## 5. Contract, schema and dependency needs (for the orchestrator)

- **Contract:** description texts only. No schema, type, enum, `required` or operation change. The version stays `1.5.0-p6`. No gate needs reopening: no breaking change.
- **No** migration, **no** dependency, **no** new problem code. `automation_rule.restricted_marker_unknown` was already shipped by BE-Z13; this task records it in ADR-0043 and ADR-0051.
- **For the backend owner of `apps/api/test/support/sensitive-reference-inventory.ts` (not edited; test-support code is outside a docs-only brief).** The `fix` text of the row `automation_rule_version.conditions` still says "each hidden literal shown as AUTOMATION_RESTRICTED_LITERAL … re-save: keepRestrictedLiterals keeps the stored literal when the marker comes back in the same condition and position". That describes D-222 (2). Under D-226 and D-228 (1) it should say "shown as the token `[restricted:k]` (k = position among all literals); re-save: `resolveRestrictedTokens`; unknown or marker text 422". The row's status and exercise are correct, so this is text only and changes no test outcome.
- **Observation (no repair needed by D-227):** the `recipient_restricted` skip reason stays in the `notification_delivery` CHECK, the contract enum and the en/ar `adminP6.json` labels, but the shipped worker never sets it. A restricted recipient is sent the restricted message instead. The ADR, OpenAPI and dictionary now say this. Removing the value would need a migration and a contract change, and I do not propose it.

## 6. User-facing texts this work made untrue, and what I did

- **Made untrue by BE-Z13 to BE-Z13C, and corrected here:**
  - ADR-0051 §3 line ~151, "shape unchanged", "`linkPath` … unchanged" and "the adapters send only the token link". Corrected in place.
  - ADR-0051 line ~324, the `"[restricted]"` marker. Corrected in place.
  - ADR-0051 line ~340, the `keepRestrictedLiterals` pairing. Superseded in place.
  - ADR-0054 line ~94, "the message carries the deep link". Corrected in place.
  - ADR-0054's `ChannelMessage` comment ("always `/links/<token>`"). Corrected.
  - ADR-0054's skip-reason sentence. Annotated.
  - Every OpenAPI member listed in §1.
- **ADR-0051 line ~400** ("Checked against the code" of 2026-11-08, naming `keepRestrictedLiterals`) is a dated record of that check, and was true at `95936867c`. I kept it, and the new amendment states the rename.
- **en/ar strings:** this task changed none and made none untrue. The en/ar texts the ADRs now quote (`adminP6.restricted.hint`, `hintItem`, `problems.automation_rule__restricted_marker_unknown`, `inbox.restricted`) were checked verbatim against the catalogues.
- **For the inventory owner:** one stale `fix` text (§5).

## 7. What remains

Nothing from the brief. All three items are done: ADR-0051/ADR-0054 (plus ADR-0043 for the refusal record), OpenAPI and dictionary, and the checks. The inventory `fix` text in §5 is for its owner.

## 8. Final checks and time

The closing prettier check over the whole tree (including this handback and its evidence), the closing `validate --historical --stage DG5`, and the end time are in `90-final.log`. Its exit codes are on its last lines.
