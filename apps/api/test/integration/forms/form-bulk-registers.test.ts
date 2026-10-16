// The forms bulk edit through the module-owned register cores (T-DG5-BE-E3; D-159 a; ADR-0041 §5; p5-work-split §B.4)
// against a real PostgreSQL. RAID (T15), design decisions (T04), executive decisions (T16), initiatives (T05),
// stakeholder groups (T13) and benefits (T14) export their PATCH core through their module's index.ts; the composition
// root passes each into the forms bulk map (forms imports none of these modules under ADR-0002). A bulk item then goes
// through the owning module's own authorization, validation, optimistic concurrency and audit event:
//  - bulk edit of owners on 3 T15 records commits all, with one raid_entry.update audit event each and every version
//    incremented;
//  - a stale version on one of the 3 gives the recoverable 409 form_record.bulk_conflict listing that record only,
//    and none of the 3 is written (the BE-E2 all-or-nothing semantics);
//  - the same for one T04, T16, T05, T13 and T14 field each;
//  - the owning module's own rules still apply (a T16 owner who cannot decide executive asks is refused, nothing
//    written), the T04/T16 discriminator holds (a T16 record is not a T04 record: 404), AUD gets 403 on every one.
// All data is synthetic; a bulk edit approves nothing (no G1-G6 business approval) and touches no engineering gate
// DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOfRequest,
  call,
  seedWorld,
  startApi,
  type Res,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { benefitAt, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { businessToday, plusDays } from "../governance/meeting-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let today: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const codeOf = (r: Res<Body>) => [r.status, r.body?.code];
const reqId = (r: Res) => r.headers["x-request-id"] as string;
const bulkUrl = (rt: string) => `/api/v1/transformations/${b.transformationId}/form-records/${rt}/bulk`;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  today = await businessToday(api);
}, 90_000);
afterAll(() => api?.close());

/** One register of the bulk map: how its records are created, which form field the bulk edit sets, and its column. */
interface Register {
  readonly rt: string;
  readonly table: "raid_entry" | "decision" | "initiative" | "stakeholder_group" | "benefit";
  readonly action: string; // the owning module's PATCH audit action
  readonly writer: () => BenefitWorld["s"]["tl"];
  readonly create: (i: number) => Promise<{ id: string; version: number }>;
  readonly field: string; // the form field key (form_source_field.field_key, bulk_editable)
  readonly column: string; // its column in the register's own table
  readonly from: () => unknown; // the value at creation
  readonly to: () => unknown; // the value the bulk edit sets
}

async function created(r: Res<Body>): Promise<{ id: string; version: number }> {
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.id as string, version: r.body.version as number };
}

