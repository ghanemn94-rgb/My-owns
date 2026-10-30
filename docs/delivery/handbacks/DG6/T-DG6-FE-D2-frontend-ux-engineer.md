# Handback T-DG6-FE-D2 (frontend-ux-engineer): draft recovery, compare and reapply, inline edit, six states

- **Stage:** DG6 (P6), BUILDING. **Section:** `docs/architecture/p6-work-split.md` §H/G.6, the FE-D2 bullet.
- **Invocation:** `DG6-T-DG6-FE-D2-frontend-ux-engineer-20261030T212222Z-4dfb55ce` (session `4dfb55ce-714e-477e-aaea-ad2ca68d51fe`).
- **Base:** branch `dg6/fe-d2` at `db187d5bcec1e6f43328705b3c27bf184478668f`. Changes are left **uncommitted**.
- **Time:** start `Fri Oct 30 21:22:40 UTC 2026`; end: see §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0**. Run at start; it is re-run at the end (§4).
- **Assignment file** sha256 `2d9e5e3a…91c0ba`, verified.
- No product G1–G6 approval is granted or recorded anywhere in this work. A draft approves nothing. All test and e2e data is SYNTHETIC.

## 1. Changed files

**New, inside my ownership (§H/G.6 FE-D2):**

| File | Purpose |
|---|---|
| `apps/web/src/components/compare/threeWay.ts` | Pure three-way grouping (ADR-0057 §7): B (as loaded), M (mine), C (current). Groups: mine, theirs, conflicts, agreed. Also `reapplyKeys` (my changes plus the conflicts kept as mine) and `mergedValues`. |
| `apps/web/src/components/compare/threeWay.test.ts` | Unit tests of the grouping and reapply keys. A field only they changed is never sent. Null and missing are the same value. Decimals are compared as text. |
| `apps/web/src/components/compare/CompareChanges.tsx` | The 409 compare-and-reapply panel. One compare table (caption "Your unsaved values compared with the current saved values") with columns: field, when you opened it, your value, current saved value, and what happens. A field changed by both offers a radio choice (keep mine / keep theirs), and re-apply stays disabled until every such field has a choice. The panel uses the §9 conflict text. Without a current version, only discard is offered. The table sits in a `TableScrollRegion`. |
| `apps/web/src/components/compare/compare.css` | Styles for compare, the draft badge, draft status and inline edit. Tokens and logical properties only. |
| `apps/web/src/components/compare/CompareChanges.test.tsx` | Panel test (en, ar): groups, caption and columns, choice gating, the keys passed, the no-latest case, and the nothing-to-send case. |
| `apps/web/src/components/compare/provisional-ar.ts` | Provisional-Arabic label for the three `common` keys FE-D2 added. |
| `apps/web/src/components/draft-recovery/api.ts` | Draft calls: `listMyFormDrafts` (infinite cursor query), the record's open draft (P5 `listFormDrafts`), and create/update (If-Match)/get/close through the unchanged P5 draft routes. Includes a local zod mirror of `MyFormDraft` (§5). |
| `apps/web/src/components/draft-recovery/useDraftAutosave.ts` | Autosave hook (ADR-0057 §6). At most one write every 10 s, plus a write on blur. The first write creates the draft and later writes update it with If-Match. Writes are serialized. A 409 is recovered by adopting the open draft, or by creating a new draft if the old one was closed. Each write is bound to its session (F-DG2-530). Closes the draft as saved or discarded. |
| `apps/web/src/components/draft-recovery/DraftRecovery.tsx` | `DraftBadge` (exact text "Draft - not submitted") and `RecordDraftRecovery`. The latter offers Restore draft / Discard draft on the record page, shows the conflict state when `baseChanged`, runs the editor session (restored values, autosave, close on save, keep on cancel), and shows the autosave status line. |
| `apps/web/src/components/draft-recovery/MyDraftsPage.tsx` | "Your drafts" at `/my-work/drafts`: open drafts across transformations, newest first, with "Show more drafts" (API cursor). The RegisterTable sorts, filters, pages and selects columns. Rows show the badge, the conflict state when the base moved, and a record link (T05; other types say how to continue). Covers the empty, loading, error, stale and no-permission states. |
| `apps/web/src/components/draft-recovery/draft-recovery.test.tsx` | Initiative-card and "Your drafts" tests (en, ar): see §2. |
| `apps/web/src/components/inline-edit/InlineEditCell.tsx` | One cell, one PATCH with If-Match (ADR-0057 §8). Keyboard and labelled input. `hasText` is checked in the browser. The cell has one translated alert. A 409 puts the conflict state in the row; Compare opens `CompareChanges` on a fresh GET, and reapply uses If-Match of the current version. |
| `apps/web/src/components/inline-edit/InlineEditCell.test.tsx` | Register tests (en, ar): see §2. |
| `apps/web/src/components/six-states.test.tsx` | The six-state component test (en, ar). |
| `apps/web/src/components/useVersionedSave.compare.test.tsx` | Test of the new `compareSides` and `reapply(values, keys)` lines. |
| `apps/web/e2e/p6-draft-recovery.spec.ts` | e2e: "a draft survives a browser reload". |
| `apps/web/e2e/p6-compare-reapply.spec.ts` | e2e: A14 with two browser sessions, plus the inline-edit 409. |

