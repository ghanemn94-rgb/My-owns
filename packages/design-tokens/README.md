# @mth/design-tokens

**Responsibility.** The single design-token source and its outputs (ADR-0009). **Owner from P1:** frontend-ux-engineer.

- `src/tokens.json`
  - `color`: the seven **provisional** tokens from master prompt §15 (REQ-S15-002), unchanged. `#0078FF` is a
    provisional brand token, not a verified Mobily colour.
  - `derived`: tokens computed from a seed by a rule. `action.primary` is the lightest darker shade of
    `brand.primary` with ≥ 4.5:1 against `surface.card` and `surface.page` (today `#006DE9`), used for action buttons
    with white text, links and the focus ring; `action.primary-hover` needs ≥ 7:1. The stored value is re-derived by
    `resolveTokens()`, so changing a seed without regenerating fails the build.
  - `semantic`: status tokens (`status.on-track|at-risk|off-track|unknown|stale` fg/bg; green for on-track, never
    blue), feedback, navigation, header gradient, control borders (`border.control`, 3:1 — `border.default` is
    decorative only), and the provisional badge. `ref` entries are emitted as `var(--mth-…)` so runtime Branding
    Settings overrides (P5) propagate.
  - `contrastPairs.pairs`: every fg/bg combination the web UI uses, with its use (`text` 4.5:1, `large-text` and
    `ui` 3:1). `contrastPairs.prohibited`: known-failing combinations the UI must not use (e.g. white small text on
    `#0078FF`, 4.09:1); each must actually fail.
- `src/contrast.ts`: WCAG 2.x relative luminance, contrast ratio and the darker-shade derivation.
- `src/index.ts`: `resolveTokens()`, `generateTokensCss()` (the `--mth-*` custom properties) and `checkContrast()`.
- `src/cli.ts`: `check` (the contrast gate) and `generate` (writes `dist/tokens.css`).

The web app does not read `dist/`: its Vite plugin calls `generateTokensCss()` from the same source at build time.

| Script                                                | What it does                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm --filter @mth/design-tokens run check:contrast` | lists every declared pair with its ratio; exits 1 on any failure |
| `pnpm --filter @mth/design-tokens run generate`       | writes `dist/tokens.css`                                         |
| `pnpm --filter @mth/design-tokens build`              | `tsc` + `generate`                                               |
