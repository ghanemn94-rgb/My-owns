// Branding design tokens (REQ-S15-002). Zod mirror of the OpenAPI `BrandingTokens` schema (docs/api/openapi.yaml,
// operation getBrandingTokens); keep both in lockstep. `provenance` stays "provisional" while the seeded §15 tokens
// are unverified. #0078FF is a provisional brand token, not a verified Mobily colour.
import { z } from "zod";

export const brandingProvenance = z.enum(["provisional", "official"]);
export type BrandingProvenance = z.infer<typeof brandingProvenance>;

export const brandingToken = z.strictObject({
  name: z.string(),
  value: z.string(),
  purpose: z.string().optional(),
  provisional: z.boolean(),
});
export type BrandingToken = z.infer<typeof brandingToken>;

export const brandingTokens = z.strictObject({
  provenance: brandingProvenance,
  tokens: z.array(brandingToken),
});
export type BrandingTokens = z.infer<typeof brandingTokens>;
