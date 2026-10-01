# Assignment T-DG1-FE-R4: round-4 repair — F-DG1-147 (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (clean re-gate, round-4 repair) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. `node_modules` present; run offline. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.
- Edit only the tooling/config needed for this finding. Do not change product runtime behaviour. Do not edit `tools/**`, `docs/source/**`, reviews or gate records. Handback under `docs/delivery/handbacks/DG1/round-4/`.

## F-DG1-147 (Low, REQ-DLV-033): the Playwright e2e specs are outside every typecheck target
`apps/web/e2e/**` and the root `playwright.config.ts` are not in any tsconfig `include` (apps/web's `tsconfig.json` includes only `src`, `test`, `vite.config.ts`, `vitest.config.ts`), so `pnpm -r typecheck` never type-checks the e2e specs — the round-3 change to `apps/web/e2e/journeys.spec.ts` was never type-checked by any gate or CI step. Evidence: `docs/delivery/test-evidence/DG1/code-security/round-3/e2e-spec-typecheck.log`.

**Fix:** bring the e2e specs (`apps/web/e2e/**`) and the root `playwright.config.ts` under a type-check target that the gate's `pnpm -r typecheck` (or an added, wired-in typecheck step) actually runs. Preferred: a dedicated `apps/web/tsconfig.e2e.json` (extending the base, with `@playwright/test` types and the e2e + playwright.config.ts files included; isolate it from the vitest/unit globals so the two don't collide) and extend apps/web's `typecheck` script to run **both** `tsc -p tsconfig.json` and `tsc -p tsconfig.e2e.json` (so `pnpm -r typecheck` covers e2e). If the root `playwright.config.ts` is awkward to include from a package tsconfig, cover it with a small root typecheck target wired into the gate `typecheck` instead — your call, but the result must be that a single gate command type-checks the e2e specs **and** the playwright config. Do NOT use `// @ts-nocheck` or loosen `strict`.

**Make it pass:** the e2e specs and playwright.config.ts have never been type-checked, so fix any real type errors they surface (do not suppress them). Keep the e2e tests behaviourally identical (they must still run green under Playwright).

## Self-verification (real output; paste into the handback)
- Show the new typecheck target FAILS on a deliberately-introduced type error in an e2e spec, then PASSES after you remove it (proves it's actually checking e2e).
- `pnpm -r typecheck` green (now covering e2e), `pnpm lint`, `pnpm exec prettier --check` the edited files, `pnpm test` green, and the e2e journeys still run green (`--workers=1`, EN+AR) on Node 22; `pnpm -r typecheck` also green on Node 24.

## Handback
`docs/delivery/handbacks/DG1/round-4/T-DG1-FE-R4-frontend-ux-engineer.md` — the diff, the fail-then-pass proof the e2e specs are now type-checked, and the green `pnpm -r typecheck` + e2e output.