const REGISTERS: readonly Register[] = [
  {
    rt: "T15",
    table: "raid_entry",
    action: "raid_entry.update",
    writer: () => b.s.tl,
    create: async (i) =>
      created(
        await call<Body>(api.app, "POST", `${b.base}/raid`, {
          session: b.s.tl,
          body: {
            type: "risk",
            description: `Synthetic risk ${i}`,
            impact: "low",
            probability: "low",
            ownerUserId: b.users.bo.id,
          },
        }),
      ),
    field: "owner",
    column: "owner_user_id",
    from: () => b.users.bo.id,
    to: () => b.users.bo2.id,
  },
  {
    rt: "T04",
    table: "decision",
    action: "decision.update",
    writer: () => b.s.tl,
    create: async (i) =>
      created(
        await call<Body>(api.app, "POST", "/api/v1/decisions", {
          session: b.s.tl,
          body: { transformationId: b.transformationId, title: `Synthetic design decision ${i}` },
        }),
      ),
    field: "due_date",
    column: "due_date",
    from: () => null,
    to: () => plusDays(today, 20),
  },
  {
    rt: "T16",
    table: "decision",
    action: "executive_decision.update",
    writer: () => b.s.tl,
    create: async (i) =>
      created(
        await call<Body>(api.app, "POST", `${b.base}/executive-decisions`, {
          session: b.s.tl,
          body: {
            title: `Synthetic: approve the vendor switch ${i}`,
            whyNow: "Synthetic: the contract renewal window closes this month",
            options: [{ title: "Switch vendor" }, { title: "Renew the current contract" }],
            recommendation: "A",
            impactOfDelay: "Synthetic: a further quarter on the current terms",
            ownerUserId: b.users.bo.id,
            requiredDate: plusDays(today, 10),
          },
        }),
      ),
    field: "owner",
    column: "owner_user_id",
    from: () => b.users.bo.id,
    to: () => b.users.bo2.id,
  },
  {
    rt: "T05",
    table: "initiative",
    action: "initiative.update",
    writer: () => b.s.tl,
    create: async (i) =>
      created(
        await call<Body>(api.app, "POST", "/api/v1/initiatives", {
          session: b.s.tl,
          body: { transformationId: b.transformationId, name: `Synthetic initiative E3-${i}` },
        }),
      ),
    field: "workstream_lead",
    column: "workstream_lead_user_id",
    from: () => null,
    to: () => b.users.tl.id,
  },
  {
    rt: "T13",
    table: "stakeholder_group",
    action: "stakeholder_group.update",
    writer: () => b.s.tl,
    create: async (i) =>
      created(
        await call<Body>(api.app, "POST", `${b.base}/stakeholder-groups`, {
          session: b.s.tl,
          body: {
            name: `Synthetic stakeholder group ${i}`,
            impact: "M",
            currentStance: "neutral",
            requiredBehavior: "Synthetic: use the new workflow",
            interventionTypes: ["involvement"],
            ownerUserId: b.users.bo.id,
          },
        }),
      ),
    field: "current_stance",
    column: "current_stance",
    from: () => "neutral",
    to: () => "support",
  },
  {
    rt: "T14",
    table: "benefit",
    action: "benefit.update",
    writer: () => b.s.bo,
    create: async () => {
      const x = await benefitAt(api, b, "identify");
      return { id: x.id, version: x.version };
    },
    field: "owner",
    column: "owner_user_id",
    from: () => undefined, // whatever the fixture set; read back before the edit
    to: () => b.users.bo2.id,
  },
];

/** The column and version of each record, read straight from the register's own table, in the given order. */
async function rowsOf(table: Register["table"], column: string, ids: readonly string[]) {
  const r = await api.db
    .selectFrom(table as "raid_entry")
    .select(["id", "version", `${column} as value` as "id"])
    .where("id", "in", [...ids])
    .execute();
  const byId = new Map(r.map((x) => [x.id as string, x as unknown as { version: number; value: unknown }]));
  return ids.map((id) => {
    const row = byId.get(id)!;
    const value = row.value instanceof Date ? row.value.toISOString().slice(0, 10) : row.value;
    return { id, version: row.version, value };
  });
}

