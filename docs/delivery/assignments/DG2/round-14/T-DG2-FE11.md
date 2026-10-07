# Assignment T-DG2-FE11: the language-not-saved notice speaks the language the user chose (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`, which already includes FE10 `8cb3bb8`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Why
FE10's handback (`docs/delivery/handbacks/DG2/T-DG2-FE10-frontend-ux-engineer.md`, "Known gaps") reports a pre-existing bilingual defect, reproduced on HEAD before FE10.

1. A signed-in user switches the language.
2. `PUT /api/v1/me/preferences` is refused, for example with a 403.
3. The UI goes back to the persisted language.
4. The notice "Language changed in this browser, but it could not be saved to your profile." then appears in the **previous** language.

The notice contradicts itself, and the user cannot tell what happened. The code is `apps/web/src/components/LanguageSwitch.tsx` and `apps/web/src/i18n/*/common.json` (`notSaved`). FE10's e2e test 4 currently accepts the notice in either language; tighten it.

No reviewer has raised this as a finding yet. The orchestrator is closing a gap flagged in a handback before the next freeze.

## Required
1. **Decide one coherent behaviour, implement it, and say which you chose and why.** Either:
   - **(a)** keep the language the user chose in this browser, show the notice in that language, and do not revert; or
   - **(b)** revert to the persisted language and show a notice, **in that language**, that says the change was not saved.

   Whichever you choose:
   - the notice text must match what the user now sees;
   - `dir` and `lang` must follow the displayed language;
   - the notice is announced once in a live region;
   - it works in both directions, EN→AR and AR→EN.
2. **Sweep.** Find any other notice or toast that is rendered in a language other than the page's current language after a failed preference or profile save. List them in the handback.
3. **Tests.**
   - Component tests for EN→AR and AR→EN with the save refused.
   - Tighten FE10's e2e test 4 to assert the exact language.
   - axe: 0 serious or critical.
   - A negative control: the new assertions fail on `HEAD`.

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
Write `docs/delivery/handbacks/DG2/T-DG2-FE11-frontend-ux-engineer.md` with the decision, the fix, the sweep and every check's real output. Keep evidence to logs and at most two cited screenshots.
