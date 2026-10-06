# Assignment T-DG2-FE7: DG2 round-4 repair, flaky web unit waits (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. T-DG2-BE8 (F-DG2-180/181) is integrated before you start. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Finding to repair
**F-DG2-220 (Low, REQ-DLV-034): the required unit check is flaky.**

`apps/web/src/pages/p2-blank-forms.test.tsx` waits for the page with Testing Library's default 1000 ms (`findByRole` / `findBy*`) while the mocked Diagnose page is still loading. Under full-suite parallel load, `pnpm test` failed once on Node 24 (1 of 7 runs). In that file, 22 of the 48 tests take 700 ms or more, and the slowest takes 2121 ms. The repro is under `docs/delivery/test-evidence/DG2/qa/round-4/`.

### Required
1. **Fix the cause, not only this file.**
   - Set a unit-web-wide async-utility timeout with real headroom (for example `configure({ asyncUtilTimeout: 5000 })` in a unit-web setup file wired into `apps/web/vitest.config.*`), with a comment citing F-DG2-220.
   - Keep each test's own timeout above it, so that a slow wait still fails clearly.
   - In `p2-blank-forms.test.tsx`, also reduce the page-load cost where easy, for example by awaiting the first query once in a shared helper.
2. **Sweep.**
   - Check every other unit-web file for `findBy*` / `waitFor` that depend on the 1000 ms default during a full page load, and confirm they are covered by the new setting.
   - With `--reporter=verbose`, list every unit test over 1.5 s on Node 22 and 24. Confirm none is within 2x of its timeout without an explicit timeout.
3. **Prove determinism.** Run the full `pnpm test`:
   - **10 times on Node 24 and 5 times on Node 22**, all green;
   - plus **3 runs under moderate concurrent CPU load** (for example while a `pnpm -r build` runs in a second clone, or with a CPU-burner loop), all green.
   Report every run's tally.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (plus the `--ignore-path` variant if only sandbox-masked dotfiles fail)
- `pnpm test`: the repeated runs above
- `node tools/gates/validate.mjs --historical --stage DG1` (exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE7-frontend-ux-engineer.md`. Give the fix, the files changed, the run tallies and every check's real output. Keep the evidence to logs only.
