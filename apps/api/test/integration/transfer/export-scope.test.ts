// F-DG7-940 (REQ-S19-016; ADR-0064 §7; p7-work-split §C.1; T-C6; T-DG7-BE-R8): the organization-scope rule of the
// installation-wide migration export. requireExportRight (export/service.ts) admits a principal only where it holds
// migration.export at ORGANIZATION scope. A grant of ADM_TECH at a narrower scope (a business unit, a transformation)
// never admits any of the five migration-export operations:
//   - 403 on list, create (with and without an Idempotency-Key), get, manifest and attachment-manifest;
//   - no migration_export row, no outbox event and no audit event is written by those principals;
//   - control: ADM_TECH at organization scope reads the same export (200), so each 403 is the scope rule and not a
//     missing record or an unready package.
// Removing the scoped authorize() call from requireExportRight makes this file fail (mutant M4 of the round-3 review;
// the kill is recorded in docs/delivery/handbacks/DG7/T-DG7-BE-R8-evidence/).
// Every value is SYNTHETIC. An export approves nothing (no G1-G6, Finance or IT approval) and touches no DG0-DG7 record.
import { createDb, createPool, migrate, type Db } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { runMigrationExport, storeDeps } from "../../../../worker/src/handlers/transfer/export.ts";
import {
  call,
  createBu,
  createOrg,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const BASE = "/api/v1/admin/migration-exports";

let api: TestApi;
let scratch: string;
let owner: Db;
let orgTech: Session;
let exportId: string;
const narrow: { scope: string; userId: string; session: Session }[] = [];

async function exportIds(): Promise<string[]> {
  return (await owner.selectFrom("migration_export").select("id").orderBy("id").execute()).map((r) => r.id);
}

/** Audit actions written by these principals, oldest first. Signing in writes `session.create` (not an export event). */
async function auditBy(userIds: string[]): Promise<string[]> {
  const rows = await owner
    .selectFrom("audit_event")
    .select(["action", "seq"])
    .where("actor_user_id", "in", userIds)
    .orderBy("seq")
    .execute();
  return rows.map((r) => r.action);
}

async function exportAudit(): Promise<string[]> {
  const rows = await owner
    .selectFrom("audit_event")
    .select(["action", "seq"])
    .where("action", "like", "migration_export.%")
    .orderBy("seq")
    .execute();
  return rows.map((r) => r.action);
}

async function exportOutbox(): Promise<string[]> {
  const rows = await owner
    .selectFrom("outbox_event")
    .select("aggregate_id")
    .where("event_type", "like", "migration_export.%")
    .execute();
  return rows.map((r) => r.aggregate_id);
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_transfer_export_scope");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 2 }));
  api = await startApi({ database: scratch });
  const org = await createOrg(api.db);
  const bu = await createBu(api.db, org.id);
  const grantor = await createUser(api.db, org.id);
  const transformation = await createTransformationRow(api.db, org.id, bu, grantor.id);

  const tech = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, tech.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
  orgTech = await signIn(api.app, tech.subject);

  const scopes = [
    { type: "business_unit", id: bu },
    { type: "transformation", id: transformation },
  ] as const;
  for (const scope of scopes) {
    const u = await createUser(api.db, org.id);
    await grant(api.db, grantor.id, u.id, "ADM_TECH", scope, org.id);
    narrow.push({ scope: `ADM_TECH @ ${scope.type}`, userId: u.id, session: await signIn(api.app, u.subject) });
  }

  // One succeeded export, requested by the organization-scope ADM_TECH, so get and both manifests have a ready target.
  const created = await call<Body>(api.app, "POST", BASE, {
    session: orgTech,
    body: { reason: "Synthetic scope fixture export" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(202);
  exportId = created.body.id;
  const outcome = await runMigrationExport(
    api.db,
    exportId,
    "job-f940-1",
    storeDeps(() => api.config.evidenceStorage.path),
  );
  expect(outcome).toMatchObject({ outcome: "succeeded" });
}, 240_000);

afterAll(async () => {
  await api?.close();
  await owner?.destroy();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("F-DG7-940: a narrower-scope ADM_TECH never reaches the installation-wide migration export", () => {
  it("control: ADM_TECH at organization scope reads the list, the export and both manifests (200)", async () => {
    for (const u of [
      BASE,
      `${BASE}/${exportId}`,
      `${BASE}/${exportId}/manifest`,
      `${BASE}/${exportId}/attachment-manifest`,
    ]) {
      const res = await call<Body>(api.app, "GET", u, { session: orgTech });
      expect(res.status, `${u} ${JSON.stringify(res.body)}`).toBe(200);
    }
    expect(await exportIds()).toEqual([exportId]);
    expect(await exportAudit()).toEqual([
      "migration_export.requested",
      "migration_export.started",
      "migration_export.succeeded",
    ]);
  });

  for (const scope of ["business_unit", "transformation"]) {
    it(`ADM_TECH @ ${scope}: 403 on all five operations; no migration_export row, outbox event or audit event`, async () => {
      const who = narrow.find((n) => n.scope === `ADM_TECH @ ${scope}`)!;
      // The principal's trail before the calls: only its sign-in.
      expect(await auditBy([who.userId])).toEqual(["session.create"]);
      const calls: [string, string, Parameters<typeof call>[3]][] = [
        ["GET", BASE, {}],
        ["POST", BASE, { body: { reason: "Synthetic narrower-scope request" } }],
        [
          "POST",
          BASE,
          {
            body: { reason: "Synthetic narrower-scope replay" },
            headers: { "idempotency-key": `synthetic-f940-${scope}` },
          },
        ],
        ["GET", `${BASE}/${exportId}`, {}],
        ["GET", `${BASE}/${exportId}/manifest`, {}],
        ["GET", `${BASE}/${exportId}/attachment-manifest`, {}],
      ];
      // Every outcome is collected first, so a regression names each operation it opens, not only the first.
      const seen: string[] = [];
      for (const [m, u, o] of calls) {
        const res = await call<Body>(api.app, m, u, { ...o, session: who.session });
        // A refusal never names the export (the list, get and manifests would).
        const leaks = JSON.stringify(res.body ?? null).includes(exportId) ? " (body names the export)" : "";
        seen.push(`${m} ${u} -> ${res.status}${leaks}`);
      }
      expect(seen, who.scope).toEqual(calls.map(([m, u]) => `${m} ${u} -> 403`));
      expect(await exportIds()).toEqual([exportId]);
      expect(await exportOutbox()).toEqual([exportId]);
      // Nothing new: no export event and no authorization.denied (the scope refusal carries no denial target).
      expect(await auditBy([who.userId])).toEqual(["session.create"]);
      expect(await exportAudit()).toEqual([
        "migration_export.requested",
        "migration_export.started",
        "migration_export.succeeded",
      ]);
    });
  }

  it("neither narrower-scope principal wrote anything to the audit trail but its own sign-in", async () => {
    expect(narrow.map((n) => n.scope)).toEqual(["ADM_TECH @ business_unit", "ADM_TECH @ transformation"]);
    expect(await auditBy(narrow.map((n) => n.userId))).toEqual(["session.create", "session.create"]);
  });
});
