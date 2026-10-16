# Handback T-DG5-FE-D (frontend-ux-engineer): P5 slices C, D and E screens

- **Stage / gate:** P5, DG5 (BUILDING). **Task:** T-DG5-FE-D (p5-work-split §C and §E; the FE-D row of p5-plan §5.1; D-155 cut-off pack).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-D-frontend-ux-engineer-20261016T111656Z-c1c825a3","session_id":"c1c825a3-0b13-4c9d-94f1-3a8d0da98c52"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-FE-D.md`, sha256 `c72ab308f6241484f563cb2a8250783f28af75a49d3fd7f432ca3f9714a66f34` (verified).
- **Base:** worktree `dg5/fe-d` at `4a05c4f` (integrated HEAD). Changes are **uncommitted**, as asked.
- **Time:** start `2026-10-16T11:17:12Z`; end `2026-10-16T13:08Z` (about 111 min).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, **exit 0** (at the start; re-run at the end, §3).
- All data in tests and screenshots is SYNTHETIC. Nothing here grants or records a business, Finance or IT approval. Product gates G1–G6 are not DG0–DG7, and nothing here reads or writes the engineering gate records. `#0078FF` stays a provisional token; the wordmark stays provisional.

## 1. Files changed

New (all owned by FE-D: `pages/procedure-builder/**`, `pages/procedures/**`, `pages/automation/**`, `pages/approval-routes/**`, `pages/notification-preferences/**`, `pages/admin/jobs*`, `pages/cutoff-pack/**` (D-155)):

