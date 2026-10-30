// P6 contract exercises of BE-G (p6-work-split §J/C.6 and §2 rule 16; T-DG6-BE-G): getIdentitySettings
// (Administration > Identity; ADR-0054 §1), with its success and every declared refusal it can reach, through the
// validating client. The 404 the contract declares is the shared ADR-0007 §5b response; this parameterless,
// installation-wide read has no resource that can be missing, so it is not reachable. Every value is synthetic.
import { expect } from "vitest";
import type { z } from "zod";
import { identitySettings } from "../../../src/modules/admin/identity.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_G: Readonly<Record<string, z.ZodType>> = {
  getIdentitySettings: identitySettings,
};

export async function exerciseP6BeGOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_ACCESS + ADM_TECH
  const auditor = await signIn(api.app, w.auditor.subject); // AUD
  const nobody = await signIn(api.app, w.nobody.subject);

  // getIdentitySettings: 200 (ADM_TECH/ADM_ACCESS, AUD); 400; 401; 403.
  const I = "/api/v1/admin/identity";
  const settings = await mirrored("GET", I, { session: admin });
  expect(settings.status).toBe(200);
  expect(settings.body.claimMapping).toEqual({ subject: "sub", email: "email", displayName: "name" });
  expect(settings.body.samlBrokerDocument).toBe("docs/operations/identity-saml-broker.md");
  expect(settings.body.expectedAudience).toBe(settings.body.clientId);
  expect((await mirrored("GET", I, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${I}?unknown=1`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", I)).status).toBe(401);
  expect((await mirrored("GET", I, { session: nobody })).status).toBe(403);
}
