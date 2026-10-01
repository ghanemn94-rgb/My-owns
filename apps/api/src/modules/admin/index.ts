// admin (ADR-0002): administration endpoints composed from identity (users) and access (roles, assignments), and the
// read-only branding tokens (REQ-S15-002; editing is Branding Settings, P5).
export { registerAdminRoutes } from "./routes.ts";
export { registerBrandingRoutes, toBrandingTokens, type BrandingTokenSource } from "./branding.ts";
