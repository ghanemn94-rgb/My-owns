// code-security-reviewer DG2 round-3 probe (T-DG2-REV-SEC-R3): residual of the F-DG2-150 / D-063 class. Text made
// only of characters that render as nothing (Unicode White_Space NEL U+0085, zero-width / format characters, bidi
// marks common in Arabic RTL input) is accepted by freeText() and counted as present by hasText(), because both use
// String.prototype.trim(), which strips only ECMAScript WhiteSpace/LineTerminator. Assertions encode the SECURE
// expectation, so a FAILING test = the defect is reproduced. Disposable clone + disposable PostgreSQL only. SYNTHETIC.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { setupP2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

const INVISIBLE: [string, string][] = [
  ["U+0085 NEL (Unicode White_Space)", "\u0085"],
  ["U+200B ZERO WIDTH SPACE", "​"],
  ["U+200F RIGHT-TO-LEFT MARK", "‏"],
  ["U+061C ARABIC LETTER MARK", "؜"],
  ["U+2060 WORD JOINER x3", "⁠⁠⁠"],
];

describe("invisible-only Out of scope must not document an exclusion (B0041) or satisfy G1", () => {
  it.each(INVISIBLE)("%s", async (label, value) => {
    const q = await setupP2World(api, w);
    const Q = `/api/v1/transformations/${q.transformationId}`;
    const created = await call(api.app, "POST", `${Q}/charter`, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)", outOfScope: value },
    });
    let precheck: string | undefined;
    let g1Missing: boolean | undefined;
    if (created.status === 201) {
      const v = await call(api.app, "GET", `${Q}/charter`, { session: q.lead.session });
      precheck = v.body.scopeCheckPrechecks.find((x: { code: string }) => x.code === "exclusions_documented")?.result;
      const g1 = await call(api.app, "GET", `${Q}/gates/G1`, { session: q.lead.session });
      g1Missing = g1.body.criteria
        .find((c: { key: string }) => c.key === "g1.initial_charter")
        .missing.some((m: { pointer: string }) => m.pointer === "/charter/outOfScope");
    }
    log(label, { create: created.status, stored: created.body?.charter?.outOfScope === value, precheck, g1OutOfScopeMissing: g1Missing });
    // secure expectation: either rejected at input (400) or, if stored, never read as a documented exclusion
    if (created.status === 201) {
      expect(precheck).toBe("attention");
      expect(g1Missing).toBe(true);
    } else {
      expect(created.status).toBe(400);
    }
  });
});
