// Acceptance check 5 (T-DG1-BE): the audit table rejects UPDATE/DELETE/TRUNCATE (privileges AND trigger, even for
// the owner), and the separation-of-duties trigger blocks a technical admin role from any approval permission.
// Also: the seeded catalogue in the database equals packages/shared/src/permissions.ts.
import { PERMISSIONS, ROLES } from "@mth/shared";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertAuditEvent } from "../../src/audit.ts";
import { appRole, ownerRole, pgError } from "../helpers.ts";

const app = appRole();
const owner = ownerRole();
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("audit_event is append-only (ADR-0004)", () => {
  let eventId: string;
  beforeAll(async () => {
    eventId = await app.db.transaction().execute((tx) =>
      insertAuditEvent(
        tx,
        { actorType: "system", actorUserId: null, source: "cli" },
        {
          action: "test.protection",
          recordType: "test",
          recordId: uuidv7(),
          organizationId: null,
        },
      ),
    );
  });

  it("lets mth_app INSERT and SELECT", async () => {
    const { rows } = await app.pool.query("SELECT action FROM audit_event WHERE id = $1", [eventId]);
    expect(rows).toEqual([{ action: "test.protection" }]);
  });

  it.each([
    ["UPDATE", "UPDATE audit_event SET reason = 'x' WHERE id = $1"],
    ["DELETE", "DELETE FROM audit_event WHERE id = $1"],
  ])("rejects %s by mth_app (no privilege)", async (_op, sql) => {
    const err = await pgError(app.pool.query(sql, [eventId]));
    expect(err.code).toBe("42501");
    expect(err.message).toMatch(/permission denied/);
  });

  it("rejects TRUNCATE by mth_app", async () => {
    const err = await pgError(app.pool.query("TRUNCATE audit_event"));
    expect(err.code).toBe("42501");
  });

  it.each([
    ["UPDATE", "UPDATE audit_event SET reason = 'x' WHERE id = $1", [true]],
    ["DELETE", "DELETE FROM audit_event WHERE id = $1", [true]],
    ["TRUNCATE", "TRUNCATE audit_event", [false]],
  ])("rejects %s even by the owner (trigger audit_event_immutable)", async (op, sql, [withParam]) => {
    const err = await pgError(owner.pool.query(sql, withParam ? [eventId] : []));
    expect(err.message).toBe(`audit_event is append-only: ${op} is not allowed`);
    const { rows } = await owner.pool.query("SELECT count(*)::int AS n FROM audit_event WHERE id = $1", [eventId]);
    expect(rows[0].n).toBe(1);
  });

  it("enforces the version step and the user-actor rule", async () => {
    const base = [uuidv7(), "test.x", "test", uuidv7()];
    expect(
      (
        await pgError(
          app.pool.query(
            `INSERT INTO audit_event (id, action, record_type, record_id, actor_type, source, prior_version, new_version) VALUES ($1,$2,$3,$4,'system','cli',1,3)`,
            base,
          ),
        )
      ).constraint,
    ).toBe("audit_event_version_step");
    expect(
      (
        await pgError(
          app.pool.query(
            `INSERT INTO audit_event (id, action, record_type, record_id, actor_type, source) VALUES ($1,$2,$3,$4,'user','api')`,
            base,
          ),
        )
      ).constraint,
    ).toBe("audit_event_user_actor");
  });
});

describe("separation of duties: technical admins are never approvers (ADR-0006, REQ-S10-003, REQ-S06-010)", () => {
  const roleId = async (code: string) =>
    (await owner.pool.query("SELECT id FROM role WHERE code = $1", [code])).rows[0].id as string;

  it.each(["ADM_TECH", "ADM_ACCESS", "ADM_METHOD"])(
    "rejects %s + gate.decide and + finance.validate, even for the owner",
    async (code) => {
      const id = await roleId(code);
      for (const perm of ["gate.decide", "finance.validate"]) {
        const err = await pgError(
          owner.pool.query("INSERT INTO role_permission (role_id, permission_code) VALUES ($1, $2)", [id, perm]),
        );
        expect(err.constraint).toBe("role_permission_no_admin_approver");
        expect(err.message).toMatch(
          new RegExp(
            `technical administrator role ${code} cannot hold approval permission ${perm.replace(".", "\\.")}`,
          ),
        );
      }
    },
  );

  it("rejects re-classifying an approver role as technical_admin", async () => {
    const err = await pgError(owner.pool.query("UPDATE role SET kind = 'technical_admin' WHERE code = 'SP'"));
    expect(err.constraint).toBe("role_permission_no_admin_approver");
  });

  it("rejects re-classifying a permission held by a technical admin as an approval", async () => {
    const err = await pgError(
      owner.pool.query("UPDATE permission SET category = 'business_approval' WHERE code = 'user.manage'"),
    );
    expect(err.constraint).toBe("role_permission_no_admin_approver");
  });

  it("still allows approval permissions on business roles (positive case)", async () => {
    await owner.db
      .transaction()
      .execute(async (tx) => {
        await tx
          .insertInto("role_permission")
          .values({ role_id: await roleId("TL"), permission_code: "gate.decide" })
          .execute();
        // roll back: this is only a positive probe of the trigger
        throw Object.assign(new Error("rollback"), { rollback: true });
      })
      .catch((e: { rollback?: boolean }) => {
        if (!e.rollback) throw e;
      });
  });

  it("gives mth_app no way to write role_permission at all", async () => {
    const err = await pgError(
      app.pool.query("INSERT INTO role_permission (role_id, permission_code) VALUES ($1, 'role.read')", [
        await roleId("WL"),
      ]),
    );
    expect(err.code).toBe("42501");
  });
});

describe("seeded catalogue equals permissions.ts", () => {
  it("permissions", async () => {
    const { rows } = await app.pool.query("SELECT code, category FROM permission");
    expect(Object.fromEntries(rows.map((r) => [r.code, r.category]))).toEqual(PERMISSIONS);
  });

  it("roles and their permissions", async () => {
    const { rows } = await app.pool.query(
      `SELECT r.code, r.kind, r.inherits_downward, coalesce(array_agg(rp.permission_code ORDER BY rp.permission_code COLLATE "C") FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS perms
       FROM role r LEFT JOIN role_permission rp ON rp.role_id = r.id GROUP BY r.code, r.kind, r.inherits_downward`,
    );
    const actual = Object.fromEntries(
      rows.map((r) => [r.code, { kind: r.kind, inheritsDownward: r.inherits_downward, permissions: r.perms }]),
    );
    const expected = Object.fromEntries(
      Object.entries(ROLES).map(([c, d]) => [
        c,
        { kind: d.kind, inheritsDownward: d.inheritsDownward, permissions: [...d.permissions].sort() },
      ]),
    );
    expect(actual).toEqual(expected);
  });
});
