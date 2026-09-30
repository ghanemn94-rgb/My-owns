# Assignment T-DG1-FE: bilingual web shell, screens, design tokens (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (BUILDING). **Base revision:** HEAD after T-DG1-BE integrates (you run second; the API is then live). You code against the **contract** `docs/api/openapi.yaml`, not backend internals, so nothing here depends on backend code being perfect.
- `node_modules` is installed; `pnpm -r typecheck`/`build`/`test` run **offline**. Do not run `pnpm install`. Dependency changes are requested in your handback (name + exact version), never applied yourself.

## Your requirements
DG1-completing: `REQ-S16-002`, `REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`. P1 increments include `REQ-S03-007..008`, `REQ-S15-001/003..004/007..008/010..013`, `REQ-S16-006..012` (UI side), the transformations/admin UI rows. List your exact set with the `csv.DictReader` one-liner (increments contains `P1`) and record which you touched.

## Scope — you own (write) ONLY these (p1-work-split.md §3)
- `apps/web/**` except `package.json` dependencies: `index.html`, `vite.config.ts`, `vitest.config.ts`; `src/**` (shell, router, API client, i18n catalogues `src/i18n/{ar,en}/**`, pages, components, styles); `e2e/**` at `apps/web/e2e/` (the frontend's own Playwright journeys and EN/AR visual screenshots); `public/**`.
- `packages/design-tokens/**` except the **seven seeded values** in `src/tokens.json`: the generator (`src/generate.ts` → `dist/tokens.css`); **derived** action-shade and semantic-status tokens (added under new keys in `tokens.json`); the contrast checker (`src/contrast.ts` + a `check:contrast` script); tests.
- You may edit the `scripts` field of the `package.json` files you own.

## Consumes (read, do not edit)
`docs/api/openapi.yaml`; `@mth/shared` (constants, permissions, problem types) and `@mth/shared/schemas` (zod forms); ADR-0009 (stack, i18n/RTL, tokens, fonts, wordmark, a11y, explicit states); ADR-0005 (cookie session, CSRF header from `/me`, dev login only when `/me.authMode = dev`); ADR-0007 (problem `code` → translated message; 409 conflict state; cursor pagination).

## Deliver (P1)
- the **bilingual shell**: Arabic RTL default and English LTR, persisted language switch, `dir`/`lang` on `<html>`, CSS **logical properties** throughout;
- navigation placeholders for the **14 areas** (REQ-S03-007 increment);
- a **provisional text wordmark** with a visible "Provisional / مؤقت" badge (REQ-S15-006) — never an invented logo; `#0078FF` is a provisional token;
- **bundled IBM Plex Sans / IBM Plex Sans Arabic** fonts, **no CDN** (REQ-S15-005) — `check:no-cdn` must pass;
- tokens CSS from the one token source and the **contrast gate** (REQ-S15-002/003);
- sign-in page (OIDC button; dev-login form **only** when `/me.authMode = dev`);
- transformations **list** (sorting, filters, cursor pagination, column selection), **create** (mode + entry phase), **detail** with workspace header, **edit** with conflict handling (409), **archive** with a reason;
- admin screens for organizations, BUs, users and role assignments;
- **explicit states**: empty, loading, error, stale, conflict and no-permission;
- axe accessibility checks and EN/AR screenshots;
- unit tests, including **i18n key parity** (every key present in both `ar` and `en`).

## Conventions (CLAUDE.md; reviewers verify)
- Every user-facing string in both Arabic and English. Default timezone Asia/Riyadh, currency SAR, both shown correctly.
- Missing/stale data shows Unknown/Stale, never zero or green.
- No public CDN at runtime or build; fonts and assets bundled locally.
- Decimal display for money (no float rounding artifacts).

## Must not touch
`apps/api/**`, `apps/worker/**`, `packages/db/**`, `packages/config/**`, `packages/shared/**` (except you consume it), `deploy/**`, `.github/**`, root `e2e/**`, `tests/qa/**`, and the frozen files (§1). The write guard also blocks `tools/**`, `.claude/agents/**`, `docs/source/**` and delivery records. **Do not change the seven seeded token values** — add derived/semantic tokens under new keys only.

## Acceptance checks (reviewers verify independently, offline)
1. `pnpm -r typecheck`, `pnpm -r build` (incl. `apps/web` under Vite), `pnpm lint` and `pnpm --filter @mth/web test` pass.
2. `pnpm --filter @mth/design-tokens run check:contrast` passes for every token pair used as fg/bg (WCAG AA).
3. `pnpm check:no-cdn` passes (no remote font/script hosts).
4. The shell renders AR-RTL by default and switches to EN-LTR; `dir`/`lang` update on `<html>`; i18n key parity test passes.
5. axe finds no serious/critical violations on the shell, sign-in, and transformations list/detail; EN and AR screenshots are produced.

## Handback
`docs/delivery/handbacks/DG1/T-DG1-FE-frontend-ux-engineer.md` — changed files, requirements touched, checks run with real output, dependency requests (name + exact version + why), anything BLOCKED.
