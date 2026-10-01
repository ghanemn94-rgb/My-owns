# Handback T-DG1-FE-R3 — frontend-ux-engineer (DG1, round-3 repair)

- **Assignment:** `docs/delivery/assignments/DG1/round-3/T-DG1-FE-R3.md` (sha256 `8fbd6ed480da8a79315baaffcc06fef2c5e5a174f8af03c5cb180e659b92ebcd`)
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-FE-R3-frontend-ux-engineer-20261001T220958Z-08ce151d","session_id":"08ce151d-63cd-4be3-90c6-e14e5284ddd7"}`
- **Base revision:** `951c68a1275b4540388041cab6c8e08ec700ffc8` (`git rev-parse HEAD` at start). Before my edit, the working tree had no tracked modifications, only untracked dotfiles in the home directory.
- **Finding addressed:** F-DG1-232 (Low, REQ-DLV-033). This is a test-determinism fix only. **No product code changed.** I don't close the finding; a non-author reviewer verifies it.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/e2e/journeys.spec.ts` | Adds `expectShellReadyForKeyboard()` and calls it after `page.reload()` in the shell journey, before the Tab press. The skip-link assertion stays as strict as before. A new step presses Enter on the skip link and checks that focus moves to `main#main`, which the existing comment claimed but no test checked. |
| `docs/delivery/handbacks/DG1/round-3/T-DG1-FE-R3-evidence/*` | The diff (`00-diff.patch`) and real run logs (`01`–`10`). |

Post-edit sha256 of `apps/web/e2e/journeys.spec.ts`: `b1cb033191529f6e21e2727ecc16770f5f00490666455d1e5ebf5f59f39bfb5d`.

## 2. Behaviour delivered

**F-DG1-232 / REQ-DLV-033 (deterministic e2e journeys).**

- **Root cause.** After `page.reload()` the SPA mounts its shell asynchronously, because it waits for the session and profile requests.
  - Before this fix, the test checked only `html[lang]`. That attribute can already be correct from `localStorage` before the shell renders, so the check passed early.
  - The test then pressed Tab at once. If the shell hadn't mounted yet, the Tab landed nowhere and the skip link stayed `inactive`. The round-2 QA evidence (`14e-…-error-context.md`) shows exactly this.
  - The shell does no programmatic focus management of its own: `grep focus()` in `apps/web/src` finds only the dialog code in `Form.tsx`. So the only race was in the test's timing.
- **Fix.** Before Tab is pressed, the new helper waits for all of the following:
  1. the wordmark is visible;
  2. the primary navigation is visible;
  3. the My Work nav link has `aria-current="page"`;
  4. `main#main h1` is visible;
  5. after `page.bringToFront()`, a poll confirms `document.hasFocus() === true` and that no element is focused (`activeElement` is `body` or `null`).
- **Why no click.** I deliberately avoided `body.click()`, which the assignment offered as an option. A click moves Chromium's sequential-focus starting point and could hit a link, which would weaken the "first focusable element" claim.
- **Assertions kept or strengthened.** The first Tab must still focus the skip link (`toBeFocused()` is unchanged). I added: Enter on the skip link → `main#main` is focused.
- **Other places checked.** `grep -n "reload\|keyboard" apps/web/e2e/*.ts` shows this was the only reload-then-key sequence in `apps/web/e2e`. `signIn()` already presses Enter only after the field is visible. I didn't edit the qa-owned suite in the top-level `e2e/` (outside my scope).

## 3. Checks actually run

Environment for all runs:

