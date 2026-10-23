// F-DG5-100 (code-security DG5 round 1; reproduction docs/delivery/test-evidence/DG5/code-security/round-1/repro/
// migration-gap-order.mjs): forward-only migrations apply in one order on every database (ADR-0003). A pending file whose
// id is not above the highest applied id would run at its lexical position on a fresh database but last on an upgraded
// one, so compareStatus() reports it and migrate() refuses it (the refusal itself: test/integration/migrate.test.ts).
import { describe, expect, it } from "vitest";
import { compareStatus, listMigrationFiles, type AppliedMigration, type MigrationFile } from "./migrate.ts";

const asFile = (name: string): MigrationFile => ({
  id: Number(name.slice(0, 4)),
  name,
  sha256: "x".repeat(64),
  sql: "",
});
const asApplied = (f: MigrationFile): AppliedMigration => ({ id: f.id, name: f.name, sha256: f.sha256 });

describe("compareStatus: a pending migration below the highest applied id (F-DG5-100)", () => {
  const shipped = listMigrationFiles().map((f) => asFile(f.name));
  const upgraded = shipped.map(asApplied);

  it("the reviewer's reproduction: a later build that fills the P5 gap 0066 is out of order on an upgraded database", () => {
    const later = [...shipped, asFile("0066_p6_example.sql")].sort((a, b) => a.id - b.id);
    const s = compareStatus(later, upgraded);
    expect(s.pending).toEqual(["0066_p6_example.sql"]);
    expect(s.unknownApplied).toEqual([]);
    expect(s.checksumMismatches).toEqual([]);
    expect(s.upToDate).toBe(false);
    expect(s.outOfOrderPending).toEqual(["0066_p6_example.sql"]);
  });

  it("every one of the eight P5 gaps, and an id equal to the highest applied, is out of order", () => {
    const highest = shipped.at(-1)!;
    for (const id of [66, 67, 73, 77, 78, 79, 83, 84]) {
      const name = `${String(id).padStart(4, "0")}_late.sql`;
      const s = compareStatus([...shipped, asFile(name)], upgraded);
      expect(s.outOfOrderPending, name).toEqual([name]);
    }
    // Same id, other name: the applied row is unknown to the build and the file is not above it.
    const twin = asFile(`${String(highest.id).padStart(4, "0")}_twin.sql`);
    const s = compareStatus([...shipped.slice(0, -1), twin], upgraded);
    expect(s.outOfOrderPending).toEqual([twin.name]);
    expect(s.unknownApplied).toEqual([highest.name]);
  });

  it("positive: a new id above the highest applied is pending in order; a fresh database has nothing out of order", () => {
    const next = asFile(`${String(shipped.at(-1)!.id + 1).padStart(4, "0")}_next.sql`);
    const s = compareStatus([...shipped, next], upgraded);
    expect(s.pending).toEqual([next.name]);
    expect(s.outOfOrderPending).toEqual([]);
    const fresh = compareStatus(shipped, []);
    expect(fresh.pending).toEqual(shipped.map((f) => f.name));
    expect(fresh.outOfOrderPending).toEqual([]);
    expect(compareStatus(shipped, upgraded)).toMatchObject({ upToDate: true, outOfOrderPending: [] });
  });
});