**Named lines in files I own per the bullet:**
- `components/useVersionedSave.ts`: the compare-and-reapply lines (`compareSides`; `reapply(values, keys?)`).
- `components/States.tsx`: the stale and conflict states. `StaleBanner` uses the §9 text; `ConflictState` is new; `ConflictPanel` gains the §9 lead sentence.

**Named lines outside the bullet's file list.** These are needed to mount the components; the orchestrator should check them at merge:
- `components/RecordForm.tsx`:
  - `FormConflict` now renders `CompareChanges`;
  - `reapply(keys?)` re-applies only the chosen fields;
  - new optional prop `initialValues` for restored draft values.
  - Every DG2–DG5 record form therefore gets the three-way compare.
- `pages/portfolio/InitiativePage.tsx`: one import plus one block. `RecordDraftRecovery` wraps the T05 `RecordDialog`.
- `pages/portfolio/PortfolioPage.tsx`: one import plus the name column cell, which is `InlineEditCell` for `initiative.edit` holders on a non-cancelled, non-completed initiative.
- `app/router.tsx`: the lazy `MyDraftsPage` and the route `my-work/drafts`. This is shared route-table overlap.
- `pages/my-work/MyWorkPage.tsx`: one "Your drafts" link in the My Work sub-navigation.
- i18n catalogues (shared):
  - `i18n/{en,ar}/productivity.json`: new blocks `compare`, `drafts`, `inlineEdit`;
  - `i18n/{en,ar}/common.json`: `state.staleSince` → `state.staleUpdated` (the §9 text), `state.staleUnknown` reworded, `conflict.lead` added.
- Two test files outside my ownership, both adjusted to the new designed behaviour:
  - `components/table-regions.test.tsx`: the `OUTSIDE_P5_PENDING` list **shrinks** by `RecordForm.tsx > FormConflict`, whose table is now in a scroll region. The list may only shrink.
  - `pages/p2.test.tsx`, Diagnose 409: the root cause is changed by both users, so the test now picks "Keep mine" before re-apply, and asserts re-apply is disabled until it does.

## 2. Behaviour delivered, per requirement row

### REQ-S15-010

Acceptance: *"Search returns only records the user may read; lists support saved views and chips; bulk and inline edits go through the same validation, authorization and concurrency checks as single edits; unsaved drafts are recoverable"*. Later-stage text: *"… a draft survives a browser reload"*.

FE-D2 scope: inline edit, draft recovery and the draft-reload e2e. Search, views, chips and bulk belong to other tasks.

