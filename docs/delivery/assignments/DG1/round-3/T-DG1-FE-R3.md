# Assignment T-DG1-FE-R3: round-3 repair — F-DG1-232 (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (clean re-gate, round-3 repair) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. `node_modules` present; run offline. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Pre-installed Chromium (do not run `playwright install`).
- Edit only the e2e test file(s) needed (test-only; no product behaviour change). Do not edit `tools/**`, `docs/source/**`, reviews or gate records. Handback under `docs/delivery/handbacks/DG1/round-3/`.

## F-DG1-232 (Low, REQ-DLV-033): non-deterministic e2e journey after page.reload()
`apps/web/e2e/journeys.spec.ts` (around L166-L172), test "shell: navigation, language persistence and My Work (Transformation Office)": after `await page.reload()` it asserts `html[lang]` and then immediately `await page.keyboard.press("Tab")` and expects the skip link focused. After a reload the shell has not always mounted / the document has not reliably taken focus when Tab is pressed, so the `toBeFocused()` assertion intermittently fails (1 of 29 normal runs; 1 of 15 under CPU load). Because the spec file is serial, that one failure then **skips the remaining 7 journeys of the locale** — masking real coverage. Evidence: `docs/delivery/test-evidence/DG1/qa/round-2/14e-e2e-shell-repeat15-under-load.log` and the error-context md/screenshot alongside it.

**Fix (test determinism only):** before pressing Tab after the reload, wait for the shell to be mounted and ready to receive keyboard focus — e.g. await the primary navigation (or the My Work heading) to be visible again after the reload, and ensure the document has focus (e.g. `await page.locator("body").click()` or focus a stable element) so the first Tab reliably lands on the skip link. Do not weaken the assertion (the skip link must still be the first focusable element and move focus to `<main>`); just remove the race. If the same reload-then-key race exists elsewhere in the e2e suite, harden it the same way. Do not change product code.

## Self-verification (real output; paste into the handback)
- Run the shell journey **repeatedly** to prove determinism: e.g. `pnpm --filter @mth/web exec playwright test journeys.spec.ts -g "shell: navigation" --repeat-each=20 --workers=1` on Node 22, and once under CPU load, all green; and once on Node 24.
- Run the **full** e2e journeys spec (both locales) green: `--workers=1`, unique PG port, pre-installed Chromium.
- `pnpm -r typecheck`, `pnpm lint`, `pnpm exec prettier --check` the edited file; `pnpm test` still green.

## Handback
`docs/delivery/handbacks/DG1/round-3/T-DG1-FE-R3-frontend-ux-engineer.md` — the diff, the repeated-run output proving determinism (incl. under load), and the full e2e journeys result EN+AR.
