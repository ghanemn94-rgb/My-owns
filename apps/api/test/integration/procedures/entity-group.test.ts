// REQ-S16-015 (ADR-0042 §8; D-142 Q4; p5-work-split §C.3; T-DG5-BE-G): the target operating model and procedures entity
// group through the API against a real PostgreSQL. Each entity is created and read with authorization enforced: the
// auditor (AUD) gets 403 on every write, and a caller outside the scope gets 404 on every scoped read (403 on the
// platform-wide Studio configuration, which has no record scope, as ADR-0041 §9 and the REQ-S16-012 test).
//   TOMDimension         a version-scoped row of an existing identity in a methodology draft (D-142 Q4):
//                        putConfigElement (tom_dimension) / listConfigElements?elementType=tom_dimension; an eleventh
//                        dimension is not creatable (S06-006);
//   TOMCanvas            the ten cells exist from instantiation; "create" is filling a cell: updateTomCanvasCell /
//                        getTomCanvas, getTomCanvasCell;
//   Capability           createCapability (capability heatmap) / getCapability;
//   Gap                  createTomGap / getTomGap;
//   Journey, Process     createJourney (kind journey, kind process) / getJourney;
//   ProcedureDefinition  putProcedureDefinition in a procedures draft / getProcedureDefinition;
//   ProcedureInstance    launchProcedureInstance / getProcedureInstance.
// Every value is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  type RequestOptions,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { seedProceduresVersion, syntheticDefinitionBody } from "../../support/procedures-fixtures.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let admin: Session;
let auditor: Session;
let outsider: Session;
const req = (m: string, u: string, o?: RequestOptions) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  auditor = await signIn(api.app, w.auditor.subject);
  outsider = await signIn(api.app, w.nobody.subject);
}, 120_000);
afterAll(() => api.close());

