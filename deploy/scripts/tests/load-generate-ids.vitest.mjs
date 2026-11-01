// The load-dataset generator's ids are RFC 9562 UUIDs that the API accepts (F-DG6-101 / F-DG6-142; T-DG6-DO-Y1).
// Runs in `pnpm test` (Vitest project unit-node, through the deploy/scripts/tests/**/*.vitest.mjs include). No database,
// no network: it imports deploy/load/generate.mjs (whose top level only resolves `pg`, never connects) and validates
// the ids with the API's own validator, zod's `z.uuid()`, resolved from apps/api's dependency (no new dependency).
//
// Before the fix, `loadId` returned md5(key) laid out as a UUID without the version and variant bits: 865 of the first
// 1,000 initiative ids failed `z.uuid()` (domain reviewer's probe), and the API answered 400 for them.
// The pinned ids are the ones the measured DO-G/DO-H load runs used (they appear in
// docs/delivery/handbacks/DG6/T-DG6-DO-H-evidence/rep-1/export-proof.json and in DO-F's run-1 EXPLAIN digest), so the
// shipped generator reproduces that dataset's ids.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { DATASET_CODE, DEFAULT_SEED, loadId, plannedCounts, rfcUuidFromMd5Hex } from "../../load/generate.mjs";

const { z } = createRequire(new URL("../../../apps/api/package.json", import.meta.url))("zod");
const apiUuid = z.uuid();
const RFC_9562 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Every (kind, ordinal) the `default` profile asks loadId for, with generous upper bounds per kind. */
function defaultProfileKeys() {
  const c = plannedCounts("default");
  const upTo = (kind, n, from = 1) => Array.from({ length: n - from + 1 }, (_, i) => [kind, from + i]);
  return [
    ...upTo("organization", 1),
    ...upTo("business_unit", 6),
    ...upTo("app_user", c.users),
    ...upTo("user_identity", c.users),
    ...upTo("scoped_assignment", 2000),
    ...upTo("transformation", c.transformations),
    ...upTo("forms_pin", c.transformations),
    ...upTo("initiative", c.initiatives, 0),
    ...upTo("reporting_period", 20),
    ...upTo("kpi_definition", 500),
    ...upTo("kpi_version", 500),
    ...upTo("kpi_actual", c.kpiActuals),
    ...upTo("kpi_actual_value", c.kpiActuals),
    ...upTo("kpi_actual_review", c.kpiActuals),
    ...upTo("outbox_event", 1),
    ...upTo("audit", 20000, 0),
  ];
}

describe("deploy/load/generate.mjs ids (F-DG6-101, F-DG6-142)", () => {
  it("every id loadId gives for the default profile passes the API's z.uuid() and the RFC 9562 layout, without collision", () => {
    const keys = defaultProfileKeys();
    const ids = keys.map(([kind, n]) => loadId(DEFAULT_SEED, kind, n));
    const rejected = ids.filter((id) => !apiUuid.safeParse(id).success);
    const nonRfc = ids.filter((id) => !RFC_9562.test(id));
    expect({ rejected: rejected.length, nonRfc: nonRfc.length, sample: rejected.slice(0, 3) }).toEqual({
      rejected: 0,
      nonRfc: 0,
      sample: [],
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(50_000);
  });

  it("the domain reviewer's probe: loadId(1, 'initiative', 0..999) -> 0 rejected by z.uuid()", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => loadId(1, "initiative", i));
    expect(ids.filter((x) => !apiUuid.safeParse(x).success)).toHaveLength(0);
    expect(ids.filter((x) => !RFC_9562.test(x))).toHaveLength(0);
  });

  it("is deterministic: md5(dataset:seed:kind:n) with only the version nibble (3) and the two variant bits set", () => {
    for (const [kind, n] of [
      ["initiative", 0],
      ["kpi_actual", 9999],
      ["audit", 12345],
    ]) {
      const h = createHash("md5").update(`${DATASET_CODE}:${DEFAULT_SEED}:${kind}:${n}`, "utf8").digest("hex");
      const id = loadId(DEFAULT_SEED, kind, n);
      expect(id).toBe(loadId(DEFAULT_SEED, kind, n));
      expect(id).toBe(rfcUuidFromMd5Hex(h));
      const hex = id.replaceAll("-", "");
      expect(hex[12]).toBe("3");
      expect(["8", "9", "a", "b"]).toContain(hex[16]);
      expect(parseInt(hex[16], 16) & 0x3).toBe(parseInt(h[16], 16) & 0x3);
      // Every other nibble is the md5's.
      expect(hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17)).toBe(h.slice(0, 12) + h.slice(13, 16) + h.slice(17));
    }
  });

  it("reproduces the ids of the measured DO-G/DO-H dataset (seed 20261027)", () => {
    expect(DEFAULT_SEED).toBe(20261027);
    // The organization (DO-F run-1 EXPLAIN digest), LOAD-T01 and its first TL (DO-H export-proof.json, every rep).
    expect(loadId(DEFAULT_SEED, "organization", 1)).toBe("d044310c-e30f-34b1-91b4-8c86cfb1c8fc");
    expect(loadId(DEFAULT_SEED, "transformation", 1)).toBe("e2b51ceb-1ff1-38e9-a507-296ec2b67e13");
    expect(loadId(DEFAULT_SEED, "app_user", 1)).toBe("3e23f9e4-d64e-396c-8562-938142305301");
  });
});
