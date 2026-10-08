# Handback T-DG3-FE-G: F-DG3-170, the inherited-approval badge wraps inside its card and row (frontend-ux-engineer)

- **Stage:** DG3, repair before review round 3. Assignment `docs/delivery/assignments/DG3/round-3/T-DG3-FE-G.md` (sha256 `81f69857…4ecf20242432c9de5f36f22dee368a01ecc4836`, checked).
- **Invocation:** run `DG3-T-DG3-FE-G-frontend-ux-engineer-20261008T093717Z-4c8cca17`, session `4c8cca17-4346-46ae-8dcb-75c2f9e96d2d`.
- **Worktree:** `/home/user/wt/dg3-fe-g`, branch `dg3/fe-g`, `HEAD` `ca2dc5275b29e431b0577b1c9addab7af7c0620e`. That is the round-2 candidate plus the review records and this assignment.
- **Changes:** left **uncommitted** for the orchestrator to integrate.
- **Time:** started 09:37:27 UTC, ended 10:24:47 UTC (2026-10-08).
- **Data:** everything in the spec and the probe is synthetic. The Sponsor's acceptance of the inherited approval is a demo business decision. It approves nothing real and implies no engineering gate (DG0–DG7).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` with exit 0, both at the start and at the end (`T-DG3-FE-G-evidence/validate-dg2-historical.log`).

## 1. The fix

- **Cause:** `.status-chip { white-space: nowrap }`. It kept the badge's text of about 80 characters on one line, which made it 518 px wide in EN and 353 px in AR.
- **New scoped modifier `status-chip--wrap`** in `app.css`:
  - `white-space: normal`, `overflow-wrap: anywhere`, `max-inline-size: 100%`, `min-inline-size: 0`;
  - `align-items: flex-start` and `text-align: start`, so the icon stays at the start of the first line;
  - `border-radius: var(--mth-radius)`, because a multi-line pill with a 999px radius would clip its corners;
  - a slightly taller `padding-block`;
  - the icon is offset (`margin-block-start: 0.2em`) to line up with the first line of text;
  - the text span gets `min-inline-size: 0`.
  - It uses only logical properties, so it works the same way in RTL.
- **The global `.status-chip` rule is unchanged.** It is still `nowrap`, and every other chip keeps its behaviour.
- **`InheritedApprovalBadge`** (`GatesPage.tsx`, also used by `GateDetailPage.tsx`):
  - adds `status-chip--wrap`;
  - wraps the translated text in a `<span>`, so the text is one flex item next to the icon.
  - Unchanged:
    - the neutral `status-chip--unknown` class;
    - the `info` icon (never the approved colour or the check icon);
    - the text, including "(does not approve this gate)" / "(لا يعتمد هذه البوابة)";
    - `data-inherited-approval` and `data-counts`.
- **Not changed:**
  - `GateDetailPage.tsx`: the badge now wraps inside its `details` grid cell.
  - The i18n catalogues: no wording change was needed.
- **Other chips in the G1 card** (gate status, readiness): the spec measures them inside the card at every width, in EN and AR, and none overflows. They needed no change.
  - The "unverified evidence" chip doesn't appear in this setup, because the evidence is verified.
  - At 390 px the longest one ("0 of 6 mandatory outputs complete" / "0 من 6 مخرجات إلزامية مكتملة") still fits; see the 390 screenshots.

## 2. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/styles/app.css` | Adds only the new `.status-chip--wrap` modifier and its two child rules. The global `.status-chip` rule is untouched. |
| `apps/web/src/pages/gates/GatesPage.tsx` | `InheritedApprovalBadge` uses `status-chip--wrap` and puts its text in a `<span>`. |
| `apps/web/src/pages/gates/inherited-approval.test.tsx` | `expectNeverApproved` also asserts the `status-chip--wrap` class. Every existing expectation is kept. |
| `apps/web/e2e/p3-inherited-approval.spec.ts` (new) | Real-browser layout regression test on the real stack, in chromium-en and chromium-ar. |