describe("REQ-S16-015: the target operating model and procedures entity group through the API", () => {
  it("TOMDimension: a version-scoped row in a methodology draft; AUD 403; no eleventh dimension; 403 without Studio read", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await req("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const id = draft.body.id as string;
    const put = (key: string, version: number, attributes: Record<string, unknown>, s = admin) =>
      req("PUT", `${V}/${id}/elements/tom_dimension/${key}`, {
        session: s,
        headers: ifm(version),
        body: { attributes },
      });
    expect((await put("technology", 1, { labelEn: "Technology (synthetic)" }, auditor)).status).toBe(403);
    const dim = await put("technology", 1, { labelEn: "Technology (synthetic)" });
    expect(dim.status, JSON.stringify(dim.body)).toBe(200);
    const eleventh = await put("synthetic_eleventh", dim.body.version, { labelEn: "Synthetic eleventh dimension" });
    expect([eleventh.status, eleventh.body.code]).toEqual([422, "config_version.source_element_protected"]);
    const list = await req("GET", `${V}/${id}/elements?elementType=tom_dimension`, { session: auditor });
    expect(list.status).toBe(200);
    const row = list.body.items.find((e: Body) => e.stableKey === "technology");
    expect([row.elementType, row.attributes.labelEn]).toEqual(["tom_dimension", "Technology (synthetic)"]);
    expect((await req("GET", `${V}/${id}/elements?elementType=tom_dimension`, { session: outsider })).status).toBe(403);
  });

  it("TOMCanvas: a cell is filled and read; AUD 403; 404 outside scope", async () => {
    const cell = await req("GET", `${T}/tom-canvas/technology`, { session: p.lead.session });
    expect(cell.status, JSON.stringify(cell.body)).toBe(200);
    const version = cell.body.cell.version as number;
    const body = { currentDesign: "Synthetic current design.", targetDesign: "Synthetic target design." };
    expect(
      (await req("PATCH", `${T}/tom-canvas/technology`, { session: auditor, headers: ifm(version), body })).status,
    ).toBe(403);
    const filled = await req("PATCH", `${T}/tom-canvas/technology`, {
      session: p.lead.session,
      headers: ifm(version),
      body,
    });
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    const canvas = await req("GET", `${T}/tom-canvas`, { session: auditor });
    expect(canvas.status).toBe(200);
    expect(canvas.body.cells).toHaveLength(10);
    const read = await req("GET", `${T}/tom-canvas/technology`, { session: auditor });
    expect([read.body.cell.currentDesign, read.body.cell.status]).toEqual(["Synthetic current design.", "draft"]);
    expect(read.body.cell).toHaveProperty("ownerUserId");
    expect((await req("GET", `${T}/tom-canvas`, { session: outsider })).status).toBe(404);
    expect((await req("GET", `${T}/tom-canvas/technology`, { session: outsider })).status).toBe(404);
  });

  it("Capability, Gap, Journey and Process: created and read with owner and status; AUD 403; 404 outside scope", async () => {
    const create = async (path: string, body: Record<string, unknown>) => {
      expect((await req("POST", `${T}/${path}`, { session: auditor, body })).status, `AUD ${path}`).toBe(403);
      const res = await req("POST", `${T}/${path}`, { session: p.lead.session, body });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.id as string;
    };
    const read = async (path: string) => {
      const res = await req("GET", `${T}/${path}`, { session: auditor });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await req("GET", `${T}/${path}`, { session: outsider })).status, `outside ${path}`).toBe(404);
      return res.body;
    };
    const capabilityId = await create("capability-heatmap", { name: "Synthetic roaming billing capability" });
    const capability = await read(`capability-heatmap/${capabilityId}`);
    expect(capability).toMatchObject({ id: capabilityId, name: "Synthetic roaming billing capability" });
    expect(capability).toHaveProperty("status");
    expect(capability).toHaveProperty("ownerUserId");

    const gapId = await create("tom-gaps", { dimensionCode: "technology" });
    const gap = await read(`tom-gaps/${gapId}`);
    expect(gap).toMatchObject({ id: gapId });
    expect(gap).toHaveProperty("status");
    expect(gap).toHaveProperty("ownerUserId");

    const steps = [{ key: "01920099-0000-7000-8000-0000000000bb", ordinal: 1, name: "Synthetic step" }];
    const journeyId = await create("journeys", { name: "Synthetic journey", kind: "journey", state: "current", steps });
    const processId = await create("journeys", { name: "Synthetic process", kind: "process", state: "current", steps });
    const journey = await read(`journeys/${journeyId}`);
    const process = await read(`journeys/${processId}`);
    expect([journey.kind, process.kind]).toEqual(["journey", "process"]);
    expect(journey).toHaveProperty("status");
    expect(process).toHaveProperty("ownerUserId");
  });

  it("ProcedureDefinition: put in a procedures draft and read; AUD 403; 403 without read rights", async () => {
    const base = await seedProceduresVersion(api);
    const draft = await req("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const id = draft.body.id as string;
    const url = `/api/v1/admin/procedure-definitions/${id}/vendor_onboarding`;
    const body = syntheticDefinitionBody();
    expect((await req("PUT", url, { session: auditor, headers: ifm(draft.body.version), body })).status).toBe(403);
    const put = await req("PUT", url, { session: admin, headers: ifm(draft.body.version), body });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const got = await req("GET", `/api/v1/procedure-definitions/vendor_onboarding?versionId=${id}`, {
      session: admin,
    });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body).toMatchObject({ code: "vendor_onboarding", nameEn: "Synthetic vendor onboarding" });
    // A caller without procedure.read gets 403 on the read.
    const one = `/api/v1/procedure-definitions/vendor_onboarding?versionId=${id}`;
    expect((await req("GET", one, { session: outsider })).status).toBe(403);
  });

  it("ProcedureInstance: launched and read; AUD 403 on launch; 404 outside scope", async () => {
    const launchBody = { procedureCode: "scope_target_change", transformationId: p.transformationId };
    expect((await req("POST", "/api/v1/procedure-instances", { session: auditor, body: launchBody })).status).toBe(403);
    const launched = await req("POST", "/api/v1/procedure-instances", { session: p.office.session, body: launchBody });
    expect(launched.status, JSON.stringify(launched.body)).toBe(201);
    const id = launched.body.id as string;
    const got = await req("GET", `/api/v1/procedure-instances/${id}`, { session: auditor });
    expect([got.status, got.body.id, got.body.status, got.body.procedureCode]).toEqual([
      200,
      id,
      "active",
      "scope_target_change",
    ]);
    expect((await req("GET", `/api/v1/procedure-instances/${id}`, { session: outsider })).status).toBe(404);
  });
});
