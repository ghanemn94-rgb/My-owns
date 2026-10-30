// compareFormRecordVersions `GET /transformations/{t}/form-records/{recordType}/{recordId}/compare` (ADR-0057 §7, §10,
// §11; REQ-S15-010 "record comparison"; REQ-S16-026; p6-work-split §H/G.4, T-DG6-BE-Q2) against a real PostgreSQL:
//  - versions 1 -> 3 of an initiative (T05) fold two PATCHes per field: the first `from`, the last `to`; fields changed
//    and changed back are not listed; a composite field carries its changed columns; fields come in form order with
//    their en/ar labels;
//  - values follow D-199 item 6 (the audit.read-only variant): AUD and TO/TL (audit.read) see values; a workstream lead
//    (an EDITOR of T05 without audit.read) and a sponsor (a plain reader) get valuesWithheld true and no values;
//  - toVersion <= fromVersion, or above the current version -> 422 form_record.compare_versions_invalid (exact text);
//    schema bounds -> 400; outside the read scope, an unknown record, a planned type -> 404;
//  - a sensitive benefit (T14): a member without admission and AUD alone -> 404; the owner (named party) and the
//    holder of sensitive_record.grant -> 200; before marking, the same member -> 200;
//  - a version step whose audit event recorded no {from, to} for a shown field -> that field `recorded: false`, no
//    values (Unknown, never guessed); a step with no diff object at all -> every shown field `recorded: false`;
//  - the route writes nothing (the record's audit trail is unchanged).
// All data is SYNTHETIC. Comparing versions approves nothing (no G1-G6 business approval); nothing touches DG0-DG7.
import { createDb, insertAuditEvent, sql, type AuditEventInput } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foldComparison } from "../../../src/modules/forms/compare.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { benefitAt, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted structurally
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let initiativeId: string;
const NAME = ["Synthetic compare initiative", "Synthetic compare initiative v2"];
const OBJECTIVE = ["Synthetic objective v1", "Synthetic objective v2", "Synthetic objective v3"];

const url = (t: string, type: string, id: string, q = "") =>
  `/api/v1/transformations/${t}/form-records/${type}/${id}/compare${q}`;
const compare = (session: Session | undefined, q: string, id = initiativeId, type = "T05", t = p.transformationId) =>
  call<Body>(api.app, "GET", url(t, type, id, q), session ? { session } : {});

