# Handback T-DG6-BE-X3B (continuation of T-DG6-BE-X3): pre-freeze repair, composition gaps (backend-workflow-engineer)

- **Stage:** DG6 (BUILDING), P6. Task T-DG6-BE-X3B. Assignment `docs/delivery/assignments/DG6/T-DG6-BE-X3B.md`, sha256 `08cac18aef27ec561e2334336f2cc409d663d4850fdfb2dd36b9951e9c25c0d4` (checked at start).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-X3B-backend-workflow-engineer-20261031T012524Z-da7bf93b","session_id":"da7bf93b-e9c1-4486-bf13-b38be7a78567"}`.
- **Tree:** worktree `/home/user/wt/dg6-be-x3`, branch `dg6/be-x3`, `HEAD` `c50725a80a2c3635490a828be427d2049a362c02` (the BE-X3 WIP commit `43da36785` merged with the integrated tip `827365aee`). My changes are **uncommitted**.
- **Time:** start `Sat Oct 31 01:25:36 UTC 2026`; end: see §7 (about 117 minutes, inside the 2-hour limit; past the 100-minute mark I only finished the checks and this handback).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (at the start; again at the end, §4).
- No business, Finance or IT approval was granted. Product gate G6 does not imply DG7. All test data is synthetic.

## 0. Who wrote what

| Part | Author |
| --- | --- |
| `setAssistantSecretProviders(secrets)` in `server.ts` (defect 1) | BE-X3 (kept as is) |
| `installConnectionLog` in `server.ts` (`holdApiConnectionLog`, held per composed app, released on `onClose`) and in `apps/worker/src/main.ts` (defect 2, QA-D-1) | BE-X3 (kept as is) |
| `packages/config/src/connection-log.ts`: a socket that never connects is logged with the requested host and the dialled address and port (defect 3, QA-D-2) | BE-X3 (kept as is) |
| BE-U's two retrieval-port registrations in `server.ts` (found by BE-X3's sweep: `registerAssistantEvidenceTextPort` and `registerAssistantPlaybookPassagePort` were called nowhere) | BE-X3 wrote the lines; **I replaced them** (see below) |
| `apps/api/test/integration/assistant/composition.test.ts` (9 cases through `buildServer`) and `apps/worker/test/integration/connection-log-main.test.ts` (3 cases through `src/main.ts`) | BE-X3; **I added 2 cases** to the first |
| BE-X3's evidence folder `T-DG6-BE-X3-evidence/` (its own runs before the restart) | BE-X3 (kept unchanged; not cited as my results) |
| `holdAssistantPorts` in `server.ts`: the fix for a defect that BE-X3's port wiring exposed (§2.4) | **me** |
| `conversations.test.ts` repair (§2.5) | **me** |
| The final sweep (`setter-sweep.sh`/`.txt`), every check in §4, this handback | **me** |

My review of BE-X3's partial work: the three defect repairs and both test files were correct and complete, and I kept them. The port wiring was right in intent but wrong in effect. Each `buildServer` replaced the two process-wide ports with ports bound to its own `db`. After a second app closed, the first app's assistant read through a destroyed pool, and `postAssistantMessage` answered **500**. This showed in the full contract suite (§2.4). BE-X3's integration evidence covers only its two new files, so it never saw this failure, and its wiring also broke four tests in `conversations.test.ts` (§2.5).

## 1. Changed files (relative to the integrated tip `827365aee`)

| File | Purpose | Author |
| --- | --- | --- |
| `apps/api/src/server.ts` | the composition lines: `setAssistantSecretProviders(secrets)`; the API connection log held per app (`holdApiConnectionLog`); BE-U's two retrieval ports held per app (`holdAssistantPorts`) | BE-X3 + me (`holdAssistantPorts`, and the type imports for it) |
| `apps/worker/src/main.ts` | `installConnectionLog("worker")`, right after `installConsoleRedaction()` and before the first database connection | BE-X3 |
| `packages/config/src/connection-log.ts` | QA-D-2: the `lookup` name, else the `connectionAttempt` address; the `connectionAttempt` port when the socket never connected | BE-X3 |
| `apps/api/test/integration/assistant/composition.test.ts` | the real-composition tests (credential, ports, API connection log); +2 cases for the port hold | BE-X3 + me |
| `apps/worker/test/integration/connection-log-main.test.ts` | the worker's connection log through `src/main.ts`, run as a process with no preload | BE-X3 |
| `apps/api/test/integration/assistant/conversations.test.ts` | clears the two ports after each `buildServer` (this suite tests the conversation frame with nothing retrievable); the rate-limit log-line case asserts the reply actually given (BE-C2's known seam at `:670`) | me |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X3B-evidence/**` | my logs, and the sweep script with its output | me |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X3B-backend-workflow-engineer.md` | this handback | me |

There is no migration, no contract change, no new dependency, no new operation and no user-facing text change.

## 2. Behaviour delivered

### 2.1 Defect 1: `setAssistantSecretProviders` is called by the composition root (REQ-S17-009)

`server.ts` passes the process's `SecretProvider` registry (BE-E's `env` and `file` providers, wrapped by `withSecretRedaction`) to the assistant, on the line after BE-X2's `setConnectorSecretProviders(secrets)`. An IT model endpoint's `credentialRef` now resolves in the running product.

