# Handback T-DG6-FE-E: the assistant panel and Administration > AI assistant (frontend-ux-engineer)

- **Stage:** P6 / DG6 (BUILDING). **Section:** `docs/architecture/p6-work-split.md` §D.3 (ADR-0059).
- **Invocation:** `DG6-T-DG6-FE-E-frontend-ux-engineer-20261030T125152Z-96cd6b9c`, session `96cd6b9c-bbcc-474f-9924-8d08103ada51`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-E.md`, sha256 `e91cdbc3…bd535` (checked).
- **Base:** branch `dg6/fe-e` at `4edfe8faa`; the working tree was clean at start. The changes are **uncommitted**, as asked.
- **Time:** started `2026-10-30T12:52:06Z`; ended `2026-10-30T14:52:26Z` (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0 before any change (`T-DG6-FE-E-evidence/validate-historical-DG5.txt`). It was rerun at the end: exit 0, `PASS gate DG5 (historical)`.
- All data used here is **synthetic**. No business, Finance or IT approval was granted. The "authorization reference" in the e2e spec is a synthetic string, and the product only records it. The test adapter is local; no model endpoint was called, and nothing is described as live.

## 1. Files changed

**Owned by FE-E (§D.8):**

| File | Purpose |
|---|---|
| `apps/web/src/components/assistant/api.ts` (new) | Paths of the 9 `assistant` operations and of `createFormDraft`, the query keys `["p6","assistant",…]`, the read hooks, the response types (mirrors of the openapi `Assistant*` schemas; no `@mth/shared` mirror exists), the availability rule (`on` only when `enabled: true`), and the citation and draft-editor links. |
| `apps/web/src/components/assistant/AssistantPanel.tsx` (new) | `AssistantLauncher`, the shell slot: it renders nothing unless the user holds `assistant.use` and the setting read says `enabled: true`. Also the non-modal panel: conversation list, new-conversation form (optional focus on the current page's transformation), and the conversation view with the composer (If-Match = conversation version). |
| `apps/web/src/components/assistant/AssistantOutput.tsx` (new) | The labelled container "Suggestion from the assistant - not an approved fact". Plain-text rendering (a text node, `dir="auto"`, no HTML, no links from content). The read-time reply-kind texts (refusal, no_sources, unavailable with its code, interrupted), the withheld notice, and the citation chips. |
| `apps/web/src/components/assistant/SuggestionCard.tsx` (new) | The suggestion card. "Take to draft" calls `takeAssistantSuggestionToDraft` (If-Match = suggestion), then the user's own `createFormDraft` with the returned body, then shows "Draft – not submitted" with links to the editor and to My Work. Advice kinds show text only. |
| `apps/web/src/components/assistant/assistant.css` (new) | Panel and admin-page styles: tokens only, logical properties only (checked by `styles.test.ts`). Info border for the assistant container, never a status colour. |
| `apps/web/src/components/assistant/provisional-ar.ts` (new) | The provisional-Arabic label of every assistant text (JSON cannot carry comments), bound by a test. |
| `apps/web/src/components/assistant/assistant.test.tsx` (new) | 22 component and page tests (§3). |
| `apps/web/src/components/assistant/assistant-i18n.test.ts` (new) | 6 tests binding the texts to ADR-0059 verbatim, read from the ADR file (§3). |
| `apps/web/src/pages/admin/assistant/AssistantSettingsPage.tsx` (new) | Administration > AI assistant: status, the §3 statements, the settings, the edit form (If-Match `0` creates the row disabled; fields locked while on), and turning on or off with a reason. Read-only for `operations.read` holders. |
| `apps/web/src/i18n/{en,ar}/assistant.json` (new) | The `assistant` namespace. Arabic is provisional. |
| `apps/web/src/i18n/{en,ar}/problems.json` | The assistant block, appended at the end: 13 codes of ADR-0059 §10. `admin.reason_required` already existed. |
| `apps/web/e2e/p6-assistant.spec.ts` (new) | The e2e spec on the real stack (en and ar), with axe and screenshots and a measured budget. |

**Named wiring lines outside §D.8 (FE-A's shell files; for the orchestrator to accept or move at merge).** FE-A did not deliver the assistant shell slot. Its handback §7 item 1 names it as FE-A2 work, and no FE-A2 task exists. Without these lines the panel and the page cannot be reached. Each line is additive and marked `T-DG6-FE-E`:

| File | Lines |
|---|---|
| `apps/web/src/app/Shell.tsx` | 1 import, plus `<AssistantLauncher />` in the header before the language switch. |
| `apps/web/src/app/router.tsx` | 1 lazy page, plus the route `admin/assistant`. |
| `apps/web/src/app/nav.ts` | `"assistant"` in the sub-page id union, plus one `NAV_SUBPAGES` entry (Administration > AI assistant; `requiresAny: [assistant.configure, operations.read]`). |
| `apps/web/src/i18n/{en,ar}/nav.json` | `nav.sub.assistant`: "AI assistant" / "مساعد الذكاء الاصطناعي". The Arabic is provisional; it is not listed in FE-A's `provisional-ar-p6.ts`, see §5. |
| `apps/web/src/i18n/index.ts` | 2 imports, plus `assistant` in both catalogues. |

**Evidence:** `docs/delivery/handbacks/DG6/T-DG6-FE-E-evidence/` (logs listed in §3; screenshots in `screenshots/{en,ar}/`).

## 2. Behaviour delivered, per requirement row

The texts in quotes are the rows' `acceptance` texts. FE-E delivers the frontend part of each row named in §D.9. Backend proof belongs to BE-T and BE-U; QA-B and QA-D own the A12 and A21 proofs.

### REQ-S17-007

> "A12: with a user scoped to X, an assistant query about Y returns no Y content; every answer lists cited record IDs and versions"

FE-E's part is the labels and the citations:
- **Labelled output.** Every answer, refusal, no-sources, unavailable and interrupted reply, and every suggestion, is rendered inside one container labelled "Suggestion from the assistant - not an approved fact" (Arabic: the ADR's provisional text). The container lives inside the panel, never in a record's field area.
  - Unit test: 4 replies → 4 containers, each named by the label; user prompts are never inside one.
  - e2e: `main#main [data-assistant-output]` count is 0.
