// Unit tests of the pure capacity conflict rule (ADR-0023 §6; REQ-PB-059, REQ-S09-004; T-DG3-BE-E). No database.
// demand > available -> capacity.over_allocated with the decimal shortfall; no capacity row -> capacity.unknown
// (available and shortfall null - never 0, never "no conflict"); FTE stays a decimal string (no float arithmetic).
import { describe, expect, it } from "vitest";
import { CAPACITY_FLAGS, capacityCell, fteText } from "./capacity.ts";

const ROLE = "01920000-0000-7000-8000-0000000000c1";

describe("capacityCell (the conflict rule)", () => {
  it("demand > available is over-allocated with the exact decimal shortfall", () => {
    expect(capacityCell(ROLE, "2027-01-01", "2.00", "2.50", "1.00")).toEqual({
      resourceRoleId: ROLE,
      periodMonth: "2027-01-01",
      availableFte: "2.00",
      demandFte: "2.50",
      committedDemandFte: "1.00",
      shortfallFte: "0.50",
      flag: CAPACITY_FLAGS.overAllocated,
    });
    // 0.1 + 0.2 style sums stay exact: 0.30 demand against 0.29 available is a 0.01 shortfall.
    expect(capacityCell(ROLE, "2027-01-01", "0.29", "0.30", "0").shortfallFte).toBe("0.01");
  });

  it("demand equal to or below available is no conflict, with a zero shortfall", () => {
    expect(capacityCell(ROLE, "2027-02-01", "2.00", "2.00", "2.00")).toMatchObject({
      flag: null,
      shortfallFte: "0.00",
    });
    expect(capacityCell(ROLE, "2027-02-01", "2.00", "0", "0")).toMatchObject({ flag: null, demandFte: "0.00" });
  });

  it("no capacity row is Unknown: never 0, never 'no conflict'", () => {
    const cell = capacityCell(ROLE, "2027-03-01", null, "0.75", "0.75");
    expect([cell.flag, cell.availableFte, cell.shortfallFte]).toEqual([CAPACITY_FLAGS.unknown, null, null]);
  });

  it("FTE is printed with two decimals from the numeric text", () => {
    expect([fteText("1.5"), fteText("0"), fteText("9999.99")]).toEqual(["1.50", "0.00", "9999.99"]);
  });
});
