// @mth/design-tokens (ADR-0009). tokens.json is the single source; frontend-ux-engineer adds the CSS
// custom-property generator (`--mth-brand-primary` ...), the derived accessible action shade, semantic status
// tokens and the WCAG contrast checker (REQ-S15-003) that fails the build on any failing text/background pair.
import tokens from "./tokens.json" with { type: "json" };

export type ColorTokenName = keyof typeof tokens.color;

export interface ColorToken {
  readonly value: string;
  readonly purpose: string;
  readonly provisional: boolean;
}

export const colorTokens: Readonly<Record<ColorTokenName, ColorToken>> = tokens.color;

/** True while any token is provisional; the UI shows the provisional wordmark/notice (REQ-S15-006). */
export const tokensAreProvisional: boolean = tokens.provisional;

/** CSS custom-property name for a token, e.g. brand.primary -> --mth-brand-primary. */
export function cssVarName(token: ColorTokenName): string {
  return `--mth-${token.replace(/\./g, "-")}`;
}
