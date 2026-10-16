# Handback T-DG5-FE-C (frontend-ux-engineer): the form builder and the common form framework (slice B screens)

- **Stage:** P5 / DG5 (BUILDING). **Scope:** `p5-work-split.md` §B (FE-C row of `p5-plan.md` §5.1): `pages/form-builder/**` and `components/form-framework/**` (history, comments, attachments, export, conflict, extension badge), adopted on the T01 and T14 screens.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-C.md`, sha256 `71f8dd68…9e385`. Verified at the start: it matches.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-C-frontend-ux-engineer-20261016T111636Z-5a671310","session_id":"5a671310-b2ae-4beb-9c35-055dbea1c481"}`
- **Base:** worktree `/home/user/wt/dg5-fe-c`, branch `dg5/fe-c`, `HEAD` `4a05c4f` (D-160). The changes are **uncommitted**, as assigned.
- **Time:** start `Fri Oct 16 11:16:50 UTC 2026` (`date -u`). The end time is in §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start and at the end (§4).
- **Gates:**
  - No G1–G6 business approval is granted or recorded.
  - Drafts, comments, attachments and form-schema reviews approve nothing.
  - Nothing reads or writes DG0–DG7.
  - In the e2e run, the configuration review of the forms draft is decided by the seeded synthetic Transformation Office user. It is a configuration review, not a business approval.
  - All test and screenshot data is synthetic.

## 1. Files changed

New (owned by FE-C):

| File | Purpose |
|---|---|
| `apps/web/src/components/form-framework/api.ts` | Typed hooks over FE-A's `api/p5.ts` and pure helpers. Bodies are parsed with BE-D/BE-E/BE-E2's zod mirrors (`parseBody`); a malformed body is an error state, never rendered half-way. Values: decimals stay text, `""` → `null` (Unknown, never 0), currency `{amount, currencyCode}`. Also draft payload reading, comment threads, changed-field labels, and the 409 test. |
| `apps/web/src/components/form-framework/FormFramework.tsx` | The framework on one record, with four keyboard-navigable tabs (arrow keys, mirrored in RTL; Home/End): **Edit and drafts**, **Version history**, **Comments**, **Attachments**. Every write is session-bound and carries If-Match. |
| `apps/web/src/components/form-framework/ExportDialog.tsx` | `ExportButton`/`ExportDialog`: a JSON preview in the chosen header language (en/ar) with its row count, Unknown/Not computable cells marked, a CSV download (`format=csv&lang=`) and a JSON download. A 422 such as `form_export.too_large` is shown by its code in en/ar. |
| `apps/web/src/components/form-framework/ExtensionBadge.tsx` | `ExtensionBadge`/`ExtensionNote`: the "Extension" / "امتداد" badge with an icon and its hint. It is neutral, never a status colour. `EXTENSION_RECORD_TYPES` lists the twelve M0149 codes. |
| `apps/web/src/components/form-framework/FormToolsButton.tsx` | The "Form tools" button of one register row. It opens the framework in a dialog that has a Close button. |
| `apps/web/src/components/form-framework/index.ts` | Barrel. |
| `apps/web/src/components/form-framework/form-framework.test.tsx` | 16 unit tests (helpers; T14 page in en and ar; stubbed API). |
| `apps/web/src/pages/form-builder/FormBuilderPage.tsx` | `/admin/forms`: `listFormRecordTypes` in a sortable, filterable, paginated table with column selection. Shows code, form (with the badge), kind, extension and bulk flags, status (Available / Not available in this release) and source. Read-only. |
| `apps/web/src/pages/form-builder/FormSchemaPage.tsx` | `/admin/forms/:recordType` (details in §2). |
| `apps/web/src/pages/form-builder/form-builder.test.tsx` | 8 unit tests (en and ar). |
| `apps/web/src/i18n/{en,ar}/forms.json` | New `forms` namespace, with identical key sets. The Arabic uses the glossary's "التحوّل". |
| `apps/web/e2e/p5-forms.spec.ts` | 3 Playwright tests × 2 projects against the real stack (§3). |
| `docs/delivery/handbacks/DG5/T-DG5-FE-C-*` | This handback, logs and screenshots. |

`FormSchemaPage.tsx` in detail:

