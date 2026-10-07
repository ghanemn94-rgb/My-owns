# Assignment T-DG2-FE9: state updaters stay pure (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`.
- **Runs after BE17.** backend-workflow-engineer T-DG2-BE17 is integrated before you start. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Finding to repair
**F-DG2-430 (Low, frontend).**
- Every web unit run prints a React warning, during `src/pages/team/team.test.tsx > Team (English LTR) > shows a 403 from the server in words`: "Cannot update a component (`AssignDialog`) while rendering a different component (`RecordDialog`)".
- Cause: `apps/web/src/components/RecordForm.tsx` lines 198-203. `set` calls `props.onValuesChange?.(next)` **inside** the `setValues((v) => …)` updater. React may run that updater while rendering, and may call it twice under StrictMode or concurrent rendering.
- The parent's `setSelectedRole` (`apps/web/src/pages/team/TeamPage.tsx:393`) therefore updates another component during render.
- The full text is in `docs/delivery/findings.json`. qa's logs are under `docs/delivery/test-evidence/DG2/qa/round-11/`.

## Required
1. **Fix.** `RecordForm` reports value changes outside the state updater: for example, compute `next` from the current values and call `onValuesChange` after `setValues`, or call it from an effect on `values`. The Team assign dialog's role-accountability preview must keep updating exactly as today, in EN and AR.
2. **Sweep.** Search `apps/web/src/**` for any other state updater that has side effects: a callback, a parent `setState`, I/O or a ref write. Fix any you find the same way, and list them in the handback.
3. **Tests.**
   - A guard: the web unit test setup fails a test on any React "Cannot update a component" or act() warning printed to `console.error`. Scope it to the warnings, so legitimate error-path tests are not affected, and say how.
   - A component test for the assign dialog preview, EN and AR.
   - A negative control: the guard fails on the old code.

## Self-verification (real output in the handback)
Run every check in **both locale settings**. **Report every non-zero exit, failed suite, hook timeout or React warning in any log, and explain it.**
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm test` on Node 22 **and** 24. A grep of the logs for `Cannot update a component` must find nothing.
- `pnpm --filter @mth/design-tokens run check:contrast`
- web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`), with axe reporting 0 serious or critical
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE9-frontend-ux-engineer.md` with the fix, the sweep list and every check's real output. Keep evidence to logs only.