Full diff: `docs/delivery/handbacks/DG3/T-DG3-FE-G-evidence/source.diff`.

## 3. Behaviour delivered (REQ-PB-004, F-DG3-170)

**On the Gates list,** the badge wraps to two lines inside the G1 card at 1024, 1366, 1920 and 390 px, in EN and AR. Its whole text is visible, disclaimer included.

**On the G1 gate view,** the badge wraps inside its "Inherited approval" row, and the document no longer scrolls horizontally.

**G1 still shows the neutral "Not submitted" / "لم تُقدَّم" chip,** and nothing reads as approved.

### The new spec

`apps/web/e2e/p3-inherited-approval.spec.ts` runs 5 tests per project:

1. **Setup**, through the real API:
   - creates a Modular transformation (entry phase mobilize);
   - adds a note as evidence, which `dev.office` verifies;
   - records an `inherited_approval` dispensation for G1;
   - has a synthetic Sponsor accept it;
   - asserts that G1 is `draft` with `inheritedApproval {status: accepted, counts: true}`.
2. **One test per width** (1024, 1366, 1920, 390), on the Gates list and on the G1 view:
   - the rendered badge text equals the catalogue text, and the disclaimer is present;
   - badge `scrollWidth <= clientWidth`;
   - the badge box lies within the card or row, and within the viewport;
   - `document.documentElement.scrollWidth <= innerWidth`;
   - every chip in the container lies inside it and is not clipped;
   - `data-gate-status="draft"` with the translated "Not submitted";
   - the badge has `status-chip--unknown`, not `on-track`, and no check-icon path;
   - no `[data-gate-status="approved"]`;
   - axe (WCAG 2.0/2.1 A+AA) finds 0 serious or critical issues;
   - every request stays same-origin (`trackRequests`);
   - full-page screenshots go to `apps/web/e2e/screenshots/{en,ar}/p3-inherited-<width>-{gates-list,gate-view}.png`.

## 4. Checks actually run (Node v24.21.0, offline, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, ports 23950–23963)

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | pass | `T-DG3-FE-G-evidence/typecheck.log` |
| 1 | `pnpm -r build` | 0 | pass | `build.log` |
| 1 | `pnpm lint` | 0 | pass | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | pass | `prettier.log` |
| 1 | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | pass | `contrast.log` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | 81 files, **1565/1565** passed | `test-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 81 files, **1565/1565** passed | `test-c-utf8.log` |
| 3 | `E2E_PG_PORT=23952 E2E_API_PORT=23953 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p3-inherited-approval.spec.ts --workers=1` | 0 | **10/10** passed (5 chromium-en, 5 chromium-ar) | `spec-p3-inherited-approval.log` |
| 4 | Full suite with the locale unset: `env -u LANG -u LC_ALL -u LC_CTYPE … with-stack.sh npx playwright test apps/web/e2e --workers=1` | 0 | **178 passed** (15.9 min) | `e2e-full-locale-unset.log` |
| 4 | Full suite with `LANG=C.UTF-8 LC_ALL=C.UTF-8 …` (same command) | 0 | **178 passed** (17.1 min) | `e2e-full-c-utf8.log` |
| 5 | Reviewer probe `dg3-ui-overflow.mjs`, after the fix | 0 | **SUMMARY 12/12 PASS** | `probe-after.log` |
| 5 | Same probe on the unmodified round-2 tree, before the fix | 1 (probe) | 2/12 PASS (reproduces the finding) | `probe-before.log` |
| – | Negative control: the new spec against the round-2 `GatesPage.tsx` and `app.css` | 1 | fails as intended | `spec-negative-control-round2-code.log` |
| 6 | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)` | `validate-dg2-historical.log` |

