// admin (ADR-0002): administration endpoints composed from identity (users) and access (roles, assignments), and
// branding: the tokens (REQ-S15-002) and, since P5, versioned Branding Settings with the configurable product name
// (REQ-S15-004, REQ-S01-002; T-DG5-BE-R) and the read port that screens and generated outputs read at render time.
export { registerAdminRoutes } from "./routes.ts";
export { brandingPortFor, registerBrandingRoutes, toBrandingTokens, type BrandingTokenSource } from "./branding.ts";
export { createBrandingReadPort, type BrandingReadPort, type CurrentBranding } from "./branding-port.ts";
// P5 (T-DG5-BE-A stub; p5-plan §5.1 BE-S): the environment read, registered by server.ts.
export { registerEnvironmentRoutes } from "./environment.ts";
// P6 (T-DG6-BE-A stubs; p6-plan §5.1): the Administration route files, each registered by one server.ts line.
export { registerUploadPolicyRoutes } from "./upload-policy.ts"; // BE-D (ADR-0052 §1)
export { registerSecurityRoutes } from "./security.ts"; // BE-E (ADR-0052 §4)
export { registerIdentityAdminRoutes } from "./identity.ts"; // BE-G (slice C)
export { registerStorageAdminRoutes } from "./storage.ts"; // BE-H (slice C)
export { registerNotificationChannelRoutes } from "./notification-channels.ts"; // BE-I (slice C)
export { registerServiceIdentityRoutes } from "./service-identities.ts"; // BE-J (slice J)
