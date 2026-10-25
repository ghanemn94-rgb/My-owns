# Handback T-DG5-FE-Z1C: frontend-ux-engineer (DG5 round-4 repair follow-up, D-176)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-Z1C-frontend-ux-engineer-20261021T143400Z-c785c1d0","session_id":"c785c1d0-dd89-4b74-816f-02aac5637b27"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-Z1C.md` (sha256 `5791475f…cacf`, verified)
- **Start revision:** `a01b8f1` on branch `dg5/fe-z1c` (merged tree of `ff5f561` plus the orchestrator's D-177 verification evidence). The working tree was clean apart from untracked sandbox dotfiles.
- **Time:** started 14:48:46Z, finished checks 15:33:07Z (`date -u`), about 45 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, both at the start and at the end (`T-DG5-FE-Z1C-evidence/40-validate-dg4-historical.log`).
- **Changes are uncommitted** for the orchestrator to integrate.

## Scope as executed

The assignment's header (the D-176 follow-up) asks for one thing. FE-Z1B is merged (`ff5f561`) and already does what the body restates for F-DG5-146:
- `TableScrollRegion` on the Form builder and Attachments tables;
- `table-scroll` removed;
- the unit guard extended;
- the `p5-form-tables-reflow` spec.

The remaining defect is the orchestrator's merged-tree failure of `apps/web/e2e/p5-form-tables-reflow.spec.ts:177`: "T14 export preview, 390 px — the region runs off the viewport [40..484] of 390 px" (en) and "[-104..350]" (ar). This task repairs that defect and does not redo FE-Z1B's work. I did not re-extend `table-regions.test.tsx`: FE-Z1B's guard is unchanged and passes (it is part of the `unit-web` counts below).

## Changed files

| File | Purpose |
|---|---|
| `apps/web/src/styles/app.css` (lines 976–999) | Dialog layout fix. The dialog's grid tracks can shrink to the dialog (`minmax(0, 1fr)`), the footer wraps, and footer items may shrink. |
| `apps/web/e2e/p5-form-tables-reflow.spec.ts` | Strengthened regression: a table inside a dialog also requires the dialog box and every footer action to be inside the viewport (lines 57, 67–76, 94, 136–139). The header comment is updated. Every existing assertion is unchanged. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-Z1C-*` | This handback and its logs and screenshots. |

## Finding: F-DG5-146 follow-up (the T14 export preview at 390 px)

- **Cause.** `.dialog` and `.dialog__body` are CSS grids with an implicit `auto`/`1fr` column. A grid track's minimum is its content's min-content width. The export preview's table has a min-content width of about 444 px, so the body's track grew past the dialog (`inline-size: min(32rem, 100%)` = 358 px at 390 px). The preview's `.table-wrap` grew with the table instead of scrolling (`scrolls false` in the D-177 log). It ran off the dialog and the viewport: to the right in LTR, to the left in RTL.
  - The footer's actions were cut off the same way ("Download JSON" and "Close"; see `before/en-z1-t14-export-preview-390.png`).
  - The page-level check (`scrollWidth - innerWidth`) stayed at 0 because the dialog backdrop is `position: fixed` and never widens the document. Only the region-bounds assertion caught it.
- **Fix.** In `apps/web/src/styles/app.css:976–999`:
  - `.dialog, .dialog__body { grid-template-columns: minmax(0, 1fr); }`
  - `.dialog__footer { flex-wrap: wrap; }`
  - `.dialog__footer > * { min-inline-size: 0; }`

  The preview now scrolls inside its focusable, named `TableScrollRegion` (`scrolls true`, region [40..350] in en and ar), and the footer actions wrap inside the dialog. This is CSS only. There is no markup, contract, string or dependency change.
- **Regression test.** `apps/web/e2e/p5-form-tables-reflow.spec.ts` (FE-Z1B's spec):
  - All its assertions are kept, including the final `expect(failures).toEqual([])` and `scrollWidth - innerWidth <= 1`.
  - Added: for a table inside `[role='dialog']`, the dialog box lies within the viewport, and no `.dialog__footer` link or button is cut off by the dialog or the viewport.
- **Failing before (real stack):**
  - `01-before-fix-p5-form-tables-reflow.log`: the original spec on the unchanged tree, exit 1, 2 failed / 2 passed.
    - en: `T14 export preview, 390 px — the region runs off the viewport [40..488] of 390 px`
    - ar: `… [-101..350] of 390 px`
  - `02-before-fix-strengthened-spec.log`: the strengthened spec on the unfixed CSS (rebuilt from `HEAD`'s `app.css`), exit 1, 2 failed / 2 passed. In addition to the region failure:
    - en: `dialog actions are cut off: ["Download JSON","Close"]`
    - ar: `["تنزيل JSON","إغلاق"]`
  - The Form builder tests passed in both runs. Their table was fixed by FE-Z1B.
- **Passing after:** `03-after-fix-p5-form-tables-reflow.log`, exit 0, 4 passed. Measured values:
  - T14 export preview at 390 px: overflow 0, region [40..350], scrolls true, in en and ar.
  - At 200 % text: region [176..1104], in en and ar.
  - Attachments and Form builder: unchanged, all within the viewport.
- **Screenshots:**
  - `T-DG5-FE-Z1C-evidence/before/{en,ar}-z1-t14-export-preview-390.png`
  - `T-DG5-FE-Z1C-evidence/after/{en,ar}-z1-t14-export-preview-{390,200pct}.png`
  - I checked the en before shot and the ar after shot visually: the dialog fits, the preview scrolls in its region, and the actions wrap.

## Checks (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-FE-Z1C-evidence/`)

