// T-C14 (ADR-0064 §6, §8, §9; p7-work-split §C.2, §C.6; REQ-S19-014 "reports equal record counts and matching attachment
// checksums"; T-DG7-BE-D): the five read-only migration-import operations on their own scratch database.
//   - ADM_TECH, ADM_ACCESS and AUD (migration_import.read) read all five; every other role and a user without grants
//     get 403 on all five, and a grant at a narrower scope than the organization admits nothing;
//   - the reconciliation report shows per-table counts and digests and every attachment mismatch;
//   - no operation writes (no route for POST/PUT/PATCH/DELETE exists under the two paths; the audit trail is unchanged
//     by the reads).
// The recorded import is SYNTHETIC (seedSyntheticImport: the CLI writes it on a real target). Reading it approves
// nothing (no G1-G6, Finance or IT approval) and touches no DG0-DG7 record.
import { createDb, createPool, type Db } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../../../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { MIGRATION_IMPORT_ROUTE_GUARDS } from "../../../src/modules/transfer/import/routes.ts";
import {
  call,
  createBu,
  createOrg,
  createUser,
  grant,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";
import { seedSyntheticImport, type SyntheticImport } from "../contract/p7-exercises-be-d.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const READERS = ["ADM_TECH", "ADM_ACCESS", "AUD"] as const;

let api: TestApi;
let scratch: string;
let owner: Db;
let seeded: SyntheticImport;
const readers: { role: string; session: Session }[] = [];
const others: { role: string; session: Session }[] = [];

const urls = () => [
  "/api/v1/admin/migration-imports",
  `/api/v1/admin/migration-imports/${seeded.importId}`,
  `/api/v1/admin/migration-imports/${seeded.importId}/reconciliations`,
  `/api/v1/admin/migration-imports/${seeded.importId}/reconciliations/${seeded.recheckRunId}`,
  "/api/v1/admin/identity-rebinds",
];

async function auditCount(): Promise<string> {
  const r = await owner
    .selectFrom("audit_event")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return String(r.n);
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_transfer_import_api");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 2 }));
  api = await startApi({ database: scratch });
  const org = await createOrg(api.db);
  const grantor = await createUser(api.db, org.id);
  seeded = await seedSyntheticImport(api.owner, api.db, org.id);
  const roles = await api.db.selectFrom("role").select("code").orderBy("code").execute();
  for (const { code } of roles) {
    const u = await createUser(api.db, org.id);
    await grant(api.db, grantor.id, u.id, code, { type: "organization", id: org.id }, org.id);
    ((READERS as readonly string[]).includes(code) ? readers : others).push({
      role: code,
      session: await signIn(api.app, u.subject),
    });
  }
  const nobody = await createUser(api.db, org.id);
  others.push({ role: "(no grant)", session: await signIn(api.app, nobody.subject) });
  // AUD at a business-unit scope: narrower than the organization, so it admits nothing.
  const buId = await createBu(api.db, org.id);
  const narrow = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, narrow.id, "AUD", { type: "business_unit", id: buId }, org.id);
  others.push({ role: "AUD @ business unit", session: await signIn(api.app, narrow.subject) });
}, 240_000);

afterAll(async () => {
  await api?.close();
  await owner?.destroy();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("T-C14: the read-only migration-import routes", () => {
  it("the guard table names migration_import.read for all five, and no write route exists", () => {
    expect(Object.values(MIGRATION_IMPORT_ROUTE_GUARDS).map((g) => [g.method, g.permission])).toEqual(
      Array.from({ length: 5 }, () => ["GET", "migration_import.read"]),
    );
    const writes = api.routes.filter(
      (r) =>
        (r.url.startsWith("/api/v1/admin/migration-imports") || r.url.startsWith("/api/v1/admin/identity-rebinds")) &&
        r.method !== "GET" &&
        r.method !== "HEAD",
    );
    expect(writes).toEqual([]);
  });

  it("ADM_TECH, ADM_ACCESS and AUD read all five; the reads write no audit event", async () => {
    expect(readers.map((r) => r.role).sort()).toEqual([...READERS].sort());
    const before = await auditCount();
    for (const { role, session } of readers)
      for (const u of urls()) {
        const res = await call<Body>(api.app, "GET", u, { session });
        expect(res.status, `${role} GET ${u}: ${JSON.stringify(res.body)}`).toBe(200);
      }
    expect(await auditCount()).toBe(before);
  });

  it("every other role, a user without grants and a narrower AUD grant get 403 on all five", async () => {
    expect(others.length).toBeGreaterThanOrEqual(10);
    for (const { role, session } of others)
      for (const u of urls()) {
        const res = await call<Body>(api.app, "GET", u, { session });
        expect(res.status, `${role} GET ${u}`).toBe(403);
        expect(res.body.code).toBe("forbidden");
      }
  });

  it("the reconciliation report shows per-table counts and digests and the attachment mismatches", async () => {
    const session = readers.find((r) => r.role === "AUD")!.session;
    const res = await call<Body>(
      api.app,
      "GET",
      `/api/v1/admin/migration-imports/${seeded.importId}/reconciliations/${seeded.recheckRunId}`,
      { session },
    );
    expect(res.body.summary).toMatchObject({
      runKind: "recheck",
      result: "mismatched",
      tablesChecked: 2,
      tablesMismatched: 1,
      rowsExpected: "7",
      rowsActual: "6",
      attachmentsChecked: 1,
      attachmentsMismatched: 1,
    });
    expect(res.body.tables).toEqual([
      expect.objectContaining({ tableName: "app_user", expectedRows: "6", actualRows: "5", matched: false }),
      expect.objectContaining({ tableName: "organization", expectedRows: "1", actualRows: "1", matched: true }),
    ]);
    for (const t of res.body.tables) {
      expect(t.expectedDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(t.actualDigest).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(res.body.attachmentMismatches).toEqual([
      {
        parentTable: "evidence_content",
        objectName: "synthetic/object-1",
        problem: "sha256_mismatch",
        expectedSize: "11",
        actualSize: "11",
        expectedSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        actualSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    // The import's own run matched.
    const first = await call<Body>(
      api.app,
      "GET",
      `/api/v1/admin/migration-imports/${seeded.importId}/reconciliations/${seeded.importRunId}`,
      { session },
    );
    expect(first.body.summary.result).toBe("matched");
    expect(first.body.attachmentMismatches).toEqual([]);
  });

  it("a reconciliation of another import is 404; the identity list shows the carried and the new pair", async () => {
    const session = readers.find((r) => r.role === "ADM_ACCESS")!.session;
    const wrong = await call<Body>(
      api.app,
      "GET",
      `/api/v1/admin/migration-imports/${seeded.recheckRunId}/reconciliations/${seeded.recheckRunId}`,
      { session },
    );
    expect(wrong.status).toBe(404);
    const holds = await call<Body>(api.app, "GET", "/api/v1/admin/identity-rebinds?state=rebound", { session });
    expect(holds.body.items).toEqual([
      expect.objectContaining({
        id: seeded.rebound.holdId,
        state: "rebound",
        issuer: "https://synthetic-old-idp.invalid",
        newIssuer: "https://synthetic-new-idp.invalid",
        version: 2,
      }),
    ]);
  });
});
