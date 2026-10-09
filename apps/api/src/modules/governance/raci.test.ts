// The pure one-accountable rule of T12 (REQ-S10-009, M0211; ADR-0026 §7; T-DG4-BE-C). The API applies it to the saved
// state before writing; the 0030 deferred trigger is the database's last line (integration: governance/*.test.ts).
import { describe, expect, it } from "vitest";
import { accountabilitySatisfied, accountableCount } from "./raci.ts";

const cells = (...values: (string | null)[]) => values.map((value) => ({ value }));

describe("T12 one accountable per deliverable (REQ-S10-009)", () => {
  it("counts A and A/R, and A/R counts as one (BAU Handover of B0101)", () => {
    expect(accountableCount(cells("I", "C", "A/R", "R", "C", "C"))).toBe(1);
    expect(accountableCount(cells("A", "R", "C", "I", "C", "I"))).toBe(1);
    expect(accountableCount(cells("A", "A", null))).toBe(2);
    expect(accountableCount(cells("R", null, "C"))).toBe(0);
  });

  it("an active deliverable needs exactly one, unless an exception is documented or it is retired", () => {
    const active = { status: "active", accountabilityException: null };
    expect(accountabilitySatisfied({ ...active, cells: cells("A", "R") })).toBe(true);
    expect(accountabilitySatisfied({ ...active, cells: cells("A", "A") })).toBe(false);
    expect(accountabilitySatisfied({ ...active, cells: cells("R", "C") })).toBe(false);
    expect(
      accountabilitySatisfied({
        status: "active",
        accountabilityException: "Synthetic rule GR-1",
        cells: cells("A", "A"),
      }),
    ).toBe(true);
    expect(accountabilitySatisfied({ status: "retired", accountabilityException: null, cells: cells() })).toBe(true);
  });
});
