# T-DG6-BE-Z13C handback: stable marker tokens, error-text masking, item label on keys (D-228) (backend-workflow-engineer)

- **Stage:** DG6 (P6), FIXING after review round 8. This is an engineering delivery gate only. Nothing here grants or implies a product gate G1–G6 or any business, Finance or IT approval. All test data is SYNTHETIC.
- **Invocation:** `claude-code-cli-session`, run `DG6-T-DG6-BE-Z13C-backend-workflow-engineer-20261108T231037Z-505900d9`, session `505900d9-a847-4d5d-81c1-fcf9c0c50f14`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z13C.md`. Its sha256 `3a4d5f30…6afcb00c` was verified at the start.
- **Base:** branch `dg6/be-z13c` at `d6d185d30f3653da84a61f2a837d8f8ebd2cac43`, with a clean tree at the start. Changes are left **uncommitted**.
- **Time:** started `2026-11-08T23:10:47Z`. The end time is in §8.
- **Decision implemented:** D-228 (1), (2) and (3). Items (4) and (5) are not mine: (4) is a scope statement and (5) is ARCH-17. An author never closes their own finding, so verification is for the reviewers.
- **Migrations:** none. **New dependencies:** none. **New endpoints:** none. **New operations:** none.

## 1. Changed files

### API (`apps/api/src`)

| File | Purpose |
| --- | --- |
| `modules/automation/versions.ts` | D-228 (1). `literalPositions` / `mapLiteralsAt`: a literal's 1-based position among **all** literals of the stored version, in reading order. A string or boolean scalar counts as one, each `in` element counts as one, and a condition without a value counts none. `redactConditionLiterals` shows a hidden literal as `[restricted:<position>]`. `resolveRestrictedTokens` maps a token back to the stored string literal at its position, wherever the condition now sits. A position with no string literal, the bare marker or any other marker-like text is still refused with 422 `automation_rule.restricted_marker_unknown`. The resolver is now synchronous: it no longer needs a policy decision, because the position comes from the stored version alone. |
| `modules/automation/rules.ts` | The `createAutomationRule` call site of the now-synchronous resolver. |
| `modules/integrations/routes.ts` | D-228 (2). `shownRuns` masks `errorMessage` as well as `idempotencyKey`, so every response that serializes a run is covered (the list is in §2.2). New `shownActionable` masks the `actionableError.params` values parsed from `error_message` (`{name=…}`, `{column=…}`) on `getIntegrationRun` and on every connector response, through `shownConnector`. |
| `modules/integrations/connectors.ts` | `ConnectorActionableError.includesRestrictedRecords?: true`. |
| `modules/operations/exceptions.ts` | D-228 (2). `shownExceptions` masks `lastErrorMessage` with `maskRestrictedIdsInFields`. `exceptionDetail` goes through it, so get, acknowledge and resolve are covered. `OperationalExceptionBody.includesRestrictedRecords?: true`. |
| `modules/operations/routes.ts` | `listOperationalExceptions` goes through `shownExceptions`. |

### Web (`apps/web/src`)

| File | Purpose |
| --- | --- |
| `pages/automation/FailuresPage.tsx` | D-228 (3). `RestrictedRecordsLabel scope="item"` when `includesRestrictedRecords` is set: on the failure row (key cell), in the dismiss form, and on the execution detail (next to the trigger key). |
| `pages/integrations/ConnectorsPage.tsx` | D-228 (3). The run detail shows `RestrictedRecordsLabel scope="item"` next to the idempotency key when `run.includesRestrictedRecords` is set. |
| `pages/integrations/ui.tsx` | `ActionableErrorPanel` shows the item label next to the "why" text when `actionableError.includesRestrictedRecords` is set. The why text is filled from `params`, which can now carry the marker. |
| `pages/integrations/api.ts` | `IntegrationRun.includesRestrictedRecords?` and `ActionableError.includesRestrictedRecords?` (the web types follow the OpenAPI). |

The label's en and ar texts already exist (`access.includesRestrictedRecords`, `adminP6.restricted.hintItem`). No new string was added.

### Shared and contract

| File | Purpose |
| --- | --- |
| `packages/shared/src/schemas/automation.ts` | Doc comment of `automationRestrictedToken`: `k` is the position among all literals (D-228 (1)). No code change. |
| `docs/api/openapi.yaml` | The condition `value` description now defines `k` per D-228 (1). Optional `includesRestrictedRecords` (`const: true`) is added on `OperationalException`, `OperationalExceptionDetail` and `ConnectorActionableError`. The `lastErrorMessage` / `errorMessage` descriptions and the `IntegrationRun.includesRestrictedRecords` description now cover the error text. Additive. |

### Tests

| File | Purpose |
| --- | --- |
| `apps/api/test/integration/access/automation-restricted-tokens-z13.test.ts` | Two **new** race tests. (a) A record **becomes hidden** between the author's read and save. The rule is `[S1, H, S2]`, and H is plain at the read and marked sensitive before the save. The save keeps `[S1, H, S2]`, and the response hides H at its own position (`[T1, T2, T3]`). (b) A record **becomes visible** between the read and the save. The rule is `[S1, V, S2]` with V hidden at the read, and V is granted before the save. The save keeps `[S1, V, S2]`. Existing expectations move to the new positions: `[T1, P, T3]` for `[S1, P, S2]`. The final positive test now shows that a token still names its position after a grant, and that a position with no literal is 422. |
| `apps/api/test/integration/access/sensitive-reference-pending-z12b.test.ts` | Expectation `[P, "[restricted:3]"]` (position among all literals). |
| `apps/api/test/integration/access/served-error-text-restricted-z13c.test.ts` (new, 4 tests) | D-228 (2), with real producers. **Operational exception:** the worker's `captureJobFailure` of a job whose error names the benefit opens the queue's exception. `lastErrorMessage` is masked for ADM_TECH and AUD in list, get, acknowledge and resolve, and an unrelated exception is untouched. AUD gets 403 on acknowledge, and another organization's reader gets 404. **Integration run:** `testConnector` of a connector whose IT-bound credential reference (a file name) embeds the benefit id fails with `connector.secret_unresolvable`. `errorMessage` and `actionableError.params.name` are masked in the test response, `listIntegrationRuns`, `getIntegrationRun` and `getConnector` (`lastRun` and `actionableError`). Another organization's reader gets 404. **Execution:** the worker's `runAsStarter` (starter.kpi_deviation on `raid.corrective_benefit`) wraps a handler that throws `handleBenefitVariance`'s error text on its last attempt, and the recorded `errorDetail` is masked for AUD (list, get). **Positive:** after a grant, the real texts come back with no flag. Every stored row is checked unchanged. |
| `apps/api/test/support/sensitive-reference-inventory.ts` | 4 new kind-`"text"` rows, all `redacted` with an exercise: `operational_failure.error_message`, `automation_execution.error_detail`, `operational_exception.last_error_message` and `integration_run.error_message`. |
| `apps/api/test/integration/access/sensitive-reference-inventory.test.ts` | The catalog pattern widens to `(^|_)(link_path|href|key|error_message|error_detail)$`, which is D-228 (2)'s `(^|_)error_(message|detail)$` added to the existing alternatives. The text floor rises from 73 to 77. `KNOWN_OPEN` and `KNOWN_PENDING` stay pinned **empty**. |
| `apps/web/src/pages/automation/fed.test.tsx` | 5 new tests (en and ar). A masked failure row carries the item label (title = `hintItem`) and an unrelated row does not. The dismiss form repeats the label. A masked execution shows the label, and an unmasked one shows none. |
| `apps/web/src/pages/integrations/integrations.test.tsx` | 3 new tests (en and ar). A masked run shows the item label on its key and in the actionable error, and an unmasked run shows none. |

## 2. Behaviour per requirement row

**REQ-S10-002.** Acceptance text, quoted: "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant". D-218, D-226, D-227 and D-228 apply.

**REQ-S12-002** (the failure queue screen). Acceptance text, quoted: "A06;A13: a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions". This is unchanged and still passes: `automation-failures`, the worker's `automation-failure-queue` and the A13 e2e spec in both locales. The change is the item label on masked rows.

**REQ-S17-005** (the actionable error). Acceptance text, quoted: "When a connector fails, users see which run failed, why and what to do, and can enter data by form or import". This is unchanged: which run, why, what to do and both fallbacks still show. A name that embeds a hidden id now reads `[restricted]` in the why text and carries the item label.

### 2.1 Stable token ordinal (D-228 (1))

- `k` is the literal's position among **all** literals of the stored version, so it depends only on the version the author read, which `If-Match` pins. A grant or sensitivity change between the read and the save cannot shift a token.
- **Record becomes hidden in between:** the author sends the plain id they hold (allowed, D-223), and every token keeps its position. Before the fix, the token for S2 resolved to H, and the stored rule became `[S1, H, H]` (§3.1).
- **Record becomes visible in between:** the token the author holds still resolves to the literal at its position. Before the fix, the save was refused with 422 (`/content/conditions/2/value`), and in other layouts a token could map to the next hidden literal.
- **What it discloses:** only the number of literals before a hidden one, which the reader already sees in the conditions. Resolving a position the writer can read discloses nothing, because the stored literal is never returned to a reader who isn't admitted.

### 2.2 Error text columns (D-228 (2))

- **Catalog:** the pattern finds exactly 4 error text columns in the migrated schema. All 4 are classified `redacted`, each with a test that seeds it from its producer.

| Column | Served by (every operation that serializes it) | Since |
| --- | --- | --- |
| `operational_failure.error_message` | `listAutomationFailures`, `getAutomationFailure`, `retryAutomationFailure`, `dismissAutomationFailure` | masked in BE-Z13B; classified here |
| `automation_execution.error_detail` | `listAutomationExecutions`, `getAutomationExecution` | masked in BE-Z13B; first exercised and classified here |
| `operational_exception.last_error_message` | `listOperationalExceptions`, `getOperationalException`, `acknowledgeOperationalException`, `resolveOperationalException` | **new** |
| `integration_run.error_message` (and `actionableError.params` derived from it) | `listIntegrationRuns`, `runConnector`, `getIntegrationRun`, `retryIntegrationRun`, `testConnector`, and `lastRun` / `actionableError` on `listConnectors`, `createConnector`, `getConnector`, `putConnector`, `enableConnector`, `disableConnector` | **new** |

- **Inventory result:** `catalog: fk=54 uuid=59 json=84 array=2 text=77`; `redacted=60 holder-restricted=54 cannot-name=135 D-219=2 not-served=22 own-input=3`. Zero open, zero PENDING (`13-after-fix-error-texts.log`).
- **Operations screen:** it never shows `lastErrorMessage`. It shows the catalogue text of `lastErrorCode`, per F-DG6-221. The marker is therefore never visible there, and the screen needs no label.

### 2.3 Web (D-228 (3))

- **Failure queue** (`FailuresPage.tsx`): the item label shows on each masked row, in the dismiss form, and on the execution detail.
- **Run detail** (`ConnectorsPage.tsx`): the item label shows next to the idempotency key, and in the actionable-error panel when its params are masked.
- en and ar are tested in unit tests. Visible text: "Includes restricted records" / its Arabic text. Title: the existing `hintItem` text.

## 3. Checks actually run

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, harness ports 31250–31299. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z13C-evidence/`.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `00-validate-historical-DG5.log` |
| 1 | `pnpm -r typecheck` | 0 | clean | `30-typecheck.log` |
| 2 | `pnpm -r build` | 0 | clean | `34-build.log` |
| 3 | `pnpm lint` | 0 | clean | `31-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `32-prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `33-openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LANGUAGE pnpm test` | 0 | unit-node **190 files / 2899 passed**; unit-web **123 / 2094 passed**; unit-formula-nocodegen **3 / 259 passed, 2 skipped** | `40-pnpm-test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts in every invocation: unit-node 190 / 2899; unit-web 123 / 2094; unit-formula-nocodegen 3 / 259 passed, 2 skipped | `41-pnpm-test-c-utf8.log` |
| 8 | before-fix, item 1 (§3.1) | 1 (expected) | **7 failed / 11 passed** (2 files) | `10-before-fix-tokens.log` |
| 9 | after-fix, item 1: `QA_PG_PORT=31250 tests/qa/support/with-pg.sh npx vitest run --project integration <z13 tokens, z12b>` | 0 | **2 files / 18 passed** | `11-after-fix-tokens.log` |
| 10 | before-fix, item 2 (§3.1) | 1 (expected) | **3 failed / 3 passed** (2 files) | `12-before-fix-error-texts.log` |
| 11 | after-fix, item 2: `QA_PG_PORT=31252 tests/qa/support/with-pg.sh npx vitest run --project integration <z13c, inventory>` | 0 | **2 files / 6 passed**, `text=77`, open 0, PENDING 0 | `13-after-fix-error-texts.log` |
| 12 | before-fix, item 3: `npx vitest run src/pages/automation/fed.test.tsx src/pages/integrations/integrations.test.tsx -t Z13C` (in `apps/web`) | 1 (expected) | **6 failed / 2 passed** | `14-before-fix-web.log` |
| 13 | after-fix, item 3: the same command | 0 | **8 passed** | `15-after-fix-web.log` |
| 14 | `QA_PG_PORT=31260 tests/qa/support/with-pg.sh npx vitest run --project integration <API set>` | 0 | **49 files / 553 passed** (764 s) | `20-after-fix-integration-api.log` |
| 15 | `QA_PG_PORT=31270 tests/qa/support/with-pg.sh npx vitest run --project integration <worker set>` | 0 | **12 files / 75 passed** (83 s) | `21-after-fix-integration-worker.log` |
| 16 | `E2E_PG_PORT=31280 E2E_API_PORT=31285 MTH_PORT_POOL=31250-31299 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --reporter=list` (chromium-en and chromium-ar) | 0 | **4 passed** in 4.0 min (a13: en 11.6 s, ar 9.8 s; a22: en 1.8 min, ar 1.8 min), no retry | `50-e2e.log` |
| 17 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `90-validate-historical-DG5-end.log` |

The full file lists are on the command line at the top of each log.

**Run 14 (API set)** covers:
- the access tests: `automation-restricted-tokens-z13`, `sensitive-reference-pending-z12b`, `served-keys-restricted-z13b`, `served-error-text-restricted-z13c`, `sensitive-reference-inventory`, `sensitive-reach-sweep`, `-id-refs-z12` and `-escalation`;
- `contract/contract.test.ts` and `response-validation.test.ts`;
- all of `automation/`, including the failure queue `automation-failures` and `starters-be-j`;
- all of `jobs/`;
- all of `operations/`, including the BE-Z6 race test `exception-recurrence-race`, plus `exceptions`, `concurrent-exception-recurrence`, `exception-last-known-value` and `freshness-scan`;
- `integrations/` `connectors`, `runs`, `outbound`, `run-failure-kpi-links`, `graceful-degradation` and `secret-binding/-composition/-namespace`;
- `tests/qa/integration` `a13-job-idempotency`, `a13-jobs-rerun`, `a13-starter-jobs`, `a13-starters-run`, `a13-durable-automation`, `a13-p6-connector-run-kill-restart`, `a13-p6-outbound-write-once`, `a21-p6-adapters-disabled`, `a22-operational-readiness` and `a22-p6-operability`.

**Run 15 (worker set)** covers the worker jobs: `automation-failure-queue` (automation recovery), `job-runs`, `worker-attempt`, `outbox`, `starters`, `restart`, `schedules`, `benefits-queue`, `raid-corrective`, `connector-failure-exception`, `operations-freshness` and `heartbeat`.

Runs 14, 15 and 16 ran at the same time as one another and as run 6.

Notes on non-zero exits, discarded attempts and test development (evidence honesty):
- a. **Runs 8, 10 and 12** exit 1 by design: they are the before-fix runs.
- b. **Run 6, first attempt, discarded.** It was started with `&` inside a foreground shell, which killed it when the shell exited. It wrote only its header line. The log was overwritten by the re-run, and its header says so.
- c. **Run 8, first attempt, overwritten.** It also failed 7 / passed 11. But in the "becomes hidden" race, the read assertion failed first, so the save never ran. I made that one read assertion `expect.soft` so the save is still exercised, and re-ran. The kept log shows the real defect: S2 is stored as H.
- d. **The new z13c test while I developed it** (scratch runs, not evidence): an env secret name was refused because `MTH_SECRET_<NAME>` is upper-case only, so the test uses a file-provider name. The name had to be bound in the IT manifest, which needs a host. A direct `UPDATE` of `automation_execution` was refused by the version and audit triggers, so it was replaced by the real `runAsStarter` wrapper.
- e. No test failed, flaked or timed out in runs 9, 11, 13, 14, 15 and 16.

### 3.1 Before-fix and after-fix

Method: the source files of the item were written back to their HEAD `d6d185d30` content with `git show HEAD:<path> > <path>`. The new and updated tests were kept, along with the widened catalog pattern for item 2. I ran the tests, restored my versions from a backup, and checked that `git diff` was byte-identical to the saved patch (`cmp`; "RESTORED-IDENTICAL" for items 2 and 3).

- Item 1 sources: `automation/versions.ts`, `automation/rules.ts`, shared `automation.ts`.
- Item 2 sources: `operations/exceptions.ts`, `operations/routes.ts`, `integrations/routes.ts`, `integrations/connectors.ts`, and the inventory support file.
- Item 3 sources: `FailuresPage.tsx`, `ConnectorsPage.tsx`, integrations `ui.tsx` and `api.ts`.

| Test | Before (HEAD sources) | After |
| --- | --- | --- |
| race: record becomes hidden between read and save | FAIL: read shows `[T1, H, T2]` (not `T3`); the save stores **H in place of S2** | PASS |
| race: record becomes visible between read and save | FAIL: 422 `restricted_marker_unknown` at `/content/conditions/2/value` | PASS |
| read: tokens by position (`[T1, P, T3]`) | FAIL: `[T1, P, T2]` | PASS |
| in-list reorder / remove with position tokens | FAIL (old ordinals) | PASS |
| positive: a held token still names its position after a grant | FAIL: 422 (the old code drops it) | PASS |
| z12b: author sees `[P, "[restricted:3]"]` | FAIL: `[restricted:2]` | PASS |
| other z13 / z12b tests (controls, refusals, 403) | pass | PASS |
| operational exception: `lastErrorMessage` masked (list, get, ack, resolve) | FAIL: `lastErrorMessage` names the benefit, no flag | PASS |
| integration run: `errorMessage` and `actionableError.params` masked | FAIL: no marker, no flag | PASS |
| execution: `errorDetail` masked | pass: already masked by BE-Z13B; first exercised here | PASS |
| positive after grant (z13c) | pass (control) | PASS |
| inventory: every catalog column classified | FAIL: `a reference column of the schema is not in the inventory: expected [ …(4) ]` | PASS |
| web: failure row / dismiss label (en, ar) | FAIL (no label) | PASS |
| web: execution label (en, ar) | FAIL | PASS |
| web: run detail key and actionable error label (en, ar) | FAIL | PASS |
| web: no label without the flag (execution, run) | pass (negative control) | PASS |

## 4. Operations routed (delta to the pending list)

None. No new operation. The three `p6-pending-*.ts` files that mention the touched operations (`-be-k`, `-be-l`, `-be-l2`) mention them only in comments, and their lists are empty. `contract.test.ts` is green in run 14.

## 5. Contract, schema and dependency needs (for the orchestrator)

- **Contract (additive):** optional `includesRestrictedRecords` (`const: true`) on `OperationalException`, `OperationalExceptionDetail` and `ConnectorActionableError`. These have no zod mirror; the web types are updated. `pnpm openapi:lint` passes.
- **Changed response content:**
  - the condition tokens are numbered by position among all literals;
  - `OperationalException.lastErrorMessage`, `IntegrationRun.errorMessage` and `actionableError.params` show `[restricted]` in place of a hidden id.
- **Changed write behaviour:** a token now resolves to the stored literal at its position even if the writer is admitted to that record by now (the "becomes visible" case). Before, it was refused with 422.
- **No** migration, **no** dependency, **no** new problem code.

## 6. User-facing texts this work made untrue

- **Fixed:** the OpenAPI condition `value` description, which defined `k` as the ordinal among hidden literals. The shared doc comment was updated the same way.
- **For the solution architect (ARCH-17, D-228 (5); not edited by me):**
  - ADR-0051 / ADR-0054 and the data dictionary should state the D-228 (1) definition of `k`;
  - they should list the two newly masked columns (`operational_exception.last_error_message`, `integration_run.error_message` plus `actionableError.params`).
  - `ADR-0051-…md` line 340 still describes the D-222 (2) pairing (`keepRestrictedLiterals`, "the k-th such condition"). This was already stale since D-226 and should become the D-228 (1) token rule.
- **en/ar strings:** none made untrue. The label reuses the existing `access.includesRestrictedRecords` and `adminP6.restricted.hintItem` texts, whose item description ("refers to a record you are not admitted to") is true for these items.

## 7. What remains, and observations for routing

All three items of the brief are done. Observations:

1. **Credential and mapping names in the connector configuration.** The inventory classifies `connector_config_version.credential_refs` as cannot-name, with the reason "a secret reference (environment or vault key name), never a record id". `field_mappings` is classified as cannot-name ("column mappings"). A file-provider name, and a source column name, can textually hold a uuid. The new test does exactly this, so the connector's `config.credentialRefs[].name` shows the id that the run's error text now masks. Two things bound this:
   - the credential name must be bound in IT's secret manifest, so only IT can introduce it;
   - every id that reaches `integration_run.error_message` comes from this configuration, which connector readers already see.

   I left `config` out of that one leak check and did not change the classification: it is configuration, not an error text, and outside D-228 (2). If a reviewer wants it masked, the same `maskHiddenIds` applies to the config view.
2. **Cross-organization ids** stay out of scope (D-228 (4)). This is why the execution test's handler is a stand-in that throws `handleBenefitVariance`'s text: the real throw needs an envelope of another organization.

## 8. Final checks and time

- `node tools/gates/validate.mjs --historical --stage DG5` at the end: exit 0, `PASS gate DG5 (historical)` (`90-validate-historical-DG5-end.log`).
- Re-run on the final tree, including this handback:
  - the prettier check over the whole tree: exit 0 (`92-prettier-final.log`);
  - `pnpm lint`: exit 0 (`93-lint-final.log`);
  - `pnpm -r typecheck`: exit 0 (`94-typecheck-final.log`).
- Started `2026-11-08T23:10:47Z`, finished `2026-11-09T00:07:50Z` (`date -u`), within the 2-hour limit.
- The tree is left uncommitted on `dg6/be-z13c`.
