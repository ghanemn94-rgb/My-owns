# Assignment T-DG2-FE8: one alert per distinct form error (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`.
- **Runs after BE14.** backend-workflow-engineer T-DG2-BE14 (F-DG2-320, media types) is integrated before you start. Read its handback. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768; the harnesses retry on collision.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Finding to repair
**F-DG2-340 (Low, REQ-PB-029).** In `apps/web/src/components/RecordForm.tsx`, a field error whose pointer is `""` is not mapped to a field. It goes to `other`, the `data-state="form-errors"` alert. The banner error from `setBannerError(e)` renders the same localized message again. A form-level validation problem whose only field error has pointer `""` is therefore shown **twice**, in two adjacent `role="alert"` regions, in EN and AR. One example is `validation.json` for an invalid-UTF-8 body (D-068).

The repro is the qa spec `docs/delivery/test-evidence/DG2/qa/tests/round-8/e2e/dg2-qa-r8.spec.ts` R8-05, with screenshots and the static analysis in `docs/delivery/test-evidence/DG2/qa/round-8/`.

## Required
1. **One alert per distinct message.**
   - A form-level problem shows its localized message **once**, in one live region, so a screen reader announces it once. This holds in EN-LTR and AR-RTL.
   - Deduplicate by message or code. Do not hide a genuinely different second message.
   - Keep field-pointer errors attached to their fields, as now.
2. **Sweep.** Look for the same double rendering in every other form and dialog that shows both a banner and a field or other-errors list:
   - the charter form;
   - the hand-written P2 forms (`GateDetailPage`, `JourneysSection`, `RowActions`);
   - `ReasonDialog`;
   - the P1 admin forms.

   Fix any you find the same way. List them in the handback.
3. **Tests.**
   - **Component tests, EN and AR.** Cover a 400 with only a pointer-`""` error, a 400 with two distinct messages, and a 400 with a field error. Each message must appear exactly once, and the live-region count must be right.
   - **e2e.** Extend `apps/web/e2e/p2-blank-text.spec.ts`, or add a spec, that produces a form-level validation problem on the real stack. One option is to send an invalid-UTF-8 body via route interception, as the qa spec does. Assert one message, and run axe in both locales.
   - **Negative control.** The new tests fail on the old code.

## Self-verification (real output in the handback)
Run every check in **both locale settings**: `env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm test` on Node 22 **and** 24
- `pnpm --filter @mth/design-tokens run check:contrast`
- web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`), with axe reporting 0 serious or critical
- `node tools/gates/validate.mjs --historical --stage DG1`, which must exit 0

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE8-frontend-ux-engineer.md` with the fix, the sweep list and every check's real output. Keep evidence to logs and at most two cited screenshots.
