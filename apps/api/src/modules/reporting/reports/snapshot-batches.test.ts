// Unit test of the snapshot children's INSERT batching (T-DG6-BE-S; DO-F run-1 EXPLAIN digest: one INSERT per
// report_snapshot_source row was the largest cost of a live-selection createExport). Pure: no database.
import { describe, expect, it } from "vitest";
import { batches, INSERT_BATCH } from "./snapshots.ts";

describe("batches (snapshot children INSERT batching)", () => {
  it("keeps every row once, in order, in chunks of at most INSERT_BATCH", () => {
    const rows = Array.from({ length: 2 * INSERT_BATCH + 7 }, (_, i) => i);
    const chunks = batches(rows);
    expect(chunks.map((c) => c.length)).toEqual([INSERT_BATCH, INSERT_BATCH, 7]);
    expect(chunks.flat()).toEqual(rows);
  });

  it("an exact multiple gives full chunks only; no rows give no chunk (no empty INSERT)", () => {
    expect(batches([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(batches([])).toEqual([]);
  });

  it("stays below PostgreSQL's 65,535 bind parameters for the widest child row (11 columns)", () => {
    expect(INSERT_BATCH * 11).toBeLessThan(65_535);
  });
});
