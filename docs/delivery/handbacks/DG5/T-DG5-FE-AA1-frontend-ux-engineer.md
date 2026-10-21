# Handback T-DG5-FE-AA1 (frontend-ux-engineer): DG5 round-5 repair, F-DG5-147

- **Stage:** DG5, FIXING after round 5 (candidate `sha256:a18a9f05…`, D-178).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-AA1.md` (sha256 `92b439e3…3e4`, verified at start).
- **Invocation:** run `DG5-T-DG5-FE-AA1-frontend-ux-engineer-20261021T213544Z-2c120e89`, session `2c120e89-18fe-41e4-848f-a5fe338269d1`.
- **Working tree:** `/home/user/wt/dg5-fe-aa1`, branch `dg5/fe-aa1`, base `HEAD` `c819f15`. Changes are left **uncommitted**.
- **Time:** started `2026-10-21T21:35:57Z`, finished about `22:50Z` (about 75 minutes).
- **Preceding gate at start:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0.
- **Preceding gate at end:** the same command, exit 0 (`40-validate-dg4-historical-end.log`).

Evidence directory: `docs/delivery/handbacks/DG5/T-DG5-FE-AA1-evidence/` (written `EV/` below).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/styles/app.css` | **Lines 380–398:** `overflow-wrap: anywhere` on `.page-header__title`, `.page-header__subtitle`, `.breadcrumbs li`, `.card__title` and `.dialog__title`, plus `min-inline-size: 0` on `.page-header__row > *`. **Lines 1587–1589:** `overflow-wrap: anywhere` on `.entry-list > li`. |
| `apps/web/e2e/p5-title-reflow.spec.ts` (new) | qa's R5-TITLE probe turned into an asserted product e2e spec, in chromium-en and chromium-ar. It also covers the P5 transformation picker. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-AA1-*` | This handback, its logs and my spec's screenshots. |

There are no component changes. `Page.tsx`, `Section.tsx` and `Form.tsx` already carry the classes the CSS targets.

## 2. F-DG5-147 (Low, REQ-S15-009)

### Cause

None of the headings or title containers that show user text set `overflow-wrap`. Those are the page-header h1 and subtitle, the breadcrumb items and `h2.card__title`, which includes the DG4 card heading "B01 · <title>" and the P5 heading "Form tools: <title>".

- An unbroken token keeps its full width as the element's min-content width.
- The `.page-header` grid track and the `.page-header__row` / `.card__header` flex items cannot shrink below that width.
- So the page widens. In ar it widens past the left edge.

### Fix (D-178)

**`apps/web/src/styles/app.css:380-398`**

- `overflow-wrap: anywhere` is set on:
  - `.page-header__title`
  - `.page-header__subtitle` (the workspace header shows the transformation name here on every tab page, including the T14 benefit page)
  - `.breadcrumbs li`
  - `.card__title`
  - `.dialog__title` (the T01 "Form tools: <title>" is a dialog title)
- `min-inline-size: 0` is set on `.page-header__row > *`.

This is the rule the product already uses for long values (`.text-cell`, `.audit-changes`, the automation failure queue).

- **Why `anywhere` and not `break-word`:** `anywhere` also lowers the min-content width, so the surrounding grid and flex tracks shrink to the viewport.
- **Ordinary text:** it still breaks at spaces first. The spec asserts that it stays on one line where it fits.

**`apps/web/src/styles/app.css:1587-1589`**

`overflow-wrap: anywhere` on `.entry-list > li`. This is the same defect class in another title container.

- My first 4-spec run surfaced it. `p5-reflow-axe.spec.ts` failed in chromium-ar on `/playbook/launch-plan` and `/playbook/health-check`: the page scrolled by 806 px at 390 px and by 1625 px at 200 % (`EV/30-e2e-4specs-unset-first-run-failed.log`).
- The cause is the P5 `TransformationPicker` (`apps/web/src/pages/launch-plan/ui.tsx:99`). It lists transformation names as links in `.entry-list` items, and my spec's synthetic 120-character name was then in the database.
- In en the axe spec ran before my spec created the data (Playwright orders files alphabetically per project), so en did not show it.
- The same class is used by the entry lists in `PresentationPage.tsx`, `AreaPages.tsx` (two lists), `reports/ui.tsx` and `MigrationsEntryPage.tsx`. They all list record or area names, so the rule is right for all of them.

### Other heading and title containers checked