The proof goes through `buildServer` with no injected registry (`composition.test.ts`):
- a set `env` reference reaches the fake model as `authorization: Bearer <value>`, and the value appears in no response;
- an unset reference sends nothing: `unavailable` with `assistant.provider_error`, and the fake's request count is unchanged.

### 2.2 Defect 2 (QA-D-1, Medium): `installConnectionLog` is called in both entry points (REQ-S17-009, REQ-S17-010)

- **API:** `buildServer` installs the log before its first database query. Because the test harness composes several apps in one process, the subscription is shared per file and counted. The last app to close removes it, so each attempt is written once. In production there is one app, the variable is ignored, and the production warning is emitted.
- **Worker:** `main.ts` installs it right after `installConsoleRedaction()`, before the first database connection.
- **Proof, API (`composition.test.ts`):** with `MTH_CONNECTION_LOG` set before `buildServer`, the call to the fake model is logged as `process: "api"`, host `127.0.0.1`, with the six keys only and no path, header, body or credential. The hold is per app: a second app on the same file does not duplicate lines, and when the last holder closes, nothing more is written.
- **Proof, worker (`connection-log-main.test.ts`):** `src/main.ts` is spawned as a process with only the deployment variables and no preload.
  - Variable set: every line is `process: "worker"`, and the worker's own PostgreSQL connections are logged.
  - `NODE_ENV=production`: one warning, and no file is written.
  - Variable unset: the worker starts and stops as before, with no warning.

ADR-0059 §12 says "One call each in `apps/api/src/server.ts` and `apps/worker/src/main.ts`". Both calls are present. In `server.ts` the call is inside `holdApiConnectionLog`, which runs once per composed app.

### 2.3 Defect 3 (QA-D-2, Low): an attempt that never connects is logged "with what is known" (REQ-S17-009)

| Case | Logged host | Logged address | Logged port |
| --- | --- | --- | --- |
| QA-D's reproduction, `net.connect({host:"192.0.2.10",port:443})` (never connects) | `192.0.2.10` | `192.0.2.10` | `443` |
| loopback, refused | `127.0.0.1` | `127.0.0.1` | the refused port |

Each case is a test in `composition.test.ts`.

**Residual (disclosed).** A host name whose DNS lookup *fails* is logged with the host, and with a null address and null port. No TCP attempt is dialled. Node's `net.client.socket` message carries only the socket, and no public socket event exposes the requested port before an attempt starts. Capturing it would mean patching `net.Socket.prototype.connect`, which the assignment's "change no other behaviour" rules out. The A21 checker treats an unknown destination as a failure, so this can never turn into a false pass. A test pins this behaviour (`a failed lookup is logged with the host asked for; no address or port was dialled`).

### 2.4 The defect BE-X3's port wiring exposed, and its fix (`holdAssistantPorts`, mine)

- **Symptom:** the full contract suite failed 2 tests.
  - `P6 BE-T operations`: `postAssistantMessage` answered 500.
  - `covers every operation …`: `getAssistantConversation` had no success, because the BE-T block stopped at the 500.
  - Log: `integration-full.log` (the first full run).
- **Cause:** the server log, captured with `MTH_TEST_LOG_DIR`, showed `Error: driver has already been destroyed`, raised in `playbook-passages.ts` `find` from `retrieval.ts:195`. The ports are process-wide, and each `buildServer` replaced them with ports on its own pool. The contract file builds and closes other apps, which left a port on a closed pool. Run alone, the BE-T block passed, which made the failure order-dependent.
- **Fix:**
  - Each composed app pushes its pair onto a process stack and registers it.
  - On `onClose`, if its pair is still the registered one, the newest remaining app's pair (or null) replaces it.
  - A port registered by someone else, such as a test's own port, is left as it is.
  - Production (one app per process) is unchanged.
- **Tests (`composition.test.ts`, +2):**
  - a second app built and closed leaves the suite app's ports in place, and a post still answers from the playbook;
  - a port a test registered itself survives an app's close.
