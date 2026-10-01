// GET /api/v1/branding/tokens (REQ-S15-002, contract operation getBrandingTokens). Read-only at DG1: Branding
// Settings (editing) is P5. The token source is injected by the composition root (server.ts reads @mth/design-tokens,
// the single token source per ADR-0009), so this module imports no workspace package outside the ADR-0002 allow-list.
// #0078FF is a provisional brand token, not a verified Mobily colour; nothing here claims official brand compliance.
import { brandingTokens, type BrandingTokens } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";

/** Structural view of `@mth/design-tokens` (`colorTokens`, `tokensAreProvisional`). */
export interface BrandingTokenSource {
  readonly colorTokens: Readonly<
    Record<string, { readonly value: string; readonly purpose: string; readonly provisional: boolean }>
  >;
  readonly tokensAreProvisional: boolean;
}

/**
 * Maps the token source to the contract shape. Fails safe: provenance is "official" only when the source says the
 * set is not provisional AND no single token is provisional, so a partly unverified set is never reported official.
 * The output is validated against the shared zod mirror, so a drift from the contract fails loudly, not silently.
 */
export function toBrandingTokens(source: BrandingTokenSource): BrandingTokens {
  const tokens = Object.entries(source.colorTokens).map(([name, t]) => ({
    name,
    value: t.value,
    purpose: t.purpose,
    provisional: t.provisional,
  }));
  const provisional = source.tokensAreProvisional || tokens.some((t) => t.provisional);
  return brandingTokens.parse({ provenance: provisional ? "provisional" : "official", tokens });
}

export function registerBrandingRoutes(app: FastifyInstance, source: BrandingTokenSource): void {
  // Computed once: the source is static per process at DG1 (no Branding Settings writes yet).
  const body = toBrandingTokens(source);
  // Any signed-in user may read the tokens (the UI themes itself with them); no permission in the catalogue fits
  // and the data is non-sensitive, so the route is authenticated-only, like /me. Unauthenticated -> 401.
  app.get("/api/v1/branding/tokens", { config: { access: { permission: "authenticated" } } }, async () => body);
}