| Container | Verdict |
|---|---|
| `.page-header__actions` | Buttons only. Unchanged on purpose, so button labels never break inside a word. |
| `.card__header` (nine direct usages outside `Section`) | Layout unchanged. Their `.card__title` now wraps. `.section__header` already has `flex-wrap: wrap`. |
| `.chip-row` (the workspace subtitle) | Inherits the subtitle's rule. Status chips stay `nowrap` (base `.status-chip`). |
| `.dialog__title` | Included above. The dialog grid already uses `minmax(0, 1fr)` (T-DG5-FE-Z1C). |
| `.conflict__title`, `.app-notice > .banner`, `.status-chip--wrap`, `.p4-message__body` | Already `overflow-wrap: anywhere`. |
| `.state__title`, `.mode-guidance__title`, `.dev-login__title`, `.login__card h1`, `.small-heading`, `.card__subtitle` (`RecordForm` legends, Design h3s) | Fixed, translated strings, not user text. Unchanged. |
| `.outcome-card__title`, `.tom-box__title`, `.gate-card__title`, `.role-card__title` | Not measured. `.role-card__title` shows a role code and `.gate-card__title` a gate name. The outcome and TOM titles may hold user text and could be included in a follow-up. They are block headings inside cards (not flex items beside actions), so a long token there would overflow its card. **Not fixed: outside D-178's named scope; reported in §6.** |
| `.section-nav__list` | In-page links to section titles (fixed strings). Unchanged. |

### Regression test

`apps/web/e2e/p5-title-reflow.spec.ts`: one test per project, chromium-en and chromium-ar.

**Data, per language:** three SYNTHETIC transformations whose name and T14 benefit title hold:

- (a) a 120-character word;
- (b) the 46-character token `Synthetic_roaming_bill_shock_reduction_program`;
- (c) ordinary text.

**Measurements:**

- Screens: the T14 benefit page, the transformation overview, and (as `dev.lead`) the picker on `/playbook/launch-plan` and `/playbook/health-check`.
- Sizes: 390 × 900, 320 × 900, and 1280 × 900 with the root font at 200 %.

**Assertions:**

- qa's final condition, `scrollWidth - innerWidth <= 1`.
- The h1, the page-header subtitle, the breadcrumbs, every `h2.card__title` and every picker link lie inside the viewport.
- Set-up: the token is really in the page header, the card titles and the picker.
- No needless wrapping: at 1280 × 900 with the default font, the ordinary title renders the h1 and the "Form tools" heading on one line each.

**Failing before the fix** (dist built from the unchanged `HEAD` CSS), `EV/01-before-fix-unset.log`: `2 failed`, exit 1, 24 overflow cases (12 per language). The values match qa's round-5 numbers exactly:

| Token | Screen | 390 px | 320 px | 200 % |
|---|---|---|---|---|
| 46-char | Benefit page | 44 px (`h2.card__title [29..434]` en / `[-44..361]` ar) | 114 px | 113 px |
| 46-char | Overview | 183 px | 253 px | 415 px |
| 120-char | Benefit page | 877 px | 947 px | 1793 px |
| 120-char | Overview | 1368 px | 1438 px | 2797 px |

The plain cases passed.

- `EV/00-before-fix-unset-spec-draft1.log` is the first run of an earlier draft of the spec, with the same overflow failures. It also had one false "plain/overview/1280: the h1 renders on 2 lines" in ar. That draft counted lines by distinct client-rect tops, which a mixed-direction or mixed-font line splits. The spec now counts lines from box height ÷ line-height, and the re-run (`01`) shows 1 line.

**Failing before the `.entry-list` fix** (heading fix in, entry-list rule removed, web rebuilt), `EV/03-before-entrylist-fix-unset.log`: `2 failed`, exit 1. Only the picker cases failed: `picker/{launch-plan,health-check}` at 806, 876 and 1625 px, in en and ar.

- After this run I pointed the "outside" check at the picker's links rather than the `li` boxes. The links are what overflows; the `li` boxes stay in place.

**Passing after:** `EV/31-e2e-4specs-unset.log` and `EV/32-e2e-4specs-cutf8.log`.

- Every case shows `overflow 0`.
- Plain 1280: `h1 1 line(s), Form tools 1 line(s)`.

