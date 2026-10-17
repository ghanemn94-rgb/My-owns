# Handback T-DG5-FE-C3 (frontend-ux-engineer), DG5 / P5, repair task (D-164)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-C3-frontend-ux-engineer-20261017T060359Z-cf6c8741","session_id":"cf6c8741-25d5-4034-b461-70f26e962e9b"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-C3.md`, sha256 `3eb36050…4032e` (verified with `sha256sum`).
- **Base:** branch `dg5/fe-c3` at `bed3619`. Changes are **uncommitted**, as asked.
- **Time:** start `2026-10-17T06:04:13Z`; end `2026-10-17T07:21:31Z` (about 77 minutes, within the limit).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start and at the end (§5).
- No product gate is granted or recorded. All data in the tests is SYNTHETIC. The configuration review in the e2e is a synthetic in-product review and approves nothing real. Nothing here reads or writes DG0–DG7 records.
- **Scope 3 (`raid.test.tsx`) does not apply:** D-164 (j) says that test passed in both locales in the W18 verification. It also passed in both of my unit-web runs (§5). I did not change it.

## 1. Changed files

All hosting lines carry the marker comment `T-DG5-FE-C3`. Each host uses FE-C2's framework pieces unchanged (`useExtensionCreate`, `RecordExtensionTools`, `extensionToolsColumn`), with FE-C2's hosting lines:

- the hook;
- the create inputs (`ext.node`) in the create dialog;
- the check (`ext.guard(schema)` for `RecordDialog`/`InlineRecordForm`, `ext.check()` in a `P4FormDialog` `toBody` or a custom submit);
- `ext.afterCreate(created)` after the register's own create;
- the outcome line (`ext.outcome`) on the register;
- the record view with Form tools.

