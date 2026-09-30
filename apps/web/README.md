# @mth/web

**Responsibility.** The React single-page app (ADR-0009): bilingual shell (Arabic RTL default, English LTR,
persistent switch via `PUT /api/v1/me/preferences`), design tokens from `@mth/design-tokens` as CSS custom
properties, locally bundled OFL fonts (IBM Plex Sans Arabic + IBM Plex Sans via Fontsource), a clearly
provisional text wordmark (no logo), and the P1 screens (sign-in, My Work placeholder, transformations
list/create/detail/edit with conflict and no-permission states, admin: organizations/BUs/users/assignments).

No runtime or build-time request goes to a public CDN (`pnpm check:no-cdn`). All strings come from the
`ar`/`en` catalogues; server errors are translated from the problem `code`.

**Owner from P1:** frontend-ux-engineer.