**Screenshots** (only my spec's, D-162), in `EV/shots/{en,ar}/`:

- `p5-title-reflow-w46-benefit-390.png`
- `p5-title-reflow-w46-overview-390.png`
- `p5-title-reflow-w120-benefit-390.png`
- `p5-title-reflow-w120-overview-390.png`
- `p5-title-reflow-picker-390.png`
- `p5-title-reflow-plain-benefit-1280.png`

I inspected `ar/p5-title-reflow-w46-overview-390.png`, `en/p5-title-reflow-w46-benefit-390.png` and `ar/p5-title-reflow-picker-390.png`. The token wraps inside the h1, the card titles and the picker links, and the page stays 390 px wide.

## 3. Checks (final tree, run one at a time, D-164)

Environment: Node 24.21.0, offline. Playwright uses `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `E2E_PG_PORT=23200`, `E2E_API_PORT=23201` and `MTH_PORT_POOL=23202-23249`, through `apps/web/e2e/support/with-stack.sh`.

| Command | Exit | Result | Log |
|---|---|---|---|
| `pnpm -r typecheck` | 0 | All packages done | `EV/10-typecheck.log` |
| `pnpm -r build` | 0 | All packages done | `EV/11-build.log` |
| `pnpm lint` | 0 | No problems | `EV/12-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `EV/13-prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `EV/14-openapi-lint.log` |
| `npx vitest run --project unit-web`, locale unset | 0 | 90 files, **1713/1713** passed | `EV/20-unit-web-unset.log` |
| `npx vitest run --project unit-web`, `LANG=LC_ALL=C.UTF-8` | 0 | 90 files, **1713/1713** passed | `EV/21-unit-web-cutf8.log` |
| 4 e2e specs (below), `--workers=1`, locale unset | 0 | **14/14** passed (8.3 min) | `EV/31-e2e-4specs-unset.log` |
| The same 4 specs, `C.UTF-8` | 0 | **14/14** passed (8.5 min) | `EV/32-e2e-4specs-cutf8.log` |
| `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)` | `EV/40-validate-dg4-historical-end.log` |

The four e2e specs are `p5-title-reflow.spec.ts`, `p5-form-tables-reflow.spec.ts`, `p5-reflow-axe.spec.ts` and `p5-forms.spec.ts`. Each run covers chromium-en and chromium-ar.

**Non-zero exits in the cited logs, all explained:**

- `EV/00-…draft1.log`, `EV/01-before-fix-unset.log` and `EV/03-before-entrylist-fix-unset.log`: exit 1, the intended failing-before runs.
- `EV/12-lint-first-run-failed.log`: exit 1. My spec used `parseFloat` for a CSS line-height, which the repository's Decimal rule forbids. It now uses `Number(… .replace("px", ""))`, a layout length rather than a value; lint was re-run with exit 0.
- `EV/30-e2e-4specs-unset-first-run-failed.log`: exit 1, 13 passed and 1 failed (`p5-reflow-axe` in ar). This is the `.entry-list` finding described in §2, fixed and re-run as `31`/`32`.

No test was flaky and none timed out.

**Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They belong to the orchestrator's merged-tree verification and are **not run**, not passed.

## 4. Contract, schema and dependency needs

None. There are no API, OpenAPI, zod or migration changes and no new dependency. I did not touch any of T-DG5-BE-AA1's files.

## 5. ADR and data-dictionary statements

I found none that the fix makes untrue. `docs/architecture/**` does not mention `overflow-wrap` or the wrapping of headings.

If the architect wants it recorded, the UI conventions could add one line: "headings, breadcrumbs, card, dialog and entry-list titles that can show user text wrap anywhere (F-DG5-147)". That would be for T-DG5-ARCH-R7, optional.

## 6. User-facing text

No text was added or changed, and none became untrue. The change is CSS only.

## 7. Remaining and notes for the orchestrator

- **Test data in the full suite.** My spec leaves synthetic transformations with a 120-character and a 46-character unbroken name in the shared e2e database, as qa's probe did. Specs that run after it and render transformation names on screens this spec does not measure could show overflow there.
  - I found and fixed the picker case.
  - The merged-tree full e2e run is where any other screen would show. Such a failure is a real product overflow of the same class, not a test bug.
- **Title containers not changed** (outside D-178's named scope): `.outcome-card__title` (Define), `.tom-box__title` (Design) and `.gate-card__title` (Gates). They may hold user text and do not set `overflow-wrap`. I did not measure them. They could get the same rule in a follow-up if qa or the orchestrator want it.
- **Not done:** nothing else from the assignment remains.

## 8. Merge instructions

- Two files, plus this handback and its evidence. There are no migrations.
- `apps/web/src/styles/app.css` is not in T-DG5-BE-AA1's ownership, so no conflict is expected.
- Rebuild `apps/web` (`pnpm -r build`) before any e2e run.