**Inline edit.** The cell sends one `PATCH /api/v1/initiatives/{id}` through the record's own route, with `{name}` only and `If-Match` of the row's version. Server validation, authorization at commit, audit and the 409 path are therefore the single edit's own.
- A blank name is refused in the browser and nothing is sent.
- A 422 is the cell's one alert.
- A 409 shows "Conflict: not saved" in the row. Compare and re-apply then use `If-Match` of the current version, and the other user's field is not sent.
- The auditor gets no control.
- Proof:
  - `InlineEditCell.test.tsx`: 10/10.
  - e2e `p6-compare-reapply.spec.ts` test 2 (en, ar) asserts the 409 request's If-Match and body, the row conflict state, and the reapply If-Match (`before+1`) with body `{name}`. Afterwards the API has the inline name **and** the other session's objective.

**Draft recovery.** The T05 editor autosaves through the P5 routes: `createFormDraft` (recordType T05, recordId, baseRecordVersion and the changed fields only), then `updateFormDraft` with If-Match. A write happens at most every 10 s and on blur.
- On the record page, an open draft is offered with the badge, Restore draft and Discard draft.
- Restore opens the editor with the draft values. Save PATCHes the record (If-Match of the record) and **then** closes the draft as `saved`. Cancel keeps the draft. Discard closes it as `discarded`.
- "Your drafts" lists drafts across transformations.
- Proof:
  - `draft-recovery.test.tsx`: 14/14, en and ar.
  - e2e `p6-draft-recovery.spec.ts` (en, ar): typing then Tab gives `POST …/form-drafts` **201**, and the initiative is still version 1 with objective null. `localStorage` and `sessionStorage` are cleared and the page reloaded; the offer with the badge "Draft - not submitted" appears. "Your drafts" lists the row; its link leads back. Restore shows the drafted value. Save gives PATCH **200** and close **200**. The API then has version 2 with the drafted objective, and no open draft remains.

### REQ-S15-011

Acceptance: *"Every record header shows its lifecycle state; each list and detail view renders a designed state for empty, loading, error, stale, conflict and no-permission"*. A14/A20 text: *"component tests render each of the six states; a draft is labelled 'Draft - not submitted' and never counted in approved totals"*.

**The six states.** `six-states.test.tsx` renders empty, loading, error, stale, conflict and no-permission in en and ar.
- Each state has its `data-state`, a role, a text label and an icon. No bare `0` stands in for a value. The Arabic text is Arabic.
- The stale text is ADR-0057 §9's English exactly, read from the ADR file: "This information may be out of date. Last updated {time}." It is shown in Asia/Riyadh, together with the "Stale" label. An unknown time is said in words, never as 1970.
- The conflict text is §9's English exactly: "Someone else saved this record after you opened it. Compare the changes before saving again."
- 403 and 404 are distinguished without disclosing whether the record exists.
- Result: 26/26.

**The badge.** The text is exactly "Draft - not submitted" (en), asserted in unit tests and in the e2e. It appears on the record page offer, in the editor's status line and on each "Your drafts" row.

**Never counted.** Drafts are read only through the P5 and P6 draft routes (`forms/drafts.ts` on the API). No total, dashboard or report reads them. BE-Q2's static test is the API-side proof. This web change adds no draft value to any total.

**Scope note.** Draft recovery is mounted on the **T05 Initiative Card editor**. The `RecordDraftRecovery` component is generic and works with any `RecordDialog`/`InlineRecordForm`. Mounting it on the other form-record editors is one block per page, in files outside my ownership. See §7.

### REQ-S16-026

Acceptance: *"Every mutation carries the expected version; a mismatch returns 409 with the current version so the user can recover"*. A14 text: *"two users edit the same initiative; the second save returns 409 and the UI offers compare and reapply without losing the first change"*.

The ADR-0057 §7 three-way flow lives in `CompareChanges`, `RecordForm.FormConflict`/`reapply(keys)` and the `useVersionedSave` lines.

