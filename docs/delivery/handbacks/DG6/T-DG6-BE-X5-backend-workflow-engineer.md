# Handback T-DG6-BE-X5 (backend-workflow-engineer): REQ-S17-007 assistant availability for signed-in users

- **Stage / gate:** P6, DG6 (BUILDING). Section: `docs/architecture/p6-work-split.md` §D (pre-freeze repair).
- **Invocation:** run `DG6-T-DG6-BE-X5-backend-workflow-engineer-20261031T041026Z-9e9db2d9`, session `9e9db2d9-d157-439f-a9ff-8e4385779686`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-BE-X5.md`, sha256 `1e4a89a3…7ee87c` (verified at the start).
- **Base:** branch `dg6/be-x5`, `HEAD` `f451a8c0b`. That is the orchestrator's integrated `b8f613829` plus one WIP commit from the earlier killed run, which holds only an empty `validate-dg5-start.log`; this run overwrote that file with the real log.
- **Time:** started `2026-10-31T04:12:18Z`, ended `2026-10-31T06:29:28Z` (`date -u`). That is over the 2-hour limit: the full integration suite alone ran 05:21–06:26 under load.
- **Changes are left uncommitted** for the orchestrator.
- **No business approval:** no G1–G6 approval, Finance validation or IT approval was granted. Every value in the tests is SYNTHETIC. Product G6 is unrelated to DG7.

## 1. The defect and the repair

**The defect: QA-B D2, proposed F-DG6-QA-B-2, High; AN-P6B G1.**
- The web's `useAssistantAvailability` read `GET /api/v1/admin/assistant` (`getAssistantSetting`). That route needs `assistant.configure` or `operations.read`.
- TL, BO, WL and FIN therefore got a 403, their availability stayed "unknown", and the launcher never showed for them.

**The repair is in two halves.**

**API:** an additive, required, boolean field `assistantEnabled` on `AssistantConversationPage`, the 200 body of `listAssistantConversations` (`GET /api/v1/assistant/conversations`).
- That operation already needs exactly `assistant.use`: every seeded role except AUD.
- The value is `providerFor(setting, …, { nodeEnv }) !== null`. That is the same check `createAssistantConversation` and `postAssistantMessage` already make before they refuse with 422 `assistant.disabled`. So "true" means a create would be accepted now.
  - No row gives false.
  - A disabled row gives false.
  - A saved provider that the environment refuses gives false, for example the test adapter under `NODE_ENV=production`.
- **Nothing else leaves the route:** no provider, endpoint, model, credential reference, authorization reference, limit or reason. Building the provider object makes no network call (`createHttpProvider` only returns closures). The response is still the strict zod mirror `{items, nextCursor, assistantEnabled}`.

**Web:** `useAssistantAvailability` now reads `GET /api/v1/assistant/conversations?limit=1` and uses `assistantEnabled`.
- Its query key `["p6","assistant","setting","availability"]` sits under the setting key. So the existing invalidations (closing the panel, and the admin screen's `assistantKeys.all` refresh after save, enable or disable) also refresh the slot.
- The slot no longer requests the admin setting at all.
- A pending or failed read is "unknown", and the launcher stays hidden.
- AUD, who lacks `assistant.use`, makes no request and sees no panel. This is unchanged.

**What is unchanged:**
- The admin screens (`apps/web/src/pages/admin/assistant/**`), `getAssistantSetting` and its permissions.
- `useAssistantSetting` and `readAssistantSetting`. The admin page still uses them.
- `e2e/a12-p6-scope-isolation.spec.ts`: `git diff --stat -- e2e` is empty.

## 2. Changed files

| File | Purpose |
| --- | --- |
| `docs/api/openapi.yaml` | `AssistantConversationPage`: `assistantEnabled` added to `required` and `properties`, with a description of what it means and what it never carries. The `listAssistantConversations` summary now names it. |
| `apps/api/src/modules/assistant/conversations.ts` | The zod mirror `assistantConversationPage` gets `assistantEnabled: z.boolean()`. The list route computes it with `enabledProvider(db)`, after the page query and outside any transaction. Header comment updated. |
| `apps/api/test/integration/assistant/conversations.test.ts` | Named lines only. The no-row list assertion now includes `assistantEnabled: false`. New describe "assistantEnabled …" with 4 tests (listed below). |
| `apps/api/test/integration/contract/p6-exercises-be-t.ts` | Named lines only. Through the validating client, the list asserts `assistantEnabled: true` while on, and 200 with `false` after `disableAssistant`. |
| `apps/web/src/components/assistant/api.ts` | `AssistantConversationPage.assistantEnabled`; `assistantKeys.availability`; `readAssistantAvailability`; `availabilityOf` now reads `assistantEnabled`; `useAssistantAvailability` uses the list instead of the admin read. Header comment updated. |
| `apps/web/src/components/assistant/AssistantPanel.tsx` | Comments only: the slot's rule and the close-time refresh. |
| `apps/web/src/components/assistant/assistant.test.tsx` | Slot tests rewritten for the new signal (listed below). `panelRoutes` answers pages with `assistantEnabled: true`. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X5-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X5-evidence/*` | Logs of every check below. |

**The new API tests** (in `conversations.test.ts`):
1. A TL on tA1 gets 403 on `GET /admin/assistant`. The list then answers `true` with the test adapter on, `false` for a saved but disabled HTTP endpoint and `true` once it is enabled. Each time:
   - the body's keys are exactly `assistantEnabled, items, nextCursor`;
   - no setting key or value appears: authorization reference, provider kind, endpoint URL, model name, credential reference name;
   - the `transformationId` filter does not change the signal;
   - reading the signal sends zero requests to the fake model.
2. Agreement with create: when the list says false, create answers 422 `assistant.disabled`; when it says true, create returns 201.
3. The signal is `providerFor`'s answer: the same enabled test-adapter row is non-null for `test` and null for `production`.
4. AUD gets 403, a user without grants gets 403, and an anonymous caller gets 401. None of the three bodies has `assistantEnabled`.

**The rewritten web tests** (in `assistant.test.tsx`), for a USER with `operations.read` and a TL-like LEAD without it:
- hidden on `assistantEnabled: false` for both, and the slot never reads the admin setting, even when that setting says "on";
- hidden when the availability read fails with 403 or 500;
- for AUD, neither the availability nor the setting is requested;
- shown to LEAD (403 on the admin setting) in en and ar, with RTL in ar, and no admin read;
- follows the server: after closing the panel the availability is read again, and an "off" answer hides the launcher.

## 3. Checks actually run

Environment: Node 24.21.0, offline, in worktree `/home/user/wt/dg6-be-x5`. Harness ports were 27150–27185 only. Machine load averaged 13–17 during the runs because other DG6 tasks were running.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-start.log` |
| 2 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages | `build.log` |
| 4 | `pnpm lint` (after the final formatting) | 0 | `eslint . --max-warnings=0` clean | `lint-final.log` (an earlier run, also exit 0: `lint.log`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | clean | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (locale unset) | 0 | unit-node 184 files / 2769 tests; unit-web 120 / 2015; unit-formula-nocodegen 3 / 259 passed + 2 skipped | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | Same counts: every test passed. **The exit 1 comes from one vitest unhandled error, `[vitest-worker]: Timeout calling "onTaskUpdate"`**, in unit-node: a worker-to-runner RPC timeout under load. No test failed. | `unit-c-utf8.log` (lines 305–322) |
| 8b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-node` (rerun of the invocation that hit the timeout) | 0 | 184 files / 2769 tests, no unhandled error | `unit-c-utf8-unit-node-rerun.log` |
| 9 | `QA_PG_PORT=27150 MTH_PORT_POOL=27151-27165 tests/qa/support/with-pg.sh npx vitest run --project integration --configLoader runner apps/api/test/integration/assistant/conversations.test.ts apps/api/test/integration/contract/contract.test.ts` (focused) | 0 | 2 files / 126 tests passed | `it-assistant-focused.log` |
| 10 | `QA_PG_PORT=27152 MTH_PORT_POOL=27153-27169 tests/qa/support/with-pg.sh pnpm test:integration` (full) | **1** | 402 files: 3 failed, 399 passed. 4080 tests: **4 failed**, 4073 passed, 1 skipped, 2 todo. **No failure is in the assistant**; see §3a. | `integration.log` |
| 10b | `QA_PG_PORT=27186 MTH_PORT_POOL=27187-27199 tests/qa/support/with-pg.sh npx vitest run --project integration --configLoader runner apps/api/test/integration/admin/security.test.ts apps/api/test/integration/contract/response-validation.test.ts` (isolated rerun, load about 2) | **1** | 121 tests: 120 passed, **1 failed** (the security test, deterministic) | `it-rerun-security-response-validation.log` |
| 11 | `QA_EVIDENCE_DIR=$TMPDIR/e2e-screens E2E_PG_PORT=27170 E2E_API_PORT=27171 MTH_PORT_POOL=27172-27185 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a12-p6-scope-isolation.spec.ts --workers=1 --reporter=list` (spec unedited) | 0 | **12 passed (1.5 m)**, including **A12-5 in chromium-en (6.0 s) and chromium-ar (8.9 s)**. The spec's own diagnostic line still shows `GET /api/v1/admin/assistant` → 403 for `dev.nobody`: the admin read stays closed, and the launcher now appears anyway. | `e2e-a12.log` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-end.log` |

**Note on check 8.** The assignment requires every Vitest invocation of `pnpm test` to pass under both locales. Every test passed in run 8, but the invocation exited 1 because of the harness RPC timeout above. I reran only that invocation (8b), which passed cleanly. I did not rerun the whole C.UTF-8 `pnpm test`; its other two invocations (unit-web, unit-formula-nocodegen) passed in run 8 itself.

**Pins:** no pinned count changes.
- The operation count stays 931: no operation was added.
- Media types, rate-limit floor and CSRF-exempt routes are unchanged.
- The AUD sweep and the route inventory have no new route to cover.
- The response-validation pagination rule still holds: `nextCursor` is still required on this page.

### 3a. Full integration run and the closing validator

**Acceptance item 3 is NOT met:** `pnpm test:integration` exited 1. These are the 4 failing tests:

1. **`tests/qa/integration/a17-import-and-integration.test.ts`, "failing connector (REQ-S12-019, A17) › the failure chain opens exactly one operational exception…"** The KPI view returns `lastValue: null` and `lastValueAt: null`, where `250.75` and `2026-01-31` are expected.
   - This is the known **QA-A2-F1** (REQ-S12-019, "linked-KPI last value"). The repair task is **BE-X4**, which runs in parallel on another branch (AN-P6B §4 also lists it as failing).
   - Not related to this change.
2. **`apps/api/test/integration/admin/security.test.ts`, "getSecurityRateLimits › ADM_TECH and AUD read every class…"** The `webhook` rate-limit class returns `operationIds: ["receiveWebhook"]`, where the test pins `[]`.
   - It fails deterministically: in the full run and again alone at load about 2 (10b).
   - This change touches no rate-limit, webhook, admin, platform or package code: `git diff --stat HEAD -- apps/api/src/modules/admin apps/api/src/modules/integrations apps/api/src/modules/platform packages` is empty. So it already fails at the base `HEAD`, most likely an expectation that wasn't updated when `receiveWebhook` joined the `webhook` class.
   - I did not prove this on a clean base clone, because I was out of time. **It needs an owner.** I propose a finding for the orchestrator: the BE-E/BE-N area, `security.test.ts:62`.
3. **`apps/api/test/integration/contract/response-validation.test.ts`, "› P5 BE-J operations (p5-exercises-be-j.ts)"** At `p5-exercises-be-j.ts:61`, a list of dependency slips had 0 items where 1 was expected.
4. **The same file, "› every operation: an undeclared request media type is a declared 400…"** This test timed out at 30 s.

Failures 3 and 4 happened under load: load average 13–17 from parallel DG6 tasks, and the suite ran 65 minutes. Both **pass in the isolated rerun** (10b: `response-validation.test.ts` green). They aren't in assistant code: the assistant exercise in the same file passed. I record them as load-sensitive. That's an F-DG4-143-class determinism concern for the owners of the P5 BE-J exercises and the media-type sweep, not something this task fixed.

**This change's own tests passed in every run:**
- `assistant/conversations.test.ts`, including the 4 new tests;
- the BE-T exercises in `contract.test.ts` and `response-validation.test.ts`;
- the assistant retrieval, guardrails, injection, suggestions and no-write suites;
- QA-B's `a12-p6-scope-isolation.test.ts`.

## 4. Behaviour per requirement row

**REQ-S17-007.** Acceptance: "A12: with a user scoped to X, an assistant query about Y returns no Y content; every answer lists cited record IDs and versions." Permissions: "use: signed-in users when enabled; configure: ADM".
- **The UI path (QA-B D2) works now.** In e2e A12-5, `dev.nobody`, a TL on X only, sees the launcher in en and ar. Asked about Y, the panel shows no Y text: Y's word, name, risk, action and evidence title are all absent from every `[data-assistant-output]`. Asked about X, the reply contains X's risk.
- **"use: signed-in users when enabled":** the panel is offered to every holder of `assistant.use` while the assistant is enabled, and hidden while it is off.
- **"configure: ADM":** unchanged. The setting itself is still readable only with `assistant.configure` or `operations.read`.
- **The API half** (retrieval scoping, citations with id and version) was not touched. It is still covered by the BE-U and QA-B suites, which run in the full integration run.
- **Status:** I don't set requirement status. The analyst or orchestrator moves the row; the remaining evidence is QA-B's re-run on the frozen candidate.

## 5. Operations routed (pending-list delta)

- **None.** No operation was added or newly routed, and no `p6-pending-*.ts` list changed.
- The changed operation `listAssistantConversations` is exercised in `p6-exercises-be-t.ts`, the existing seam for this operation, on named lines: `assistantEnabled` is `true` while on and `false` after disable, through the validating client.

## 6. Contract, schema and dependency needs (for the orchestrator and the architect)

**Contract change, to record in ADR-0059 §9 and §10 (the architect's file; I did not edit it).**
- `AssistantConversationPage` gains a required `assistantEnabled: boolean`. It means "the assistant is on for the caller now": the `providerFor` check that create and post use.
- The change is additive for clients. Only the API produces this body, and the web client now consumes it.
- Proposed ADR wording: "`listAssistantConversations` also returns `assistantEnabled`, the only setting information an `assistant.use` holder receives; the web's panel slot reads it instead of `getAssistantSetting` (QA-B D2)."
- The architect may also want to note it in ADR-0007 §4a's assistant line (pagination unchanged).

**Not needed:**
- **Migration:** none.
- **Dependency:** none.
- **New problem code:** none.
- **Permission change:** none.

**Merge overlap (D-004).** `conversations.test.ts` and `p6-exercises-be-t.ts` are BE-T's files: I changed named lines only. The web files are FE-E's, and the assignment gives me both halves.

## 7. User-facing texts

- **None became untrue.** I checked `apps/web/src/i18n/{en,ar}/assistant.json`: no string says the assistant is limited to administrators, or is planned or later.
- **No string was added or changed.**

## 8. What remains

- **The integration suite is not green** (§3a). One failure belongs to BE-X4 (QA-A2-F1). One is a deterministic, pre-existing pin in `security.test.ts` that needs an owner. Two depend on load and passed in isolation.
- QA-B (or another non-author) re-runs A12-5 on the frozen candidate and closes F-DG6-QA-B-2. I don't close it: it isn't my finding, and I'm the author of the fix.
- The architect records the contract change in ADR-0059 (§6).
- **Not run by me:**
  - `apps/web/e2e/p6-assistant.spec.ts` and `e2e/a21-p6-degradation.spec.ts`. Both cover the admin screen, which I did not change; its unit tests in `assistant.test.tsx` pass.
  - Re-running these is left to the integration pass.
