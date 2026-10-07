# Assignment T-DG2-FE12: translate at render time everywhere, and keep the header readable (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`, which includes FE10 `8cb3bb8` and FE11. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Why
The FE11 handback (`docs/delivery/handbacks/DG2/T-DG2-FE11-frontend-ux-engineer.md`, "Sweep" and "Known gaps") flags two bilingual and UX gaps. Close them before the next freeze.
1. **Translated strings stored in state.** These places store an already-translated string in React state, so the text stays in the old language if the user switches language while it is visible:
   - `TeamPage` `done`, the "Role assigned…" success notice;
   - `LoginPage` `error` (`auth.dev.invalidUsername`);
   - `JourneysSection` `error` (around line 528).
2. **The language-not-saved notice squeezes the header.** At 1280 px it wraps to two lines and squeezes the wordmark (see FE11's screenshots).

## Required
1. **Translate at render time.** Store the key, code or values in state, never the translated string, and translate when rendering, as `LanguageSwitch` now does.
   - **Sweep** all of `apps/web/src/**` for any other `useState`/`setState` that holds the result of `t(...)` or `errorMessage(...)`, and fix each one the same way.
   - List every place in the handback.
   - A switch of language while a notice or error is visible must update its text and direction.
2. **Header layout.** Show the language-not-saved notice so that it neither wraps the header nor squeezes the wordmark at 320 px, 768 px and 1280 px, in EN-LTR and AR-RTL. For example, use a banner below the header, as the other app banners do. Keep it a single polite live region that is announced once. Keep the FE11 behaviour (a) and its texts unchanged.
3. **Tests.**
   - Component tests (EN→AR and AR→EN while visible) for each fixed place.
   - A layout check on the notice at the three widths: no overlap with the wordmark, and no horizontal scroll.
   - axe: 0 serious or critical.
   - A negative control: the new tests fail on `HEAD`.

## Self-verification (real output in the handback)
Run every check in **both locale settings**. **Report every non-zero exit, failed suite, hook timeout or React warning in any log, and explain it.**
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm test` on Node 22 **and** 24
- `pnpm --filter @mth/design-tokens run check:contrast`
- the web e2e P1+P2+`p2-blank-text.spec.ts`+`session-end.spec.ts`, in chromium-en and chromium-ar (`--workers=1`), with axe reporting 0 serious or critical
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE12-frontend-ux-engineer.md` with the fix, the sweep list and every check's real output. Keep evidence to logs and at most two cited screenshots.
