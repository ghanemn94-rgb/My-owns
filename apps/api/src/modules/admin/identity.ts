// P6 slice C (T-DG6-BE-G; ADR-0054 §1; REQ-S16-007): Administration > Identity, getIdentitySettings. A read-only view
// of the effective identity-provider settings (identity.read; ADM_TECH, ADM_ACCESS, AUD): the auth mode, the one
// accepted issuer, the client id (also the one accepted ID-token audience), the requested scopes, the PKCE method, the
// fixed claim mapping and where the SAML broker is documented. It NEVER returns the client secret: only whether one is
// configured. There is no PUT: identity settings stay runtime configuration (ADR-0011). Reading it changes and approves
// nothing.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { holdsAnywhere, principalOf } from "../access/index.ts";
import { parseQuery, problems, type ModuleDeps } from "../platform/index.ts";

/** Repository path of the SAML broker document (DO-B; ADR-0054 §1). The product contains no SAML code. */
export const SAML_BROKER_DOCUMENT = "docs/operations/identity-saml-broker.md";

/** zod mirror of the contract's `IdentitySettings` (docs/api/openapi.yaml 1.5.0-p6). */
export const identitySettings = z.strictObject({
  authMode: z.enum(["oidc", "dev"]),
  issuer: z.string().nullable(),
  clientId: z.string().nullable(),
  clientSecretConfigured: z.boolean(),
  scopes: z.array(z.string()),
  expectedAudience: z.string().nullable(),
  pkceMethod: z.literal("S256").nullable(),
  claimMapping: z.strictObject({
    subject: z.literal("sub"),
    email: z.literal("email"),
    displayName: z.literal("name"),
  }),
  samlBrokerDocument: z.string(),
});
export type IdentitySettings = z.infer<typeof identitySettings>;

/**
 * The settings for a configuration. With OIDC configured, the values the sign-in flow actually uses
 * (`identity/oidc.ts`): the issuer as compared exactly with `iss`, the client id as the expected audience, and S256
 * (the flow always sends `code_challenge_method=S256`). Without OIDC (dev mode only) every OIDC field is null or empty.
 */
export function identitySettingsOf(config: ModuleDeps["config"]): IdentitySettings {
  const oidc = config.oidc;
  return {
    authMode: config.authMode,
    issuer: oidc ? oidc.issuerUrl.href : null,
    clientId: oidc ? oidc.clientId : null,
    clientSecretConfigured: oidc !== null && oidc.clientSecret.length > 0,
    scopes: oidc ? oidc.scopes.split(/\s+/).filter((s) => s.length > 0) : [],
    expectedAudience: oidc ? oidc.clientId : null,
    pkceMethod: oidc ? "S256" : null,
    claimMapping: { subject: "sub", email: "email", displayName: "name" },
    samlBrokerDocument: SAML_BROKER_DOCUMENT,
  };
}

/** The operation takes no parameter: any query parameter is a 400 validation error. */
const query = z.strictObject({});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerIdentityAdminRoutes(app: FastifyInstance, { config }: ModuleDeps): string[] {
  app.get("/api/v1/admin/identity", { config: { access: { permission: "identity.read" } } }, async (request) => {
    parseQuery(query, request.query);
    // Installation-wide configuration: identity.read held in any scope admits the read (ADM_TECH, ADM_ACCESS, AUD).
    if (!holdsAnywhere(principalOf(request), "identity.read")) throw problems.forbidden();
    return identitySettingsOf(config);
  });
  return ["GET /api/v1/admin/identity"];
}