Node 24.21.0, offline. Harness ports 23101–23149. Each check ran once, one at a time (D-164).

| Check | Command | Exit | Result |
|---|---|---|---|
| Historical DG4 gate | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | PASS (start and end) |
| Typecheck | `pnpm -r typecheck` | 0 | `10-typecheck.log` (re-run after the last comment-only spec edit) |
| Build | `pnpm -r build` | 0 | `11-build.log`. Ran after the CSS fix. The later spec edit was comment and formatting only and is not part of `dist`. |
| Lint | `pnpm lint` | 0 | `12-lint.log` (re-run after the last edit) |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `13-prettier.log` (see the disclosure below) |
| OpenAPI lint | `pnpm openapi:lint` | 0 | `14-openapi-lint.log` |
| unit-web, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE npx vitest run --project unit-web` | 0 | 90 files, 1713 tests passed |
| unit-web, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web` | 0 | 90 files, 1713 tests passed |
| e2e, real stack, locale unset | `apps/web/e2e/support/with-stack.sh npx playwright test p5-form-tables-reflow p5-table-regions-axe p5-reflow-axe p5-forms --workers=1` | 0 | 14 passed (7 tests × chromium-en and chromium-ar), 0 failed, 0 flaky, 8.2 min. `30-e2e-unset.log` |
| e2e, real stack, C.UTF-8 | the same command with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | 14 passed, 0 failed, 0 flaky, 7.8 min. `31-e2e-cutf8.log` |

Disclosures:
- **Prettier.** The first prettier run exited 123: my own spec edit was unformatted. I ran `prettier --write` on that file and re-wrapped one over-long comment line. The re-run exited 0, and the log in the evidence folder is from that re-run.
- **e2e environment.** PostgreSQL started under `with-stack.sh` in this sandbox, so the D-176 sandbox setting works here. Nothing was BLOCKED.
- **Not run (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite. They are not reported as passed.
- **Screenshots (D-162).** All spec screenshots went to a private `$TMPDIR` folder, which I deleted. Only the eight export-preview shots listed above are kept as evidence.

## Notes for the orchestrator

- **Reach of the fix.** The rule applies to every `Dialog`, not only the export dialog. Content wider than a dialog now shrinks or scrolls inside the dialog instead of widening it. Other dialogs are covered by `p5-forms` and the two axe/reflow specs (all green), but not by the full suite. Please watch dialog-heavy specs in the merged-tree run (for example `p2-*` and `session-end` Upload). `.dialog:has(.steps-editor)` keeps its 56rem width.
- **Contract, schema, dependency:** none needed.
- **ADRs and data dictionary (for T-DG5-ARCH-R7):** I found no ADR statement about dialog layout or the export preview's width (`grep` over `docs/architecture`). If ADR-0041 §5 "Export", or a reflow amendment, describes the preview as scrolling in its own region, that is now true at 390 px as well. A one-line note that dialogs' grid tracks are `minmax(0, 1fr)` (wide content scrolls in a `.table-wrap` inside the dialog) would make the reflow rule complete.
- **User-facing texts:** none changed, and none made untrue.
- **What remains:** nothing in this assignment's scope. Round 5 (qa) still has to verify F-DG5-146 and F-DG5-144 independently. That is not mine to close.
