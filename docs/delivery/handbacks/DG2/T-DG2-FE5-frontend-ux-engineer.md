# Handback T-DG2-FE5: DG2 round-3 repairs (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING), round-4 repair. Branch `claude/mobily-transformation-platform-regate`.
- **Base:** `HEAD` = `190504171b37151e553d4357a5d8f3f432aacba6`, checked with `git rev-parse HEAD` before writing. T-DG2-BE6 was already integrated at this base. The changes are uncommitted in the working tree; the orchestrator integrates them.
- **Assignment:** `docs/delivery/assignments/DG2/round-4/T-DG2-FE5.md`, sha256 `1ea8d101…3c1cfc5`, checked with `sha256sum`.
- **Invocation:** `DG2-T-DG2-FE5-frontend-ux-engineer-20261006T064016Z-73bd85e3`, session `73bd85e3-dd90-4940-83a2-9cf838554102`.
- **Findings repaired:** F-DG2-210 (Medium, REQ-PB-029) and F-DG2-211 (Medium, REQ-S15-012). I authored these fixes, so I don't close the findings.
- **Not touched:** `packages/shared/**`, `apps/api/**`, ADRs, `tools/**`, `.claude/**`, `docs/source/**`, and all reviews and gate records. The QA round-3 specs were read but not edited.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/components/RecordForm.tsx` | **F-DG2-210.** The form sends free text verbatim: only `""` becomes `null`, with no `trim()`. A new `blankErrors` pre-check uses the shared `hasText` from `@mth/shared/schemas` on every `text`/`textarea`/`url` field that would be sent. On create that is every sent field; on edit it is only the fields the user changed. Any such field that is non-empty but has no visible content gets the field error `validation.blank`, merged with the shared-schema errors, and nothing is sent. After any field error (client or server), focus moves to the first `[aria-invalid="true"]` control in the form, through `formRef` and an effect. A new `FieldSpec.annotation` flag stops an update whose only changed fields are annotations: it shows "There are no changes to save." and never writes a content-free version. **F-DG2-211.** The unmapped-errors banner is now `<div role="alert" class="banner banner--error" data-state="form-errors"><ul class="plain-list"><li>…`, so the live region wraps a real list. |
| `apps/web/src/pages/define/CharterPage.tsx` | `changeSummary` is marked `annotation: true`, so the charter form cannot send a PATCH that carries only `changeSummary`. |
| `apps/web/src/pages/p2.test.tsx` | 10 new component tests in EN and AR (listed in §2). |
| `apps/web/e2e/p2-blank-text.spec.ts` | New P2 negative e2e spec on the real stack (chromium-en and chromium-ar), with axe in every state, including the error-banner state. |
| `docs/delivery/handbacks/DG2/T-DG2-FE5-evidence/*` | Check logs, two screenshots and the axe summaries (716 KB). I wrote no evidence under `test-evidence/` because that is not my write scope. |

## 2. Behaviour delivered

### F-DG2-210 (REQ-PB-029): RecordForm and the charter form (one implementation: the charter is an `InlineRecordForm`)

- **`""`** keeps its old meaning. On create no value is sent. On edit of a filled field, an explicit `null` is sent.
- **A non-empty value with no visible content** (`value !== "" && !hasText(value)`, the server's own predicate) is an inline field error with `problems.validation__blank`:
  - EN: "Enter some text; spaces alone are not a value."
  - AR: "أدخِل نصاً؛ المسافات وحدها ليست قيمة."
  - The field gets `aria-invalid="true"` and `aria-describedby` pointing at the error, and focus moves to it. **No request is sent.**
- **Edit:** an unchanged field is never sent, and an untouched legacy value never blocks saving other fields. A whitespace field is now an error rather than being dropped, so the old `{changeSummary}`-only PATCH can't happen. Separately, a change summary alone is reported as "no changes to save".
- **Visible text is sent verbatim.** Nothing is trimmed, and RLM marks are kept.
- The other field kinds are unchanged: decimals, integers, trajectory, select, date and checkbox.

**Component tests** (new, `p2.test.tsx`):
- T01, whitespace Current state, EN and AR: inline message, `aria-invalid`, the describedby text contains the message, focus is on the field, no PATCH, and the "no changes" banner is absent.
- T01 edit: an emptied field is sent as `null` and visible text verbatim (`"  Synthetic cause‏  "`).
- Charter create, whitespace Case for change, EN and AR: inline error, describedby, focus, no POST.
- Charter edit, whitespace Out of scope, EN and AR: inline error, focus, no PATCH.
- Charter edit, EN and AR: emptying Out of scope sends `null`; an Arabic In scope with RLM marks and surrounding spaces is sent verbatim.
- Charter edit, change summary alone: "There are no changes to save." and no PATCH.

**Regression check.** I temporarily swapped in the `HEAD` versions of `RecordForm.tsx` and `CharterPage.tsx` and re-ran the tests: **7 of the new tests failed**. They were the whitespace T01 cases (EN, AR), charter create (EN, AR), charter edit (EN, AR) and the summary-only case. With the fix, all 56 tests in the file pass. The originals were restored right after this run.

### F-DG2-211 (REQ-S15-012): error banner semantics

- `role="alert"` now sits on a wrapper `<div>` around a semantic `<ul>`.
- **Sweep of `apps/web/src/**`:**
  - A grep for `role=` on `<ul>`/`<ol>`, including multi-line JSX attributes, found only `RecordForm.tsx:328`, which is now fixed.
  - Every other `role="alert"`/`role="status"` is on a `<p>`, `<div>`, `<span>` or `<section>`.
  - I found no `<li>` outside a list. This was checked by grep and by axe across all 45 P2 scans and the P1 scans.
- The component test asserts that the alert is a `DIV` containing `ul:not([role]) > li`.
- The e2e test drives the real error-banner state ("There are no changes to save.") and runs axe on it in EN and AR. Result: **0 violations of any impact** (`axe-summary-p2-blank-{en,ar}.json`, key `p2-blank-error-banner`).

### e2e on the real stack (`apps/web/e2e/p2-blank-text.spec.ts`)

1. **Setup.** A fresh synthetic transformation is created through the API; `GET …/charter` returns 404.
2. **Charter create.**
   - A whitespace Case for change (`"   \n\t  "`) shows the message, `aria-invalid`, the accessible description and focus. **No mutating request to `/charter`** is sent (request listener), and `GET …/charter` is still 404. axe runs.
   - Then visible text `"  Synthetic: billing errors  "` creates v1 and is stored verbatim.
3. **Charter edit.**
   - A whitespace Out of scope plus a change summary shows the message and focus, and no request is sent.
   - Afterwards the API shows version still 1, Out of scope still `"Synthetic: wholesale billing"` (**not cleared**), and `versions` has length 1. axe runs.
   - Next a change summary alone is sent. It shows the `[data-state=form-errors][role=alert]` banner with a list item. axe runs (F-DG2-211 state), no request is sent, and the version is still 1.
4. **T01.** A whitespace Current state shows the message and focus, the "no changes" banner is absent, and **no mutating request at all** is sent. axe runs.

**Screenshots** (full page, cited):
- `docs/delivery/handbacks/DG2/T-DG2-FE5-evidence/en-p2-blank-03-error-banner.png`: the EN charter form with the "There are no changes to save." banner above the buttons; v1 is the only version.
- `docs/delivery/handbacks/DG2/T-DG2-FE5-evidence/ar-p2-blank-04-t01.png`: the AR (RTL) T01 dialog. The red-bordered الوضع الراهن field shows the inline message "أدخِل نصاً؛ المسافات وحدها ليست قيمة." with its alert icon.

I inspected both visually. The other six screenshots stayed in run scratch.

## 3. Checks actually run

Environment: offline sandbox, Node v24.21.0 unless stated otherwise. Logs are in `docs/delivery/handbacks/DG2/T-DG2-FE5-evidence/`.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | **exit 0** (`typecheck.log`) |
| `pnpm -r build` | **exit 0** (`build.log`: "apps/api build: Done") |
| `pnpm lint` (`eslint . --max-warnings=0`) | **exit 0** (`lint.log`) |
| `pnpm format:check` | **exit 2**. The output says "All matched files use Prettier code style!" The only errors are 12 "Unable to read file" (EACCES) on sandbox-masked untracked dotfiles: `.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md` (`format-check.log`) |
| `pnpm exec prettier --check . --ignore-path .prettierignore --ignore-path <file listing those 12>` | **exit 0**: "All matched files use Prettier code style!" (`format-check-ignore-path.log`) |
| `pnpm test` on Node v22.22.2 (`/opt/node22/bin`) | **exit 0**: `Test Files 31 passed (31)`, `Tests 568 passed (568)` (I add 10 tests, all in `p2.test.tsx`. BE6 reported 550 at its own base; I didn't measure the count at `HEAD` before my change) (`unit-node22.log`) |
| `pnpm test` on Node v24.21.0 | **exit 0**: `Test Files 31 passed (31)`, `Tests 568 passed (568)` (`unit-node24.log`) |
| `pnpm --filter @mth/design-tokens run check:contrast` | **exit 0**: "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" (`contrast.log`) |
| `E2E_PG_PORT=54518 E2E_API_PORT=3518 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | **exit 0**: `50 passed (3.3m)`, covering P1 9+9, P2 12+12 and the new spec 4+4 (`e2e-run.log`). Disposable PostgreSQL with 19 migrations and the synthetic seed; pre-installed Chromium; `playwright install` was not run. axe on the P2 scans: 45 per language, **0 serious/critical**; every failing axe call would have failed its test. |
| The same with only `p2-blank-text.spec.ts` (ports 54517/3517) | **exit 0**: `8 passed (18.9s)` (`e2e-blank-only.log`) |
| Component regression check (`HEAD` `RecordForm.tsx`/`CharterPage.tsx` swapped in, `npx vitest run src/pages/p2.test.tsx`) | `Tests 7 failed / 49 passed (56)` on the old code, as expected; `56 passed` with the fix |
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0**: `PASS gate DG1 (historical)` (`validate-dg1-historical.log`) |

## 4. Known gaps / not done

- **Regression check not repeated in e2e.** I did not re-run the new e2e spec against a build of the old code, so there is no browser-level proof that the old `<ul role="alert">` fails axe in this exact state. The finding's own QA evidence shows that it does, and the component test checks the new structure.
- **Hand-written P2 forms are out of scope.** Some P2 forms don't use `RecordForm` and still `trim()` before sending:
  - the gate submission note, decision rationale and comments (`GateDetailPage.tsx`);
  - the journey steps (`JourneysSection.tsx`);
  - the row-action note (`RowActions.tsx`).
  - The assignment names RecordForm and the charter form, so I left these unchanged. Rationale and note already reject an all-space value through a required/trim check, but they send trimmed text rather than verbatim text. I suggest a follow-up observation if reviewers want the same rule there.
- **P1 admin and transformation forms use `trim()` on purpose.** They match the P1 `name`/`reason` schemas, as noted in the BE6 handback.
- **Message wording.** The `validation__blank` message says "spaces" and also covers invisible-only input. The wording is unchanged, as the assignment requires.

## 5. Merge instructions

- No migrations, no OpenAPI or API change, no shared-package change, no config change.
- The new spec `apps/web/e2e/p2-blank-text.spec.ts` (sha256 `2750e91f…dd2df`) is matched by the existing `testMatch`. It creates its own synthetic transformation, so it is independent of `p2-journeys.spec.ts` ordering.
- I expect no conflicts; no other agent ran at the same time.
