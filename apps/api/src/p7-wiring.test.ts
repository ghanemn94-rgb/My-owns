// The P7 permission wiring (T-DG7-BE-A; p7-plan §5.1 BE-A "the P7 permission wiring"). Unit test without a database
// (pg connects lazily, as in server.test.ts). It pins three things:
//  1. every P7 permission code (P7_PERMISSIONS, packages/shared/src/permissions.ts) is the guard of at least one P7
//     route, and no P7 guard uses any other code, so no P7 code is unreachable and none is invented;
//  2. every guard row names a contract operation with the same method and path, and the permission the contract's
//     summary states for it (docs/api/openapi.yaml, tags `transfer` and `retention`);
//  3. a guarded operation is either not routed yet (it is then in its owner's p7-pending-<task>.ts list, which the
//     contract test enforces) or routed with exactly its guard's permission: a filled stub cannot drift from the table.
// getDeploymentStatus (P7 slice B) is guarded by the P6 code operations.read in platform/deployment.ts (BE-B; D-250 O1)
// and so is not a P7 permission row. The release module's operations are not in the contract yet (T-DG7-ARCH-05).
import { readFileSync } from "node:fs";
import { loadConfig } from "@mth/config";
import { createPool } from "@mth/db";
import { P7_PERMISSIONS } from "@mth/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { RETENTION_ROUTE_GUARDS } from "./modules/retention/index.ts";
import { TRANSFER_ROUTE_GUARDS } from "./modules/transfer/index.ts";
import { buildServer } from "./server.ts";

const GUARDS: Readonly<Record<string, { method: string; path: string; permission: string }>> = {
  ...TRANSFER_ROUTE_GUARDS,
  ...RETENTION_ROUTE_GUARDS,
};

interface ContractOperation {
  operationId?: string;
  summary?: string;
  tags?: string[];
}

function contractOperations(): Map<string, { method: string; path: string; summary: string; tags: string[] }> {
  const doc = parse(readFileSync(new URL("../../../docs/api/openapi.yaml", import.meta.url), "utf8")) as {
    paths: Record<string, Record<string, ContractOperation>>;
  };
  const out = new Map<string, { method: string; path: string; summary: string; tags: string[] }>();
  for (const [path, item] of Object.entries(doc.paths))
    for (const [method, op] of Object.entries(item))
      if (op && typeof op === "object" && typeof op.operationId === "string")
        out.set(op.operationId, {
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? "",
          tags: op.tags ?? [],
        });
  return out;
}

describe("P7 permission wiring (T-DG7-BE-A)", () => {
  it("every P7 permission code guards at least one P7 route, and the P7 guards use no other code", () => {
    expect([...new Set(Object.values(GUARDS).map((g) => g.permission))].sort()).toEqual(
      Object.keys(P7_PERMISSIONS).sort(),
    );
  });

  it("every guard row is a contract operation with the same method, path and stated permission", () => {
    const contract = contractOperations();
    for (const [operationId, guard] of Object.entries(GUARDS)) {
      const op = contract.get(operationId);
      expect(op, operationId).toBeDefined();
      expect(op!.method, operationId).toBe(guard.method);
      expect(op!.path, operationId).toBe(guard.path.replace(/:([A-Za-z]+)/g, "{$1}"));
      // The contract states the guard as an item of a parenthesis in the summary, e.g. "(retention.read; ADM_TECH, AUD)"
      // or "(attachment; ETag = its SHA-256; config_bundle.export)".
      const code = guard.permission.replace(/\./g, "\\.");
      expect(op!.summary, operationId).toMatch(new RegExp(`\\((?:[^()]*; )?${code}(?:[;)]| plus )`));
    }
    // And the other way round: every transfer or retention operation of the contract has its guard row.
    const tagged = [...contract]
      .filter(([, op]) => op.tags.includes("transfer") || op.tags.includes("retention"))
      .map(([id]) => id)
      .sort();
    expect(tagged).toEqual(Object.keys(GUARDS).sort());
  });

  it("a guarded operation is not routed yet, or routed with exactly its guard's permission", async () => {
    const config = loadConfig("api", {
      NODE_ENV: "test",
      APP_BASE_URL: "http://localhost:3000",
      DATABASE_URL: "postgresql://mth_app@127.0.0.1:1/none",
      AUTH_MODE: "dev",
    });
    const pool = createPool(config.databaseUrl!);
    try {
      const { app, routes } = await buildServer({ config, pool, logger: false, webRoot: null });
      await app.close();
      for (const [operationId, guard] of Object.entries(GUARDS)) {
        const route = routes.find((r) => r.method === guard.method && r.url === guard.path);
        if (route) expect(route.access, operationId).toEqual({ permission: guard.permission });
      }
    } finally {
      await pool.end();
    }
  });
});
