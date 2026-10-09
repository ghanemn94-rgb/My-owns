// raid module suite (P4; T-DG4-BE-A created the module, p4-plan §2 seam 19). The owning tasks add their behaviour
// tests here and under test/integration/raid/. Until then: the module wires every route file through its hook, and
// reports "scaffold" while no route exists (a route-free module promises no behaviour).
import { readdirSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { HttpProblem, mapDatabaseGuardError, type ModuleDeps } from "../platform/index.ts";
import { registerRaidModule } from "./index.ts";
import { checkProbability, parseRaidCreate } from "./register.ts";
import { isOverdue, sourceKindOf, type ActionRow } from "./actions.ts";

describe("raid module (P4)", () => {
  it("registers through its hook and reports its registration", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerRaidModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("raid");
      expect(registration.deliversIn).toBe("P4");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
    } finally {
      await app.close();
    }
  });

  it("has its route files in place (1 created by T-DG4-BE-A, p4-plan §5.1)", () => {
    const files = readdirSync(new URL(".", import.meta.url), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts" && f !== "routes.ts");
    expect(
      files.length + (readdirSync(new URL(".", import.meta.url)).includes("routes.ts") ? 1 : 0),
    ).toBeGreaterThanOrEqual(1);
  });
});

// T-DG4-BE-D (ADR-0031 §1-§4, §11): the pure rules of the register and the database last-line mappings.
const problemOf = (fn: () => unknown): HttpProblem => {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpProblem) return err;
    throw err;
  }
  throw new Error("expected a problem");
};

describe("RAID rules (T-DG4-BE-D)", () => {
  it("registers its 11 routes when filled (BE-D) and reports active", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerRaidModule(app, {} as ModuleDeps);
      expect(registration.status).toBe("active");
      expect(registration.routes.length).toBeGreaterThanOrEqual(11);
    } finally {
      await app.close();
    }
  });

  it("REQ-PB-080: Probability is required for a Risk and n/a for every other type", () => {
    expect(() => checkProbability("risk", "high")).not.toThrow();
    for (const t of ["assumption", "issue", "dependency"]) expect(() => checkProbability(t, null)).not.toThrow();
    const required = problemOf(() => checkProbability("risk", null));
    expect([required.status, required.code, required.detail, required.errors?.[0]?.pointer]).toEqual([
      422,
      "raid.probability_required",
      "A Risk needs a Probability (High, Medium or Low).",
      "/probability",
    ]);
    for (const t of ["assumption", "issue", "dependency"]) {
      const na = problemOf(() => checkProbability(t, "high"));
      expect([na.status, na.code, na.detail]).toEqual([
        422,
        "raid.probability_not_applicable",
        "Probability is n/a for Assumption, Issue and Dependency entries; leave it empty.",
      ]);
    }
  });

  it("REQ-PB-079: a Type outside the four is 400 raid.type_invalid at /type; other errors keep their codes", () => {
    const body = { type: "opportunity", description: "", impact: "low", ownerUserId: "not-a-uuid" };
    const p = problemOf(() => parseRaidCreate(body));
    expect(p.status).toBe(400);
    expect(p.errors).toContainEqual({
      pointer: "/type",
      code: "raid.type_invalid",
      message: "Type must be Risk, Assumption, Issue or Dependency.",
    });
    expect(p.errors?.some((e) => e.pointer === "/ownerUserId" && e.code !== "raid.type_invalid")).toBe(true);
    for (const type of ["risk", "assumption", "issue", "dependency"])
      expect(
        parseRaidCreate({
          type,
          description: "Synthetic",
          impact: "low",
          ownerUserId: "0192aaaa-0000-7000-8000-000000000009",
        }).type,
      ).toBe(type);
  });

  it("the database last lines map to the exact ADR-0031 §11 codes (S-11)", () => {
    const map = (constraint: string, detail = "") => mapDatabaseGuardError({ code: "23514", constraint, detail });
    expect(
      map("raid_entry_probability_applicable", "Failing row contains (a, b, c, risk, R-01, x, high, null)")?.code,
    ).toBe("raid.probability_required");
    expect(
      map("raid_entry_probability_applicable", "Failing row contains (a, b, c, issue, I-01, a risk text, high, high)")
        ?.code,
    ).toBe("raid.probability_not_applicable");
    expect([map("raid_entry_status_transition")?.code, map("raid_entry_starts_open")?.code]).toEqual([
      "raid.status_transition",
      "raid.status_transition",
    ]);
    expect([map("raid_entry_closed_final")?.status, map("raid_entry_closed_final")?.code]).toEqual([
      422,
      "raid.closed",
    ]);
    expect([map("raid_entry_code_key")?.status, map("raid_entry_code_key")?.type]).toEqual([
      409,
      "urn:mth:problem:version-conflict",
    ]);
    for (const c of ["action_item_one_source", "action_item_source_immutable", "raid_entry_type_immutable"])
      expect(map(c)?.status).toBe(500);
  });

  it("an action's source kind and overdue flag (ADR-0031 §4)", () => {
    const base = {
      source_workshop_item_id: null,
      raid_entry_id: null,
      dependency_id: null,
      corrective_case_id: null,
    } as unknown as ActionRow;
    expect(sourceKindOf(base)).toBe("none");
    expect(sourceKindOf({ ...base, raid_entry_id: "x" })).toBe("raid_entry");
    expect(sourceKindOf({ ...base, dependency_id: "x" })).toBe("dependency");
    expect(sourceKindOf({ ...base, corrective_case_id: "x" })).toBe("corrective_case");
    expect(sourceKindOf({ ...base, source_workshop_item_id: "x" })).toBe("workshop");
    expect(isOverdue({ due_date: "2026-10-08", status: "open" }, "2026-10-09")).toBe(true);
    expect(isOverdue({ due_date: "2026-10-09", status: "open" }, "2026-10-09")).toBe(false);
    expect(isOverdue({ due_date: "2026-10-08", status: "done" }, "2026-10-09")).toBe(false);
    expect(isOverdue({ due_date: null, status: "in_progress" }, "2026-10-09")).toBe(false);
  });
});
