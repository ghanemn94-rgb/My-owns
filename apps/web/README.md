# @mth/web

**Responsibility.** The React single-page app (ADR-0009). **Owner from P1:** frontend-ux-engineer.

- **Bilingual shell.** Arabic RTL is the default; English LTR. The switch sets `<html lang dir>` immediately, stores
  the hint in `localStorage` (`mth.locale`, applied before first paint by `public/locale-boot.js`) and, when signed
  in, persists it with `PUT /api/v1/me/preferences` (If-Match; a 409 re-reads `/me` and retries once). After
  sign-in the profile preference wins. Layout uses CSS logical properties only (a unit test rejects physical
  left/right).
- **Design tokens.** `virtual:mth-tokens.css` is generated at build time by the `mth-design-tokens` Vite plugin from
  `packages/design-tokens/src/tokens.json` (the one token source). All colours in `src/styles/app.css` are
  `var(--mth-*)`; every fg/bg pair is declared in `tokens.json` and checked by
  `pnpm --filter @mth/design-tokens run check:contrast`.
- **Fonts.** IBM Plex Sans Arabic + IBM Plex Sans (OFL-1.1) from `@fontsource/*`, weights 400/500/600, Arabic and
  Latin subsets only, emitted as hashed local assets. No CDN (`pnpm check:no-cdn`).
- **Wordmark.** A provisional **text** wordmark (the configured product name) with a visible "Provisional / مؤقت"
  badge. There is no logo image in this package (a unit test checks it).
- **API.** `src/api/client.ts` sends same-origin cookies, `X-CSRF-Token` (from `/me`) on unsafe methods, `If-Match`
  for versioned changes and `Idempotency-Key` on create; problem+json becomes `ApiError`, and the UI translates the
  problem `code` (`src/lib/problem.ts`, catalogue `problems.json`), never the English `title`.
- **Explicit states.** `src/components/States.tsx`: loading, empty, error (with request reference), stale (data shown,
  refresh failed), conflict (409: compare + re-apply only the user's own changes on the latest version, or discard)
  and no-permission (403/404). Missing values render **Unknown**, never 0 or green.
- **Screens (P1).** Sign-in (OIDC button; the development form appears only when the server's dev-login route
  exists), My Work, the 14 navigation areas (planned areas say so), transformations list/create/detail/edit/archive,
  administration: organizations, business units, users, role assignments.

## Sign-in page and `authMode` (contract note)

`/me.authMode` needs a session, so before sign-in the page cannot read it. The page therefore probes the documented
contract: `POST /api/v1/auth/dev-login` with an empty body answers **400** when the route exists (AUTH_MODE=dev) and
**404** in every other mode. The probe signs nobody in and creates nothing. A public `GET /api/v1/auth/options`
would be cleaner; it is requested in the T-DG1-FE handback.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @mth/web typecheck` | `tsc` (strict, zero errors) |
| `pnpm --filter @mth/web build` | typecheck + Vite build to `dist/` (served by the API in production) |
| `pnpm --filter @mth/web test` | unit/component tests in jsdom (i18n key parity, states, shell, journeys against a scripted API) |
| `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | real-API journeys in EN and AR with axe and screenshots (see `e2e/README.md`) |
