# Handback T-DG5-FE-G2 (frontend-ux-engineer), DG5 W18 repair (D-163)

- **Invocation:** `DG5-T-DG5-FE-G2-frontend-ux-engineer-20261017T013332Z-e69c74c1`, session `e69c74c1-c070-4a87-9dfe-2b3c0dac1e25`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-G2.md`. Its sha256 `b761e3d8…0b6f4bb61b4` was verified at the start.
- **Base:** branch `dg5/fe-g2` at `f21a536`. The changes are **uncommitted** for the orchestrator to integrate.
- **Time:** started `2026-10-17T01:33:50Z`; ended `2026-10-17T03:48Z`. I stopped implementing at about `03:18Z`, past the 100-minute mark, and wrote this handback. §6 lists exactly what remains.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited **0** (`PASS gate DG4 (historical)`; `…-evidence/validate-dg4-historical.log`).

No business, Finance or IT approval was granted. All test data is synthetic. Product gates G1–G6 are separate from DG0–DG7. `#0078FF` stays a provisional token, and no text claims official Mobily colours.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/app/Shell.tsx` | The shell shows exactly the areas that `GET /me/navigation` returns, in `nav.ts` order (`visibleAreaIds(useMyNavigation().data)` filters `NAV_AREAS`). While the call is pending: no area list, `aria-busy`, a "Loading navigation…" line. On a failure: the `ErrorState` with a retry. `data-nav-state` is `loading`, `ready` or `error`. |
| `apps/web/src/app/me-navigation.ts` | No client fallback any more. A body that isn't the contract's shape is a query error. |
| `apps/web/src/app/me-navigation.test.ts` (new) | Unit test of `visibleAreaIds`: pending gives null, an empty answer gives an empty set, and the filter keeps `nav.ts` order. |
| `apps/web/src/app/app.test.tsx`, `apps/web/src/app/p5-shell.test.tsx` | Shell tests now follow the server rule. A technical admin gets 3 areas; the union of the defaults gets 14; WL gets 13 without Administration. New cases cover pending (no list), error (alert + retry recovers) and a malformed body (error). The tests wait for `data-nav-state=ready`. |
| `apps/web/src/test/navigation-fixture.ts` (new), `apps/web/src/test/fixtures.tsx` (one fallback hook plus a function, appended) | The scripted API's default `GET /me/navigation`. It mirrors the server's ADR-0049 §9 table for the scripted `/me`, so the ~80 unit-test files that render the shell stay realistic. **Outside my listed ownership**; disclosed here. |
| `packages/design-tokens/src/contrast.ts` | `deriveNavigationBackground(primary)`, `NAVIGATION_TEXT`, `NAVIGATION_TEXT_CONTRAST` (the D-163 rule, implemented once). |
| `packages/design-tokens/src/tokens.json` | `nav.background` moves from a semantic ref to `brand.deep` to a **derived** token from `brand.primary` (`darkenUntil 4.5` against white) = `#0071F1`. `nav.text-muted` becomes a ref to `nav.text` (white); see §5. Everything stays `provisional: true`. |
| `packages/design-tokens/src/tokens.test.ts` | Tests for `#0078FF`→`#0071F1`, `#FFD700`→`#8B7500` (hue kept), `#003B73`→itself, the lightest-step property, the token rule, and the gate pair. The CSS expectation is updated. |
| `apps/web/src/pages/branding/api.ts` | `THEMED_TOKENS` gains `nav.background`, so the server-derived shade (BE-R re-derives every `derived` token from the current branding version) recolours the navigation at render time. **FE-G's file**: a one-entry change. |
| `apps/web/src/pages/branding/BrandingPage.tsx` | The contrast preview shows the navigation colour derived from the **primary** colour, using the shared function. The old "white navigation text on the secondary colour" line was untrue and is now the **header** check (the header gradient starts at `brand.deep`). **FE-G's file**; F-DG4-160. |
| `apps/web/src/pages/studio/ElementsSection.tsx` | The approver route edits `mode` (sequential / parallel / any) and the ordered `approverRoleCodes`. Rules: exactly one approver form; sequential/parallel need 2–6 roles (ADR-0044 §4); codes are validated. A route summary (mode + ordered steps) and the `ProvenanceBadge` appear on the element view. |
| `apps/web/src/pages/studio/StudioFormDialog.tsx` | A new `roleList` field kind: an ordered list with labelled inputs per step, plus Add, Move up/down and Remove buttons (keyboard-operable; focus moves to a new row; a fieldset with legend, hint and error). |
| `apps/web/src/pages/studio/api.ts` | `displayValue`: a list of codes reads `BO · SP` (in the diff and the migration page) instead of JSON. |
| `apps/web/src/pages/studio/route-editor.test.tsx` (new) | Unit tests (en and ar) for the route rules, the dialog list editor (order, both forms refused, the server's 422 `admin_approver_forbidden` translated), the route summary and the provenance badge (and none after a failed read). |
| `apps/web/src/pages/reports/SnapshotPage.tsx` | `Checksum`: the full SHA-256 as one LTR `<bdi>` that wraps anywhere, with the full value as its title. `CodeLabel`: translated section and record-type labels, with a fallback to the evidence register's labels and then to the raw code in LTR. |
| `apps/web/src/pages/reports/snapshot-labels.test.tsx` (new) | Unit tests (en and ar) for the checksum and the labels. |
| `apps/web/src/i18n/{en,ar}/nav.json` | `loading` (appended). |
| `apps/web/src/i18n/{en,ar}/studio.json` | `elements.attr.mode`, `elements.attr.approverRoleCodes`, `elements.route.*` (appended inside `elements`). |
| `apps/web/src/i18n/{en,ar}/problems.json` | `studio_route__one_approver_form`, `studio_route__size` (appended; checked for duplicates). |
| `apps/web/src/i18n/{en,ar}/reportsP5.json` | `sourceSection.*` (22) and `sourceRecordType.*` (57) (appended). |
| `apps/web/src/i18n/{en,ar}/playbookP5.json` | `branding.contrastNavPass/Fail` (untrue) replaced by `contrastHeaderPass/Fail` and `contrastNavDerived`. |
| `apps/web/e2e/journeys.spec.ts` | The two DG1 pins (D-163), with comments: the TO sees **14** areas including Administration; `dev.admin` sees **My Work, Playbook, Administration**, and the administration journey still reaches its screens. |
| `apps/web/e2e/p5-navigation.spec.ts` (new) | A synthetic union-of-defaults user sees 14 areas; a synthetic WL sees no Administration (and `/admin` gives no-permission). `brand.primary` changes the nav computed background (`#C8102E` itself; `#FFD700` → `#8B7500`), then the settings are restored. |
| `apps/web/e2e/p5-studio-routes.spec.ts` (new) | A two-step sequential route in a methodology draft, seen in the element view and the preview (the Preview check and the diff). Main refusal: `ADM_METHOD` as approver gives 422, shown translated. Studio gate badges. The draft is discarded and the grant revoked. |
| `apps/web/e2e/p5-snapshot-page.spec.ts` (new) | The checksum stays inside its card as LTR; the labels "Register" / "RAID entry" are translated. Main refusal: a stale issue is refused by its code. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-G2-*` | This handback, its logs, and **my own specs'** screenshots (en and ar). |

No API, contract, schema, migration or dependency change. No root `e2e/**` or `tests/qa/**` edit.

## 2. Behaviour per requirement row (acceptance quoted)

### REQ-S03-007: "an ADM sees 14 areas in en and ar; a Workstream Lead does not see Administration; each area's landing page lists the contents named in §3"

- The shell renders only what the server returns (ADR-0049 §9, D-163 option (a)). Pending shows no list, never all areas. An error shows the error state.
- e2e `p5-navigation.spec.ts`, chromium-en and chromium-ar:
  - A user created through the access API holding **every role of `GET /roles` at organization scope** sees all 14 areas, in `nav.ts` order, with the labels in the project's language.
  - A synthetic **WL** on one transformation sees no Administration, and `/admin` shows no-permission.
  - All assignments are revoked in `finally`.
- The landing-page contents were FE-A's and are unchanged.
- The DG1 journey pins are updated, and the DG1 gate record is not touched.

### REQ-S15-004: "changing brand.primary in Branding Settings changes the navigation colour …"

The navigation part is done. The PDF header part is BE-R's and BE-N's.

- `nav.background` = `deriveNavigationBackground(brand.primary)`:
  - It is `brand.primary` itself when white text reaches ≥ 4.5:1 on it (WCAG 2.1 relative luminance).
  - Otherwise the colour is darkened in **HSV value steps of 0.1 %** (RGB channels scaled towards black; hue and saturation kept). The result is the lightest shade that passes.
- At render time the server's `/branding/tokens` re-derives it from the current branding version, and the shell applies it.
- e2e: publishing `#C8102E` gives computed `rgb(200, 16, 46)`; `#FFD700` gives `rgb(139, 117, 0)`. The settings are restored, and after a reload the default (`#0071F1`) is back.

### REQ-PB-002: "every seeded element listed in B0158-B0162 … renders the badge in en and ar; no such element is labelled as a PMI standard"

- The Studio's element view shows `ProvenanceBadge` (icon + text, never colour alone) for each element whose `type.key` matches a resolved profile (phases, gates, templates, TOM dimensions), in en and ar.
- A failed read shows no badge, never a wrong one.
- Unit tests and the e2e assert the badge on G3 and the absence of "PMI standard / official / certified".

### F-DG5-QA-A-3 (sequential and parallel routes)

- The editor described in §1 is delivered.
- e2e (en and ar): a two-step sequential route (BO then SP, reordered with Move up), seen in the element summary and in the preview diff (`approverRoleCodes BO · SP`, `mode sequential`, Preview check pass/warn).
- A server refusal is shown by its code text.

### QA-C O1 (snapshot page)

- The checksum wraps inside its card as an LTR run, with the full value kept (title, `data-sha256`).
- Section and record-type codes are translated in en and ar. An unknown code is shown as the code in LTR, never guessed.

## 3. Checks actually run (exit codes)

All runs were in this worktree, on Node 24.21.0, offline, on harness ports 24001/24002 with pool 24003–24049.

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` | 0 | PASS |
| `pnpm --filter @mth/design-tokens run check:contrast` | 0 | `PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented`. `nav.text #FFFFFF on nav.background #0071F1` = 4.53:1 (text and ui), and `nav.text-muted` likewise (`contrast.log`). |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` clean (`lint.log`, after removing one unused import that the first run flagged). |
| `pnpm openapi:lint` | 0 | `openapi.log` |
| `npx tsc -p tsconfig.json --noEmit` in apps/web, packages/design-tokens, packages/shared, packages/db; `tsc -p tsconfig.e2e.json` in apps/web | 0 each | `tsc-*.log` |
| `npx tsc` in **apps/api** | **137** | **BLOCKED**: SIGKILL (kernel OOM) under five concurrent tasks; the host has 15 GB with ~5 GB available. It was killed on all three attempts, alone and in `pnpm -r typecheck`. I made no API source change. The API's only touched dependency is `@mth/design-tokens`, with additive exports. |
| `pnpm -r typecheck` | **137** | **BLOCKED**: the same SIGKILL (api, then worker) (`pnpm-r-typecheck.log`). |
| `pnpm --filter @mth/web run build` | 0 | Built twice (before each e2e run). **`pnpm -r build` was not run** (§6). |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 123, then **0** | The first run flagged 10 of my files. After `prettier --write`, the re-run exits 0 (`prettier.log`). |
| Web unit tests (vitest, apps/web), first full run | 1 | 3 failed / 1531 passed. All 3 were the expected server-rule changes, fixed afterwards (`unit-web-first-run.log`). |
| Web unit tests after the changes, locale unset and `C.UTF-8` | see §3.1 | |
| Design-tokens unit tests (`npx vitest run packages/design-tokens`) | 0 | 21 passed |
| e2e: `p5-navigation`, `p5-studio-routes` (first version), `journeys` | 1 | 22 passed, 2 failed. The 2 were my routes spec's locator (the label's name includes the selected option); fixed (`e2e-first-run-mine.log`). |
| e2e `p5-studio-routes.spec.ts`, second run | 1 | 2 failed: the diff showed `["BO","SP"]`, so the list display was fixed. Third run: **exit 0, 2 passed** (`e2e-studio-routes.log`). |
| e2e `p5-snapshot-page.spec.ts` | 1, then 0 | First run: a locator scope; then **2 passed** (`e2e-snapshot-page.log`). |
| Full web e2e suite (`with-stack.sh npx playwright test apps/web/e2e --workers=1`) | — | **NOT RUN** (time; §6) |
| `pnpm test` (all Vitest invocations) | — | **NOT RUN** as a whole; only the web project ran (§3.1, §6). |
| `tests/qa/support/with-pg.sh pnpm test:integration` | — | **NOT RUN** (time; §6). No API code changed. |

### 3.1 Web unit tests, final

- **Full web project, locale unset:** exit 1, 1557 passed and 1 failed of 1558, 83 files (`unit-web-unset.log`).
- **Full web project, `LANG=LC_ALL=C.UTF-8`:** exit 1, the same 1557 / 1 (`unit-web-cutf8.log`).
- **The one failure was mine:** `glossary.test.ts` ("spells the Transformation term consistently (with shadda)") flagged my Arabic label `reportsP5.sourceRecordType.transformation` = "التحول". I fixed it to "التحوّل".
- **Re-run after the fix, in both locales:** exit **0**, 146 / 146 tests in 11 files (`src/i18n`, `src/app`, `src/pages/studio`, `snapshot-labels.test.tsx`) (`unit-web-rerun-unset.log`, `unit-web-rerun-cutf8.log`).
- **Not done:** the full web project was not re-run after this one-string fix.

## 4. Operations routed

None. This repair adds no route and calls only existing operations (`getMyNavigation`, `listMethodologyElements`, `putConfigElement`, `runConfigPreview`, `getBrandingTokens`, `putBrandingSettings`, snapshot reads). Pending-list delta: **0**. No change to `p5-pending-*` or `p5-exercises-*`, and no pinned-count change.

## 5. Contract, schema or dependency needs; texts made untrue

- **No new dependency, contract or schema change.**
- **Design-token note for review:** `nav.text-muted` was `#C9D8EA`. On a navigation background guaranteed only 4.5:1 against **white**, no non-white colour can reach 4.5:1 (it would need luminance ≥ 1.0). It is now a ref to `nav.text` (white). Secondary navigation items differ by size, never by colour alone. The header's `.user-box__org` and the ghost button border, which use this token, become white on the brand.deep header; that passes.
- **New field codes (client-side, not server problem codes):** `studio_route.one_approver_form` and `studio_route.size`, with en/ar texts in `problems.json`. The server's own refusals (ADR-0039 §13 `config_version.admin_approver_forbidden` / `approver_not_allowed` / `unknown_element`) already had texts.
- **Untrue texts corrected (F-DG4-160):** `playbookP5.branding.contrastNavPass/Fail` ("White navigation text on the secondary colour …") became untrue when the navigation started following the primary colour. They are replaced in en and ar (§1). ADR-0049 §8/§9 already say "the navigation colour is `nav.background`". No other string named the navigation colour.
- **Root QA spec `e2e/a20-bilingual-shell.spec.ts`** (not mine, not edited): it resolves `nav.background` through `tokens.json` (`derived` entries are supported), so it reads `#0071F1`, which the shell renders. Its token-propagation script changes only `brand.deep`, which no longer drives the navigation. The nav assertion still holds; I have not run it.
- **Other e2e specs:** I found no other spec in `apps/web/e2e` that counts areas for `dev.admin`. `p5-shell.spec.ts:86` signs in `dev.admin` and opens Administration, which is still visible. Not re-run in the full suite (§6).

## 6. What remains (not done)

1. **Full web e2e suite**: not run. Command: `E2E_PG_PORT=24001 E2E_API_PORT=24002 MTH_PORT_POOL=24003-24049 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1`. Only my 3 new specs and `journeys.spec.ts` ran (all passing at their last run). The risk is any spec that assumed `dev.admin` sees business areas, or that the TO sees 13.
2. **`pnpm test`** across all Vitest invocations in both locales: only the web project (twice) and design-tokens ran; the full web project needs one re-run after the glossary fix.
3. **Integration** (`QA_PG_PORT=… MTH_PORT_POOL=… tests/qa/support/with-pg.sh pnpm test:integration`): not run. No API, DB or shared source changed.
4. **`pnpm -r typecheck`**: BLOCKED by OOM (exit 137) in apps/api and apps/worker. It needs a re-run with free memory.
5. **`pnpm -r build`**: not run (only the web build).
6. Not in scope, noted: the Studio badge reflects the **published** methodology's profiles. A draft's own `profile.*` override shows only after publication.

## 7. Merge notes

- No migrations. Integrate after FE-C2: no file overlap expected. FE-C2 owns `components/form-framework/**` and the T02–T16 pages; I touched neither.
- `packages/design-tokens` must be rebuilt (`pnpm --filter @mth/design-tokens build`) so `dist/tokens.css` carries `--mth-nav-background: #0071F1`.
- `apps/web/src/test/fixtures.tsx`: an appended fallback hook in `mockApi`. If another task edited `mockApi`, keep both.