| File | Purpose |
|---|---|
| `apps/web/src/pages/automation/ui.tsx` | FE-D UI kit: labelled status chips (icon and text, never colour alone, Unknown is neutral), the guarded action runner (If-Match, session-bound, one form-level alert with the translated problem code, reload on 409/422), the human-decision note, and the note/reason form. |
| `apps/web/src/pages/automation/api.ts` | Slice D/E client (D-144: "slices D–K add their own clients"): paths of the 39 operations my screens send (operationId in comments), query keys `["p5","fed",…]`, read hooks; types from the `@mth/shared` mirrors. |
| `apps/web/src/pages/automation/ContentEditor.tsx` | The readable rule builder: triggers from the catalogue, conditions on the trigger's fields, actions with their typed D-146 settings, run-as identity and service permissions. The six human-only decisions are listed as not automatable and cannot be chosen. |
| `apps/web/src/pages/automation/RulesPage.tsx` | `/admin/automation`: rules list (origin and enabled filters, sort, filter, paging, columns), starter-guarantee marker, create rule (starts disabled, as a draft). |
| `apps/web/src/pages/automation/RulePage.tsx` | `/admin/automation/rules/:ruleId` and the work-item link `/admin/automation-rules/:ruleId/versions/:versionNo`: facts and readable summary, enable/disable (reason; a starter says why it cannot be disabled), versions, edit draft, dry run (sample JSON, planned actions, "nothing was created"), submit, review (author excluded by the server), publish, discard, execution history. |
| `apps/web/src/pages/automation/FailuresPage.tsx` | `/admin/automation/failures` (retry/dismiss following `allowedActions`, errors translated by code), `/admin/automation/executions`, `/admin/automation/executions/:executionId` (per-action results). |
| `apps/web/src/pages/automation/fed.test.tsx` | 17 unit tests (stubbed API, en and ar), plus a check of the ADR-0043 §9 and ADR-0044 §10 texts. |
| `apps/web/src/pages/admin/jobsOperations.tsx` | `/admin/jobs/operations` and `/admin/jobs/operations/:jobCode`: last success ("Never run"), next run ("Disabled"/"Unknown"), last outcome, open failures, run now, job runs. |
| `apps/web/src/pages/procedures/api.ts` | Instance, my-step and coverage types (mirrors of the OpenAPI shapes; no shared mirror exists) and typed hooks over FE-A's `api/p5.ts`. |
| `apps/web/src/pages/procedures/MyProceduresPage.tsx` | `/playbook/procedures`: my procedure steps, launch (with an Idempotency-Key), instances list. |
| `apps/web/src/pages/procedures/InstancePage.tsx` | `/playbook/procedures/:instanceId`: pinned version, status, due date (Unknown with its reason), next action, missing inputs, inputs form, steps (parallel and conditional), complete/assign/link evidence/skip per active step, evidence and output links, cancel. Approval steps are decided only through the business approval. |
| `apps/web/src/pages/procedure-builder/ProceduresAdminPage.tsx` | `/admin/procedures`: definitions of a `procedures` version (published or draft), the new-procedure code form in an editable draft. |
| `apps/web/src/pages/procedure-builder/DefinitionPage.tsx` | `/admin/procedures/:procedureCode`: read view of every REQ-S06-001 element, plus the structured builder (validate returns every finding; save to draft with If-Match on the draft; remove). A trigger or completion left unset is omitted, so the server answers its 422. |
| `apps/web/src/pages/procedure-builder/CoveragePage.tsx` | `/admin/coverage`: methodology coverage (Covered / Planned (neutral) / Not covered), the server's totals. |
| `apps/web/src/pages/approval-routes/ApprovalRoutesPage.tsx` | `/admin/approval-routes` (resolved routes, read-only) and `/my-work/approvals/:approvalId/route` (steps, "Waiting — not notified yet", decide your step). |
| `apps/web/src/pages/approval-routes/GateConditionsPage.tsx` | `/transformations/:id/gate-conditions` (the `gate_condition_overdue` work-item link): conditions with owner, deadline, status and escalation; close (owner only). |
| `apps/web/src/pages/notification-preferences/NotificationPreferencesPage.tsx` | `/my-work/notification-preferences` (effective settings, own quiet hours/time zone/digest, the urgent policy note, the organization policy for `notification_policy.configure`) and `/me/notification-digests/:digestId` (the digest notification's link). No per-kind opt-out (D-155 a). |
| `apps/web/src/pages/cutoff-pack/CutoffPackPage.tsx` | `/transformations/:id/meetings/:meetingId/cutoff-pack`: draft agenda from the open asks, "No reviewer assigned", "not publishable until reviewed", review action (chair/secretary; the server decides). |
| `apps/web/src/i18n/{en,ar}/workflowsP5.json` | The FE-D namespace, en and ar, with identical keys. |
| `apps/web/e2e/p5-procedures-automation.spec.ts` | 6 Playwright journeys × 2 languages against the real API. |

Modified (shared files, appended lines or the FE-B precedent):

| File | Change |
|---|---|
| `apps/web/src/app/router.tsx` | Appended the lazy imports and 19 route lines after the FE-B block. The FE-D placeholder rows are retired: the `P5_SUBPAGES` filter now also excludes `"FE-D"`, and the five explicit FE-D rows are replaced by a comment (FE-B's precedent). |
| `apps/web/src/app/nav.ts` | Appended the `jobOperations` sub-entry (Administration, `requiresAny: ["job.read"]`) and its id. The landing contents for "procedures" (Playbook) and "approvals" (Governance) now link to the delivered screens instead of "not available yet" (F-DG4-160). |
| `apps/web/src/app/p5-shell.test.tsx` | My five features removed from the placeholder list; asserts no FE-D placeholder remains and that my routes exist (FE-B precedent). |
| `apps/web/src/i18n/index.ts` | Appended the `workflowsP5` import and catalogue lines. |
| `apps/web/src/i18n/{en,ar}/problems.json` | Appended 40 slice D/E problem codes (§6). |
| `apps/web/src/i18n/{en,ar}/nav.json` | Appended `nav.sub.jobOperations`. |
| `apps/web/src/i18n/{en,ar}/admin.json` | `admin.plannedSections` corrected: procedures, approval routes, automation and job operations are available; only forms and branding remain "not available yet" (F-DG4-160). |
| `apps/web/src/pages/meetings/MeetingPage.tsx` | Appended a link to the meeting's cut-off pack (D-155: "wire it from the meeting page with an appended link"). |
| `apps/web/src/pages/approvals/ApprovalsPage.tsx` | Appended a link from the approval detail to its route page. A routed approval refuses the DG4 decision with 422 `approval.decide_through_route`, so the decision lives on the route page. |

Evidence: `docs/delivery/handbacks/DG5/T-DG5-FE-D-evidence/` (logs per check, `summary-A.txt`, `summary-B.txt`, `screenshots/{en,ar}/p5-*.png`).

## 2. Behaviour delivered, per requirement row (acceptance quoted)

- **REQ-S06-001** — "A06: a procedure with a conditional and a parallel step publishes and runs; a definition missing a trigger or completion condition is rejected".
  - The builder authors every element (purpose, trigger, scope, prerequisites, inputs and input schema, steps with position, parallel group and condition, roles, SLA, validation rules, approval and escalation paths, outputs, completion, exceptions, effective date) inside a `procedures` draft. Publishing is the Studio's publish (BE-F: no separate procedure publish).
  - e2e (en and ar): validation lists both `procedure_definition.trigger_required` and `completion_required`; the save is refused with the 422; a seeded definition is edited and "Saved to the draft. This is not published".
  - Not done here: the A06 publish-and-run of a conditional+parallel definition through the UI (QA-A's A06).
- **REQ-S06-002** — "A02: a baseline-validation instance shows its current step and assignee; completing it creates a validated baseline record linked to the instance".
  - e2e (en and ar): the lead launches `baseline_validation`; the instance shows the active step `record_baseline`, the assignee role BO, the due date and the 5 missing inputs. Completing the BO step as the TL is refused with 403 `procedure_step.not_assignee` (translated).
  - The output links list shows linked records. The full complete-and-validate chain needs BO and FIN users that the dev seed lacks; it is QA-E's A02.
- **REQ-S12-001** — "A13: each execution is recorded with rule version, trigger event and outcome".
  - The execution history (per rule and global) shows the version, trigger event, outcome, conditions, attempt and translated error; the execution detail shows the per-action results.
  - The e2e stack has no worker, so no execution is produced there; the history renders its empty state.
- **REQ-S12-002** — "A06;A13: a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions".
  - e2e (en and ar): readable builder → submit before a dry run refused (422 `automation_rule_version.dry_run_required`) → dry run Pass, showing what each action would do and "Nothing was created" → TO review → publish → enable → disable with a reason. A starter shows why it cannot be disabled and offers no disable action.
  - Failure queue: retry with If-Match and translated refusals (unit). "Without duplicating actions" is the server's guarantee (BE-I); the UI shows `existing` results.
- **REQ-S12-022** — "A22: the jobs screen shows last success and next run for each scheduled job; a non-admin gets 403".
  - e2e (en and ar): "Never run" and a computed next run for each job; run now; the auditor gets the no-permission state from the server's 403.
- **REQ-S04-011** (FE-D part: "the conditions list") — the gate-conditions screen lists conditions with owner, deadline, Open/Overdue/Closed and escalation, and the owner closes one. The conditional decision itself stays on the DG4 gate screen. e2e shows the real empty state; no conditional G5 is created in e2e.
- **REQ-S10-015** — "A06;A08: in a sequential route step 2 is not notified until step 1 approves; in a parallel route both are notified at once".
  - The route page shows each step's status and notification time ("Waiting — not notified yet" until activated); unit-tested for the sequential case.
  - The admin list shows the resolved routes. The seeded methodology has none, so e2e shows "No approval route is configured".
- **REQ-S12-025** — "A09: a non-urgent reminder due in quiet hours is delivered in the next digest; an urgent escalation is delivered immediately".
  - The preferences screen sets quiet hours (may span midnight), time zone and digest, and states the urgent policy (always immediate).
  - e2e (en and ar): equal start and end refused with 422 `notification_preference.quiet_hours_invalid`; 22:00–07:00 with a daily digest saved and shown as effective; reset to "deliver at once" afterwards. Delivery itself is BE-L's.
- **REQ-S12-015** (D-155) — "A13;A15: cut-off creates one draft agenda containing current open asks; it is not published without review".
  - The pack screen shows the draft agenda (one item per open ask), "No reviewer assigned", "not publishable until reviewed", and the review action (unit: If-Match, 403 `not_reviewer` translated).
  - e2e shows the "No cut-off pack yet" state only: the e2e stack runs no worker, so no pack is generated there.
- **REQ-S01-003** (route registered for FE-D) — the coverage view shows each element with its linked form or procedure and the server's totals; "Planned" is neutral, never green (e2e screenshot).

## 3. Checks actually run (real exit codes)

The environment is in the logs. Ports: e2e 23351/23352 (pool 23353–23379); integration 23380 (pool 23381–23399).

| Check | Command | Exit | Result |
|---|---|---|---|
| Historical validator (start) | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | PASS gate DG4 (historical) |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` |
| Lint | `pnpm lint` | 0 | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" |
| OpenAPI lint | `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE pnpm test` | **0** | 2160 / 1446 / 259 + 2 skipped. Web went from 1429 to 1446 = my 17 new tests. |
| Unit, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | 2157 passed + 3 failed (node: `architecture.test.ts` 30 s timeout; two Arabic `pdf.test.ts` renders, 5 s timeouts); web 1445 passed + 1 failed (`raid.test.tsx` "action register… edit sends If-Match", a findByRole wait); 259 + 2 skipped. **Disclosed below.** |
| Integration | `QA_PG_PORT=23380 MTH_PORT_POOL=23381-23399 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | 2659 passed + 1 skipped (272 files), ended 13:37:26Z (`integration.log`, `summary-B.txt`). No pinned-count change. |
| FE-D e2e spec (focused) | `with-stack.sh npx playwright test apps/web/e2e/p5-procedures-automation.spec.ts --workers=1` | 0 (run 3) | 12/12 passed |
| Full web e2e | `E2E_PG_PORT=23351 E2E_API_PORT=23352 MTH_PORT_POOL=23353-23379 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | 382 passed + 4 failed in 1.1 h, ended 14:07:46Z (`e2e-full.log`). **Disclosed below**; the 4 specs then passed in full: 68/68, exit 0 (`e2e-rerun-failed-specs.log`). |
| Historical validator (end) | `node tools/gates/validate.mjs --historical --stage DG4` | **0** | PASS gate DG4 (historical), `validate-historical-DG4-end.log` |

Non-zero runs disclosed:
- **Unit, C.UTF-8 (exit 1): 4 timeouts under load, none in FE-D code.** This run executed while the integration suite ran in parallel. The four tests passed in the locale-unset run of the same tree.
  - `raid.test.tsx`: re-run alone in C.UTF-8 passes 18/18 (`unit-c-utf8-rerun-raid.log`, exit 0).
  - `architecture.test.ts` and `pdf.test.ts`: re-run while integration was still loading the machine, they timed out again (`unit-c-utf8-rerun-timeouts.log`, exit 1: 148 passed, 4 timed out).
  - These are the load timeouts D-160(d) already lists under F-DG4-143–148 (`architecture.test.ts`, `pdf.test.ts`, a `raid.test.tsx` wait). I changed no file under `apps/api`, `packages/` or `pages/raid`.
  - **Not verified as passing in C.UTF-8 by me**: the orchestrator's merged-tree verification should confirm them on an unloaded machine.
- **Integration and full e2e finished after the first draft of this handback** (the background job ran on). Integration exit 0. Full e2e exit 1 with 4 failures:
  - (a) `p5-procedures-automation.spec.ts` jobs test (ar): **my test defect.** It assumed `approval.escalation_scan` had never run, but over a 1.1 h suite the job had run, so the cell held a last-success time. The product was correct. Fixed: the assertion accepts a recorded time or "Never run", never an empty cell or a guessed time.
  - (b) `p2-journeys.spec.ts:828`, `p4-benefits.spec.ts:454` and `p4-dashboards.spec.ts:295` (ar): 30 s test timeouts with no assertion failure, in DG2–DG4 specs I did not touch.
  - Re-run of these four spec files in full on a fresh stack, with the fixed test: **68 passed, exit 0** (`e2e-rerun-failed-specs.log`).
- **FE-D spec run 1** (`e2e-fed-spec-run1-failed.log`): 10/12. axe found `scrollable-region-focusable` on the dry-run table, a real keyboard-access defect. Fixed by making every FE-D table scroll region focusable and labelled (`tabIndex=0 role=region aria-label`, the existing ChangeRequest/Closure pattern).
- **FE-D spec run 2** (`e2e-fed-spec-run2-failed.log`): 10/12. A strict-mode locator in my test matched two "Pass" chips. The test was fixed; the product was correct.
- **Unit tests during development**: the first `fed.test.tsx` run had 5 failures from test bugs (a duplicate text match, a race with the catalogue load, `waitFor` not retrying on null). The tests were fixed; 17/17 since.
- Run 3 of the spec: 12/12.

Pinned counts: no contract change. The media-type triple and rate-limit floor are unaffected; I add no API route.

## 4. Operations routed (delta to my pending list)

None. FE-D has no `p5-pending-fe-d.ts` and routes no API operation. All 16 slice C and 39 slice D/E operations were routed by BE-F…BE-L2. The screens consume 51 of them: all 16 slice C operations, and 35 of the 39 slice D/E operations. The four not sent are `updateAutomationRule` (the rule's names and owner cannot be edited from the UI yet: §7), `getAutomationFailure` and `getAutomationRuleVersion` (the screens use the list reads), and `listDependencySlips` (no FE-D screen in §5.1). `contract.test.ts` is unaffected.

## 5. Contract, schema or dependency needs

- **No new dependency.** No contract or schema change.
- The procedure instance, my-step and coverage shapes have no `@mth/shared` mirror, so they are mirrored as TypeScript interfaces in `pages/procedures/api.ts`. A shared zod mirror (BE-F2/BE-G) would remove the duplication.
- `FIELD_TYPES` is not exported to the web. The builder reads the list from `procedureInputField.shape.fieldType.options`, so there is no second copy.

## 6. User-facing texts my work made untrue, and what I did

- `admin.plannedSections` (en/ar) said workflow and automation settings were not available: corrected. It still says forms and branding are not available yet; FE-C (forms) and FE-G (branding) own those words. FE-C may edit the same string: expect a one-line merge.
- Landing contents: Playbook "procedures" and Governance "approvals" moved from `p5` ("not available yet") to links.
- The FE-D placeholders (`nav.p5.*`) are no longer rendered for my routes. Their `title`/`summary` texts are reused as the real screen titles; they describe the screens truthfully.
- **For another owner (`myWork.json`, not mine):** the four rule-action message keys (`automation.message.follow_up`, `review_needed`, `update_due`, `attention_required`) have no `myWork.message.*` text. A task created by an admin rule would show an untranslated key in My Work. Owner: FE-A / the My Work owner; proposed en/ar texts: see `workflowsP5.message.*`.
- Problem codes: 40 keys added to `problems.json` en/ar, with the exact ADR-0043 §9 / ADR-0044 §10 English texts, the execution error codes, and `validation.service_permissions_need_service`. That last code is not in an ADR table; its proposed text is "Only a rule that runs as the service identity can hold service permissions.". `transformation.launch_start_invalid` was left to the transformation-create owner (FE-F/BE-P).

## 7. What remains / known gaps

0. **Check still to run (orchestrator):** a C.UTF-8 unit run of `architecture.test.ts` and `pdf.test.ts` without parallel load. The fixed jobs e2e test passed in the four-spec re-run, but the full suite has not been re-run since that fix. My own e2e spec passed 12/12 against the real API (`e2e-fed-spec-run3.log`). The separable second half of this task is these verifications plus items 1–3 below.

1. **Polish (Low):** on the rule page, a `dry_run_required` alert shown before a dry run stays visible after a successful dry run, because the dry-run panel has its own runner. Fix: clear the page runner when the dry run succeeds.
2. Live end-to-end of executions, failures, retries, cut-off pack generation and route steps: the e2e stack runs no worker and seeds no BO/FIN users, so those screens are exercised with stubbed responses (unit) and their real empty states (e2e). The live chains are QA-A (A06/A13) and QA-E (A02).
3. Editing a rule's names, description or owner (`updateAutomationRule`) has no UI yet; the content and lifecycle do.
4. The procedure-step assign picker needs `user.read`. Without it the list is empty and the server still decides.
5. Merge notes: `router.tsx` (the `P5_SUBPAGES` filter line and the removed FE-D rows), `p5-shell.test.tsx` (the features list) and `admin.json` will overlap with FE-C's edits of the same lines. Keep both tasks' exclusions.
