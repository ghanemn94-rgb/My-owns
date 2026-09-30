# @mth/design-tokens

**Responsibility.** The single design-token source and its outputs (ADR-0009):
- `src/tokens.json`: the seven **provisional** tokens from master prompt §15 (REQ-S15-002). `#0078FF` is a
  provisional brand token, not a verified Mobily colour.
- Generation (P1, frontend-ux-engineer): CSS custom properties (`--mth-brand-primary`, …), a derived accessible
  action-button shade, and separate semantic status tokens that always pair with a label or icon.
- Contrast checker (P1, frontend-ux-engineer): computes the WCAG 2.x contrast ratio for every declared
  text/background pair and fails the build below 4.5:1 (normal text) or 3:1 (large text and UI boundaries).

**Owner from P1:** frontend-ux-engineer.
