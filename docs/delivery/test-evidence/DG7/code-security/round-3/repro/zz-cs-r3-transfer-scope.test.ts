// code-security-reviewer DG7 round 3 reproduction (NOT part of the candidate; copied into a disposable clone as
// apps/api/test/integration/transfer/zz-cs-r3-transfer-scope.test.ts, run, then removed). SYNTHETIC data only.
// Claim under test (export/service.ts requireExportRight, import/service.ts requireImportReadRight): a grant of
// ADM_TECH at a NARROWER scope (business unit) never admits the installation-wide migration export or the migration
// import reads; ORGANIZATION scope does. Approves nothing (no G1-G6, Finance or IT approval); touches no DG0-DG7 record.
import { createDb, createPool, migrate, type Db } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, createBu, createOrg, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";

let api: TestApi;
let scratch: string;
let owner: Db;
let buTech: Session;
let orgTech: Session;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r3_scope");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 2 }));
  api = await startApi({ database: scratch });
  const org = await createOrg(api.db);
  const bu = await createBu(api.db, org.id);
  const grantor = await createUser(api.db, org.id);
  const u1 = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, u1.id, "ADM_TECH", { type: "business_unit", id: bu }, org.id);
  buTech = await signIn(api.app, u1.subject);
  const u2 = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, u2.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
  orgTech = await signIn(api.app, u2.subject);
}, 240_000);

afterAll(async () => {
  await api?.close();
  await owner?.destroy();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("CS-R3: narrower-scope ADM_TECH never reaches installation-wide transfer operations", () => {
  it("business-unit ADM_TECH: 403 on the export list and request, and on the import and rebind lists; nothing written", async () => {
    const calls: [string, string, object?][] = [
      ["GET", "/api/v1/admin/migration-exports"],
      ["POST", "/api/v1/admin/migration-exports", { reason: "Synthetic scope probe request" }],
      ["GET", "/api/v1/admin/migration-imports"],
      ["GET", "/api/v1/admin/identity-rebinds"],
    ];
    for (const [m, u, body] of calls) {
      const res = await call(api.app, m, u, { session: buTech, ...(body ? { body } : {}) });
      expect(res.status, `${m} ${u} ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(await owner.selectFrom("migration_export").select("id").execute()).toEqual([]);
  });

  it("control: organization-scope ADM_TECH reads the export and import lists (200)", async () => {
    for (const u of ["/api/v1/admin/migration-exports", "/api/v1/admin/migration-imports"]) {
      const res = await call(api.app, "GET", u, { session: orgTech });
      expect(res.status, `${u} ${JSON.stringify(res.body)}`).toBe(200);
    }
  });
});
