# ADR-0009: Frontend: React, Vite, routing, data, forms, tables, i18n/RTL, tokens, fonts, wordmark, accessibility

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-002, REQ-S15-001…008, REQ-S15-011…013, REQ-S01-002, REQ-S19-019. **Complete at DG1:** REQ-S15-002, REQ-S15-005, REQ-S15-006.

## Decision

1. **Stack** [all UNVERIFIED, licences MIT unless stated]:

   | Area | Choice |
   |---|---|
   | UI | React 19.2.0 and react-dom 19.2.0 |
   | Build | Vite 7.1.11 with `@vitejs/plugin-react` 5.0.4. Build-time only; there is no Node runtime for the web in production. |
   | Routing | React Router 7.9.0, library ("data router") mode. No framework or SSR mode. |
   | Server state | TanStack Query 5.90.2, with a thin typed `fetch` wrapper that sends `X-CSRF-Token` and `If-Match` and maps problem+json to typed errors |
   | Tables | TanStack Table 8.21.3 (headless): sorting, filtering, pagination and column selection (REQ-S15-013) |
   | Forms | react-hook-form 7.62.0 with `@hookform/resolvers` 5.2.1 and the shared zod schemas |
   | i18n | i18next 25.5.2 with react-i18next 16.0.0 |

2. **i18n and RTL.**
   - Two catalogues, `ar` and `en`, in `apps/web/src/i18n/{ar,en}/*.json`, with identical key sets checked by a unit test.
   - **Arabic RTL is the default**, and English is LTR.
   - Switching language sets `<html lang dir>` before paint (from `/me` preferences, with `localStorage` as a pre-login hint) and persists the choice with `PUT /api/v1/me/preferences` (REQ-S15-007).
   - Layout uses **CSS logical properties only** (`margin-inline-start`, `inset-inline-end`, …); a stylelint-free check greps for physical `left`/`right` in component CSS.
   - Numbers, dates and currency are formatted with `Intl`, in the user's locale and the record's time zone. Technical identifiers and formulas are wrapped in `<bdi dir="ltr">` so they stay readable in RTL.
   - Server errors are translated from the problem `code`.
3. **Design tokens (REQ-S15-002/003).**
   - `packages/design-tokens/src/tokens.json` is the single source. It holds the seven §15 values, **marked provisional**; `#0078FF` is not a verified Mobily colour.
   - A generator emits `tokens.css` with `--mth-*` custom properties, imported once by the web app. Future Branding Settings (P5) override the same properties at runtime.
   - A **contrast checker** script computes WCAG 2.x ratios for every declared text/background pair and fails the build below 4.5:1 (normal text) or 3:1 (large text and non-text UI).
   - It also derives an **accessible action shade** for white-on-blue buttons, instead of assuming `#0078FF` passes. Calculated in this run with the WCAG 2.x relative-luminance formula [V-LOCAL]:

   | Pair | Ratio | Result |
   |---|---|---|
   | `#0078FF` on `#FFFFFF` | **4.09:1** | fails 4.5:1 for small text |
   | `#0078FF` on `#F5F8FC` | 3.84:1 | fails |
   | white on `#003B73` | 11.21:1 | passes |
   | `#142438` on `#F5F8FC` | 14.72:1 | passes |
   | `#526174` on `#FFFFFF` | 6.32:1 | passes |
   | `#526174` on `#F5F8FC` | 5.94:1 | passes |

   So `brand.primary` may be used for large text, borders and selected-state accents, but body-size text and white-on-blue buttons need the derived darker action shade.
   - Status colours are **separate semantic tokens** (`status.on-track`, `status.at-risk`, `status.off-track`, `status.unknown`, `status.stale`) and always come with a label or icon. Blue is never used to signal a favourable status.
4. **Fonts (REQ-S15-005, completes at DG1).**
   - **IBM Plex Sans Arabic** and **IBM Plex Sans**, both under the SIL Open Font License 1.1, installed as npm packages `@fontsource/ibm-plex-sans-arabic` 5.2.6 and `@fontsource/ibm-plex-sans` 5.2.6. The package code is MIT and the font files OFL-1.1 [UNVERIFIED versions; the licence is OFL-1.1 per the IBM Plex project].
   - Vite bundles the `woff2` files as hashed local assets (`assetsInlineLimit: 0`). There are **no requests to Google Fonts or any CDN**, which `pnpm check:no-cdn` and an e2e network assertion enforce.
   - Only the needed weights and subsets are imported: 400, 500 and 600; Arabic, plus Latin for the Latin face.
   - OFL notices ship in the image's `licenses/` folder (devops).
5. **Provisional wordmark (REQ-S15-006, completes at DG1).**
   - There is no official logo, so the header shows a **text wordmark**: the configurable product name (`Me.productName`, default "Mobily Transformation Hub" / Arabic translation), followed by a visible **"Provisional / مؤقت" badge**.
   - No invented logo, glyph or imitation of Mobily marks.
   - The About page states that the colours and wordmark are provisional.
6. **No public CDN at runtime or build.** npm packages come from the registry or IT's mirror at build time only. Runtime assets are all same-origin. The CSP (`default-src 'self'`) blocks accidental remote loads.
7. **Accessibility testing.**
   - **axe-core via `@axe-core/playwright` 4.10.2** (axe-core is **MPL-2.0**, used unmodified as a dev tool; flagged in the licence inventory) [UNVERIFIED], run locally in e2e on every P1 screen in **both** languages.
   - Keyboard-only walkthrough tests, visible-focus checks, and labelled controls checked by role-based queries.
8. **Explicit states (REQ-S15-011).** Each data view renders empty, loading, error, stale, **conflict** (409 → reload and compare, then re-apply) and **no-permission** (403/404) states. Unknown values render "Unknown", never 0 or green.

## Alternatives

- **Next.js or Remix framework mode.** SSR adds a Node runtime and complexity. An internal authenticated SPA does not need SEO.
- **A component library (MUI, Ant Design).** Heavier theming against provisional tokens, and RTL quirks. P1 builds a small set of accessible primitives on native elements. A headless library such as Radix may be added later through an ADR update.
- **Noto Sans Arabic.** Also OFL and a valid alternative. Plex was chosen for a single designed Latin/Arabic pairing.

## Verification evidence

| Item | Pinned | Licence | Evidence |
|---|---|---|---|
| react / react-dom | 19.2.0 | MIT | [UNVERIFIED] |
| @types/react / @types/react-dom | 19.2.2 / 19.2.1 | MIT | [UNVERIFIED] |
| vite / @vitejs/plugin-react | 7.1.11 / 5.0.4 | MIT | [UNVERIFIED] |
| react-router | 7.9.0 | MIT | [UNVERIFIED]; check advisories for 7.9.x before pinning |
| @tanstack/react-query / react-table | 5.90.2 / 8.21.3 | MIT | [UNVERIFIED] |
| react-hook-form / @hookform/resolvers | 7.62.0 / 5.2.1 | MIT | [UNVERIFIED] |
| i18next / react-i18next | 25.5.2 / 16.0.0 | MIT | [UNVERIFIED] |
| @fontsource/ibm-plex-sans(-arabic) | 5.2.6 | MIT package, OFL-1.1 fonts | [UNVERIFIED] |
| @axe-core/playwright | 4.10.2 | MPL-2.0 (axe-core) | [UNVERIFIED]; licence flag |
| Provisional tokens | 7 values from §15 | — | `packages/design-tokens/src/tokens.json` [V-LOCAL: built and read back offline, `cssVarName('brand.primary')` = `--mth-brand-primary`] |
