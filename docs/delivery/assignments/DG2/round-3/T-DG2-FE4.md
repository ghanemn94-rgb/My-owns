# Assignment T-DG2-FE4: DG2 round-2 repairs (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor; offline. Use the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and never run `playwright install`.
- **Concurrency:** backend-workflow-engineer (T-DG2-BE4, `apps/api/**` and ADR-0017) and transformation-analyst (T-DG2-AN3, `requirements.csv`) run at the same time as you. Do **not** touch `apps/api/**`, `packages/db/**`, `docs/api/openapi.yaml` or `requirements.csv`.
- **Findings:** full text in `docs/delivery/findings.json`. Note the files and behaviour for each fix in your handback.

## Findings to repair

### 1. F-DG2-151 (Low, REQ-PB-017 / B0023): gate titles repeat the gate code

The API already returns the verbatim B0023 gate names with the code inside them:
- `sourceNameEn`, e.g. `G2 - Direction`;
- `nameAr`, e.g. `G2 - التوجّه`.

The UI prefixes the code a second time, which renders `G2 – G2 - Direction` in EN and AR. It does this in three places:
- `apps/web/src/lib/methodology.ts:25` (gate-name helper);
- `apps/web/src/pages/gates/GatesPage.tsx:70`;
- `apps/web/src/pages/gates/GateDetailPage.tsx:74`.

Required:
- Show the source gate name exactly once, as given (`pick(locale, sourceNameEn, nameAr)`). Do not strip or rebuild the string; the seed is the verbatim source.
- Fix every place that composes a gate label, including anything that calls the `methodology.ts` helper, such as decision and gate links and phase headers.
- Update the unit tests, e2e expectations and fixtures that assert the doubled form.
- Use one shared helper so the label cannot drift again.

### 2. F-DG2-150, UI part (Medium, mandatory, REQ-PB-031 / B0041): the exclusions check must read as failing

The backend run will return result `attention` (not `unknown`) for "Are explicit exclusions documented?" when the saved charter's Out of scope is empty or blank. Two things change in the UI:

- **Detail string.** Today the `attention` detail for `exclusions_documented` says "Check the documented exclusions.", which wrongly implies exclusions exist. Change it in both languages:
  - `apps/web/src/i18n/en/define.json`, key `define.charter.precheck.detail.exclusions_documented.attention` → EN: `No explicit exclusions (out of scope) are documented, so this check fails.`
  - `apps/web/src/i18n/ar/define.json`, same key → AR: `لا توجد استثناءات صريحة (خارج النطاق) موثّقة؛ لذلك يفشل هذا الفحص.`
- **Chip.** The `attention` result must render as a clearly non-passing chip: never green and never the neutral "Unknown" grey. Check `ResultChip` and its contrast; `pnpm --filter @mth/design-tokens run check:contrast` must pass.
- **Tests.** Update `apps/web/src/test/p2fixtures.ts` and the charter page tests so that an empty Out of scope shows the failing `attention` state with the new EN and AR text.

## Conventions (unchanged)
- Every user-facing string exists in AR (RTL) and EN (LTR).
- `#0078FF` is a provisional token; the wordmark is provisional.
- Unknown/Stale is never shown as 0 or green.
- No public CDNs.
- Never edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** 24.
- `pnpm --filter @mth/design-tokens run check:contrast`
- The web e2e P1 and P2 journeys in **chromium-en and chromium-ar** with `--workers=1` on a unique port and a disposable PostgreSQL (the repo's e2e stack script), with axe reporting no serious or critical violations. Add screenshots of the gate list and the gate detail page in EN and AR to the handback evidence.

If a build or test error looks like a concurrent write by the backend run in the same tree (for example ENOENT under a `dist/` folder), re-run once and say so in the handback.

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE4-frontend-ux-engineer.md`. For each finding, give the fix, the files changed and every check's real output.
