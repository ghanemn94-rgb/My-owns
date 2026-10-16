// P5 contract exercises of BE-R2 (p5-work-split §I.4 and §2 rule 14; T-DG5-BE-R2): getMyNavigation, with a success
// and every declared refusal it can reach (400 undeclared parameter, 401 no session), through the contract-validating
// client `mirrored`. 429 is the shared rate limiter's, exercised by the contract test's rate-limit checks. The zod
// mirror below follows the OpenAPI `Navigation` schema exactly (there is no shared zod schema for it; see the BE-R2
// handback). Nothing here approves anything or touches the engineering delivery gates; every user is SYNTHETIC.
import { expect } from "vitest";
import { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";

const AREA_CODES = [
  "my_work",
  "executive_overview",
  "transformations",
  "playbook_procedures",
  "strategy_kpis",
  "target_operating_model",
  "initiatives_roadmaps",
  "governance",
  "risks_actions",
  "benefits_finance",
  "change_adoption",
  "evidence_reports",
  "bau_improvement",
  "administration",
] as const;

const navigationItem = z.strictObject({
  code: z.string(),
  labelKey: z.string(),
  path: z.string(),
  availability: z.enum(["working", "planned"]),
});
const navigationArea = z.strictObject({
  code: z.enum(AREA_CODES),
  webId: z.string(),
  labelKey: z.string(),
  path: z.string(),
  items: z.array(navigationItem).max(20),
});
/** The OpenAPI `Navigation` schema (components.schemas.Navigation), mirrored here. */
export const navigationMirror = z.strictObject({ areas: z.array(navigationArea).max(14) });

export const P5_MIRRORS_BE_R2: Readonly<Record<string, z.ZodType>> = {
  getMyNavigation: navigationMirror,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeR2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const tech = await signIn(api.app, w.admin.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const N = "/api/v1/me/navigation";

  // getMyNavigation: 200 (ADM_ACCESS + ADM_TECH: Administration is listed, with its access and branding items).
  const admin = await mirrored("GET", N, { session: tech });
  expect(admin.status).toBe(200);
  const adminArea = (admin.body as Body).areas.find((a: Body) => a.code === "administration");
  expect(adminArea.items.map((i: Body) => i.code)).toEqual(
    expect.arrayContaining(["automation", "organization", "access", "branding", "environment"]),
  );
  // 200 for a user without any grant: only the session items (My Work; the playbook's source and guidance).
  const bare = await mirrored("GET", N, { session: nobody });
  expect(bare.status).toBe(200);
  expect((bare.body as Body).areas.map((a: Body) => a.code)).toEqual(["my_work", "playbook_procedures"]);
  // 400: an undeclared query parameter; 401: no session.
  expect((await mirrored("GET", `${N}?transformationId=x`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", N)).status).toBe(401);
}