- **Citations.** Each citation is shown as a chip with the record type and **version** ("Initiative, version 3") or the playbook block and version ("Playbook B0042 (version 1.0)").
  - A readable record links to its screen. Nested records use the conversation's focus transformation. Five record types have no per-record screen (RAID entry, dependency, decision, evidence, lesson); they link to the focus transformation's register.
  - A deliverable has no screen to open, so its chip is plain text.
  - A citation with `readable: false` never links and shows a lock with "(you can no longer read it)".
- **Withheld content.** An answer with `contentWithheld: true` shows the notice and never the text.
- **The A12 data property itself** (no Y content) is server-side: BE-U retrieval and QA-B. The UI renders only what the server returns and makes no extra record read.

### REQ-S17-008

> "A08;A10: tests show that assistant requests to approve a gate, validate a benefit or edit a value are refused and change no records"

FE-E's part is that a draft goes through the human's own `createFormDraft`:
- **Refusals.** A refusal is rendered from its code at read time, in the user's language, with ADR-0059 §8's exact English (bound to the ADR in a test).
  - e2e, en and ar: "approve gate G4" shows the approval refusal inside the labelled container.
- **Take to draft.** It calls `takeAssistantSuggestionToDraft` (If-Match = suggestion version), then `POST /transformations/{tid}/form-drafts` with the returned `FormDraftCreate` body, under the user's session. The result is labelled "Draft – not submitted" and offers "Open the editor" and "My drafts".
  - Unit test: the only two writes are exactly these two requests. Nothing is submitted or approved.
  - The action is shown only to holders of the target's write permission (`charter.edit` / `executive_decision.create`; a UI hint, the server decides). Advice suggestions offer no action.
  - Already taken: the server's 422 `assistant.suggestion_already_taken` is shown in one alert, and no draft request is sent.