- It reads `getFormSchemaAdmin` for a chosen `form_schema` version. The default is the open draft, else the newest published version.
- A version chip and a link to the Studio version.
- Source columns show "Source column (protected)" (lock icon); extension fields show "Extension field".
- In an editable draft, with `methodology.configure`:
  - **Add extension field:** `putConfigElement` `form_field` `<code>.<key>`, origin `admin`, the type and its settings, If-Match on the draft.
  - **Edit:** a source column takes labels, help and required only; its type is never offered.
  - **Delete:** `removeConfigElement`. For a source column the dialog says it will be refused, and the server's 422 is shown translated.
- A published version and AUD get a read-only view.

Existing files edited (additive lines, plus the placeholder swap the shell prescribes):

| File | Change |
|---|---|
| `apps/web/src/app/router.tsx` | Two lazy imports and two routes (`admin/forms`, `admin/forms/:recordType`), marked T-DG5-FE-C. FE-C's `formSchema` row is removed from `P5_PLANNED_ROUTES`, and the `P5_SUBPAGES` filter also skips owner `FE-C` (FE-B's precedent). |
| `apps/web/src/app/p5-shell.test.tsx` (FE-A's test) | Needed with that swap. `formBuilder` leaves the placeholder list, and the test asserts that no FE-C row is left and that both form routes are registered. |
| `apps/web/src/i18n/index.ts` | `forms` namespace imports and two catalogue lines. |
| `apps/web/src/i18n/{en,ar}/problems.json` | Eight missing ADR-0041 §10 field codes: `validation.text`, `rich_text`, `currency_amount`, `currency_code`, `percentage`, `attachment`, `lookup`, `choice`. The English is the ADR text verbatim. `validation.decimal`/`date`/`reference` already existed (DG2 texts, unchanged). |
| `apps/web/src/i18n/{en,ar}/admin.json` | `admin.plannedSections` corrected (§6). |
| `apps/web/src/styles/app.css` | An appended block: `.ff-tabs`, `.ff-fieldset`, `.ff-comments`, `.ff-pre`. Logical properties and tokens only. |
| `apps/web/src/pages/diagnose/DiagnosePage.tsx` | T01 adoption: a "Form tools" button per filled T01 row and an **Export** button on the T01 section. Also the extension badge on the Baselines and Value pools sections. |
| `apps/web/src/pages/benefits/BenefitPage.tsx` | T14 adoption: a new section `BenefitFormTools` (framework plus export) after the profile. |
| `evidence/EvidencePage.tsx`, `capacity/CapacityPage.tsx`, `portfolio/funding.tsx`, `change-requests/ChangeRequest(s)Page.tsx`, `meetings/Meeting(s)Page.tsx`, `raid/CorrectivePages.tsx` (list and case), `lessons/LessonsPage.tsx`, `bau/HandoverPage.tsx` (list and detail), `bau/ControlsPage.tsx` | One import plus one `<ExtensionNote recordType=… />` line inside the register section of each extension form (REQ-S05-006). |

No API, database, contract, schema or `packages/**` file changed. No new dependency.

## 2. Behaviour delivered, per requirement row (acceptance quoted)

### REQ-S05-001

> "A01;A14: for T01 and T14, a saved draft reopens, a new version is listed in history, a comment and attachment persist, export returns the rows, and a conflicting concurrent save returns a recoverable conflict"

| Clause | Delivered | Proof |
|---|---|---|
| "a saved draft reopens" | **Save draft** posts `createFormDraft` (`recordId`, `baseRecordVersion` = the record version shown, `payload` = only the user's changed source and extension fields), or `updateFormDraft` with If-Match. The record is not written, and the screen says "Draft saved — not submitted. The record has not changed." On reopen, the user's open draft for the record (`listFormDrafts`, `status=open`) prefills the form under the banner "You have an open draft … not saved to the record yet". With `baseChanged: true`, the comparison view shows the draft against the current values. **Discard draft** closes it with `discarded`; a save to the record closes it with `saved`. | Unit (T14, en/ar). e2e T14 steps 1–2: save, `reload()`, value back, banner. |
| "a new version is listed in history" | **Save to the record** sends the changed source fields through the register's own PATCH (T01 `diagnostic-items/{id}`, T14 `benefits/{id}`; DG2–DG4 validation unchanged), with If-Match. Changed extension values go through `putFormRecordCustomFields` (If-Match = the values' version, `"0"` for the first save). The history tab (`listFormRecordVersions`) lists version, action, actor, time and the changed fields' labels. | e2e T14 step 3: history has 2 rows, version 2 present. T01 history in e2e. Unit. |
| "a comment and attachment persist" | **Comments:** post a comment and one reply level (`createFormRecordComment`), read back as threads. Append-only, so the UI offers no edit or delete. **Attachments:** attach evidence of the transformation (`attachFormRecordEvidence`). The store is shown: T01 "Evidence link" (DG2 `evidence_link`), T14 "Form attachment". **Remove** needs a reason (3–1000) and If-Match; "Show removed attachments" lists removed ones with their reason. | e2e T14 steps 4–5: post, then `reload()` and read back; attach, then `reload()`. e2e T01: comment, and an attachment stored as an evidence link. Unit: reply body with `parentCommentId`; removal with reason and If-Match `"1"`. |
| "export returns the rows" | **Export** on the T01 section and the T14 section: `exportFormRecords` JSON preview in en or ar, with a row count. A null cell shows "Unknown"/"Not computable" with an icon, never 0. CSV and JSON downloads. | e2e T14 step 6: `data-export-rows='1'`, language attribute, row text. e2e T01: rows ≥ 1 with "Synthetic root cause". Unit: Unknown cell has no "0"; a 422 `form_export.too_large` is translated. |
| "a conflicting concurrent save returns a recoverable conflict" | On any 409 (`form_record.conflict` or a register's version conflict), the user's typed values are kept, the record is re-read, and `ConflictPanel` (the form's one alert) shows "your value" against "current saved value". **Re-apply my change on the current version** re-sends **only the user's own changed fields** with the current version's If-Match. **Discard** loads the current values. | e2e T14 step 7: another session PATCHes `description`, the UI saves `title`, the 409 panel appears, re-apply → saved. The API then shows the new title **and** the other user's description (see the note below). Unit: the second PATCH carries `{title}` only, with If-Match `"4"`. |
| Inline help, validation, permissions | Help from `getTransformationFormSchema` sits beside each field in the screen's language, with a per-type hint (e.g. "12% is stored as 0.12"). A server 400 field code (e.g. `/values/uplift` `validation.percentage`) lands on its field, translated. There is one form-level alert per form. Without the record type's write permission (or without `form_record.comment`), the user gets read-only views: no save or draft buttons, and "You can read comments but not post them". | Unit: help, field error, reader. e2e T01: the synthetic AUD sees the comment, no Save and no Post, axe-checked. |

**A defect found and fixed during this task.** My first framework version re-sent the user's stale copy of *every* source field on re-apply. The e2e conflict step caught it: it reverted another user's `description`. The editor now keeps a base, i.e. what the user started from. Only fields the user changed are sent, drafted or compared; every other field follows the current saved record. The unit test pins this.

**Not in the screens (stated plainly):**

- **Bulk editing:** `bulkUpdateFormRecords` has no UI in this task. The p5-plan FE-C row lists history, comments, attachments, export, conflict and the extension badge. REQ-S05-001's acceptance text does not name bulk editing (D-142 R1). See §7.
- **T01 rows without a record:** the framework applies to records that exist. An empty T01 dimension is created first with its existing "Fill" dialog.

### REQ-S05-002

> "A06: adding an extension field to T03 publishes successfully; attempting to delete the T03 'Gap' column is rejected"

**What is delivered:** the form builder, Studio Templates (§1). In e2e (en and ar), the synthetic ADM_METHOD (`dev.nobody`, granted and revoked as in `p5-studio.spec.ts`) works through these steps:

1. Creates a forms draft (`createConfigDraft` from the newest published `form_schema` version).
2. Opens `/admin/forms/T03`, chooses the draft, sees every source column marked protected, and adds the extension field `synthetic_note_<lang>` through the UI.
3. Clicks **Delete** on `gap`: the server answers 422 `form_schema.source_column_protected`, shown as "Source columns cannot be deleted. Relabel the column or add help instead." (ar: the `problems.json` text). `gap` stays.
4. Takes the draft through the Studio pipeline by API: preview, compatibility, submit for review, the TO approves, publish. It is then `isNewestPublished`.
5. The builder shows the published version read-only, with the field present.

**Note for the full suite:** each project publishes one forms version that contains an optional T03 text field.

### REQ-S05-006

> "A01: all twelve record types can be created and retrieved via the API; extension-type forms show the extension badge in en and ar"

| Clause | Delivered |
|---|---|
| Creates and reads | These are the DG2–DG4 operations of ADR-0041 §1 (backend; unchanged). |
| The badge on the builder | The form builder shows the badge on exactly the twelve `extensionBadge` rows. Unit en/ar: 12 badges, none on T03. e2e en/ar: `[data-extension-badge]` count 12. |
| The badge on each form | It sits in the register section of 11 of the twelve forms: evidence, baseline, value pool, resource plan (capacity demands), funding approval, change request (list and detail), meeting record (list and detail), corrective plan (list and case), lesson, BAU handover (list and detail), control. |
| `procedure_definition` | Its screen is FE-D's (the procedure builder, running concurrently). It is listed in §7 for FE-D: one line, `<ExtensionNote recordType="procedure_definition" />`. In the form builder its row carries the badge. |

## 3. Interaction checks actually run (UI)

All of these ran in Playwright against the real stack, in chromium-en and chromium-ar, with `apps/web/e2e/p5-forms.spec.ts`. The log is `T-DG5-FE-C-evidence/e2e-p5-forms.log`: **6 passed**, exit 0.

- Keyboard and roles:
  - the framework tabs are `role=tab` with `aria-selected`;
  - fields are found by their visible labels;
  - the dialogs are focus-trapped and close by button or Escape (Dialog).
- axe (no serious or critical violation) on every one of these screens:
  - `p5-forms-t14-draft`, `-history`, `-attachments`, `-export`, `-conflict`;
  - `p5-forms-t01-tools`, `p5-forms-t01-auditor`;
  - `p5-form-builder`, `p5-form-schema-draft`, `p5-form-schema-refusal`.
- `html[dir]` is rtl/ltr. No `DG0–7` text appears. There are no foreign requests (`trackRequests`).
- **Screenshots** (both languages), in `docs/delivery/handbacks/DG5/T-DG5-FE-C-evidence/screenshots/{en,ar}/`:
  - `p5-forms-t14-draft.png`, `p5-forms-t14-history.png`, `p5-forms-t14-comments.png`, `p5-forms-t14-attachments.png`, `p5-forms-t14-export.png`, `p5-forms-t14-conflict.png`;
  - `p5-forms-t01-tools.png`, `p5-forms-t01-history.png`, `p5-forms-t01-export.png`, `p5-forms-t01-auditor.png`;
  - `p5-form-builder.png`, `p5-form-schema-draft.png`, `p5-form-schema-refusal.png`, `p5-form-schema-published.png`.
- I inspected `ar/p5-forms-t14-conflict.png` and `en/p5-form-schema-refusal.png` visually:
  - RTL mirrored;
  - the conflict table reads "mine vs current";
  - one translated alert;
  - the chips carry text and an icon.

## 4. Checks (real exit codes; logs in `T-DG5-FE-C-evidence/`)

Environment: Node 24.21.0, offline, ports 23300–23349 only. The empty sandbox folders `.claude/.cc-writes` under `apps/web`, `apps/web/src/pages` and `apps/web/src/components/form-framework` were removed before the final runs.

Load during the final runs: load average about 20, from the four concurrent W15 tasks plus my own e2e run (`uptime` at 13:03Z: 19.66).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | **0** | clean | `typecheck.log` |
| 1 | `pnpm -r build` | **0** | clean (the usual Vite chunk-size warning) | `build.log` |
| 1 | `pnpm lint` | **0** | `eslint . --max-warnings=0` clean | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier.log` |
| 1 | `pnpm openapi:lint` | **0** | PASS, 846 operations | `openapi-lint.log` |
| 2 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **1** | See below the table. | `unit-locale-unset.log` |
| 2 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | **1** | See below the table. | `unit-c-utf8.log` |
| 2 | Isolated reruns: `vitest run --project unit-node apps/api/src/architecture.test.ts packages/reporting/src/pdf/pdf.test.ts`, both locales | **1** each | 147/152 passed; the same 5 tests time out again under the same load (4 pdf at 5000 ms, architecture at 30000 ms) | `unit-rerun-node-unset.log`, `unit-rerun-node-c-utf8.log` |
| 2 | Isolated rerun: `vitest run --project unit-web apps/web/src/pages/raid/raid.test.tsx` (locale unset) | **0** | 18/18 | `unit-rerun-raid-unset.log` |
| 2 | Earlier full `unit-web` run (after my main changes, before the final fixes) | — | It exposed my own failures, which are fixed: the `formBuilder` placeholder assertion, and the benefits tests crashing on malformed stub bodies (now parsed with zod). Targeted reruns: 120/120. Framework and builder tests: 24/24 after the last change. | `$TMPDIR` only; not kept |
| 3 | `QA_PG_PORT=23300 MTH_PORT_POOL=23301-23319 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | **272 files; 2659 passed, 1 skipped** (2660). This equals D-160's count, so there is no pinned-count change. Ran 11:19–11:56Z. My change has no API, DB or packages file, so integration covers nothing I edited. | `integration.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` | **0** | `PASS gate DG4 (historical)`, at the start (11:16Z) and at the end (13:12Z) | `validate-dg4-end.log` |
| e2e | `E2E_PG_PORT=23320 E2E_API_PORT=23321 MTH_PORT_POOL=23322-23349 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p5-forms.spec.ts --workers=1` | **0** | **6 passed** (3 tests × en/ar) | `e2e-p5-forms.log` |
| e2e | Full suite: `E2E_PG_PORT=23330 E2E_API_PORT=23331 MTH_PORT_POOL=23332-23349 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **1** | 360 passed, 9 failed (all 30 s test timeouts), 15 did not run; see below the table | `e2e-full.log` |

**`pnpm test` with the locale unset (exit 1).**

| Invocation | Result | Failure |
|---|---|---|
| unit-node | 2159/2160 | `apps/api/src/architecture.test.ts` "every import respects dependsOn…": **Test timed out in 30000ms** |
| unit-web | 1452/1453 | `pages/raid/raid.test.tsx` "action register …": a **5000 ms timeout** (the wait D-160 (d) records) |
| unit-formula-nocodegen | 259 passed + 2 skipped | — |

**`pnpm test` with `C.UTF-8` (exit 1).**

| Invocation | Result | Failures |
|---|---|---|
| unit-node | 2155/2160 | `architecture.test.ts` (30 s timeout); `packages/reporting/src/pdf/pdf.test.ts`, 4 Arabic tests (each **5000 ms timeout**) |
| unit-web | 1452/1453 | the same `raid.test.tsx` 5 s timeout |
| unit-formula-nocodegen | 259 passed + 2 skipped | — |

**The full e2e suite.** At handback, 214 of about 390 tests had run, with 8 failures. The run then finished at 13:43:02Z (addendum after the handback): **exit 1; 360 passed, 9 failed, 15 did not run (1.3 h).**

- **Every one of the 9 failures is "Test timeout of 30000ms exceeded"** in a DG2–DG4 spec under this load. None is an assertion failure on its own. None is in `p5-forms.spec.ts`, whose standalone run passed 6/6.
- **The 9 tests:**
  - `p2-journeys` Define → G2 (en and ar);
  - `p3-seams` P3 pages (en);
  - `p4-adoption-bau` 6 (en);
  - `p4-benefits` 8 (en): its screenshot shows the page still on "Loading…" at the timeout;
  - `p4-gates-closure` 9 (en);
  - `p4-raid-governance` 5 (en);
  - `p4-traceability` 3 (en);
  - `p4-dashboards` 6 (ar).
- **The 15 "did not run"** are the later tests in the serial specs after a failure.
- **Pages I edited:** the BAU handover, benefit and meeting pages carry my one-line badge or the T14 section. A quiet-machine rerun of these specs is needed to exclude a real effect. I could not do it within the time limit.

**Disclosure.** Acceptance item 2 (`pnpm test` passing in every invocation, in both locales) and the full web e2e suite are **not met in this run**:

- Every remaining failure is a timeout. None is an assertion failure.
- None of them is in a file I changed. `architecture.test.ts` checks API imports and `pdf.test.ts` checks the reporting package; I edited neither the API nor `packages/**`. `raid.test.tsx` covers the action register, which I did not change; it passed 18/18 alone.
- This is the F-DG4-143 to F-DG4-148 class seen in the W13/W14 handbacks.
- I could not get a quiet machine within the time limit.
- **The orchestrator's merged-tree verification has to confirm these checks.** I did not raise any test timeout.

## 5. Operations routed (delta to a pending list)

**None.** FE-C is a web task. It routes no API operation and has no `p5-pending-*.ts` or `p5-exercises-*.ts` file. `contract.test.ts` is unchanged, so the pins are unchanged: media-type `[391, 390, 1]`, operation count 846 (`openapi:lint`).

The screens consume these slice B operations, all already routed by BE-D/BE-E/BE-E2:

- `listFormRecordTypes`, `getFormSchemaAdmin`, `getTransformationFormSchema`;
- `getFormRecordCustomFields`, `putFormRecordCustomFields`;
- `listFormRecordVersions`;
- `listFormRecordComments`, `createFormRecordComment`;
- `listFormRecordAttachments`, `attachFormRecordEvidence`, `removeFormRecordAttachment`;
- `exportFormRecords`;
- `listFormDrafts`, `createFormDraft`, `updateFormDraft`, `closeFormDraft`;
- slice A `listConfigVersions`, `putConfigElement`, `removeConfigElement`.

## 6. User-facing texts this work made untrue, and what I did

| Text | Action |
|---|---|
| `admin.plannedSections` (en/ar): "… Form, workflow, automation and branding settings are not available yet." | **Corrected in both languages:** "The Playbook Studio (…) and the form builder are available in this release. Workflow, automation and branding settings are not available yet." (ar equivalent). |
| `nav.p5.formSchema.*` / `nav.p5.formBuilder.*` placeholder texts | No longer rendered as placeholders. They are reused as the page title and summary of `/admin/forms/:recordType` and remain true. |
| Landing-page items (`AREA_CONTENTS`) | None names the form builder, so nothing changed. |

## 7. For the orchestrator, and what remains

1. **For FE-D:** add the badge to the procedure-definition form (REQ-S05-006's twelfth form): `import { ExtensionNote } from "../../components/form-framework/ExtensionBadge.tsx"` and `<ExtensionNote recordType="procedure_definition" />` in its register section.
2. **Expected merge conflicts with FE-D** (both additive). Resolve each by keeping both sides:
   - `router.tsx`: the `P5_SUBPAGES` filter line and adjacent `P5_PLANNED_ROUTES` comments; the filter must skip FE-B, FE-C and FE-D;
   - `p5-shell.test.tsx`: the placeholder feature list and the "built" assertions;
   - `i18n/index.ts`: namespace lines;
   - `admin.json` `plannedSections`: FE-D will likely also drop "workflow, automation" from this sentence;
   - `app.css`: appended block.
3. **Not done: bulk editing UI.** `bulkUpdateFormRecords` (BE-E2/BE-E3) has no screen. It is the separable second half of the framework adoption: a multi-select on the register tables with an owner/due-date dialog, plus the `form_record.bulk_conflict` listing from `errors[]`. It is not named in REQ-S05-001's acceptance, but M0127 says "bulk editing where suitable". I recommend a small follow-up task; the orchestrator decides.
4. **Not done: adoption beyond T01 and T14.** The assignment scope is T01 and T14. Any other form adopts it as `FormToolsButton`/`FormFramework` plus `ExportButton`, with its source-field list.
5. **The eleven field types in the editor:**
   - Choice renders a select; rich text, a textarea; date, a date input.
   - Reference, attachment and lookup are typed as IDs or codes, validated by the server with their codes.
   - Multi-choice is comma-separated text.
   - A picker per lookup set is a later improvement.
6. **The FE-B request still stands.** `P4FormDialog` lacks PUT; I reused FE-B's `StudioFormDialog` (import, no edit).
7. **Root files:** the empty read-only `CLAUDE.local.md` and `.zshrc` at the worktree root were created by the sandbox at 12:12Z, not by me. Do not integrate them.
8. **Contract, schema or dependency needs:** none.

## 8. End of run

- `date -u` at the end: `Fri Oct 16 13:14:16 UTC 2026`, about 2 h after the start (11:16:50Z).
- **Full web e2e suite:** it finished after the handback, at 13:43Z (§4, addendum): 360 passed, 9 failed (timeouts), 15 did not run.
- **Remaining work:**
  - the bulk-edit UI (§7 item 3, the separable second half);
  - FE-D's badge line (§7 item 1);
  - a quiet-machine confirmation of acceptance item 2 and of the full e2e suite (§4).
- **Background processes:** the check-runner background task (`checks.sh`) hit the session's 30-minute background limit after both `pnpm test` runs had written their final `exit=` lines. Its last step, the DG4 validator, was run separately: `validate-dg4-end.log`, exit 0.
- **Commits:** everything is uncommitted.
