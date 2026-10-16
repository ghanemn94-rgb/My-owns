// A16 / A11 (qa-verifier, T-DG5-QA-D): REQ-S16-021, the sustainment, improvement and health entity group.
// Acceptance (docs/delivery/requirements.csv): "... an integration test creates and reads each one through the API with
// authorization enforced" for BAUHandover, Control, ControlCheck, ImprovementItem, Lesson and HealthAssessment.
// One synthetic transformation is created natively through the real API (Fastify inject, disposable PostgreSQL, every
// response validated against docs/api/openapi.yaml). Each entity is created by a role that may create it and read back
// through its own GET route, with its id, owner and status as the contract names them; the same create by the auditor
// (AUD: read-only) is 403 and writes no row, and a Transformation Office user of ANOTHER organization gets 404 on the
// read (existence not disclosed). ControlCheck has no create operation in the contract: checks are created by the
// daily control-check job (the exported production job function, run with an explicit business date) and recorded
// through the API, so its "create" is that job plus the API record.
// All data is SYNTHETIC; nothing here approves anything real or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, signIn, startApi, type TestApi } from "../support/api.ts";
import {
  nativePerson,
  plusDays,
  seedNativeGateWorld,
  type NativeGateWorld,
  type Person,
} from "../support/gates-native.ts";
import { ensureDefaultCalendar, seedWorld, type World } from "../support/p4.ts";
import { fullContent, runControlCheckScan } from "../support/a11.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let g: NativeGateWorld;
let kds: Person;
let areaId: string;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ifm = (v: number) => ({ "if-match": `"${v}"` });

async function countRows(table: "control" | "bau_handover" | "improvement_item" | "lesson" | "health_assessment") {
  const r = await api.db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "=", g.transformationId)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Create as `creator` (expect 201), refuse the same create to AUD (403, no row), read it back, 404 cross-org. */
async function createdAndRead(
  table: Parameters<typeof countRows>[0],
  collection: string,
  creator: Person,
  body: Body,
  readById = false,
): Promise<Body> {
  const before = await countRows(table);
  const denied = await send("POST", `${g.base}/${collection}`, { session: g.auditor.session, body });
  expect(denied.status, `AUD create ${collection}`).toBe(403);
  expect(await countRows(table)).toBe(before);
  const made = await send("POST", `${g.base}/${collection}`, { session: creator.session, body });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  expect(await countRows(table)).toBe(before + 1);
  // The contract's read: GET {collection}/{id} where it exists, else the collection list (controls, improvement items
  // and lessons have no single-record GET in docs/api/openapi.yaml).
  const url = readById ? `${g.base}/${collection}/${made.body.id}` : `${g.base}/${collection}?limit=100`;
  const read = await send("GET", url, { session: g.auditor.session });
  expect(read.status).toBe(200);
  const row: Body = readById ? read.body : (read.body.items as Body[]).find((x) => x.id === made.body.id);
  expect(row, `${collection} ${made.body.id} read back`).toBeTruthy();
  expect(row.id).toBe(made.body.id);
  expect(typeof row.status).toBe("string");
  const hidden = await send("GET", url, { session: g.outsider.session });
  expect(hidden.status, `cross-organization read of ${collection}`).toBe(404);
  expect((await send("GET", url)).status).toBe(401);
  return row;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  g = await seedNativeGateWorld(api, w, "A16 S16-021");
  const admin = await signIn(api.app, w.admin.subject);
  kds = await nativePerson(api, w, admin, g.transformationId, "KDS");
  await ensureDefaultCalendar(api, w);
  const a = await send("POST", `${g.base}/performance-areas`, {
    session: g.bo.session,
    body: { name: "Synthetic QA A16 performance area", reviewFrequency: "monthly", reviewInterval: 1 },
  });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  areaId = a.body.id;
}, 180_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("REQ-S16-021: each entity of the group is created and read through the API with authorization enforced", () => {
  let controlId: string;

  it("Control: created by the Business Owner, read with owner and status; AUD 403; other organization 404", async () => {
    const c = await createdAndRead("control", "controls", g.bo, {
      performanceAreaId: areaId,
      name: "Synthetic QA A16 monthly reconciliation",
      frequency: "monthly",
    });
    expect(c.status).toBe("active");
    expect("ownerUserId" in c).toBe(true);
    controlId = c.id;
  });

  it("BAUHandover: prepared by the Workstream Lead, read with its receiving owner and status", async () => {
    const h = await createdAndRead("bau_handover", "bau-handovers", g.wl, {
      performanceAreaId: areaId,
      receivingOwnerUserId: g.bo.id,
      ...fullContent(kds.id),
    });
    expect(h.receivingOwnerUserId).toBe(g.bo.id);
    expect(h.status).toBe("draft");
  });

  it("ImprovementItem: created by the Business Owner, read with owner and status", async () => {
    const i = await createdAndRead("improvement_item", "improvement-items", g.bo, {
      title: "Synthetic QA A16 improvement",
      sourceKind: "manual",
      performanceAreaId: areaId,
      ownerUserId: g.bo.id,
      priority: "M",
    });
    expect(i.ownerUserId).toBe(g.bo.id);
    expect(i.status).toBe("open");
  });

  it("Lesson: created by the Business Owner, read with its author and status", async () => {
    const l = await createdAndRead("lesson", "lessons", g.bo, {
      title: "Synthetic QA A16 lesson",
      lessonText: "Synthetic QA: a lesson for the entity group test.",
      tags: ["qa"],
      performanceAreaId: areaId,
    });
    expect(l.status).toBe("draft");
  });

  it("HealthAssessment: created by the Lead, read with owner and status", async () => {
    const h = await createdAndRead("health_assessment", "health-checks", g.tl, { assessmentDate: "2026-10-05" }, true);
    expect(h.ownerUserId).toBe(g.tl.id);
    expect(h.status).toBe("draft");
  });

  it("ControlCheck: created by the control-check job, read through the API; recording it is refused to AUD and allowed to the owner", async () => {
    const control = await api.db
      .selectFrom("control")
      .select(["next_check_date"])
      .where("id", "=", controlId)
      .executeTakeFirstOrThrow();
    const due = String(
      control.next_check_date instanceof Date ? control.next_check_date.toISOString() : control.next_check_date,
    ).slice(0, 10);
    await runControlCheckScan(api.db, "qa-a16-control-scan", {
      asOf: plusDays(due, -7),
      organizationId: g.organizationId,
    });
    const list = await send("GET", `${g.base}/control-checks?performanceAreaId=${areaId}`, {
      session: g.auditor.session,
    });
    expect(list.status).toBe(200);
    const check = (list.body.items as Body[]).find((c) => c.controlId === controlId);
    expect(check, JSON.stringify(list.body)).toBeTruthy();
    expect(check.status).toBe("due");
    expect(typeof check.id).toBe("string");
    const hidden = await send("GET", `${g.base}/control-checks?performanceAreaId=${areaId}`, {
      session: g.outsider.session,
    });
    expect(hidden.status).toBe(404);
    const aud = await send("POST", `${g.base}/control-checks/${check.id}/record`, {
      session: g.auditor.session,
      headers: ifm(check.version),
      body: { result: "passed", resultNote: "Synthetic QA" },
    });
    expect(aud.status).toBe(403);
    const ok = await send("POST", `${g.base}/control-checks/${check.id}/record`, {
      session: g.bo.session,
      headers: ifm(check.version),
      body: { result: "passed", resultNote: "Synthetic QA A16: reconciled" },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe("passed");
  });
});