- **Not done:** a running two-step take-to-draft on the real stack. See §6 item 3.

### REQ-S17-009

> "A21;A18: a fresh install shows AI disabled, and a network capture during the e2e suite shows no outbound calls to model or telemetry hosts"

FE-E's part is Administration > AI assistant:
- **Status.** With no row, the page shows "Off (not configured)". Otherwise it shows "Off" or "On" from the server, never "On" by guess. An unreadable setting is the no-permission state, never a status.
- **Fixed statements.** "Telemetry and analytics: off. This installation contains no telemetry or analytics client." and "The reference is recorded as entered; the product does not check it with IT." are verbatim from ADR-0059 §3, bound by a test.
  - The page also says that no endpoint is tested from the product.
- **ADM_TECH** (`assistant.configure`):
  - edits the settings (If-Match `0` creates the row **disabled**);
  - turns the assistant on or off through a reason dialog (If-Match = row version);
  - sees the provider, endpoint, API style, model, credential reference and authorization reference **disabled while on**, with the reason given.
- **Credentials.** The credential is a reference (provider + name) only. There is no secret field.
- **Validation.** The client checks the limits and the credential pair before sending. Server 400 field errors land on their fields; 409 reloads the setting and keeps the typed values.
- **Read-only view.** `operations.read` holders (TO, KDS, TD, AUD) see the page read-only, with no write control.
- **e2e, both languages:**
  1. Off at the start (no launcher in the shell).
  2. Saved disabled, then turned on, then the panel appears for the Transformation Office.
  3. The auditor gets the read-only page and no panel.
  4. Turned off again in `finally`, so later specs of the same stack start with AI off.
- **A21 and A18** (the connection log and the network capture) are QA-D and DG7, not claimed here. The panel makes no request at all for a user without `assistant.use`, and only `GET /admin/assistant` otherwise.

### §D.3 test list → where each item is proven

| §D.3 test | Proof |
|---|---|
| panel hidden when `enabled` is false | unit: enabled false, no row, 403; the panel's own requests never reach the conversation routes; e2e: no launcher while off |
| every assistant output inside the labelled container, never in a record's field area | unit + e2e (above) |
| answers render as plain text (no HTML, no links from content) | unit: `<b>…</b>`, an https URL and `javascript:` stay text, no `b`/`a`/`i` element is created; a source scan forbids `dangerouslySetInnerHTML`, `.innerHTML`, `insertAdjacentHTML`, `DOMParser` and markdown libraries |
| withheld content shows its notice | unit |
| AUD sees the setting read-only and no assistant panel | unit (no setting request from the panel for AUD) + e2e (`dev.auditor`) |
| en/ar render, RTL | unit (`dir`) + e2e in `chromium-en` and `chromium-ar`; `dir="auto"` keeps an English prompt readable in RTL (fixed after the first screenshot showed "?What is…") |
| one form-level alert | unit: to-draft card, composer (409 `assistant.reply_pending`), settings form (422 `assistant.endpoint_invalid`), each exactly one `role="alert"` |
| session-bound actions | every write starts `beginSessionGuard()` and checks `stale()` after each await (`auth/sessionBound.ts` convention; the eslint rule and the source scan in `session-bound.test.tsx` pass) |
| axe | e2e: `expectAccessible` (WCAG 2.0/2.1 A+AA; no serious or critical violation) on 5 screens × 2 languages |
| an e2e spec with a measured budget | `p6-assistant.spec.ts`: 120 s per test; measured under load (§3) |

