// P6 slices E and F (T-DG6-BE-A; p6-work-split §E/F.1): the platform/db-errors.ts P6 mappings, proven against the
// real 0098/0099 guards. Each probe runs as mth_app (the server's role) inside one transaction that is rolled back, so
// nothing is written; the driver's actual error (SQLSTATE and constraint name, as PostgreSQL raises it) goes through
// mapDatabaseGuardError, the function the error hook calls. All data is synthetic.
import { v7 as uuidv7 } from "uuid";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mapDatabaseGuardError } from "../../src/modules/platform/db-errors.ts";
import {
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../support/harness.ts";

let api: TestApi;
let w: World;
let appPool: pg.Pool;
let transformationId: string;
let evidenceId: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  appPool = new pg.Pool({ connectionString: inject("mthDb").appUrl, max: 1, application_name: "p6-guard-mapping" });
  transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const office = await signIn(api.app, w.office.subject);
  const created = await call<{ id: string }>(api.app, "POST", `/api/v1/transformations/${transformationId}/evidence`, {
    session: office,
    body: { kind: "file", title: "Synthetic guard-mapping evidence", ownerUserId: w.office.id },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  evidenceId = created.body.id;
});
afterAll(async () => {
  await appPool?.end();
  await api?.close();
});

/** Runs `statements` in order inside a savepoint of a rolled-back transaction; returns the last statement's error. */
async function guardError(statements: ReadonlyArray<{ text: string; values: unknown[] }>) {
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    let caught: (Error & { code?: string; constraint?: string }) | undefined;
    for (const s of statements) {
      try {
        await client.query(s.text, s.values);
      } catch (e) {
        caught = e as Error & { code?: string; constraint?: string };
        break;
      }
    }
    return caught;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

const sensitivity = (recordId: string) => ({
  text: `INSERT INTO record_sensitivity (id, organization_id, transformation_id, record_type, record_id, is_sensitive,
           reason, created_by, updated_by) VALUES ($1, $2, $3, 'evidence', $4, true, 'Synthetic reason', $5, $5)`,
  values: [uuidv7(), w.orgA.id, transformationId, recordId, w.office.id],
});
const grantRow = (recordId: string, grantee: string, status = "active") => ({
  text: `INSERT INTO sensitive_record_grant (id, organization_id, transformation_id, record_type, record_id,
           grantee_user_id, reason, status, created_by, updated_by)
         VALUES ($1, $2, $3, 'evidence', $4, $5, 'Synthetic reason', $6, $7, $7)`,
  values: [uuidv7(), w.orgA.id, transformationId, recordId, grantee, status, w.office.id],
});
const policy = (allowedTypes: string[], maxBytes: number) => ({
  text: `INSERT INTO upload_policy (id, organization_id, allowed_types, max_bytes, reason, created_by, updated_by)
         VALUES ($1, $2, $3::text[], $4, 'Synthetic reason', $5, $5)`,
  values: [uuidv7(), w.orgA.id, allowedTypes, maxBytes, w.admin.id],
});

function expectMapped(
  err: (Error & { code?: string; constraint?: string }) | undefined,
  constraint: string,
  expected: { status: number; code: string; detail?: string },
) {
  expect(err, `the guard ${constraint} fired`).toBeDefined();
  expect(err!.constraint).toBe(constraint);
  const body = mapDatabaseGuardError(err!)?.toBody("req-p6");
  expect(body).toMatchObject(expected);
}

describe("P6 guard mappings against the real 0098/0099 guards (mth_app; rolled back)", () => {
  it("a record that does not exist in the transformation -> 404 not_found (both tables)", async () => {
    expectMapped(await guardError([sensitivity(uuidv7())]), "record_sensitivity_record_ref", {
      status: 404,
      code: "not_found",
    });
    expectMapped(await guardError([grantRow(uuidv7(), w.leadA1.id)]), "sensitive_record_grant_record_ref", {
      status: 404,
      code: "not_found",
    });
  });

  it('a second sensitivity row for the same record (concurrent If-Match "0" create) -> 409 version_conflict', async () => {
    expectMapped(
      await guardError([sensitivity(evidenceId), sensitivity(evidenceId)]),
      "record_sensitivity_record_key",
      {
        status: 409,
        code: "version_conflict",
      },
    );
  });

  it("a second active grant for the same record and grantee -> 409 sensitive_grant.duplicate", async () => {
    expectMapped(
      await guardError([grantRow(evidenceId, w.leadA1.id), grantRow(evidenceId, w.leadA1.id)]),
      "sensitive_record_grant_one_active_key",
      {
        status: 409,
        code: "sensitive_grant.duplicate",
        detail: "This person already has an active grant for this record.",
      },
    );
  });

  it("a grant to oneself -> 422 sensitive_grant.not_self", async () => {
    expectMapped(await guardError([grantRow(evidenceId, w.office.id)]), "sensitive_record_grant_not_self", {
      status: 422,
      code: "sensitive_grant.not_self",
      detail: "You cannot grant access to yourself.",
    });
  });

  it("a grant that does not start active -> 422 invalid_transition", async () => {
    expectMapped(
      await guardError([grantRow(evidenceId, w.leadA1.id, "revoked")]),
      "sensitive_record_grant_transition",
      {
        status: 422,
        code: "invalid_transition",
        detail: "Only an active grant can be revoked.",
      },
    );
  });

  it("upload policy: a second row of one organization -> 409; a bad type list or size -> 400 validation", async () => {
    expectMapped(await guardError([policy(["pdf"], 1000), policy(["png"], 1000)]), "upload_policy_organization_key", {
      status: 409,
      code: "version_conflict",
    });
    expectMapped(await guardError([policy(["exe"], 1000)]), "upload_policy_allowed_types", {
      status: 400,
      code: "validation",
    });
    expectMapped(await guardError([policy(["pdf"], 26214401)]), "upload_policy_max_bytes", {
      status: 400,
      code: "validation",
    });
  });
});