describe("bulk edit through the module-owned register cores (D-159 a; REQ-S05-001)", () => {
  for (const reg of REGISTERS) {
    const count = reg.rt === "T15" ? 3 : 2;
    const subject =
      reg.rt === "T15" ? `owners on ${count} T15 records` : `${reg.rt} \`${reg.field}\` on ${count} records`;
    let records: { id: string; version: number }[] = [];
    const bulk = (items: readonly { recordId: string; version: number }[]) =>
      call<Body>(api.app, "POST", bulkUrl(reg.rt), {
        session: reg.writer(),
        body: { items: items.map((x) => ({ ...x, sourceFields: { [reg.field]: reg.to() } })) },
      });

    describe(reg.rt, () => {
      beforeAll(async () => {
        records = [];
        for (let i = 0; i < count; i++) records.push(await reg.create(i));
      }, 60_000);

      it(`a stale version on one of ${subject}: the recoverable 409 lists that record only; none is written`, async () => {
        const before = await rowsOf(
          reg.table,
          reg.column,
          records.map((r) => r.id),
        );
        const fresh = reg.from();
        if (fresh !== undefined) expect(before.map((x) => x.value)).toEqual(records.map(() => fresh));
        const r = await bulk(records.map((x, i) => ({ recordId: x.id, version: i === 1 ? x.version + 5 : x.version })));
        expect([r.status, r.body.code, r.body.detail]).toEqual([
          409,
          "form_record.bulk_conflict",
          "One of the selected records changed. Nothing was saved; reload and try again.",
        ]);
        expect(r.body.errors).toEqual([
          {
            pointer: "/items/1/version",
            code: "form_record.bulk_conflict",
            message: `Record ${records[1]!.id} is at version ${records[1]!.version}.`,
          },
        ]);
        expect(
          await rowsOf(
            reg.table,
            reg.column,
            records.map((x) => x.id),
          ),
        ).toEqual(before);
        expect(await auditOfRequest(api.db, reqId(r))).toEqual([]);
      });

      it(`${subject}: all committed through the module's own update, one ${reg.action} audit event each, versions + 1`, async () => {
        const r = await bulk(records.map((x) => ({ recordId: x.id, version: x.version })));
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.body.items).toEqual(records.map((x) => ({ recordId: x.id, version: x.version + 1 })));
        const after = await rowsOf(
          reg.table,
          reg.column,
          records.map((x) => x.id),
        );
        expect(after).toEqual(records.map((x) => ({ id: x.id, version: x.version + 1, value: reg.to() })));
        // One audit event of the register's own record per record, from its version to version + 1. Follow-up writes
        // of the owning module (a T16 owner's My Work item) are other records' events and are not counted here.
        const audits = (await auditOfRequest(api.db, reqId(r))).filter((a) => a.record_type === reg.table);
        expect(audits.map((a) => [a.action, a.record_id, a.prior_version, a.new_version]).sort()).toEqual(
          records.map((x) => [reg.action, x.id, x.version, x.version + 1]).sort(),
        );
        records = after.map((x) => ({ id: x.id, version: x.version }));
      });

      it(`AUD gets 403 on the ${reg.rt} bulk edit and nothing is written`, async () => {
        const before = await rowsOf(
          reg.table,
          reg.column,
          records.map((x) => x.id),
        );
        const r = await call<Body>(api.app, "POST", bulkUrl(reg.rt), {
          session: b.s.auditor,
          body: {
            items: records.map((x) => ({ recordId: x.id, version: x.version, sourceFields: { [reg.field]: null } })),
          },
        });
        expect(r.status).toBe(403);
        expect(
          await rowsOf(
            reg.table,
            reg.column,
            records.map((x) => x.id),
          ),
        ).toEqual(before);
      });
    });
  }

  it("the owning module's own rules apply: a T16 owner who cannot decide executive asks is refused, nothing written", async () => {
    const t16 = REGISTERS.find((r) => r.rt === "T16")!;
    const a = await t16.create(90);
    const c = await t16.create(91);
    const before = await rowsOf("decision", "owner_user_id", [a.id, c.id]);
    const r = await call<Body>(api.app, "POST", bulkUrl("T16"), {
      session: b.s.tl,
      body: {
        items: [
          { recordId: a.id, version: a.version, sourceFields: { owner: b.users.bo2.id } },
          // The TL raises asks but does not hold executive_decision.decide: T16's own check refuses this item.
          { recordId: c.id, version: c.version, sourceFields: { owner: b.users.tl.id } },
        ],
      },
    });
    expect(codeOf(r)).toEqual([422, "executive_decision.owner_not_executive"]);
    expect(await rowsOf("decision", "owner_user_id", [a.id, c.id])).toEqual(before); // the first item rolled back
    expect(await auditOfRequest(api.db, reqId(r))).toEqual([]);
  });

  it("the T04/T16 discriminator holds: a T16 record is not a T04 record (404), and nothing is written", async () => {
    const t16 = REGISTERS.find((r) => r.rt === "T16")!;
    const a = await t16.create(92);
    const r = await call<Body>(api.app, "POST", bulkUrl("T04"), {
      session: b.s.tl,
      body: { items: [{ recordId: a.id, version: a.version, sourceFields: { decision_owner: b.users.bo2.id } }] },
    });
    expect(r.status).toBe(404);
    expect(await rowsOf("decision", "owner_user_id", [a.id])).toEqual([
      { id: a.id, version: a.version, value: b.users.bo.id },
    ]);
  });

  it("a field the form does not mark bulk-editable is still refused on a module-owned register (T15 description)", async () => {
    const t15 = REGISTERS.find((r) => r.rt === "T15")!;
    const a = await t15.create(93);
    const r = await call<Body>(api.app, "POST", bulkUrl("T15"), {
      session: b.s.tl,
      body: { items: [{ recordId: a.id, version: a.version, sourceFields: { description: "Synthetic" } }] },
    });
    expect(codeOf(r)).toEqual([422, "form_record.bulk_field_not_editable"]);
  });
});