**Other states:**
- loading, error with retry and empty states in the conversation list;
- a "turned off" notice when a create or post answers 422 `assistant.disabled`; closing the panel re-reads the setting, so the launcher disappears;
- `conversation_full` (no composer at 99+ messages);
- 409 `reply_pending` or a version conflict reloads the conversation and keeps the typed text;
- keyboard: Escape closes the panel and returns focus to the launcher; focus returns to the question box after an answer (fixed after the first e2e run, see §3); visible focus rings.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0, offline, 4 cores, shared with other agents (load average 13–15 during the runs). Harness ports 25800–25849 only.

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | exit 0, `PASS gate DG5 (historical)` | `validate-historical-DG5.txt` |
| 1 | `pnpm -r typecheck` | exit 0 | `typecheck.txt` |
| 2 | `pnpm -r build` | exit 0 | `build.txt` |
| 3 | `pnpm lint` | exit 0 | `lint.txt` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (rerun on the final tree including this handback: see the end of §3) | `prettier.txt` |
| 5 | `pnpm openapi:lint` | exit 0, "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations" | `openapi-lint.txt` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | **exit 1.** Every test passed: unit-node 176 files / 2722 tests, unit-web 101 / 1817, unit-formula-nocodegen 3 / 259 + 2 skipped. Vitest reported **1 unhandled error** in unit-node, `[vitest-worker]: Timeout calling "onTaskUpdate"` (a worker RPC timeout, load average ~14), which makes the run exit 1. Rerun of unit-node alone with the locale unset: exit 0, 176 / 2722 (`unit-node-rerun-locale-unset.txt`). | `test-locale-unset.txt` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 1.** Every test passed: unit-node 176 / 2722, unit-web 101 / 1817, unit-formula-nocodegen 3 / 259 + 2 skipped. The same unhandled unit-node error, `[vitest-worker]: Timeout calling "onTaskUpdate"`, made the run exit 1. unit-node includes no `apps/web` file (`vitest.config.ts`: api, worker, packages, tests/qa/unit, deploy scripts), so this change cannot reach it. A C.UTF-8 rerun was not done in the time limit. | `test-c-utf8.txt` |
| 8 | `QA_PG_PORT=25810 MTH_PORT_POOL=25811-25849 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 1** (14:27Z–15:36Z, past the time limit). Vitest printed no totals: the run ended with an unhandled `Error: Channel closed` (`ERR_IPC_CHANNEL_CLOSED`, a tinypool worker IPC failure). From the log: 283 files passed, and **4 files had 5 failed tests**, none in a file this task touched: `assistant/conversations.test.ts` (rate-limit class `assistant`: post over budget is 429); `contract/response-validation.test.ts` (2: P5 BE-J operations; undeclared request media type is a 400); `reporting/registers-report.test.ts` (5,001 rows → 422, failed at its 120 007 ms timeout); `admin/security.test.ts` (getSecurityRateLimits: ADM_TECH and AUD read every class). Not investigated, not claimed as flakes. Pinned-count change: none (this task changes no API). | `test-integration.txt` |
| 9 | `E2E_PG_PORT=25800 E2E_API_PORT=25801 MTH_PORT_POOL=25802-25849 E2E_SCREENSHOT_DIR=… apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-assistant.spec.ts --workers=1` (final tree, under load) | exit 0; 2 passed (en 15.6 s, ar 16.7 s) | `e2e-p6-assistant-loaded.txt` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | exit 0, `PASS gate DG5 (historical)` | `validate-historical-DG5-end.txt` |

**Non-zero exits and flakes, disclosed:**
- **e2e run 1** (`e2e-run1-failed.txt`): exit 1, both languages. The spec signed in a second user without signing out; `/login` shows no form while a session is active. Fixed in the spec (sign out between users, as `journeys.spec.ts` does).
- **e2e run 2** (`e2e-run2-failed.txt`): exit 1, both languages (24.0 s and 22.4 s). Escape did not close the panel: the send button is disabled while waiting, so focus fell to `<body>`. This was a real keyboard defect. Fixed in the panel: focus returns to the question box after the answer or an error.
- **e2e run 3** (`e2e-run3.txt`): exit 0 (19.4 s and 20.2 s), before the header-overlap and `dir="auto"` fixes. Run 9 above is the final tree.
- **The first full unit-web run** (`npx vitest run --project unit-web`, before the e2e fixes): exit 0, 101 files, 1817 tests passed.
- **A second unit-web run,** started deliberately as load while e2e run 9 ran: exit 1, 1 failed / 1816 passed.
  - The failure was `src/pages/adoption/adoption.test.tsx > adoption screens (en) > indicators: all seven by name; a measure without data is Unknown, never 0`: `Unable to find role="table"` after 9022 ms.
  - Rerun alone twice on the same tree: 22/22 passed (795 ms and 598 ms).
  - This is a timing flake of an existing test under heavy load (load average ~14). The assistant code does not touch that page. The shell's only new request is `GET /admin/assistant`, which the scripted API answers 404 and which hides the slot. Logs: `unit-web-first-run.txt` and `unit-web-under-load.txt`. The assignment's acceptance runs are rows 6–8.

**Assistant tests on their own:** `npx vitest run src/components/assistant`: 28 passed (22 + 6). The i18n binding tests together with `src/i18n`: 58 passed.

**e2e budget (rule 15):** the slowest passing run was 20.2 s (run 3); the final tree under load ran 15.6 s and 16.7 s. The budget is 120 s per test, about 6x the loaded worst case, and is written in the spec header.

**Screenshots** (Playwright, full page, final tree), in `screenshots/en/` and `screenshots/ar/`:
- `p6-assistant-admin-off.png`
- `p6-assistant-admin-form.png`
- `p6-assistant-admin-on.png`
- `p6-assistant-panel.png`
- `p6-assistant-admin-auditor.png`

The panel is fixed-position, so a full-page capture shows it at viewport height; the composer is below the visible part of the panel's own scroll area.

**Interaction checks actually run:**
- Keyboard: Escape closes the panel and returns focus to the launcher (unit + e2e `toBeFocused`).
- Focus moves to the panel heading on open.
- Reason dialog focus trap (the shared `Dialog`).
- Language: en and ar projects; RTL `dir` asserted.
- Blank prompt refused inline with nothing sent; 409 `reply_pending` alert with the typed text kept; 422 field refusal on the settings form; locked fields while on; read-only for AUD.

**Final prettier check** (the same command as row 4, rerun at 14:53Z on the final tree including this handback): exit 0, "All matched files use Prettier code style!".

## 4. Operations routed (pending-list delta)

None. FE-E is a web task and routes no API operation. All 9 `assistant` operations were routed by BE-T (8) and BE-U (1); their `p6-pending-be-t.ts` and `p6-pending-be-u.ts` are empty at this base. No `p6-pending-*`, `p6-exercises-*` or `contract.test.ts` file was touched, and no pinned count changes.

## 5. Needs for the orchestrator (contract, schema, dependency, ownership)

1. **Contract need: an `enabled` read for every holder of `assistant.use`.**
   - `getAssistantSetting` needs `assistant.configure` or `operations.read` (ADR-0059 §10). Those are ADM_TECH and TO, KDS, TD, AUD.
   - For the other roles that hold `assistant.use` (SP, TL, WL, IO, …) the client cannot tell whether the assistant is on. The panel therefore stays **hidden** for them (fail-closed: unknown is never shown as On).
   - So, at this revision, **only ADM_TECH, TO, KDS and TD see the panel** when it is on. ADM_ACCESS and ADM_METHOD hold `assistant.use` but not `operations.read`.
   - Proposed additive fix: either an `assistantEnabled: boolean` property on `GET /me` (D-196 item 4 style), or a `GET /api/v1/assistant/status` → `{enabled}` for `assistant.use`.
   - The web change after that is one line in `useAssistantAvailability`.
2. **Ownership:** the named lines in `Shell.tsx`, `router.tsx`, `nav.ts`, `nav.json` and `i18n/index.ts` (§1) sit outside §D.8 and were not given to any task. Please accept or move them at merge.
3. **Provisional Arabic list:**
   - The assistant texts are labelled provisional in `components/assistant/provisional-ar.ts`, bound by `assistant-i18n.test.ts`.
   - FE-A's `i18n/provisional-ar-p6.ts` is not mine and was not edited. Its test checks only the slice E/F/J/C rows, so it still passes.
   - `nav.sub.assistant` (Arabic) should be added to FE-A's list if the orchestrator wants it there.
4. **No new dependency, no migration, no schema change.** The response types are local mirrors in `components/assistant/api.ts`, because `@mth/shared/schemas` has no assistant mirror. A shared zod mirror could replace them later.
5. **No new problem code.** Every code used is in ADR-0059 §10 or is a shared one.

## 6. User-facing texts made untrue

- **Searched:** all en/ar catalogues for "AI", "assistant" and the Arabic terms. No existing text called the assistant planned, later or not available, so nothing needed correcting.
- **New texts:** they state only what ships: the local test adapter "not for production"; no endpoint tested from the product; the reference recorded but not verified.
- **`nav.areas.admin.contents`** ("Methodology, forms, workflows, automation, organization, access and branding.") does not list the AI assistant. It is not untrue, only incomplete, and it is FE-A's text; left as is.

## 7. What remains

1. The contract need of §5 item 1. Until it lands, roles without `operations.read` or `assistant.configure` never see the panel.
2. A Mobily language review of the provisional Arabic (all of `assistant.json` except the ADR's own label, the 13 problem texts, and `nav.sub.assistant`).
3. **Not run on the real stack:** the e2e asks with no focus transformation, so the test adapter answered `no_sources`/refusal and no suggestion card was produced end to end. Take to draft and the suggestion rendering are proven by unit tests against the contract shapes only. A focused-conversation e2e (create a transformation, focus the panel on it, get a `charter_draft` suggestion from the test adapter, take it to a draft) is the separable follow-up. It belongs to FE-E2 or QA-B, and depends on the test adapter producing a suggestion for a matched record.
4. **Acceptance item 3 is not met:** the integration run exited 1. It ended with a worker IPC crash (`Channel closed`) and printed no totals, after 5 failed tests in 4 files (§3 row 8). None of those files is touched by this change, which edits no API, database or integration file. The two rate-limit tests (assistant class; getSecurityRateLimits) may share a cause in the rate-limit class registry, and the contract media-type test may too; that is for BE-T, BE-E and BE-F to check. The orchestrator should run `with-pg.sh pnpm test:integration` on the merged tree.
5. **Acceptance item 2 is not met as written.** `pnpm test` exited 1 in both locales. All 4,798 tests passed in each run, but one unhandled Vitest worker RPC timeout (`onTaskUpdate`) in unit-node failed the invocation. A rerun of unit-node with the locale unset exited 0. A clean full `pnpm test` (exit 0) in both locales still needs a rerun on a less loaded machine, for example the orchestrator's merged-tree verification.
6. QA-D's A21 connection log and the A18 capture are not FE-E's work and are not claimed.

## 8. Merge instructions

- No migration and no ordering constraint against the backend; BE-T and BE-U are already merged at the base.
- Expect conflicts only in the shell lines of §1: `Shell.tsx` header, `router.tsx` route list, `nav.ts` `NAV_SUBPAGES` tail and id union, `nav.json` `sub`, and `i18n/index.ts`, if FE-B, FE-C or FE-D append there too. Union both sides.
- `problems.json`: the assistant block is appended at the end of the object. Keep it if other blocks land after it; key uniqueness is checked by `i18n.test.ts`.
- The e2e spec turns the assistant **off** at the end. If QA-D's A21 spec runs in the same stack, it still starts with `enabled: false`, but with a configured row (`configured: true`). A21 should assert `enabled: false`, not `configured: false`, or run first.