e2e `p6-compare-reapply.spec.ts` test 1 (en, ar) uses **two browser contexts**: `dev.office` and `dev.lead` open the same T05 editor.
1. Session 2 changes the name and the objective but has not saved.
2. Session 1 saves a new objective and new risks: PATCH 200.
3. Session 2 saves and gets **409**. The API is unchanged at version 2.
4. The compare table marks name as `mine`, risks as `theirs` (showing session 1's value) and objective as `conflict` (showing both values). Re-apply is disabled.
5. The user picks "Keep theirs" for the objective. The re-applied PATCH carries `If-Match: "2"` and body `{name}` only, and returns 200.
6. The API then has version 3: session 2's name plus session 1's objective and risks. **The first change is intact.**

QA-C's black-box `e2e/a14-compare-reapply.spec.ts` (caption, columns, `common.conflict.reapply`) passes on this UI, en and ar (§4).

## 3. Operations routed / pending-list delta

**None.** FE-D2 is a web task and routes no API operation. The operations it consumes are all routed already:
- `listMyFormDrafts` (BE-Q2);
- the P5 `listFormDrafts`, `createFormDraft`, `updateFormDraft`, `getFormDraft`, `closeFormDraft`;
- `updateInitiative`, `getInitiative`.

There is no `p6-pending-fe-d2.ts`. `contract.test.ts` pinned counts are unchanged: operation count delta 0, media types 0, rate-limit floor 0, CSRF-exempt 0. No migration and no new dependency.

## 4. Checks (exit codes are real; logs are in `docs/delivery/handbacks/DG6/T-DG6-FE-D2-evidence/`)

Environment: Node 24.21.0, offline, the sandbox host shared with other agents (load average 6–14). Harness ports: 26650–26699 only. Empty `.cc-writes` directories were removed before the tests.

| # | Command | Result | Exit | Log |
|---|---|---|---|---|
| A4 | `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | `PASS gate DG5 (historical)` | **0** | `validate-dg5-historical.txt` |
| A1 | `pnpm -r typecheck` (as `tsc --noEmit` of `apps/web` `tsconfig.json` and `tsconfig.e2e.json`; the other packages are unchanged) | clean | **0**, **0** | inline (§8 note) |
| A1 | `pnpm -r build` | all packages built. A first background build failed (exit 2) on a type error in my new `six-states.test.tsx`; I fixed it and re-ran | **0** | `build.txt` |
| A1 | `pnpm lint` | clean | **0** | `lint.txt` |
| A1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | "All matched files use Prettier code style!" | **0** | `prettier.txt` |
| A1 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | **0** | `openapi-lint.txt` |
| A2 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | vitest 1: 182/182 files, 2762/2762 tests. vitest 2 (web): 116/117 files, **1992/1993** tests, **1 failed**. vitest 3: 3/3 files, 259 passed, 2 skipped | **1** | `test-locale-unset.txt` |
| A2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | identical counts, with the same single failure | **1** | `test-locale-cutf8.txt` |
| — | the single failure (both runs): `p6-admin-screens.test.tsx` "identity shows whether a client secret is configured" | **pre-existing**: fails the same way on a clean sparse clone of `HEAD db187d5b` without FE-D2 (§7 item 2) | 1 at HEAD | `head-admin-identity.txt` |
| A3 | `QA_PG_PORT=26660 MTH_PORT_POOL=26661-26699 tests/qa/support/with-pg.sh pnpm test:integration` | **completed after the handback draft**: 391/396 files passed, 5 with failures; **4028 passed, 7 failed**, 1 skipped, 2 todo (4038); duration 2931 s. All 7 failures are API or QA tests (below). FE-D2 changes only `apps/web/**` (`git diff --name-only` confirms no API, db, shared or test-support file), but I did **not** re-run these on HEAD to prove they pre-exist | **1** | `test-integration.txt` |

Integration files with failures (final):
- `tests/qa/integration/a12-p6-scope-isolation.test.ts` (1 failed);
- `tests/qa/integration/a17-import-and-integration.test.ts` (2 failed);
- `apps/api/test/integration/assistant/conversations.test.ts` (1 failed);
- `apps/api/test/integration/contract/response-validation.test.ts` (2 failed, one a 30 s timeout);
- `apps/api/test/integration/admin/security.test.ts` (1 failed).

Pinned-count change: none from FE-D2.

**Targeted web tests** (FE-D2's own files, en and ar), all passing in the full runs above:

| File | Result |
|---|---|
| `threeWay.test.ts` | 4/4 |
| `CompareChanges.test.tsx` | 6/6 |
| `InlineEditCell.test.tsx` | 10/10 |
| `draft-recovery.test.tsx` | 14/14 |
| `six-states.test.tsx` | 26/26 |
| `useVersionedSave.compare.test.tsx` | 1/1 |

The affected neighbours also pass: `table-regions`, `p2`, portfolio, business-cases, benefit-formulas, `States`, `RecordForm.alerts` and saved-views (16 files, 261 tests, run in isolation).

**e2e on the real stack** (`apps/web/e2e/support/with-stack.sh`; `E2E_PG_PORT=26650 E2E_API_PORT=26651 MTH_PORT_POOL=26652-26699`; `--workers=1`; chromium-en and chromium-ar):
- **Run 1** (`e2e-p6-fe-d2-run1.txt`): the two new specs, **6/6 passed**, exit **0**. Load average 9.0 to 7.9.
- **Run 2** (`e2e-p6-fe-d2-run2.txt`): the new specs plus the existing specs this change can affect: QA-C `e2e/a14-compare-reapply.spec.ts`, `journeys`, `p3-journeys`, `p3-business-cases`, `p3-prioritization-roadmap`, `p5-diagnose-reflow`, `p5-forms`, `p3-portfolio`, `p6-register-1000`. Result: **99 passed, 3 failed, 14 did not run**, exit **1**.
  - All 6 FE-D2 tests passed.
  - QA-C's A14 passed in both languages, as did journeys' 409 step and p5-diagnose-reflow's 409 at 390 px.
  - The 3 failures are §7 items 3 and 4: two pre-existing auditor checks owned by FE-B/FE-D, and one screenshot error during the disk incident. The 14 skipped tests are the rest of that serial file.
- **Re-run of `p3-journeys.spec.ts` alone** (`e2e-p3-journeys-rerun.txt`): **34 passed, 2 failed**, exit 1.
  - `1c` (ar) now passes.
  - The 2 failures are test 7 in en and ar, the same pre-existing `SELECT:Unsaved view` / `SELECT:طريقة عرض غير محفوظة` (FE-D's saved-view picker for the auditor).
- **Budgets** (rules 13 and 15): 180 s per test. The measured loaded worst case is 14.3 s (two-session A14, ar, run 2); inline edit takes 5.5–6.8 s and the draft reload 10.5–14.2 s. 180 s is about 12x the worst case, and the spec headers state it.
- Every new screen passes axe with 0 serious or critical issues. Every request stays on the application origin.

**Screenshots** (EN and AR), under `docs/delivery/handbacks/DG6/T-DG6-FE-D2-evidence/screenshots/{en,ar}/`:
- `p6-draft-autosaved`, `p6-draft-offer`, `p6-my-drafts`, `p6-draft-restored`;
- `p6-compare-conflict`, `p6-compare-resolved`, `p6-compare-reapplied`;
- `p6-inline-conflict`, `p6-inline-compare`.

Run 2 also wrote the existing specs' screenshots into the same folder, because they share `E2E_SCREENSHOT_DIR`.

**Interaction checks actually run, through Playwright on the real stack:**
- keyboard: Tab-out autosave, Enter submits the inline edit, Escape cancels it (unit test);
- radio choice gating re-apply;
- two independent browser contexts;
- `localStorage`/`sessionStorage` cleared, then reload;
- deep link from "Your drafts" back to the record;
- RTL layout checked visually on `ar/p6-draft-offer.png` and `ar/p6-compare-resolved.png`.


## 5. Contract, schema or dependency needs (for the orchestrator)

1. **No shared zod mirror exists for `MyFormDraft` / `MyFormDraftPage`.** `components/draft-recovery/api.ts` holds a local strict zod schema written from `docs/api/openapi.yaml`. Suggest a `myFormDraft` mirror in `packages/shared/src/schemas/forms-records.ts` (BE-Q2's area). The web can then import it in one line.
2. No new dependency, no migration, no new problem code.

## 6. User-facing texts made untrue

None found:
- The en and ar catalogues were searched for draft recovery, inline edit, compare or autosave described as "later", "planned", "not yet" or "future".
- The P5 form-framework texts (`forms.edit.draftSaved` "Draft saved — not submitted. The record has not changed.") are notices, not the badge, and stay true.
- The changed `common.state.staleSince` → `staleUpdated` replaces one text with the §9 text in both languages.

All new Arabic is **provisional**. The `productivity.*` texts are covered by the "productivity." entry of `components/saved-views/provisional-ar.ts`. The three `common` keys are listed in `components/compare/provisional-ar.ts` and bound by `six-states.test.tsx`.

## 7. What remains, and disclosures

1. **Draft recovery on the other form-record editors.** Only T05 (Initiative Card) is mounted. Each further editor needs one `RecordDraftRecovery` block in its page (the T05 block is the template). Those pages are outside my file list, so this is left for the orchestrator to assign. ADR-0057 §6 scopes P6 draft recovery to "the form-record editors".
2. **Pre-existing failure, not caused by FE-D2: `src/pages/admin/security/p6-admin-screens.test.tsx` "identity shows whether a client secret is configured".**
   - The test asserts that no `input` exists on the page, but the header's global search box (FE-D) is one.
   - It fails identically on a clean sparse clone of `HEAD db187d5b` without my change (`head-admin-identity.txt`).
   - Owner: FE-B/FE-D (its file). It makes `pnpm test` exit 1 in both locale runs.
3. **Pre-existing e2e failures, not caused by FE-D2** (run 2):
   - `p3-business-cases.spec.ts:397` (en): strict-mode violation, two `[data-state='read-only']` elements. The second comes from FE-B's `components/sensitivity/SensitivityPanel.tsx:241`.
   - `p3-journeys.spec.ts:1399` (en): the auditor's no-enabled-control check finds `SELECT:Unsaved view`, which is FE-D's saved-view picker. The auditor is meant to apply views, but this spec's allow-list was not updated.
   - Both files and both components are outside my ownership. Neither touches a FE-D2 element: the inline cell, the draft offer and the badge are all absent for the auditor.
4. **An environment incident I caused, disclosed.** During e2e run 2, my first attempt at the HEAD check (a full `git clone` under `$TMPDIR`) filled the shared disk for a short time. I removed the clone at once and redid the check as a sparse clone.
   - `p3-journeys.spec.ts:248` (ar) failed in that window with "Page.captureScreenshot: Unable to capture screenshot". Its serial file then skipped 14 tests.
   - That file was re-run on its own afterwards: see §4.
5. **Polish (Low).** Inside a dialog, the five-column compare table wraps tightly (screenshot `ar/p6-compare-resolved.png`). It is in a scroll region and stays usable. A wider dialog for the conflict state would read better.
6. `RecordForm.tsx` gained three named changes (see §1), so **every** DG2–DG5 record form's 409 now uses the three-way compare. Existing unit tests and the e2e specs that exercise those conflicts (journeys, P3, P5 diagnose reflow, QA-C A14) pass (§4).

## 8. Merge instructions

- No migration and no dependency.
- Expect conflicts only in the shared files: `app/router.tsx` (one lazy page plus one route line), and `i18n/{en,ar}/productivity.json` / `common.json` (new blocks; `staleSince` renamed).
- `table-regions.test.tsx` loses one list entry.

- **Time:** end `Fri Oct 30 23:36 UTC 2026`, about 134 minutes, past the ~2 h limit. The overrun was the full unit runs (about 10 min each, ×2), the e2e regression run (15 min) and the integration suite, which is still running.
- **What remains:**
  1. The integration run (A3) exits 1 with 7 API/QA failures; the orchestrator should triage them against HEAD.
  2. Proving the 7 integration failures exist without FE-D2. FE-D2 is web-only, but that was not re-run on HEAD.
  3. Draft recovery mounted on the other form-record editors (§7 item 1).
  4. The polish item (§7 item 5).
  5. The shared `myFormDraft` zod mirror (§5 item 1).
- **Note on typecheck:** I ran `tsc --noEmit` for the web app and its e2e project (both exit 0). The successful `pnpm -r build` runs `tsc` for every package. I did not run the literal `pnpm -r typecheck` command separately.
