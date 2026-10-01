# Handback: T-DG1-FE3, web transition and UX consistency with the P1 close rule (frontend-ux-engineer)

- **Stage:** P1 / DG1, round-2 repair follow-up to **F-DG1-001**
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-FE3-frontend-ux-engineer-20261001T074558Z-0bf43778","session_id":"0bf43778-215f-4c26-a3c2-fce24a1cbdb7"}`
- **Assignment:** `docs/delivery/assignments/DG1/round-2/T-DG1-FE3.md` (sha256 `ad090f4e…0858f`, verified)
- **Base revision:** `HEAD` = `15f1cf1a7e8ac0bb768cedafdead020aa49dbb89` (includes `98e3d72`). Dedicated worktree `/home/user/mth-wt-fe3`. Run offline; no `pnpm install`.
- **Scope respected:** source changes are in `apps/web/**` only. The only other files written are this handback and its evidence directory. Nothing was committed: the orchestrator integrates.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/transformations/TransformationEditPage.tsx` | Adds the exported constant `P1_GOVERNED_STATUSES = ["closed"]`. Its comment says it mirrors the API's `GOVERNED_TARGET_STATUSES`, that the API refuses it in P1 (422 `invalid-transition`, governed by G6), and `TODO(P2)` to lift it into `@mth/shared`. Adds the exported helper `offeredStatusOptions(current)`: the current status, plus the allowed next statuses, minus the governed targets. The status `<select>` now uses this helper. |
| `apps/web/src/i18n/en/transformations.json` | `transformations.form.statusHint` lists only the P1 transitions and says that closing needs the G6 business approval. |
| `apps/web/src/i18n/ar/transformations.json` | The same change in Arabic, using the glossary terms (التحوّل, البوابة 6 - الاستدامة). |
| `apps/web/src/pages/transformations/transformations.test.tsx` | New `describe("P1 close rule in the edit form (F-DG1-001, T-DG1-FE3)")` block with 5 tests (see §2). No existing test expected `closed` to be offered, so none needed updating. |
| `docs/delivery/handbacks/DG1/round-2/T-DG1-FE3-screenshots/*` | Evidence: 4 Playwright screenshots, the capture script, and the interaction-check output. |

## 2. Behaviour delivered

- **Fix 1. `closed` is no longer offered.** `offeredStatusOptions` gives:
  - `draft` → `[draft, active]`
  - `active` → `[active, on_hold]`
  - `on_hold` → `[on_hold, active]`

  The current status is always first, so an already-`closed` record still renders: `offeredStatusOptions("closed")[0] === "closed"`. The shared table `TRANSFORMATION_STATUS_TRANSITIONS` is unchanged (`packages/**` is out of scope). The web filters the governed target out of it, the same way the API's `isAllowedTransition` does.
- **Fix 2. Status hint.**
  - EN: "Only the allowed next statuses are offered: draft → active; active → on hold; on hold → active. Closing a transformation needs the G6 (Sustain) business approval, which is available in a later release."
  - AR: "لا تُعرض إلا الحالات التالية المسموح بها: مسودة ← نشط؛ نشط ← معلّق؛ معلّق ← نشط. يتطلّب إغلاق التحوّل اعتماد الأعمال في البوابة 6 - الاستدامة، وسيتاح ذلك في إصدار لاحق."
  - **Wording deviation, please confirm:** the assignment says "available in a later stage". I wrote "later release" (AR "إصدار لاحق") for two reasons. First, the UI already uses "المرحلة" / "phase" for playbook phases, so "a later stage/phase" could be read as a later *transformation phase*. Second, "later release" matches the API's own 422 detail ("…not available in this release"). If the orchestrator prefers "stage", it's a one-string change in each catalogue plus the exact-match assertion in the test.
  - The Arabic string uses "التحوّل" with the shadda, and the glossary term "البوابة 6 - الاستدامة" (glossary row "G6 - Sustain"). "اعتماد الأعمال" matches the existing "اعتمادات الأعمال" in `admin.json`. The existing glossary suite (`glossary.test.ts`, which also checks the shadda spelling) still passes.
- **Fix 3. The `closed` label is kept.** `transformations.status.closed` (EN "Closed", AR "مغلق") and `auditChanges.ts` are untouched. The existing audit-trail tests ("Status: Active → Closed" and "الحالة: نشط ← مغلق") still pass.
- **Fix 4. Tests.** All five are in `transformations.test.tsx`:
  1. `P1_GOVERNED_STATUSES` is exactly `["closed"]`.
  2. `offeredStatusOptions` for draft, active and on_hold matches the lists above and never contains `closed`. It also checks that the shared table still lists `closed` (so the filter is what removes it) and that a closed record renders its own status.
  3. The EN hint matches exactly, and neither hint contains "or closed", "→ closed", "أو مغلق" or "← مغلق". The AR hint contains the P1 transitions, "البوابة 6 - الاستدامة" and "التحوّل".
  4. and 5. In both EN (LTR) and AR (RTL), the rendered edit page for an `active` record shows a status `<select>` with exactly `["active","on_hold"]`, the correct `document.dir`, and the hint text.
  - **Mutation check:** with the `.filter(...)` temporarily removed, 3 of the new tests failed ("Tests 3 failed | 11 passed (14)"). With it restored, all pass.

## 3. Checks actually run

Environment: worktree `/home/user/mth-wt-fe3`, Node v22.22.2, offline, existing `node_modules`. The table shows the final run, after the wording change.

| Command | Exit | Output tail |
|---|---|---|
| `pnpm --filter @mth/web typecheck` | 0 | `tsc -p tsconfig.json` (no errors) |
| `pnpm --filter @mth/web build` | 0 | `✓ built in 2.71s` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` (no output) |
| `pnpm check:no-cdn` | 0 | `PASS no-cdn: scanned apps, packages` |
| `pnpm --filter @mth/web test` | 0 | `Test Files 8 passed (8)` / `Tests 97 passed (97)` (`transformations.test.tsx` 14 tests, 5 of them new) |
| `pnpm test` (whole repo) | 0 | `Test Files 21 passed (21)` / `Tests 210 passed (210)` |

**Visual evidence and interaction checks.** I ran `vite preview` of the built `dist` on `127.0.0.1:4179`, with Chromium from `/opt/pw-browsers` driven by `@playwright/test`. The API was mocked with Playwright `page.route` returning **synthetic** fixtures: an org-wide Transformation Office grant and TR-0001 at version 4. These screenshots are **not** from the live API+DB stack; that flow is covered by the e2e suite, which I did not run here (it needs the DB stack). For each locale × status (`active`, `on_hold`), the script read the option values and labels, `document.dir`, and focused the select to check that it takes focus and has `aria-describedby` set to the hint.

| Screenshot | Result |
|---|---|
| `docs/delivery/handbacks/DG1/round-2/T-DG1-FE3-screenshots/T-DG1-FE3-edit-status-active-en.png` | dir `ltr`; options `["active","on_hold"]` = Active, On hold |
| `docs/delivery/handbacks/DG1/round-2/T-DG1-FE3-screenshots/T-DG1-FE3-edit-status-on_hold-en.png` | dir `ltr`; options `["on_hold","active"]` |
| `docs/delivery/handbacks/DG1/round-2/T-DG1-FE3-screenshots/T-DG1-FE3-edit-status-active-ar.png` | dir `rtl`; options نشط، معلّق |
| `docs/delivery/handbacks/DG1/round-2/T-DG1-FE3-screenshots/T-DG1-FE3-edit-status-on_hold-ar.png` | dir `rtl`; options معلّق، نشط |

- In every case the focused element was `SELECT`, with `aria-describedby` = `…-hint`, and a visible focus ring appears in the screenshots.
- Raw output: `docs/delivery/handbacks/DG1/round-2/T-DG1-FE3-screenshots/interaction-checks.jsonl`.
- Script: `docs/delivery/handbacks/DG1/round-2/T-DG1-FE3-screenshots/capture-script.mjs`. It was run from the repository root as a temporary copy, which was then deleted.
- I inspected the screenshots visually. The AR hint reads right-to-left with the arrows (←) pointing in reading order, and the EN hint reads left-to-right.

## 4. Known gaps / not done

- The source of truth is still duplicated (web `P1_GOVERNED_STATUSES` versus API `GOVERNED_TARGET_STATUSES`). Lifting it into `@mth/shared` is deferred to P2 as assigned, because `packages/**` is out of scope. The test pins the web value to `["closed"]` but doesn't import the API constant (the web doesn't depend on `apps/api`).
- I did not run the e2e suite (`pnpm --filter @mth/web e2e`) against the live stack: **BLOCKED** in this run because it needs the Postgres/API stack, which wasn't started. Nothing in this change touches the API contract.
- The Arabic wording follows the DG0 glossary, which is still a proposal pending review by a Mobily Arabic-language owner.
- The "later release" wording differs from the assignment's "later stage" (see §2). The orchestrator needs to confirm it.
- No business, Finance or IT approval is implied. G6 is referenced only as a future in-product business approval, and it is unrelated to DG7.

## 5. Merge instructions

- No migrations and no dependency or lockfile changes. Four files under `apps/web/src`, plus this handback and its evidence directory.
- No conflicts are expected unless another branch edits `transformations.form.statusHint` or the end of `transformations.test.tsx`.
