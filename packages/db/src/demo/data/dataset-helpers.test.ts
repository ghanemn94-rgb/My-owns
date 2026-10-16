// Unit tests of the KBE-H dataset helpers that need no engine and no database (T-DG5-KBE-H): the id scheme, the
// synthetic-clock instants, the plain-code storage-rounding record and YTD window, and the module order. The engine
// recomputation of every number is in packages/db/test/integration/demo-numbers-spec.test.ts (the engine may not be
// imported here, ADR-0002 rule 5) and from the stored rows in demo-numbers.test.ts.
import { describe, expect, it } from "vitest";
import { DEMO_SYNTHETIC_CLOCK } from "../guard.ts";
import { DEMO_ID_PATTERN, type DemoSeedContext } from "../seed.ts";
import { demoActual, fixed6, roundingRecord, ytdWindow } from "./actuals.ts";
import { KBE_H_DATASET_MODULES } from "./finance.ts";
import { DEMO_ANCHORS, ID_BLOCK, KBE_H_FIRST_ORDER, kbeId, when } from "./kpis.ts";

describe("ids", () => {
  it("kbeId: 01995000-4<block>-7000-8000-<n>, within the demo pattern, refusing bad input", () => {
    expect(kbeId(ID_BLOCK.benefit, 1)).toBe("01995000-4401-7000-8000-000000000001");
    expect(kbeId(ID_BLOCK.kpiEvaluation, 0x109)).toBe("01995000-4205-7000-8000-000000000109");
    expect(kbeId(0xfff, 0xffff)).toMatch(DEMO_ID_PATTERN);
    for (const [b, n] of [
      [0xff, 1],
      [0x1000, 1],
      [0x101, 0],
      [0x101, 0x10000],
      [0x101, 1.5],
    ] as const)
      expect(() => kbeId(b, n)).toThrow();
  });

  it("the anchors are fixed demo ids and the transformation is coverage.ts's", () => {
    expect(DEMO_ANCHORS.transformationId).toBe("01995000-0000-7000-8000-000000000001");
    for (const id of [DEMO_ANCHORS.organizationId, ...Object.values(DEMO_ANCHORS.users)])
      expect(id).toMatch(DEMO_ID_PATTERN);
  });
});

describe("when: instants derive from the synthetic clock", () => {
  const clock = new Date(DEMO_SYNTHETIC_CLOCK);
  const ctx = {
    clock,
    at: (o: { days?: number; hours?: number; minutes?: number }) =>
      new Date(clock.getTime() + (((o.days ?? 0) * 24 + (o.hours ?? 0)) * 60 + (o.minutes ?? 0)) * 60_000),
  } as unknown as DemoSeedContext;

  it("returns the clock plus the whole-minute offset", () => {
    expect(when(ctx, "2026-09-01T06:00:00Z").toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect(when(ctx, "2026-07-03T07:00:00Z").toISOString()).toBe("2026-07-03T07:00:00.000Z");
  });

  it("refuses a malformed instant or one that is not a whole minute away", () => {
    expect(() => when(ctx, "2026-07-03 07:00")).toThrow();
    expect(() => when(ctx, "2026-07-03T07:00:30Z")).toThrow();
  });
});

describe("storage rounding record and YTD window", () => {
  it("fixed6 pads to numeric(24,6) text and refuses more than six places", () => {
    expect([fixed6("0.195"), fixed6("222750"), fixed6("-0.0005"), fixed6("0")]).toEqual([
      "0.195000",
      "222750.000000",
      "-0.000500",
      "0.000000",
    ]);
    expect(() => fixed6("0.1234567")).toThrow();
    expect(() => fixed6("1e3")).toThrow();
  });

  it("roundingRecord marks a rounded value only when the exact value differs from the stored one", () => {
    expect(roundingRecord("0.195", "0.195")).toMatchObject({ stored: "0.195000", rounded: false });
    expect(roundingRecord("0.19889423076923076923", "0.198894")).toMatchObject({
      exact: "0.19889423076923076923",
      stored: "0.198894",
      rounded: true,
      column: "numeric(24,6)",
      mode: "ROUND_HALF_UP",
    });
  });

  it("ytdWindow: the KPI's actuals of the year up to the slot, in period order", () => {
    expect(ytdWindow(demoActual("attach_rate.2026-08")).map((a) => a.key)).toEqual([
      "attach_rate.2026-06",
      "attach_rate.2026-07",
      "attach_rate.2026-08",
    ]);
    expect(ytdWindow(demoActual("cost_per_mb.2026-06")).map((a) => a.key)).toEqual(["cost_per_mb.2026-06"]);
  });
});

describe("modules", () => {
  it("five modules after BE-T's anchors, in dependency order", () => {
    expect(KBE_H_DATASET_MODULES.map((m) => m.key)).toEqual([
      "kbe.kpis",
      "kbe.actuals",
      "kbe.business_cases",
      "kbe.benefits",
      "kbe.finance",
    ]);
    const orders = KBE_H_DATASET_MODULES.map((m) => m.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(Math.min(...orders)).toBe(KBE_H_FIRST_ORDER);
  });
});
