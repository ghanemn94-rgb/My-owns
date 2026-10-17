# Handback T-DG5-FE-C2 (frontend-ux-engineer), DG5 / P5, repair task (D-163)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-C2-frontend-ux-engineer-20261017T013312Z-66c241a9","session_id":"66c241a9-0d05-423e-9cab-20e5ee7284c9"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-C2.md`, sha256 `949a8769…c0bf` (verified).
- **Base:** branch `dg5/fe-c2` at `f21a536` (D-163). Changes are **uncommitted**, as asked.
- **Time:** start `2026-10-17T01:33:26Z`; end `2026-10-17T03:35:11Z` (past the ~2 h limit by a few minutes, spent on the final fixes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start (log `val-start`, quoted in §5) and at the end (§5).
- No product gate is granted or recorded. All data in the tests is SYNTHETIC; the form-builder review in the e2e is a synthetic in-product configuration review that approves nothing real, and nothing here reads or writes DG0–DG7 records.

## 1. Changed files

### Framework (`components/form-framework/**`, owned)

| File | Purpose |
|---|---|
| `components/form-framework/ExtensionEntry.tsx` (new) | `useExtensionEntry` / `useExtensionCreate`: the pinned version's extension fields in a **create** form, rendered with the framework's `ExtensionInput`, checked with the API's own validators before the create, then stored after the create with `putFormRecordCustomFields` and `If-Match: "0"`. A server refusal after the create is shown by its problem code (`data-state="extension-save-failed"`). `guard(schema)` adds the check to a `RecordDialog` create schema. `ExtensionValues`: the read-only **record view** (Unknown / Not computable, never 0; no per-record read while the form has no extension field). `RecordExtensionTools` and `extensionToolsColumn`: the record view plus the Form tools entry (edit with If-Match, drafts, history, comments, attachments, recoverable conflict) for one record or a register column. Create inputs are offered only with the record type's `writePermission` (from the served schema). |
| `components/form-framework/FormFramework.tsx` | `ExtensionInput` exported. The changed extension values are checked locally before the PUT. A field error goes through the new `extensionFieldError`, so out-of-range names the limit, both locally and for the server's code (F-DG5-QA-A-4). The source fieldset is hidden when a host passes no source fields, because the register's own dialog edits them. |
| `components/form-framework/api.ts` | `checkExtensionValue` (shared `defineField` + `validateFieldValue`, `percentageBareAs: "fraction"` as the API uses), `rangeLimitsOf` (percentage limits as percents via decimal.js), `extensionErrorKey`. |
| `components/form-framework/index.ts` | Barrel lines for the new exports. |
| `components/form-framework/extension-fields.test.tsx` (new) | Unit tests (§4). |
| `i18n/en/forms.json`, `i18n/ar/forms.json` | Appended block `forms.extensions.*`: `createIntro`, `createdWithoutValues`, `valuesUnavailable`, `viewTitle`, `columnHeader`, `range.{min,max,between}` (en and ar). No `problems.json` key was needed: every code these screens can receive already has en/ar text (`validation.*`, `form_record.*`, `form_draft.*`, `form_attachment.*`, `form_comment.*`), and the out-of-range text is a framework message, not a new problem code. |
| `apps/web/e2e/p5-extension-fields.spec.ts` (new) | e2e of T13 in en and ar (§4). |

### Hosting lines on the T02–T16 pages (the framework hosting lines and the header line only)

Each page gets: one import block (marked `T-DG5-FE-C2`), the `TemplateProvenance` header line, the hook line `useExtensionCreate("Txx")`, the create inputs in the dialog's slot plus the check and `afterCreate` lines in its submit or done handler, the outcome line, and the record view with Form tools.

| Record type | File(s) | Header | Create form | Edit (Form tools) | Record view |
|---|---|---|---|---|---|
| T02 `outcome` | `pages/define/DefinePage.tsx` | `#t02` | outcome `RecordDialog` | each outcome card | each outcome card |
| T03 `tom_gap` | `pages/design/DesignPage.tsx` | `#t03` | gap `RecordDialog` | register column | register column |
| T04 `decision` (design) | `pages/decisions/DecisionsPage.tsx` | `#t04` | decision `RecordDialog` | register column | register column |
| T05 `initiative` | `pages/portfolio/PortfolioPage.tsx`, `pages/portfolio/InitiativePage.tsx` | `#t05` card | portfolio create `RecordDialog` | initiative T05 card | initiative T05 card |
| T06 `initiative_score` | `pages/prioritization/Scorecard.tsx` | `#scorecard` | — (no create form: scores are created inline by the scorecard save; values are entered with Form tools once the score exists) | one entry per saved criterion score, after the scorecard `<form>` | same |
| T07 `roadmap_wave` | `pages/roadmap/RoadmapPage.tsx`, `pages/roadmap/waves.tsx` | `#waves` | add-wave `RecordDialog` | waves table column | waves table column |
| T08 `dependency` | `pages/dependencies/DependenciesPage.tsx` | `#map` | `DependencyDialog` (create) | T08 table column | T08 table column |
| T09 `benefit_formula` | `pages/benefit-formulas/BenefitFormulasPage.tsx`, `BenefitFormulaPage.tsx` | `#t09`, `#t09-row` | `CreateFormulaDialog` (a refusal keeps it open; a resubmit replays the create with the same idempotency key) | formula page `#t09-row` | formula page |
| T11 `transformation_decision_right` | `pages/decision-rights/DecisionRightsPage.tsx` | `#decision-rights` | `RowDialog` (add) | register column | register column |
| T12 `transformation_raci_deliverable` | `pages/raci/RaciPage.tsx` | `#raci` | `AddDeliverableDialog` | each deliverable row header | same |
| T13 `stakeholder_group` | `pages/adoption/AdoptionPage.tsx` | `#t13` | `GroupDialogForm` (create) | register row actions (`data-form-tools`) | "Extension fields" column (when the pinned form has extension fields) |
| T14 `benefit` | `pages/benefits/BenefitsPage.tsx` | `#benefit-register` | `CreateBenefitDialog` (a refusal shows on the register and skips the navigation) | existing `BenefitPage` framework (FE-C) | existing `BenefitPage` framework |
| T15 `raid_entry` | `pages/raid/RaidPage.tsx` | `#raid-register` | `CreateEntryDialog` | register row actions | register row actions |
| T16 `decision` (executive) | `pages/executive-decisions/ExecutiveDecisionsPage.tsx` | `#t16-log`, `#t16-decision` | `CreateDecisionDialog` | decision page | decision page |

T01 already hosted the framework (FE-C) and its header (FE-G). T10 is the dashboard read model, not a form (ADR-0041 §1).

## 2. Behaviour delivered, per requirement row

**REQ-S06-004.** Acceptance: *"A06: an admin adds a field to T13, changes a validation rule and changes an approver route in the UI; after publish, with no deployment or application-code change, a new T13 record stores the new field, the changed rule rejects a value it previously accepted, and a submission is routed to the new approver"*. Also A06 / REQ-S20-006, *"a new published version works without application-code changes"*, and F-DG5-QA-A-2.

- The T13 stakeholder-group screen now offers the published extension field in the create form and in Form tools, and shows it in the record view, in en and ar.
- The value is saved through `putFormRecordCustomFields`: `If-Match: "0"` on a create, or the stored version on an edit.
- A new T13 record stores the field: proven live in `p5-extension-fields.spec.ts`, and by `e2e/a06-configuration-change.spec.ts` › *"a field added to T13 in Studio can be entered on a stakeholder record of a new transformation"*, which passes **unchanged** in en and ar (§5).
- The same works on T02–T16 (table in §1). The rule-change and approver-route clauses are A06's first test, which also passes unchanged.

**F-DG5-QA-A-4** (Low; REQ-S06-004 UX). A well-formed number (or percentage, or date) outside the field's `min`/`max` now shows *"Enter a value from 0 to 100."* / *"أدخل قيمة من 0 إلى 100."* (or "at most" / "at least"), not the decimal-format hint.

- **Local:** the web runs the API's own validators before sending, so nothing is sent.
- **Server:** the server answers a range refusal with `validation.decimal` / `validation.percentage` / `validation.date` and no reason field. When the refused value is out of the served limits, that code is shown with the limit too (`extensionErrorKey`).
- A malformed number keeps the decimal-format text.
- **Tests:** unit (both paths), plus e2e in en and ar (`fec2-t13-create-out-of-range.png`). A06's step 3 (`aria-invalid`, no notice, `version` 0) still passes.

**REQ-PB-011.** Acceptance: *"A01: all four questions render verbatim (en) with ar translations; every seeded template has exactly one question tag"*, with D-163's addition *"shown in form headers and the Playbook reader"*. FE-G's `TemplateProvenance` (provenance badge, question tag, source links) is now in the form header of T02–T16, as `DiagnosePage` has it for T01. There is one unit test per page, in en and ar (12 screens, §4). T05 (initiative page) and T06 (scorecard) have the line too, but their unit test is not written (§8).

## 3. Interaction checks run (UI)

- **Keyboard and labels:** every extension input is a labelled `Field` (the label is the field's label in the screen language, plus a type hint). Errors are tied through `aria-describedby` and `aria-invalid`. Form tools is a button with a screen-reader record name; its tabs keep FE-C's arrow, Home and End keys.
- **axe:** 0 serious/critical issues on the 4 screens of my spec in en and ar, and on A06's screens (both passed `expectAccessible`).
- **`<html lang/dir>`:** checked on each screen. No foreign request. No `DG0–7` text.
- **States:**
  - loading: an extension value shows "Loading…";
  - error: "Extension values could not be read.";
  - Unknown and Not computable: chips, never 0;
  - no permission: read-only Form tools and no create inputs (unit test);
  - post-create refusal: the outcome banner with the problem text (unit test);
  - 409: unchanged FE-C conflict view;
  - draft vs saved: unchanged FE-C labels.
- **Visual evidence:** `T-DG5-FE-C2-evidence/screenshots/{en,ar}/fec2-t13-field-added.png`, `fec2-t13-create-out-of-range.png`, `fec2-t13-record-view.png`, `fec2-t13-form-tools.png`. Only my spec's screenshots are kept (D-162); the A06 screenshots from the same run were deleted.

## 4. Tests added

- `apps/web/src/components/form-framework/extension-fields.test.tsx`: 39 tests.
  - Checks and range texts, including the server code path.
  - T13 in en and ar:
    - the record view and Form tools value;
    - Form tools out of range → no PUT, then a PUT with `If-Match: "1"`;
    - the server's own code shown when no limit is served;
    - create: out of range → no POST; a valid value → POST, then PUT `If-Match: "0"` with the body;
    - a post-create 422 shown by its code;
    - the reader's read-only view.
  - The REQ-PB-011 header on 12 screens × en/ar.
- `apps/web/e2e/p5-extension-fields.spec.ts`: the T13 main path and its main refusal, live, in en and ar (§5).

## 5. Checks (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-FE-C2-evidence/`)

**Environment:** Node 24.21.0, offline. Ports were 23951–23999 only. The machine has 16 GB RAM (about 2 GB free at times), 4 cores, and was shared with four other W18 tasks. My integration run overlapped the unit run (disclosed). Up to 03:28Z the runs used the tree before the last three fixes (see "Final fixes" below). The reruns after those fixes are listed separately.

| Check | Command | Result |
|---|---|---|
| DG4 historical (start) | `node tools/gates/validate.mjs --historical --stage DG4` | **exit 0**, `PASS gate DG4 (historical)` (`validate-dg4-start.log`) |
| DG4 historical (end) | same | **exit 0** (`validate-dg4-end.log`) |
| typecheck | `pnpm -r typecheck` | **exit 137 (SIGKILL; OOM on the shared machine) — NOT PASSED.** design-tokens, shared, config, reporting, **apps/web** and db reported `Done`. `apps/api` `tsc` was killed after about 9 min. No API file is changed by this task. Not re-run within the limit. A later `apps/web` `tsc --noEmit` after the final fixes ran clean (no output). |
| build | `pnpm -r build` | **exit 0** (`build.log`) |
| lint | `pnpm lint` | **exit 0** (`lint.log`), run before the final fixes |
| prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (`prettier.log`), run before the final fixes. The fixed files were re-formatted with `prettier --write`. The top-level untracked files `.bashrc`, `.zshrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile` and `CLAUDE.local.md` were present from the start, are not mine, and were included in this check. |
| OpenAPI lint | `pnpm openapi:lint` | **exit 0** (`openapi-lint.log`) |
| unit, locale unset | `env -u LANG -u LC_ALL … pnpm test` | **exit 1** (`unit-locale-unset.log`): unit-node 2243/2252 passed (9 failed), unit-web 1567/1573 passed (6 failed), unit-formula-nocodegen 259 passed + 2 skipped. See "Unit failures" below. |
| unit, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 1** (`unit-c-utf8.log`, completed after the handback was first written): unit-node 2245/2252 passed (7 failed: the same timeouts in `pdf.test.ts` (6) and `architecture.test.ts` (1)); **unit-web 1573/1573 passed** (its project ran after the final fixes, and includes `raid.test.tsx` and `extension-fields.test.tsx`); unit-formula-nocodegen 259 passed + 2 skipped. |
| integration | `QA_PG_PORT=23960 MTH_PORT_POOL=23961-23999 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 1** (`integration.log`, completed after the handback was first written): 2878 passed, 1 skipped, 5 failed (287 files, 3 failed). This is **identical to the D-163 baseline** (2878 / 1 / 5). The 5 are the QA tests kept failing on purpose for other W18 tasks: `a06-configuration-change.test.ts` (1, F-DG5-QA-A-1 → BE-C3), `a15-demo-transformation-outputs.test.ts` (3) and `a15-outputs-every-definition.test.ts` (1) (→ BE-N2 / KBE-D3). Pinned-count change: none. |
| e2e, targeted | `E2E_PG_PORT=23951 E2E_API_PORT=23952 MTH_PORT_POOL=23953-23999 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p5-extension-fields.spec.ts e2e/a06-configuration-change.spec.ts --workers=1` | **exit 0, 6 passed** in en and ar: my T13 spec, A06 main, and **A06 "a field added to T13 in Studio can be entered on a stakeholder record of a new transformation" (unchanged)** (`e2e-targeted.log`) |
| e2e, full web suite | `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **NOT RUN** (time limit). |

**Unit failures (locale-unset run) and what was done:**

- `packages/reporting/src/pdf/pdf.test.ts` (8) and `apps/api/src/architecture.test.ts` (1): **timeouts** ("Test timed out in 5000ms" / "30000ms"). In an isolated rerun, 5 of the 152 tests in these 2 files still timed out (`unit-node-failed-files-rerun.log`, exit 1) while the machine was saturated. Neither file nor anything they read is changed by this task. They're reported as failed, not passed.
- `src/i18n/glossary.test.ts` (1): **my defect.** My Arabic `forms.extensions.createIntro` wrote تحولك without the shadda. It's fixed to تحوّلك.
- `src/components/form-framework/form-framework.test.tsx` (2, FE-C's T14 test in my `form-framework/**`): it typed `150%` to test that a server 400 lands on its field. The new local check (F-DG5-QA-A-4) now refuses `150%` before sending, with the range text. The test now types `0.5`, which the local check accepts, so it still proves the server's code lands on the field, translated.
- `src/pages/benefit-formulas/benefit-formulas.test.tsx` (2, auditor read-only): it counted my Form tools button as a control. Fixed in the product: Form tools is offered only with the record type's write permission or `form_record.comment`, and every reader still sees the values in the record view.
- `src/pages/raid/raid.test.tsx` › "action register: source, follow-up date and overdue flag; edit sends If-Match" (`/actions`, en and ar): **Not reproduced in the full C.UTF-8 run** (unit-web 1573/1573 passed there), but it failed in the locale-unset run and in the isolated rerun, so it is intermittent and its cause is unresolved. `ActionsPage` imports only `raid/api.ts` and `raid/ui.tsx`, which this task does not change; my only RAID edit is `RaidPage.tsx`, the register. The test asserts an "overdue" flag on a fixed fixture date, so a date-dependent fixture is a plausible cause, but I didn't prove it within the limit. It needs the owner's or the orchestrator's check against the base `f21a536`.

**Final fixes rerun:** `npx vitest run --project unit-web` over the 4 failing files plus `extension-fields.test.tsx` gives **97 passed, 2 failed (exit 1)**: only the two `raid.test.tsx` cases above (`unit-web-fixed-files-rerun.log`). `extension-fields.test.tsx`: 39/39.

## 6. Operations routed (pending-list delta)

None. This task adds no API route and calls only operations that BE-D/BE-E/BE-E2 already routed (`getTransformationFormSchema`, `get/putFormRecordCustomFields`, and the framework's history/comments/attachments/drafts reads). FE tasks own no `p5-pending-*.ts`. Pinned-count delta in `contract.test.ts`: **0**.

## 7. Contract, schema or dependency needs

- No new dependency, contract, schema or migration.
- **Note for the orchestrator (no change made):** the 400 of `putFormRecordCustomFields` for an out-of-range value carries the field code (`validation.decimal`, etc.), but not the validator's `params.reason`/limit (`forms/custom-values.ts:236` maps only `pointer`/`code`/`message`). The web therefore derives the range message from the served settings. If the server ever validates against limits the web was not served, the user sees the code's own text, which is correct but less specific. Adding `params` to field errors would be a contract change, not made here.
- **Untrue texts:** none found. No en/ar string calls extension fields on T02–T16 "planned" or limited to T01/T14. The `forms.*.planned` texts are about the `planned` record types (launch plan, health check), which are unchanged.

## 8. What remains (stated plainly)

1. **The twelve extension record types of ADR-0041 §1 (the separable second half, D-059/D-070): NOT DONE.** Evidence, baseline, value pool, resource plan, funding approval, change request, meeting record, corrective plan, lesson, BAU handover and control have no create inputs or record view yet. `procedure_definition` takes no custom fields (`custom_fields_allowed = false`). The framework pieces (`useExtensionCreate`, `RecordExtensionTools`, `extensionToolsColumn`) are ready, so each page needs only the same hosting lines as in §1.

   | Record type → screen | Done? |
   |---|---|
   | T13 → `/adoption` (stakeholder groups) | done |
   | T02 → `/define` (outcomes), T03 → `/design`, T04 → `/decisions`, T05 → `/portfolio` + `/initiatives/:id`, T07 → `/roadmap`, T08 → `/dependencies`, T09 → `/benefit-formulas` + `/:formulaId`, T11 → `/decision-rights`, T12 → `/raci`, T14 → `/benefits` (create; edit/view were FE-C's), T15 → `/raid`, T16 → `/executive-decisions` + `/:decisionId` | done |
   | T06 → `/prioritization` scorecard | view + Form tools done; **no create form exists** (scores are saved inline), so values are entered through Form tools after the score is saved |
   | the 11 extension types above (and `charter`, `tom_canvas`, `business_case`, which accept custom fields but were not in the ordered scope) | **not done** |

2. T01: FE-C's Form tools covers edit and view. T01 items are filled per dimension, and the fill (create) dialog does not yet carry the extension inputs. **Not done.**
3. Unit header tests for T05 and T06: the header lines are in place, but those two pages need record fixtures, so they're **not unit-tested**. The other 12 are.
4. **Checks not completed (time limit):**
   - `pnpm -r typecheck` (the apps/api part was OOM-killed);
   - `pnpm test` under `C.UTF-8`;
   - the full web e2e suite;
   - `pnpm lint` and the repository prettier check after the last three small fixes.

   The orchestrator should run them on the integrated tree. The `raid.test.tsx` `/actions` failure is unresolved (§5).
5. Create inputs sit in the dialog's top `note` slot on `P4FormDialog` screens (T11, T12, T13, T14, T15, T16), because `pages/my-work/p4ui.tsx` isn't mine and has no lower slot. `RecordDialog` and custom-dialog screens show them after the source fields.

## 9. Merge instructions

- No migration.
- Expected merge contacts: appended `forms.json` lines (a new `extensions` block at the end of en/ar `forms.json`), plus the per-page import blocks.
- FE-G2 owns `Shell.tsx`, `nav.ts`, `studio/**`, `reports/**`, `design-tokens/**` and `journeys.spec.ts`; none is touched here.