All logs are under `docs/delivery/handbacks/DG3/T-DG3-FE-G-evidence/`. The exit codes of checks 1–2 are also listed in `static-exit-codes.txt`, and those of check 4 in `e2e-full-times.txt`.

### Full e2e suite: counts per spec

The counts were identical in both locale settings. No test failed, was flaky or was retried (`retries: 0`, and the logs contain no ✘).

`e2e-per-spec-counts.txt` has the same table:

| Spec | chromium-en | chromium-ar |
|---|---|---|
| journeys.spec.ts | 9 | 9 |
| p2-blank-text.spec.ts | 9 | 9 |
| p2-journeys.spec.ts | 12 | 12 |
| p3-business-cases.spec.ts | 6 | 6 |
| p3-g4-refusal.spec.ts | 2 | 2 |
| p3-journeys.spec.ts | 18 | 18 |
| p3-portfolio.spec.ts | 6 | 6 |
| p3-prioritization-roadmap.spec.ts | 7 | 7 |
| p3-seams.spec.ts | 3 | 3 |
| p3-ui-completion.spec.ts | 7 | 7 |
| session-end.spec.ts | 5 | 5 |
| **p3-inherited-approval.spec.ts (new)** | 5 | 5 |

Without the new spec that is 84 per project, so 168, which matches the round-2 baseline. With it the total is 178 per setting.

### Notes on exit codes (disclosed)

- **Probe "before" run.** The `with-stack.sh` wrapper exited 0 because the inline `bash -c` ended with an `echo`. The probe itself reported `### probe exit=1` and `SUMMARY 2/12`. That was the expected reproduction, not a harness failure.
- **Probe "after" run.** It propagated the probe's exit status: 0.
- **Negative control.** The spec was run against the round-2 code, which had been rebuilt temporarily, with screenshots sent to `$TMPDIR`. It exited 1:
  - `en 1024 list: badge within its container: right edge 828 inside 634`
  - `ar 1024 list: badge within its container: left edge 361 inside 390`
  - Serial mode then skipped the remaining widths (2 passed, 2 failed, rest skipped). This proves that the spec detects the defect.
  - Afterwards the fixed files were restored byte-for-byte from a scratch copy and rebuilt with `pnpm --filter @mth/web build` (exit 0). Checks 1–5 above all ran after this restore.
- **Stray directory.** Before running the tests I removed an empty `apps/web/.claude/.cc-writes` directory (and its now-empty parent), as the assignment instructs.

### How the reviewer's probe was run (read-only)

- The probe file was not edited. I copied it to `$TMPDIR/probe/rv/` (sha256 `435b4f36…02c23ac3d`, identical to the original) with a `node_modules` symlink, so that `@playwright/test` resolves.
- I ran it from the repository root (the probe reads `apps/web/src/i18n` relative to cwd) inside the project harness: `E2E_PG_PORT=23956 E2E_API_PORT=23957 apps/web/e2e/support/with-stack.sh`.
  - `E2E_BASE_URL` comes from the harness.
  - `SHOTS` pointed at `$TMPDIR/probe/shots-{before,after}`, never at the reviewer's folder.
- The reviewer's own `with-stack.sh` / `run-all.sh` hard-code `$TMPDIR/review-dom` and the reviewer's evidence path, so I used the equivalent project harness.

## 5. Before and after measurements

### Reviewer probe (`probe-before.log` → `probe-after.log`)

Badge and container are x-ranges in px; `doc` is the document `scrollWidth` against the viewport width.