- Repository working tree at `951c68a` plus the edit above.
- Pre-installed Chromium via `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was never run.
- `apps/web/e2e/support/with-stack.sh`: a disposable PostgreSQL with a unique `E2E_PG_PORT` per run, and the real API in `AUTH_MODE=dev` on :3000.
- `--workers=1`. Screenshots went to `$TMPDIR` through `E2E_SCREENSHOT_DIR`, so the committed screenshots under `apps/web/e2e/screenshots/` are unchanged. This change has no visible UI effect, so no new screenshots were needed.
- `pnpm -r build` ran first on Node 22 (exit 0).

| # | Command | Node | Result | Log |
|---|---|---|---|---|
| 1 | `with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts -g "shell: navigation" --repeat-each=20 --workers=1` (both projects) | v22.22.2 | **40 passed, 0 failed**, exit 0 | `T-DG1-FE-R3-evidence/01-shell-repeat20-node22.log` |
| 2 | Same as #1, under CPU load: one busy-loop process per CPU (`nproc` busy loops), plus the `@mth/web` vitest suite run 3× in the background | v22.22.2 | **40 passed, 0 failed**, exit 0 (end loadavg 5.35) | `T-DG1-FE-R3-evidence/02-shell-repeat20-node22-under-load.log` |
| 3 | Same as #1 | v24.21.0 | **40 passed, 0 failed**, exit 0 | `T-DG1-FE-R3-evidence/03-shell-repeat20-node24.log` |
| 4 | `with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts --workers=1`: full spec, chromium-en + chromium-ar | v22.22.2 | **18 passed** (9 EN + 9 AR), 0 skipped, exit 0 | `T-DG1-FE-R3-evidence/04-full-journeys-node22.log` |
| 5 | Same as #4 | v24.21.0 | **18 passed**, 0 skipped, exit 0 | `T-DG1-FE-R3-evidence/05-full-journeys-node24.log` |
| 6 | `pnpm -r typecheck` | v22.22.2 | exit 0 | `06-typecheck.log` |
| 7 | `pnpm lint` (`eslint . --max-warnings=0`) | v22.22.2 | exit 0 | `07-lint.log` |
| 8 | `pnpm exec prettier --check apps/web/e2e/journeys.spec.ts` | v22.22.2 | exit 0 | `08-prettier.log` |
| 9 | `pnpm test` | v22.22.2 | exit 0 (web: 21 files / 326 tests passed; full output in log) | `09-unit-tests.log` |
| 10 | `eslint --max-warnings=0` on the spec, plus ad hoc `tsc --noEmit --strict` on the spec. The web `tsconfig.json` doesn't include `e2e/`, so `pnpm -r typecheck` doesn't cover this file. | v22.22.2 | exit 0 / exit 0 | `10-e2e-file-lint-tsc.log` |

Output tails:

```
# 01 (Node 22)                 40 passed (1.8m)   # exit=0
# 02 (Node 22, under load)     40 passed (2.8m)   # exit=0   # loadavg at end: 5.35 3.39 2.34
# 03 (Node 24)                 40 passed (1.6m)   # exit=0
# 04 full EN+AR (Node 22)      18 passed (41.9s)  # exit=0
# 05 full EN+AR (Node 24)      18 passed (42.0s)  # exit=0
```

**Node 24 location note.** On Node 24 the list reporter prints different source line numbers for *every* test, with an offset that grows down the file: for example sign-in shows `:164` instead of `:156`, and the shell journey shows `:190` instead of `:178`.

- The file was identical across all runs: the same `git diff`, and the sha256 above.
- The test titles, their order and their count are identical.

This is a Playwright 1.56.1 / Node 24 source-location artefact, not a test difference. I didn't investigate it further because it's out of scope.

## 4. Known gaps / not done

- The round-2 failure rate was about 1/29 normal and 1/15 under load. 120 green repetitions (40 + 40 + 40) plus 2 full runs give strong evidence the race is gone, but they don't prove it statistically to certainty.
- The top-level `e2e/**` suite belongs to qa-verifier. I didn't audit it for the same pattern beyond noting it's out of my write scope.
- I didn't run the CI workflow itself; only the local runs listed above.

## 5. Merge instructions

- Test-only change in one file: no migrations, no build or config changes, and no new dependencies.
- No conflicts expected unless another branch also edits the shell journey in `apps/web/e2e/journeys.spec.ts` (around lines 118–139 and 190–201).
- Commit the evidence directory together with this handback.
