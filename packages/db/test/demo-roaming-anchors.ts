// Test-only stand-ins for BE-T's part of the International Roaming dataset (p5-work-split §J.2; T-DG5-KBE-H): the
// organization, business unit, demo role users, the roaming transformation and the three chain initiatives, with the
// exact ids of DEMO_ANCHORS (packages/db/src/demo/data/kpis.ts), so KBE-H's numbers can be seeded and checked before
// BE-T's dataset exists. BE-T's real modules replace these; they are never part of DEMO_DATASET_MODULES. Same rules as
// the real dataset: fixed literal ids, times from the synthetic clock, every row through ctx.insert. SYNTHETIC; no
// credential (no user identity at all); approves nothing.
import { DEMO_ANCHORS } from "../src/demo/data/kpis.ts";
import type { DemoDatasetModule } from "../src/demo/seed.ts";

const USERS: readonly [keyof typeof DEMO_ANCHORS.users, string][] = [
  ["sp", "roaming.user.sp (synthetic)"],
  ["tl", "roaming.user.tl (synthetic)"],
  ["bo", "roaming.user.bo (synthetic)"],
  ["fin", "roaming.user.fin (synthetic)"],
  ["kds", "roaming.user.kds (synthetic)"],
  ["wl", "roaming.user.wl (synthetic)"],
];

const INITIATIVES: readonly [keyof typeof DEMO_ANCHORS.initiatives, string, string][] = [
  ["passRedesign", "INI-01", "Pass redesign + digital activation"],
  ["proactiveComms", "INI-02", "Proactive comms + QoS monitoring"],
  ["partnerOptimization", "INI-03", "Partner optimization"],
];

export const TEST_ANCHOR_MODULES: readonly DemoDatasetModule[] = [
  {
    key: "test.anchors",
    order: 10,
    async seed(ctx) {
      const at = ctx.at({ days: -120 });
      const { organizationId: org, businessUnitId: bu, transformationId: t, users } = DEMO_ANCHORS;
      await ctx.insert("organization", "test.anchor.organization", {
        id: org,
        code: "SYN-ROAMING",
        name_en: "Synthetic Demo Operator",
        name_ar: "مشغل عرض توضيحي اصطناعي",
        created_at: at,
        updated_at: at,
        created_by: null,
        updated_by: null,
      });
      for (const [role, name] of USERS)
        await ctx.insert("app_user", `test.anchor.user.${role}`, {
          id: users[role],
          organization_id: org,
          display_name: name,
          preferred_locale: "en",
          created_at: at,
          updated_at: at,
          created_by: null,
          updated_by: null,
        });
      await ctx.insert("business_unit", "test.anchor.business_unit", {
        id: bu,
        organization_id: org,
        parent_business_unit_id: null,
        code: "CONSUMER",
        name_en: "Consumer (synthetic)",
        name_ar: "قطاع الأفراد (اصطناعي)",
        created_at: at,
        updated_at: at,
        created_by: null,
        updated_by: null,
      });
      await ctx.insert("transformation", "test.anchor.transformation", {
        id: t,
        organization_id: org,
        business_unit_id: bu,
        code: "ROAMING",
        name: "International Roaming Transformation (synthetic)",
        description: "Illustrative example only. Replace assumptions with validated company data.",
        mode: "end_to_end",
        entry_phase: null,
        status: "active",
        current_phase: "transform",
        sponsor_user_id: users.sp,
        lead_user_id: users.tl,
        timezone: "Asia/Riyadh",
        currency: "SAR",
        version: 1,
        created_at: at,
        created_by: users.tl,
        updated_at: at,
        updated_by: users.tl,
      });
      for (const [key, code, name] of INITIATIVES)
        await ctx.insert("initiative", `test.anchor.initiative.${key.toLowerCase()}`, {
          id: DEMO_ANCHORS.initiatives[key],
          organization_id: org,
          transformation_id: t,
          code,
          name,
          executive_owner_user_id: users.sp,
          workstream_lead_user_id: users.wl,
          status: "draft",
          version: 1,
          created_at: at,
          created_by: users.tl,
          updated_at: at,
          updated_by: users.tl,
        });
    },
  },
];