| File | Lines added |
|---|---|
| `pages/evidence/EvidencePage.tsx` | `evidence`: hook, create inputs in the add-evidence `RecordDialog` (all four kinds), register column, outcome |
| `pages/diagnose/DiagnosePage.tsx` | **T01 fill dialog**: hook, create inputs and check when the dimension has no item yet, `afterCreate`, outcome. **`baseline`** and **`value_pool`**: hook, create inputs, register column, outcome |
| `pages/capacity/CapacityPage.tsx`, `pages/capacity/editing.tsx` | `resource_plan`: hook, an "Form tools and extension fields" column in the demands table, outcome; `DemandDialog` gains an optional `ext` prop (create branch only) |
| `pages/portfolio/funding.tsx` | `funding_approval`: hook, create inputs in `FundingDialog`, record view and Form tools on each decision in the history. A funding decision has no `version` column, so the host passes `version: 1`, which is what the server's `currentRecordVersion` reads for it (`forms/drafts.ts`) |
| `pages/change-requests/ChangeRequestsPage.tsx`, `CreateChangeRequest.tsx`, `ChangeRequestPage.tsx` | `change_request`: hook, create inputs in the create dialog's note, register column, record view on the request page. A refusal after the create keeps the user on the register (no navigation), so the outcome is visible |
| `pages/meetings/MeetingsPage.tsx`, `MeetingPage.tsx` | `meeting_record`: hook, create inputs, register column, record view in the meeting header |
| `pages/raid/CorrectivePages.tsx` | `corrective_plan`: hook, create inputs, register column, record view on the case page |
| `pages/lessons/LessonsPage.tsx` | `lesson`: hook, create inputs (create only, not edit), register column |
| `pages/bau/HandoverPage.tsx` | `bau_handover`: hook in `HandoversTable` (both the handovers page and the area page), create inputs, register column, record view on the handover page |
| `pages/bau/ControlsPage.tsx` | `control`: hook in `ControlsTable`, create inputs, register column |
| `pages/define/CharterPage.tsx` | `charter`: hook hoisted to `CharterBody`, so a refusal stays shown after the created charter replaces the form. Create inputs in the create `InlineRecordForm` (not on a new version). `afterCreate` gets `saved.charter`, because `createCharter` answers with a `CharterView`. Record view and Form tools in the charter fields section |
| `pages/design/DesignPage.tsx` | `tom_canvas`: record view and Form tools in the per-dimension view. No create form (see §2) |
| `pages/business-cases/BusinessCasesPage.tsx`, `BusinessCasePage.tsx` | `business_case`: hook, create inputs in the custom `CreateCaseDialog` (checked with the dialog's own checks), register column, record view on the case page's summary. A refusal after the create keeps the user on the register |
| `components/form-framework/extension-hosts.test.tsx` (new; additive in `form-framework/**`) | Unit tests (§4) |
| `apps/web/e2e/fec3-extension-hosts.spec.ts` (new) | e2e (§4) |

No i18n key was added: every text comes from FE-C2's `forms.extensions.*` and `forms.edit.*` keys. No `problems.json` key was needed: the codes these screens can receive from the new calls (`form_record.*`, `validation.*`, `form_draft.*`, `form_attachment.*`, `form_comment.*`) already have en/ar text, as FE-C2 checked. No framework source file is changed.

## 2. Added scope 1: record type → screen → done or not

| Record type | Screen | Create inputs | Record view + Form tools |
|---|---|---|---|
| `evidence` | `/transformations/:id/evidence` | done | done (register column) |
| `baseline` | `/diagnose` › Baselines | done | done (register column) |
| `value_pool` | `/diagnose` › Value pools | done | done (register column) |
| `resource_plan` (`resource_demand`) | `/capacity` › Demands | done | done (table column) |
| `funding_approval` (`funding_decision`) | `/initiatives/:id` › Funding decision | done | done (per decision) |
| `change_request` | `/change-requests`, `/change-requests/:id` | done | done (column and page) |
| `meeting_record` (`meeting`) | `/meetings`, `/meetings/:id` | done | done (column and header) |
| `corrective_plan` (`corrective_case`) | `/corrective-actions`, `/corrective-actions/:id` | done | done (column and page) |
| `lesson` | `/lessons` | done | done (register column) |
| `bau_handover` | `/bau-handovers`, area page, `/bau-handovers/:id` | done | done (column and page) |
| `control` | `/bau-controls`, area page | done | done (register column) |
| `charter` | `/charter` | done (first charter) | done |
| `tom_canvas` (`tom_canvas_cell`) | `/design` › TOM canvas › dimension view | **not done: no create path exists.** The ten cells exist from the transformation's creation and are only updated, so values are entered with Form tools on the cell | done |
| `business_case` | `/business-cases`, `/business-cases/:id` | done | done (column and summary) |
| T01 fill dialog | `/diagnose` › T01 | done (when the dimension has no item yet) | Form tools was already FE-C's |
| T06 | `/prioritization` › scorecard | **not done, by design.** One scorecard save creates up to one T06 record per criterion (`createInitiativeScore` per changed criterion), so a single set of create inputs would not map to one record. Values are entered with Form tools on each saved score, as FE-C2 left it | FE-C2's |
| `procedure_definition` | — | not applicable: `custom_fields_allowed = false` (0068 seed) | — |

**T01 note:** a transformation created now gets all six T01 items at creation. Its fill dialog therefore opens in edit mode, and Form tools is the entry there. The fill dialog's create path is reached only for a dimension without an item. It is covered by a stubbed unit test, not by the live e2e (§4).

**Write rule in the hosts:** each host offers Form tools edits only when the record type's write permission is held, and the register's own "editable" state applies. Examples: a closed RAID-like case, a retired control, an archived business case, a submitted change request and an accepted handover are read-only. The server checks only the write permission, so the web is stricter, never looser. Every reader sees the values in the record view. Unknown never shows as 0 (unit-tested on the handover register).

## 3. Behaviour delivered, per requirement row

**REQ-S06-004.** Acceptance (verbatim): *"A06: an admin adds a field to T13, changes a validation rule and changes an approver route in the UI; after publish, with no deployment or application-code change, a new T13 record stores the new field, the changed rule rejects a value it previously accepted, and a submission is routed to the new approver"*. The T13 path was FE-C2's. This task extends *"works without code changes"* (F-DG5-QA-A-2) to the remaining record types that `listFormRecordTypes` marks as accepting custom fields (table in §2). The e2e proves it live on two of them, in en and ar:

- A published field on `lesson` and `business_case` is offered in their create forms on a transformation created after the publish.
- 150 is refused with *"Enter a value from 0 to 100."* (ar: *"أدخل قيمة من 0 إلى 100."*), and nothing is created (checked through the API).
- A valid value is stored after the create (`putFormRecordCustomFields`, `If-Match: "0"`). It reads back as version 1 on the published version, and the record view shows it.

**REQ-S05-006** (shown, unchanged). Acceptance: *"A01: all twelve record types can be created and retrieved via the API; extension-type forms show the extension badge in en and ar"*. The badge lines are FE-C's and are unchanged. They sit next to the new inputs (e.g. `data-extension-note='lesson'`, asserted in the e2e).

**REQ-PB-011** (Added scope 2). Acceptance: *"A01: all four questions render verbatim (en) with ar translations; every seeded template has exactly one question tag"*, with D-163's *"shown in form headers"*. New unit tests prove the template header strip (`TemplateProvenance`, with its source link) is rendered in en and ar:

- in the **T05** initiative card (the `#t05` section, next to `.t05-fields`);
- in the **T06** scorecard (`#scorecard`).

A mutation check (the T06 line removed) made the T06 tests fail. The line was then restored.

## 4. Tests added

- `apps/web/src/components/form-framework/extension-hosts.test.tsx`: 12 tests (6 × en/ar):
  - `lesson` (P4 dialog): out of range → no request; a valid value → POST, then PUT `If-Match: "0"` with the body; the body of the create carries no extension key.
  - `business_case` (custom dialog): out of range → no POST. A valid value → PUT `If-Match: "0"`. A 422 `form_record.custom_field_unknown` after the create → the register shows *createdWithoutValues* and the problem's text, with no navigation.
  - `bau_handover` register for a reader: the stored value, Unknown (never 0) for a record without a value, and no create button or inputs.
  - **T01 fill dialog** for a dimension without an item: out of range → no request; 30 → POST, then PUT `If-Match: "0"` on `/form-records/T01/<new id>`.
  - **T05** and **T06** headers (REQ-PB-011).
  - Mutation check: removing the lesson create inputs (`note=`) or the T06 header line made those tests fail (4 failed). Both lines were restored and the file is unchanged.
- `apps/web/e2e/fec3-extension-hosts.spec.ts`: the main path and the main refusal, live, in chromium-en and chromium-ar (§3). On each screen it checks `<html lang/dir>`, axe (0 serious/critical), no foreign request, and no `DG0–7` text.
- **Visual evidence** (my spec only, D-162): `docs/delivery/handbacks/DG5/T-DG5-FE-C3-evidence/screenshots/{en,ar}/fec3-lesson-create-out-of-range.png`, `fec3-lesson-record-view.png`, `fec3-business-case-record-view.png`. I viewed them. In ar, the lesson dialog shows two extension fields: the en project had already published its own field on the same stack. That is expected (cumulative published versions), and the test enters only its own.

## 5. Checks (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-FE-C3-evidence/`)

**Environment:** Node 24.21.0, offline. Ports 23750–23799 only. 4 CPUs, 15 GB, shared with three W19 QA tasks. The checks ran one at a time. One exception: the web-only `tsc --noEmit`, and two single-file Vitest runs, ran during development.

| Check | Command | Result |
|---|---|---|
| DG4 historical (start) | `node tools/gates/validate.mjs --historical --stage DG4` | **exit 0**, `PASS gate DG4 (historical)` |
| typecheck | `pnpm -r typecheck` | **exit 0** (`typecheck.log`; apps/api and apps/worker `Done`) |
| build | `pnpm -r build` | **exit 0** (`build.log`) |
| lint | `pnpm lint` | **exit 0** (`lint.log`, `--max-warnings=0`) |
| prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (`prettier.log`). The pre-existing untracked top-level files (`.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `.bash_profile`, `CLAUDE.local.md`) were present from the start, are not mine, and were included |
| OpenAPI lint | `pnpm openapi:lint` | **exit 0**, `PASS … 846 operations` |
| unit-web, locale unset | `env -u LANG -u LC_ALL -u LANGUAGE npx vitest run --project unit-web` | **exit 0**: 85 files, **1609/1609** passed (D-164's 1597 + my 12) (`unit-web-locale-unset.log`) |
| unit-web, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web` | **exit 0**: 85 files, **1609/1609** passed (`unit-web-c-utf8.log`) |
| e2e, my spec | `E2E_PG_PORT=23750 E2E_API_PORT=23751 MTH_PORT_POOL=23752-23799 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/fec3-extension-hosts.spec.ts --workers=1` | **exit 0, 2 passed** (en, ar) (`e2e-fec3.log`) |
| e2e, touched pages | see §5.1 | see §5.1 |
| `pnpm test` (repository-wide) | — | **not run, D-164** |
| `pnpm test:integration` | — | **not run, D-164** |
| full web e2e suite | — | **not run, D-164** |

**Failed runs of my own spec, disclosed** (logs kept):

- `e2e-fec3-run1.log`: 2 failed, timeouts. The lesson step ran as the Lead, who does not hold `lesson.edit` (BO and TO hold it). The step now runs as `dev.office` (TO).
- `e2e-fec3-run2.log`: 2 failed at the T01 step. A new transformation has all six T01 items, so there is no "Fill in" button. The T01 step was moved to a stubbed unit test (§2, T01 note), and its field was removed from the e2e setup.

The lesson and business-case steps passed in run 2. Neither failure was a product defect.

### 5.1 e2e specs of the touched pages

Command: `E2E_PG_PORT=23760 E2E_API_PORT=23761 MTH_PORT_POOL=23762-23799 apps/web/e2e/support/with-stack.sh npx playwright test` over the nine specs that drive a dialog or page this task changed:

- `p2-journeys` (charter, T01, evidence, baselines, value pools, the TOM canvas dimension view);
- `p3-business-cases`, `p3-portfolio` (funding), `p3-ui-completion` (capacity);
- `p4-adoption-bau` (handovers, controls, lessons), `p4-raid-governance` (corrective, meetings), `p4-governance`, `p4-change-phases` (change requests);
- `p5-forms`.

Each ran in chromium-en and chromium-ar with `--workers=1`. Screenshots went to `$TMPDIR` and are not committed (D-162).

- **First run:** exit 1, **127 passed, 1 failed** (`e2e-touched-pages.log`, 17.7 min). The failure is `p4-change-phases.spec.ts` › "6. the auditor reads without write actions; 390 px and 200 % text have no page-level overflow" (chromium-en). Its error is `ENOSPC: no space left on device` in `context.close()` at the test's last line (`p4-change-phases.spec.ts:543`), after all its read-only and overflow assertions had passed. The shared disk was full for a while. 7.2 GB was free right after, so the four concurrent tasks' runs probably filled it. The same test passed in chromium-ar in the same run.
- **Rerun of that spec alone:** exit 0, **14 passed** (7 tests × en/ar), including test 6 in both languages (`e2e-p4-change-phases-rerun.log`).

The remaining specs that visit a touched page only through navigation or a seed are **not run**, and are left to the orchestrator's full suite (D-164): `p2-blank-text`, `p3-g4-refusal`, `p3-inherited-approval`, `p3-journeys`, `p3-prioritization-roadmap`, `p3-seams`, `p4-benefits`, `p4-execution`, `p4-gates-closure`, `p4-kpi`, `p4-traceability`, `p5-navigation`, `p5-procedures-automation`, `p5-reader-branding-demo`, `p5-reports-exports`, `p5-shell`, `session-end`, `journeys` and `p5-extension-fields`.

**DG4 historical (end):** `node tools/gates/validate.mjs --historical --stage DG4` → **exit 0**, `PASS gate DG4 (historical)` (`validate-dg4-end.log`; the start log is `validate-dg4-start.log`).

## 6. Operations routed (pending-list delta)

None. This task adds no API route. It calls only operations BE-D/BE-E/BE-E2 already route (`getTransformationFormSchema`, `get/putFormRecordCustomFields`, and the framework's reads), plus the existing DG2–DG4 creates of each register, unchanged. FE tasks own no `p5-pending-*.ts`. Pinned-count delta in `contract.test.ts`: **0**.

## 7. Contract, schema or dependency needs

- No new dependency, contract, schema, migration or i18n key.
- **Note for the orchestrator:** `funding_decision` has no `version` column. The server reads such a record as version 1 for drafts (`currentRecordVersion`), and the web host passes `version: 1` to match. If that server rule changes, `funding.tsx` must follow.

## 8. User-facing texts

None made untrue. No en/ar string calls extension fields on these forms planned, later or limited to some forms. `forms.extensions.createdWithoutValues` (*"…Enter them again with Form tools on the record."*) is now true on every hosted form, because each one offers Form tools on the record to a writer.

## 9. What remains

1. `tom_canvas` and T06 have no create inputs. This is by design, because no single-record create path exists (§2). Their values are entered with Form tools.
2. The T01 fill-create path is not proven live (a new transformation has no empty dimension). It is unit-tested.
3. The live e2e covers two of the fourteen new hosts (`lesson`, `business_case`), one per dialog family not proven before (P4 dialog with a TO user, custom dialog). The other twelve hosts are typechecked and use the same lines, but have no unit or e2e test of their own.
4. Not run, per D-164: `pnpm test`, `pnpm test:integration` and the full web e2e suite, for the orchestrator's merged-tree verification.

## 10. Merge instructions

- No migration, no i18n change.
- Only page files are touched, each with an import block and hosting lines marked `T-DG5-FE-C3`, plus two new files.
- `pages/capacity/editing.tsx`, `funding.tsx`, `CreateChangeRequest.tsx` and `CorrectivePages.tsx` change dialog prop lists: optional `ext`, additive.
- The W19 QA tasks write only `tests/qa/**` and root `e2e/**`, so no conflict is expected.