| Case | Before | After |
|---|---|---|
| en.1366 list | badge [310,828] vs card [297,632], FAIL | badge [310,619] vs card [297,632], PASS |
| en.1366 view | badge [1086,1604], doc 1604 > 1366, FAIL | badge [1086,1325], doc 1366, PASS |
| en.1024 list | badge [310,828] vs card [297,634], FAIL | badge [310,621], PASS |
| en.1024 view | badge [652,1170], doc 1170 > 1024, FAIL | badge [652,983], doc 1024, PASS |
| en.1920 list | badge [310,828] vs card [297,640], FAIL | badge [310,627], PASS |
| en.1920 view | PASS | PASS |
| ar.1366 list | badge [703,1056] vs card [734,1069], FAIL | badge [747,1056], PASS |
| ar.1366 view | badge [-73,280], doc 1439 > 1366, FAIL | badge [41,280], doc 1366, PASS |
| ar.1024 list | badge [361,714] vs card [390,727], FAIL | badge [403,714], PASS |
| ar.1024 view | badge [19,372] vs container [24,744], FAIL | badge [41,372], PASS |
| ar.1920 list | badge [1257,1610] vs card [1281,1623], FAIL | badge [1294,1610], PASS |
| ar.1920 view | PASS | PASS |
| **Summary** | **2/12** | **12/12** |

### New spec, after the fix

The badge's `scrollWidth == clientWidth` in every case, so nothing is clipped. Its height is 45 px (2 lines) or 64 px (3 lines, gate view in EN at 1366 and 1920). Full table: `T-DG3-FE-G-evidence/spec-measurements.md`.

| Width | List, EN / AR: badge within card | View, EN / AR: doc scrollWidth = innerWidth |
|---|---|---|
| 1024 | [310,621] ⊂ [297,634] / [403,714] ⊂ [390,727] | 1024 / 1024 |
| 1366 | [310,619] ⊂ [297,632] / [747,1056] ⊂ [734,1069] | 1366 / 1366 |
| 1920 | [310,626] ⊂ [297,640] / [1294,1610] ⊂ [1280,1623] | 1920 / 1920 |
| 390 | [42,348] ⊂ [29,361] / [42,348] ⊂ [29,361] | 390 / 390 |

## 6. Screenshots (EN and AR)

**From the new spec, full page.** These were taken in the final full C.UTF-8 suite run. They are copied from the gitignored `apps/web/e2e/screenshots/`.

- `docs/delivery/handbacks/DG3/T-DG3-FE-G-evidence/screens/en/p3-inherited-{1024,1366,1920,390}-{gates-list,gate-view}.png`
- `docs/delivery/handbacks/DG3/T-DG3-FE-G-evidence/screens/ar/p3-inherited-{1024,1366,1920,390}-{gates-list,gate-view}.png`

**From the reviewer's probe after the fix, viewport only, 1366:**

- `docs/delivery/handbacks/DG3/T-DG3-FE-G-evidence/probe-after-screens/{en,ar}-overflow-1366-{gates-list,gate-view}.png`

**What I checked visually:**

- EN 1366 Gates list, AR 1366 gate view and AR 390 Gates list.
- The badge is grey with the info icon, on two or three lines inside the G1 card or row, and the disclaimer is fully visible.
- "Not submitted" / "لم تُقدَّم" stays next to it.
- AR mirrors correctly: the icon is at the start (right).

## 7. Known gaps / not done

- **Placement on the gate view.** The badge wraps inside its `details` grid cell (about 14–17rem wide), so it takes 3 lines in EN at 1366 and 1920. Making the inherited-approval row span the full grid width would need a new non-modifier CSS rule, which is outside my permitted edit scope. It is not required for the fix.
- **The "unverified evidence" chip** isn't present in the spec's setup, because the evidence is verified. The spec checks every chip that is present in the G1 card. That chip is short and keeps the global `nowrap` rule.
- **Nothing is committed,** as the assignment instructs.

## 8. Merge instructions

- No migrations and no API or package changes.
- Apply the three modified files and the new spec on top of the round-2 candidate source. I expect no conflicts, because only `InheritedApprovalBadge` and a new CSS block after `.status-chip--stale` are touched.
- Rebuild the web app (`pnpm -r build`) before you run the e2e suite.
- The evidence folder `docs/delivery/handbacks/DG3/T-DG3-FE-G-evidence/` and this handback are new, untracked files.
