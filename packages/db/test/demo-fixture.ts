// A small SYNTHETIC test dataset for the demo seed framework's tests (T-DG5-BE-S). The real dataset (the International
// Roaming transformation) is BE-T's and KBE-H's, in packages/db/src/demo/data/**. This one uses the same rules: fixed
// literal ids in 01995000-…, times only from the synthetic clock, every row through ctx.insert (audit + registration).
// It holds no credential: the demo user's identity names a demo IdP issuer only. It approves nothing.
import type { DemoDatasetModule } from "../src/demo/seed.ts";

export const FIXTURE_ORG_ID = "01995000-0000-7000-8000-00000000f001";
export const FIXTURE_USER_ID = "01995000-0000-7000-8000-00000000f002";
export const FIXTURE_IDENTITY_ID = "01995000-0000-7000-8000-00000000f003";
export const FIXTURE_DEMO_ISSUER = "urn:mth:demo-idp:synthetic-test";

export const TEST_DEMO_MODULES: readonly DemoDatasetModule[] = [
  {
    key: "test.users",
    order: 20,
    async seed(ctx) {
      await ctx.insert("app_user", "test.user.roaming-sp", {
        id: FIXTURE_USER_ID,
        organization_id: FIXTURE_ORG_ID,
        display_name: "roaming.user.sp (synthetic)",
        created_by: null,
        updated_by: null,
      });
      await ctx.insert(
        "user_identity",
        "test.identity.roaming-sp",
        {
          id: FIXTURE_IDENTITY_ID,
          user_id: FIXTURE_USER_ID,
          issuer: FIXTURE_DEMO_ISSUER,
          subject: "roaming.user.sp",
          email_at_binding: null,
          last_login_at: ctx.at({ days: -1, hours: 2 }),
        },
        { organizationId: FIXTURE_ORG_ID },
      );
    },
  },
  {
    // Deliberately listed second with a lower order: the seed sorts modules, so the organization comes first.
    key: "test.organization",
    order: 10,
    async seed(ctx) {
      await ctx.insert("organization", "test.organization", {
        id: FIXTURE_ORG_ID,
        code: "SYN-DEMO",
        name_en: "Synthetic Demo Organization",
        name_ar: "مؤسسة عرض توضيحي اصطناعية",
        created_by: null,
        updated_by: null,
      });
    },
  },
];