- **Mutation check:** with the release made a no-op, the first new case fails (`integration-mutant-port-release.log`, exit 1, 1 failed / 10 passed). The source was restored and checked: zero `MUTANT` lines.

### 2.5 `conversations.test.ts` (mine; BE-T's file, repaired because BE-X3's wiring broke it)

- **The four broken tests:** four BE-T tests assumed that nothing is retrievable (BE-T's stub seam, `no_sources`). With the playbook port now really registered, their prompts got playbook passages, the replies became `answer`, and the fake model received calls (`integration-targeted.log`, 4 failed).
- **Fix for the four:** this file tests the conversation frame. It now clears both ports after each `buildServer`: the suite's app, and the `limited` app of the rate-limit case. It puts the suite app's pair back before the app closes. `composition.test.ts` covers the composed ports. Three of the four then passed.
- **The fourth:**
  - What it is: the `assistant` rate-limit log-line case at `:670`. T-DG6-BE-C2's handback already lists it as a deterministic failure on the integrated tree, because BE-U's *search* retrieval finds a synthetic transformation for "Synthetic …".
  - Fix: it now asserts that the log line describes the reply actually given: `replyKind` (`answer` or `no_sources`) and `dataItems` equal to the reply's citation count. The local test adapter cites every item it is given (`provider.ts:183`).
  - What it still checks: one line per post, no prompt text, and 429 with `Retry-After` past the budget.
  - Result: `integration-targeted-3.log`, 14 files, 272 passed, 1 todo, exit 0.

### 2.6 Per requirement row (acceptance texts quoted)

- **REQ-S17-009:** "A21;A18: a fresh install shows AI disabled, and a network capture during the e2e suite shows no outbound calls to model or telemetry hosts".
  - My part (BE-T's row share): the evidence instrument works in the running product (2.2, 2.3), and the configured credential reference resolves (2.1).
  - "AI disabled" on a fresh install is unchanged: `a21-p6-adapters-disabled.test.ts` passes.
  - Not claimed: the network capture itself is A18, at DG7. The e2e A21 run with `MTH_CONNECTION_LOG` is QA-D's. I did not run e2e (it is not in this assignment's acceptance list); see §6.
- **REQ-S17-010:** "A21: the guided lifecycle e2e test passes with AI disabled and external notification channels off". The connection log now exists for this run without a preload. The e2e itself is QA-D's, and I did not run it.
- **REQ-S17-007:** "A12: with a user scoped to X, an assistant query about Y returns no Y content; every answer lists cited record IDs and versions".
  - My change makes the running product's retrieval include the evidence-text and playbook ports.
  - `tests/qa/integration/a12-p6-scope-isolation.test.ts` and BE-U's suites pass with them (`integration-targeted-3.log`).
  - `e2e/a12-p6-scope-isolation.spec.ts` now runs against a composition with real ports. I did not run it.

## 3. The sweep (assignment: every `set*Provider*`, `set*Port`, `install*`, `register*` under `apps/*/src/modules` and `apps/worker/src`)

- **What I ran:** `T-DG6-BE-X3B-evidence/setter-sweep.sh`, output in `setter-sweep.txt`, 302 functions. It lists every exported `set*`, `install*` and `register*` function with its call sites (`file:line`, import and export lines excluded, test files excluded).
- **Composition wiring of the setters this task is about** (line numbers in the final `server.ts`):

| Setter | Wired by |
| --- | --- |
| `setAssistantSecretProviders` | `server.ts:668` (BE-X3) |
| `registerAssistantEvidenceTextPort`, `registerAssistantPlaybookPassagePort` | `server.ts`, inside `holdAssistantPorts`, called once per app (BE-X3, me) |
| `setConnectorSecretProviders` | `server.ts:664` (BE-X2) |
| `registerBuiltInSecretProviders` | `server.ts:661`, `apps/worker/src/main.ts:69` |
| `installConnectionLog` (`packages/config`, outside the sweep's directories) | `server.ts` (`holdApiConnectionLog`), `apps/worker/src/main.ts:32` |
| `setImportTargetRegistry`, `setConnectorTargetColumnsSource`, `setOutboundConfirmationPort`, `setExternalChangeEvidenceGate`, `setAutomationActionRegistry`, `setFormBulkUpdaters`, `setMeetingPackAssembler`, `setWorkflowsReadPort`, `setReviewTaskWriter`, `setMaterialChangePort`, `setKpiVersionActivator`, `registerLaunchPlanPort`, `registerHealthCheckSchemeProvider`, `registerTransformationInitializer`, `registerDeniedMutationAudit`, the platform `register*` hooks | `server.ts` (call sites in `setter-sweep.txt`) |
| `installDefaultConnectorAdapters` | `integrations/routes.ts:344`, inside the module registration (the process's connector adapters) |
| `setDecisionRightRouter`, `setImpactPreviewPort`, `setNextForumDateProvider`, `registerBenefitDownstreamProvider`, `registerProceduresKindProvider` and the other `register*KindProvider` | the owning module's register function, which `server.ts` calls |
| every `register*Routes` / `register*Module` | its module index or `server.ts` (listed) |

- **The seven with no call outside their own file:** I checked each one. None is a composition gap, so I fixed nothing.

| Setter | Why it needs no composition call |
| --- | --- |
| `setConnectorAdapters` | a test seam (replace and restore). The production registry is filled by `installDefaultConnectorAdapters` (above). The worker executes no adapter: the API's run watch does, per the `handlers/integrations.ts` header. |
| `setOutboundCrashHook` | a test seam ("never set outside tests"; QA-C's A13 crash) |
| `setGateExceptionClock` | a test seam (production reads the database clock) |
| `setOperationsAlertLogger` | an optional seam. The default writes a JSON line to stderr through `console.error`, which `main.ts`'s `installConsoleRedaction()` redacts. Its comment says main "may" pass pino. Wiring it would change the log format, so I left it. |
| `registerReaderStudioRules`, `registerRiskDispositionSubject` | called by their own file's route registration, which `server.ts` reaches |
| `registerInitiativesOf` | a query helper, not a setter, called in its own file |

## 4. Checks run (final tree, after every change; logs in `T-DG6-BE-X3B-evidence/`)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, harness ports 26920–26949.

| # | Command | Exit | Result / log |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` |
| 2 | `pnpm -r typecheck` | 0 | `typecheck.log` (re-run after the last source change) |
| 3 | `pnpm -r build` | 0 | `build.log` (run after the last source change) |
| 4 | `pnpm lint` | 0 | `lint.log` (re-run after the last change) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` (`All matched files use Prettier code style!`); re-run with this handback in place: `prettier-final.log` |
| 6 | `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (locale unset) | **1** | `unit-locale-unset-final.log`: unit-node 184 files / 2769 passed; unit-web 2 failed / 2011 passed (120 files, 2 failed); unit-formula-nocodegen 3 files / 259 passed, 2 skipped |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | `unit-locale-cutf8-final.log`: the same counts and the same 2 unit-web failures |
| 9 | `QA_PG_PORT=26930 MTH_PORT_POOL=26931-26944 tests/qa/support/with-pg.sh pnpm test:integration` (**the final full run**) | **1** | `integration-final.log`: 402 files (3 failed, 399 passed); 4076 tests: **4 failed**, 4069 passed, 1 skipped, 2 todo. Every failure classified below; none is in a file this task touched |
| 10 | targeted: contract + `assistant/**` + `security/rate-limits` + QA a12/a21 + worker connection log (`QA_PG_PORT=26945`) | 0 | `integration-targeted-3.log`: 14 files passed; 272 passed, 1 todo |
| 11 | mutation: port release made a no-op, `composition.test.ts` | 1 (expected) | `integration-mutant-port-release.log`: 1 failed / 10 passed; source restored |
| 12 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `validate-historical-dg5-end.log`: `PASS gate DG5 (historical)` |

**Non-zero exits and failures, explained:**

- **The unit suite, `unit-web`, 2 failed / 2011 passed, in both locales (first runs `unit-locale-unset.log` and `unit-locale-cutf8.log`; the final runs are in rows 7 and 8).**
  - The failing tests are `src/app/axe-scope.test.ts` ("add these routes to P6_AXE_ROUTES …: `/my-work/drafts`") and `src/pages/admin/security/p6-admin-screens.test.tsx` ("identity shows whether a client secret is configured, never a secret value").
  - Run alone, both fail too (`unit-web-two-failures-alone.log`), so they are deterministic.
  - This branch has **no diff in `apps/web` or `e2e`** against the integrated tip `827365aee` (`git diff --stat 827365aee HEAD -- apps/web e2e` is empty). The failures are in the integrated tree and outside my scope: web, frontend owner (FE-X1/FE-X1B run in parallel).
  - `unit-node`: 184 files, 2769 passed. `unit-formula-nocodegen`: 259 passed, 2 skipped.
- **`integration-full.log` (the first full run, exit 1, 16 failed / 4057 passed, 7 files failed).** It started before my `holdAssistantPorts` edit and kept running while I edited. Vitest loads files lazily, so this run mixes the old and the new tree, and **I do not cite it as a result.** I could not stop it: the background task's sandbox hides its processes from `ps`, and `pkill -f` is forbidden. It showed:
  - the contract 500 (§2.4);
  - the four `conversations.test.ts` failures (§2.5);
  - A17 (below).
- **`integration-targeted.log` and `-2.log`:** my intermediate runs, at 4 failed and then 1 failed (`conversations.test.ts`, §2.5). Both are fixed in `-3.log`.
- **The final full run (row 9), 4 failures.** All three failing files were re-run alone afterwards (`integration-final-failures-alone.log`: 3 files, 2 failed / 129 passed, exit 1):

| Failure | Alone | Classification |
| --- | --- | --- |
| `tests/qa/integration/a17-import-and-integration.test.ts`, "the failure chain opens exactly one operational exception linked to the stale KPI …": the KPI shows `freshness: "unknown"`, `lastValue: null`, expected stale with `250.75` | fails | **pre-existing and deterministic.** It is QA-D's QA-D-3 (b), reported before this task ("fails … in the full run and alone"). QA-D-3 (a), the webhook 401, now passes. Outside this assignment, and not in a file I touched |
| `apps/api/test/integration/admin/security.test.ts`, "ADM_TECH and AUD read every class …": the `webhook` class lists `operationIds: ["receiveWebhook"]`, while the test pins `[]` | fails | **a deterministic seam in the integrated tree.** The test predates the routing of `receiveWebhook` into the `webhook` class. This branch changes no rate-limit class, route or module registration: its only source diff is the composition lines in `server.ts`, `main.ts` and `connection-log.ts`. The owner of `admin/security.test.ts` (BE-E/BE-E2) or the orchestrator's seam pass should update the pin |
| `apps/api/test/integration/contract/response-validation.test.ts`: "P5 BE-J operations" (`expected [] to have a length of 1`) and "an undeclared request media type … " (30 s timeout) | **passes** (113/113) | **load.** The run shared the machine with the first full run. These are the same two cases D-201 attributes to load |

The final full run started while the first full run was still running, so two suites shared the machine.

## 5. Operations routed, contract pins

- No operation was routed or added; my `p6-pending-*` delta is **0**.
- No media type, no JSON-body route, no rate-limit class and no CSRF-exempt route was added. Every pinned count in `contract.test.ts` is unchanged.
- No contract, schema or dependency need for the orchestrator.

## 6. User-facing texts, and what remains

- **Texts:** I grepped `apps/web/src/i18n` for the connection log and credential-reference strings. No en/ar string is made untrue by this work; the assistant screens already describe the reference as recorded, not checked. I changed nothing there.
- **Remains / for the orchestrator:**
  1. **QA-D-3 (b) / A17:** the failing connector's KPI shows `unknown` with no last value, instead of stale with 250.75. It fails in the full run and alone. This is QA-D's finding from before this task, and it is outside this assignment.
  2. **The `admin/security.test.ts` webhook-class pin** (§4): a test seam in the integrated tree, for its owner or the orchestrator's seam pass.
  3. **The two `unit-web` failures** (§4): integrated-tree defects for the frontend owner.
  4. **QA-D-2 residual:** a failed DNS lookup logs no port (§2.3).
  5. **Not run:** e2e (not in this assignment's acceptance list). `e2e/a12-p6-scope-isolation.spec.ts` and QA-D's A21 e2e now run against a composition with real ports and a built-in connection log. QA-D's preload (`e2e/support/connection-log-preload.mjs`) is now redundant for the API and the worker. If QA keeps it, the log gets **two lines per attempt** (two subscriptions); QA should drop it.
  6. **Assignment discrepancy:** the assignment names "`p6-work-split.md` §D and §J/C (pre-freeze repair: composition gaps)". `p6-work-split.md` has §D and §J/C but no "pre-freeze repair" subsection. I took the scope from the assignment text and §D (D.1 and D.2 wiring lines, D.8 ownership: the `server.ts`/`main.ts` wiring lines are the orchestrator's, written here at the assignment's direction).

## 7. Merge instructions

- My changes are uncommitted on top of `c50725a80`, which includes BE-X3's WIP commit.
- Files: `server.ts`, `composition.test.ts`, `conversations.test.ts`, and the evidence folder.
- No migration. No ordering constraint. I expect no conflict except in `server.ts`'s P6 wiring block, if another task edits the lines next to `setConnectorSecretProviders`.
- End time: `Sat Oct 31 03:22:21 UTC 2026` (`end-time.txt`), about 117 minutes after the start.