async function patchInitiative(version: number, body: Record<string, unknown>) {
  const res = await call<Body>(api.app, "PATCH", `/api/v1/initiatives/${initiativeId}`, {
    session: p.lead.session,
    body,
    headers: ifm(version),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.version as number;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  const created = await call<Body>(api.app, "POST", "/api/v1/initiatives", {
    session: p.lead.session,
    body: {
      transformationId: p.transformationId,
      name: NAME[0],
      objective: OBJECTIVE[0],
      risksSummary: "Synthetic risk",
      scopeIn: "Synthetic scope in",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  initiativeId = created.body.id;
  // v2: name, objective, risks (changed here and back in v3), scope in.
  expect(
    await patchInitiative(1, {
      name: NAME[1],
      objective: OBJECTIVE[1],
      risksSummary: "Synthetic risk, briefly changed",
      scopeIn: "Synthetic scope in v2",
    }),
  ).toBe(2);
  // v3: objective again, risks back to v1, scope out.
  expect(
    await patchInitiative(2, { objective: OBJECTIVE[2], risksSummary: "Synthetic risk", scopeOut: "Synthetic out" }),
  ).toBe(3);
}, 120_000);
afterAll(() => api.close());

describe("folding two PATCHes (versions 1 -> 3 of an initiative)", () => {
  it("AUD (audit.read) sees each field's first from and last to, in form order, with en/ar labels", async () => {
    const res = await compare(p.auditor.session, "?fromVersion=1&toVersion=3");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      transformationId: p.transformationId,
      recordType: "T05",
      recordId: initiativeId,
      fromVersion: 1,
      toVersion: 3,
      currentVersion: 3,
      valuesWithheld: false,
    });
    expect(res.body.fields).toEqual([
      {
        fieldKey: "initiative_name",
        labelEn: "Initiative name",
        labelAr: "اسم المبادرة",
        recorded: true,
        from: NAME[0],
        to: NAME[1],
      },
      {
        fieldKey: "objective",
        labelEn: "objective",
        labelAr: "الهدف",
        recorded: true,
        from: OBJECTIVE[0],
        to: OBJECTIVE[2],
      },
      {
        fieldKey: "scope_in_out",
        labelEn: "scope in/out",
        labelAr: "النطاق داخل/خارج",
        recorded: true,
        from: { scope_in: "Synthetic scope in", scope_out: null },
        to: { scope_in: "Synthetic scope in v2", scope_out: "Synthetic out" },
      },
    ]);
    // risks changed in v2 and back in v3: the two versions do not differ there.
    expect(res.body.fields.map((f: Body) => f.fieldKey)).not.toContain("risks");
  });

  it("one step (2 -> 3) folds only that step", async () => {
    const res = await compare(p.office.session, "?fromVersion=2&toVersion=3");
    expect(res.status).toBe(200);
    const byKey = new Map(res.body.fields.map((f: Body) => [f.fieldKey, f]));
    expect(byKey.get("objective")).toMatchObject({ from: OBJECTIVE[1], to: OBJECTIVE[2] });
    expect(byKey.get("risks")).toMatchObject({ from: "Synthetic risk, briefly changed", to: "Synthetic risk" });
    expect(byKey.has("initiative_name")).toBe(false);
  });

  it("TO and TL (audit.read in scope) see values", async () => {
    for (const s of [p.office.session, p.lead.session]) {
      const res = await compare(s, "?fromVersion=1&toVersion=3");
      expect([res.status, res.body.valuesWithheld]).toEqual([200, false]);
      expect(res.body.fields[0]).toHaveProperty("from", NAME[0]);
    }
  });

  it("an editor without audit.read (WL) and a plain reader (SP) get field names only (D-199 item 6)", async () => {
    for (const s of [p.contributor.session, p.sponsor.session]) {
      const res = await compare(s, "?fromVersion=1&toVersion=3");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.valuesWithheld).toBe(true);
      expect(res.body.fields.map((f: Body) => f.fieldKey)).toEqual(["initiative_name", "objective", "scope_in_out"]);
      for (const f of res.body.fields) {
        expect(f.recorded).toBe(true);
        expect(f).not.toHaveProperty("from");
        expect(f).not.toHaveProperty("to");
      }
      expect(JSON.stringify(res.body)).not.toContain("Synthetic objective");
    }
  });

  it("writes nothing", async () => {
    const before = await auditOf(api.db, initiativeId);
    await compare(p.auditor.session, "?fromVersion=1&toVersion=3");
    expect(await auditOf(api.db, initiativeId)).toEqual(before);
  });
});

describe("refusals", () => {
  it("toVersion <= fromVersion or above the current version -> 422 form_record.compare_versions_invalid", async () => {
    for (const q of ["?fromVersion=3&toVersion=2", "?fromVersion=2&toVersion=2", "?fromVersion=1&toVersion=4"]) {
      const res = await compare(p.auditor.session, q);
      expect([res.status, res.body.code, res.body.detail], q).toEqual([
        422,
        "form_record.compare_versions_invalid",
        "Choose two different versions of this record, the older one first.",
      ]);
    }
  });

  it("schema bounds and unknown parameters -> 400; no session -> 401", async () => {
    for (const q of [
      "?fromVersion=1&toVersion=1",
      "?fromVersion=0&toVersion=2",
      "?fromVersion=1",
      "",
      "?fromVersion=1&toVersion=x",
      "?fromVersion=1&toVersion=2&x=1",
    ])
      expect((await compare(p.auditor.session, q)).status, q).toBe(400);
    expect((await compare(undefined, "?fromVersion=1&toVersion=2")).status).toBe(401);
  });

  it("outside the read scope, an unknown record, a planned type, another transformation's record -> 404", async () => {
    const officeB = await signIn(api.app, w.officeB.subject);
    const nobody = await signIn(api.app, w.nobody.subject);
    const q = "?fromVersion=1&toVersion=2";
    expect((await compare(officeB, q)).status).toBe(404);
    expect((await compare(nobody, q)).status).toBe(404);
    expect((await compare(p.auditor.session, q, crypto.randomUUID())).status).toBe(404);
    expect((await compare(p.auditor.session, q, initiativeId, "launch_plan")).status).toBe(404);
    expect((await compare(p.auditor.session, q, initiativeId, "T01")).status).toBe(404);
  });
});

describe("Unknown, never guessed (ADR-0057 §11)", () => {
  /** A version step written as a register would, but with the given `changes` (owner role; test-only). */
  async function stepWithChanges(changes: Record<string, unknown> | null): Promise<number> {
    return createDb(api.owner)
      .transaction()
      .execute(async (tx) => {
        const r = await sql<{ version: number }>`UPDATE initiative SET version = version + 1, updated_at = now()
          WHERE id = ${initiativeId}::uuid RETURNING version`.execute(tx);
        const version = r.rows[0]!.version;
        await insertAuditEvent(
          tx,
          { actorType: "system", actorUserId: null, source: "migration" },
          {
            action: "test.step",
            recordType: "initiative",
            recordId: initiativeId,
            organizationId: w.orgA.id,
            transformationId: p.transformationId,
            priorVersion: version - 1,
            newVersion: version,
            changes: changes as NonNullable<AuditEventInput["changes"]> | null,
          },
        );
        return version;
      });
  }

  it("a step without a {from, to} diff of a shown field reports it recorded: false with no values", async () => {
    const v = await stepWithChanges({ objective: { redacted: true }, name: { from: NAME[1], to: NAME[0] } });
    const res = await compare(p.auditor.session, `?fromVersion=3&toVersion=${v}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fields).toEqual([
      {
        fieldKey: "initiative_name",
        labelEn: "Initiative name",
        labelAr: "اسم المبادرة",
        recorded: true,
        from: NAME[1],
        to: NAME[0],
      },
      { fieldKey: "objective", labelEn: "objective", labelAr: "الهدف", recorded: false },
    ]);
  });

  it("a step with no diff object at all reports every shown field recorded: false", async () => {
    const v = await stepWithChanges(null);
    const res = await compare(p.auditor.session, `?fromVersion=${v - 1}&toVersion=${v}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fields.length).toBeGreaterThan(3);
    for (const f of res.body.fields)
      expect(f).toEqual({ fieldKey: f.fieldKey, labelEn: f.labelEn, labelAr: f.labelAr, recorded: false });
  });

  it("the pure fold: first from, last to; composites by column; other tables' columns ignored", () => {
    const fields = [
      {
        key: "a",
        labelEn: "A",
        labelAr: "أ",
        origin: "source" as const,
        storageKind: "column" as const,
        storageRef: "x.a",
      },
      {
        key: "c",
        labelEn: "C",
        labelAr: "ج",
        origin: "source" as const,
        storageKind: "composite" as const,
        storageRef: "x.c1, x.c2, y.z, other_table",
      },
      { key: "e", labelEn: "E", labelAr: "هـ", origin: "admin" as const, storageKind: null, storageRef: null },
      {
        key: "k",
        labelEn: "K",
        labelAr: "ك",
        origin: "source" as const,
        storageKind: "computed" as const,
        storageRef: "x.k",
      },
    ];
    const steps = [
      {
        changes: {
          a: { from: "1", to: "2" },
          c2: { from: null, to: "q" },
          k: { from: 1, to: 2 },
          z: { from: 1, to: 2 },
        },
      },
      { changes: { a: { from: "2", to: "3" }, c2: { from: "q", to: "r" } } },
    ];
    expect(foldComparison(fields, "x", steps, true)).toEqual([
      { fieldKey: "a", labelEn: "A", labelAr: "أ", recorded: true, from: "1", to: "3" },
      { fieldKey: "c", labelEn: "C", labelAr: "ج", recorded: true, from: { c2: null }, to: { c2: "r" } },
    ]);
    expect(foldComparison(fields, "x", steps, false)).toEqual([
      { fieldKey: "a", labelEn: "A", labelAr: "أ", recorded: true },
      { fieldKey: "c", labelEn: "C", labelAr: "ج", recorded: true },
    ]);
    expect(foldComparison(fields, "x", [{ changes: {} }], true).map((f) => f.recorded)).toEqual([false, false]);
  });
});

describe("a sensitive benefit (ADR-0051 §2)", () => {
  let b: BenefitWorld;
  let benefit: { id: string; version: number };
  let member: Session;
  let office: Session;

  beforeAll(async () => {
    b = await seedBenefitWorld(api, w);
    benefit = await benefitAt(api, b, "plan");
    expect(benefit.version).toBeGreaterThanOrEqual(2);
    const td = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, td.id, "TD", { type: "transformation", id: b.transformationId }, w.orgA.id);
    member = await signIn(api.app, td.subject);
    office = await signIn(api.app, w.office.subject);
  }, 120_000);

  const q = () => `?fromVersion=1&toVersion=${benefit.version}`;

  it("before marking, a member reads the comparison; after marking, a member without admission and AUD alone get 404", async () => {
    expect((await compare(member, q(), benefit.id, "T14", b.transformationId)).status).toBe(200);
    const marked = await call<Body>(api.app, "PUT", `${b.base}/records/benefit/${benefit.id}/sensitivity`, {
      session: office,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic compare fixture" },
    });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect((await compare(member, q(), benefit.id, "T14", b.transformationId)).status).toBe(404);
    expect((await compare(b.s.auditor, q(), benefit.id, "T14", b.transformationId)).status).toBe(404);
  });

  it("the owner (a named party) and the holder of sensitive_record.grant are admitted", async () => {
    const owner = await compare(b.s.bo, q(), benefit.id, "T14", b.transformationId);
    expect([owner.status, owner.body.valuesWithheld]).toEqual([200, true]); // BO holds no audit.read
    const granter = await compare(office, q(), benefit.id, "T14", b.transformationId);
    expect([granter.status, granter.body.valuesWithheld]).toEqual([200, false]); // TO holds audit.read
  });
});
