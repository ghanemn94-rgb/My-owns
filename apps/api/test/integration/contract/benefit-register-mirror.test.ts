// The benefit register's zod mirror carries `initiatives[]` (T-DG4-BE-R1; BE-M handback §2.1; ARCH-08, D-106 (d)).
// KBE-D's `listBenefits` contract exercise lists an EMPTY register, so it never proved that the strict mirror
// `benefitRegisterPage` accepts the `initiatives` member BE-M fills on every row. This contract test lists a NON-empty
// register, with a benefit allocated to an initiative, through the validating client (the OpenAPI response schema), and
// parses the page with the strict zod mirror. It also shows that a mirror without the member would reject the page.
// All data is SYNTHETIC; nothing here is a business approval, and nothing touches DG0-DG7.
import { benefitRegisterPage, benefitRegisterRow } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { seedTraceWorld, type TraceWorld } from "./p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
let t: TraceWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  t = await seedTraceWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("listBenefits: the strict mirror parses a non-empty register page with initiatives[]", () => {
  it("a register row naming its initiative parses with benefitRegisterPage; without the member it would not", async () => {
    const benefit = await call(api.app, "GET", `${t.base}/benefits/${t.benefitId}`, { session: t.s.bo });
    const alloc = await call(api.app, "PUT", `${t.base}/benefits/${t.benefitId}/allocations`, {
      session: t.s.bo,
      headers: ifm(benefit.body.version),
      body: { allocations: [{ initiativeId: t.initiativeId, share: "1" }] },
    });
    expect(alloc.status, JSON.stringify(alloc.body)).toBe(200);

    // The validating client checks the response against the OpenAPI operation as well.
    const register = await call(api.app, "GET", `${t.base}/benefits`, { session: t.s.auditor });
    expect(register.status).toBe(200);
    const page = benefitRegisterPage.parse(register.body);
    expect(page.items.length).toBeGreaterThan(0);
    const row = page.items.find((r) => r.id === t.benefitId);
    expect(row?.initiatives).toEqual([{ id: t.initiativeId, code: t.initiativeCode, name: expect.any(String) }]);
    expect(page.items.every((r) => Array.isArray(r.initiatives))).toBe(true);

    // The member is strict too: an extra key inside an initiative reference is refused.
    const tampered = structuredClone(register.body) as { items: { id: string; initiatives: object[] }[] };
    tampered.items.find((r) => r.id === t.benefitId)!.initiatives[0] = {
      id: t.initiativeId,
      code: t.initiativeCode,
      name: "Synthetic",
      extra: true,
    };
    expect(benefitRegisterPage.safeParse(tampered).success).toBe(false);

    // The mirror as it was before this change (no `initiatives`) rejects the same page: the member is required here.
    const withoutMember = z.strictObject({
      items: z.array(benefitRegisterRow.omit({ initiatives: true })),
      nextCursor: z.string().nullable(),
    });
    expect(withoutMember.safeParse(register.body).success).toBe(false);
  });
});
