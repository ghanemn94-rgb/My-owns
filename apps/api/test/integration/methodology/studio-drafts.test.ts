// Playbook Studio drafts, resolved elements, ConfigResolver and configuration pins (ADR-0039 §1-§4, §9, §11, §13;
// REQ-S06-004 (slice A part), REQ-S16-012 (MethodologyVersion create/read); p5-work-split §A.1; T-DG5-BE-A) against a
// real PostgreSQL:
//  - a draft copies its base's element rows, takes the next version number of its key, and one open draft per kind and
//    key (409 config_version.draft_exists); an edit in preview returns the draft to editing; discard keeps it readable;
//  - resolved elements = the catalogue overridden by the version's rows (playbook v1 has no rows);
//  - pins: an unpinned kind shows version 1 of its default key, never the latest; ConfigResolver.withDraft resolves to
//    the draft without persisting anything;
//  - every mutation: ADM_METHOD positive; AUD, TO and BO 403; If-Match 428/409; one audit event per row written;
//    authorization re-checked at commit time (403, nothing written).
// Each test seeds its own synthetic base key (test/support/studio-fixtures.ts), so parallel suites never share a draft.
// All data is synthetic; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConfigResolver } from "../../../src/modules/methodology/index.ts";
import {
  auditOf,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import {
  methodologyAdmin,
  moveDraftToPreview,
  putElementAsOwner,
  seedStudioBase,
} from "../../support/studio-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
let adminId: string;
let auditor: Session;
let office: Session;
let bo: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
  const boUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, boUser.id, "BO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bo = await signIn(api.app, boUser.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const PLAYBOOK_V1 = "01920002-0000-7000-8000-000000000001";
const SCORING_V1 = "01920005-0000-7000-8000-000000000001";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const createDraft = (basedOnVersionId: string, session = admin, extra: Record<string, unknown> = {}) =>
  call<Body>(api.app, "POST", V, { session, body: { basedOnVersionId, ...extra } });
const actions = async (recordId: string) => (await auditOf(api.db, recordId)).map((a) => a.action);

describe("createConfigDraft (ADR-0039 §4)", () => {
  it("copies every element row of its base, takes the next version number, and audits each row it writes", async () => {
    const base = await seedStudioBase(api, "scoring_defaults", [
      { elementType: "scoring_weight", stableKey: "strategic_fit", ordinal: 1, attributes: { weightPercent: "60.00" } },
      { elementType: "scoring_weight", stableKey: "feasibility", ordinal: 2, attributes: { weightPercent: "40.00" } },
    ]);
    const res = await createDraft(base.id, admin, { titleEn: "Synthetic weights v2", changeSummary: "Synthetic" });
    expect(res.status).toBe(201);
    expect(res.headers["location"]).toBe(`${V}/${res.body.id}`);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.body).toMatchObject({
      configKind: "scoring_defaults",
      key: base.key,
      versionNo: 2,
      status: "draft",
      draftStage: "editing",
      origin: "draft",
      basedOnVersionId: base.id,
      titleEn: "Synthetic weights v2",
      titleAr: "أساس تجريبي",
      changeSummary: "Synthetic",
      isNewestPublished: false,
      reviewRequired: true,
      pendingReviewId: null,
      latestChecks: { preview: null, compatibility: null, sourceCoverage: null },
      version: 1,
      createdBy: adminId,
    });
    const rows = await api.db
      .selectFrom("methodology_element")
      .selectAll()
      .where("methodology_version_id", "=", res.body.id)
      .orderBy("stable_key")
      .execute();
    expect(rows.map((r) => [r.stable_key, r.attributes])).toEqual([
      ["feasibility", { weightPercent: "40.00" }],
      ["strategic_fit", { weightPercent: "60.00" }],
    ]);
    // One audit event for the version and one for each copied row, all in the request's transaction.
    expect(await actions(res.body.id)).toEqual(["methodology_version.create_draft"]);
    for (const r of rows) expect(await actions(r.id)).toEqual(["methodology_element.copy"]);
    // The base is untouched; the elements of the draft resolve from its rows.
    const els = await call<Body>(api.app, "GET", `${V}/${res.body.id}/elements?elementType=scoring_weight`, {
      session: auditor,
    });
    expect(els.body.items.map((e: Body) => [e.stableKey, e.attributes.weightPercent, e.overridden])).toEqual([
      ["strategic_fit", "60.00", true],
      ["feasibility", "40.00", true],
    ]);
  });

  it("the seeded scoring defaults v1 resolves its eleven rows (verbatim B0076 weights; read-only on the seed)", async () => {
    // Read-only on the seed: no draft of `scoring-defaults` is created here, so the shared run database never holds an
    // open draft of that key that another suite (KBE-A's) could trip over.
    const resolver = createConfigResolver();
    const weights = await resolver.elements(api.db, SCORING_V1, "scoring_weight");
    expect(weights.map((e) => [e.stableKey, e.attributes["weightPercent"]])).toEqual([
      ["strategic_fit", "25.00"],
      ["financial_value", "25.00"],
      ["customer_impact", "20.00"],
      ["feasibility", "15.00"],
      ["time_to_value", "15.00"],
    ]);
    const rubric = await resolver.elements(api.db, SCORING_V1, "scoring_rubric");
    expect(rubric).toHaveLength(6);
    // Rubric descriptors are null in the seed ("No descriptor defined"), never invented.
    expect(
      rubric.every((r) =>
        (r.attributes["levels"] as { descriptorEn: unknown }[]).every((l) => l.descriptorEn === null),
      ),
    ).toBe(true);
  });

  it("numbers: a draft is version_no max+1 of its key, and a discarded draft keeps its number (gaps allowed)", async () => {
    const base = await seedStudioBase(api, "methodology");
    const first = await createDraft(base.id);
    expect(first.body.versionNo).toBe(2);
    expect(
      (await call<Body>(api.app, "POST", `${V}/${first.body.id}/discard`, { session: admin, headers: ifm(1) })).status,
    ).toBe(200);
    const second = await createDraft(base.id);
    expect([second.status, second.body.versionNo]).toEqual([201, 3]);
  });

  it("one open draft per kind and key: 409 config_version.draft_exists; a non-published base 422; unknown 404", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await createDraft(base.id);
    const dup = await createDraft(base.id);
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "config_version.draft_exists",
      "A draft of this configuration already exists. Continue it or discard it first.",
    ]);
    const fromDraft = await createDraft(draft.body.id);
    expect([fromDraft.status, fromDraft.body.code, fromDraft.body.detail]).toEqual([
      422,
      "config_version.unknown_element",
      "This element does not exist in the methodology.",
    ]);
    expect((await createDraft(crypto.randomUUID())).status).toBe(404);
    // Validation: free-text rules on the titles (blank, invalid character), strict body.
    expect((await createDraft(base.id, admin, { titleEn: "‏" })).status).toBe(400);
    expect((await createDraft(base.id, admin, { titleEn: "a\u0000b" })).status).toBe(400);
    expect((await createDraft(base.id, admin, { extra: 1 })).status).toBe(400);
    // Nothing was written by the refused requests: still exactly one open draft of the key.
    const open = await api.db
      .selectFrom("methodology_version")
      .select("id")
      .where("key", "=", base.key)
      .where("status", "=", "draft")
      .execute();
    expect(open.map((r) => r.id)).toEqual([draft.body.id]);
  });

  it("authorization: AUD, TO and BO get 403 on every write and nothing is written; AUD and TO read", async () => {
    const base = await seedStudioBase(api, "methodology");
    for (const s of [auditor, office, bo]) expect((await createDraft(base.id, s)).status).toBe(403);
    const draft = await createDraft(base.id);
    for (const s of [auditor, office, bo]) {
      expect(
        (await call(api.app, "PATCH", `${V}/${draft.body.id}`, { session: s, headers: ifm(1), body: { titleEn: "x" } }))
          .status,
      ).toBe(403);
      expect(
        (await call(api.app, "POST", `${V}/${draft.body.id}/discard`, { session: s, headers: ifm(1) })).status,
      ).toBe(403);
    }
    const after = await call<Body>(api.app, "GET", `${V}/${draft.body.id}`, { session: auditor });
    expect([after.status, after.body.version, after.body.draftStage]).toEqual([200, 1, "editing"]);
    expect((await call(api.app, "GET", `${V}/${draft.body.id}`, { session: office })).status).toBe(200);
    expect(await actions(draft.body.id)).toEqual(["methodology_version.create_draft"]);
  });

  it("commit-time authorization: methodology.configure revoked while the request waits -> 403; nothing written", async () => {
    const base = await seedStudioBase(api, "methodology");
    const u = await methodologyAdmin(api.db, w);
    const s = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", V, { session: s, body: { basedOnVersionId: base.id } }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db.selectFrom("methodology_version").select("id").where("key", "=", base.key).execute();
    expect(rows).toHaveLength(1);
  });
});

describe("updateConfigDraft and discardConfigDraft (ADR-0039 §1, §4)", () => {
  it("an edit recomputes the content hash, steps the version and writes one audit event", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await createDraft(base.id);
    const res = await call<Body>(api.app, "PATCH", `${V}/${draft.body.id}`, {
      session: admin,
      headers: ifm(1),
      body: { titleAr: "عنوان تجريبي", definition: { schema: "mth.test/1", note: "edited" } },
    });
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBe('"2"');
    expect(res.body).toMatchObject({ version: 2, titleAr: "عنوان تجريبي", definition: { note: "edited" } });
    expect(res.body.contentSha256).not.toBe(draft.body.contentSha256);
    expect(await actions(draft.body.id)).toEqual([
      "methodology_version.create_draft",
      "methodology_version.update_draft",
    ]);
    // Decimals in a definition are strings: a float is refused (400) and nothing changes.
    const bad = await call<Body>(api.app, "PATCH", `${V}/${draft.body.id}`, {
      session: admin,
      headers: ifm(2),
      body: { definition: { weight: 0.5 } },
    });
    expect(bad.status).toBe(400);
    expect((await call<Body>(api.app, "GET", `${V}/${draft.body.id}`, { session: admin })).body.version).toBe(2);
  });

  it("If-Match: missing 428, stale 409 (update and discard); nothing written", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await createDraft(base.id);
    const id = draft.body.id;
    expect((await call(api.app, "PATCH", `${V}/${id}`, { session: admin, body: { titleEn: "x" } })).status).toBe(428);
    const stale = await call<Body>(api.app, "PATCH", `${V}/${id}`, {
      session: admin,
      headers: ifm(7),
      body: { titleEn: "x" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect((await call(api.app, "POST", `${V}/${id}/discard`, { session: admin })).status).toBe(428);
    expect((await call(api.app, "POST", `${V}/${id}/discard`, { session: admin, headers: ifm(2) })).status).toBe(409);
    expect(await actions(id)).toEqual(["methodology_version.create_draft"]);
  });

  it("commit-time authorization on update and discard: methodology.configure revoked while waiting -> 403; nothing written", async () => {
    const base = await seedStudioBase(api, "methodology");
    const u = await methodologyAdmin(api.db, w);
    const s = await signIn(api.app, u.subject);
    const draft = await createDraft(base.id, s);
    expect(draft.status).toBe(201);
    const upd = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "PATCH", `${V}/${draft.body.id}`, { session: s, headers: ifm(1), body: { titleEn: "late" } }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(upd.status).toBe(403);
    // Re-grant, then revoke again while a discard waits.
    await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const dis = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", `${V}/${draft.body.id}/discard`, { session: s, headers: ifm(1) }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(dis.status).toBe(403);
    const after = await call<Body>(api.app, "GET", `${V}/${draft.body.id}`, { session: auditor });
    expect([after.body.version, after.body.draftStage, after.body.titleEn]).toEqual([
      1,
      "editing",
      "Synthetic Studio base",
    ]);
    expect(await actions(draft.body.id)).toEqual(["methodology_version.create_draft"]);
  });

  it("an edit of a draft in preview returns it to editing", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await createDraft(base.id);
    await moveDraftToPreview(api, draft.body.id, adminId);
    const inPreview = await call<Body>(api.app, "GET", `${V}/${draft.body.id}`, { session: admin });
    expect([inPreview.body.draftStage, inPreview.body.version]).toEqual(["preview", 2]);
    expect(inPreview.body.latestChecks.preview).toMatchObject({ result: "pass" });
    const res = await call<Body>(api.app, "PATCH", `${V}/${draft.body.id}`, {
      session: admin,
      headers: ifm(2),
      body: { titleEn: "Edited after preview" },
    });
    expect([res.status, res.body.draftStage, res.body.version]).toEqual([200, "editing", 3]);
    // The preview run was for the old content hash: it no longer counts as the latest check of the current content.
    expect(res.body.contentSha256).not.toBe(inPreview.body.contentSha256);
    expect(res.body.latestChecks.preview).toBeNull();
  });

  it("discard: the draft stays readable, cannot be edited (409 not_editable), and frees the key for a new draft", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await createDraft(base.id);
    const res = await call<Body>(api.app, "POST", `${V}/${draft.body.id}/discard`, { session: admin, headers: ifm(1) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "draft", draftStage: "discarded", version: 2 });
    expect(res.body.discardedAt).not.toBeNull();
    expect(await actions(draft.body.id)).toEqual(["methodology_version.create_draft", "methodology_version.discard"]);
    const edit = await call<Body>(api.app, "PATCH", `${V}/${draft.body.id}`, {
      session: admin,
      headers: ifm(2),
      body: { titleEn: "again" },
    });
    expect([edit.status, edit.body.code, edit.body.detail]).toEqual([
      409,
      "config_version.not_editable",
      "This configuration version is published or no longer being edited. Create a new draft to change it.",
    ]);
    const twice = await call<Body>(api.app, "POST", `${V}/${draft.body.id}/discard`, {
      session: admin,
      headers: ifm(2),
    });
    expect([twice.status, twice.body.code]).toEqual([409, "config_version.not_editable"]);
    expect((await createDraft(base.id)).status).toBe(201);
  });

  it("a published version is never editable: 409 config_version.not_editable on update and discard", async () => {
    const base = await seedStudioBase(api, "methodology");
    const upd = await call<Body>(api.app, "PATCH", `${V}/${base.id}`, {
      session: admin,
      headers: ifm(1),
      body: { titleEn: "x" },
    });
    expect([upd.status, upd.body.code]).toEqual([409, "config_version.not_editable"]);
    const dis = await call<Body>(api.app, "POST", `${V}/${base.id}/discard`, { session: admin, headers: ifm(1) });
    expect([dis.status, dis.body.code]).toEqual([409, "config_version.not_editable"]);
  });
});

describe("listConfigVersions and getConfigVersion", () => {
  it("lists newest first with kind/status filters and a cursor; the seeded versions are newest-published", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await createDraft(base.id);
    const drafts = await call<Body>(api.app, "GET", `${V}?kind=methodology&status=draft&limit=100`, {
      session: auditor,
    });
    expect(drafts.status).toBe(200);
    expect(drafts.body.items.some((v: Body) => v.id === draft.body.id)).toBe(true);
    expect(drafts.body.items.every((v: Body) => v.status === "draft" && v.configKind === "methodology")).toBe(true);
    const page1 = await call<Body>(api.app, "GET", `${V}?limit=1`, { session: auditor });
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await call<Body>(api.app, "GET", `${V}?limit=1&cursor=${page1.body.nextCursor}`, {
      session: auditor,
    });
    expect(page2.body.items[0].id < page1.body.items[0].id).toBe(true);
    expect(
      (await call(api.app, "GET", `${V}?limit=1&kind=procedure&cursor=${page1.body.nextCursor}`, { session: auditor }))
        .status,
    ).toBe(400);
    const playbook = await call<Body>(api.app, "GET", `${V}/${PLAYBOOK_V1}`, { session: auditor });
    expect(playbook.body).toMatchObject({ key: "playbook", versionNo: 1, status: "published", origin: "seed" });
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", V, { session: nobody })).status).toBe(403);
  });
});

describe("resolved elements (ADR-0039 §2-§3)", () => {
  it("playbook v1 has no rows: every element is the catalogue value, not overridden", async () => {
    const gates = await call<Body>(api.app, "GET", `${V}/${PLAYBOOK_V1}/elements?elementType=gate`, {
      session: auditor,
    });
    expect(gates.body.items.map((g: Body) => g.stableKey)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    const cat = await api.db
      .selectFrom("gate_definition")
      .selectAll()
      .where("code", "=", "G3")
      .executeTakeFirstOrThrow();
    const g3 = gates.body.items[2];
    expect(g3).toMatchObject({ origin: "source", removed: false, overridden: false, sourceRef: cat.source_ref });
    expect(g3.attributes).toEqual(g3.catalogueAttributes);
    expect(g3.attributes).toMatchObject({
      labelEn: cat.source_name_en,
      labelAr: cat.name_ar,
      defaultApproverRoleCode: cat.default_approver_role_code,
    });
    const tom = await call<Body>(api.app, "GET", `${V}/${PLAYBOOK_V1}/elements?elementType=tom_dimension`, {
      session: auditor,
    });
    expect(tom.body.items).toHaveLength(10);
    const phases = await call<Body>(api.app, "GET", `${V}/${PLAYBOOK_V1}/elements?elementType=phase`, {
      session: auditor,
    });
    expect(phases.body.items).toHaveLength(6);
    // Unfiltered: every type of the kind, paged by position; the pages join to the whole list.
    const all: Body[] = [];
    let cursor: string | null = null;
    do {
      const page: Body = await call<Body>(
        api.app,
        "GET",
        `${V}/${PLAYBOOK_V1}/elements?limit=50${cursor ? `&cursor=${cursor}` : ""}`,
        { session: auditor },
      );
      all.push(...page.body.items);
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    expect(all.filter((e) => e.elementType === "source_element")).toHaveLength(80);
    expect(all.every((e) => !e.overridden)).toBe(true);
  });

  it("a version's row overrides the catalogue; removed elements only with includeRemoved; other kinds' types are empty", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await createDraft(base.id);
    await putElementAsOwner(api, draft.body.id, {
      elementType: "gate",
      stableKey: "G3",
      attributes: { labelEn: "Gate 3 (synthetic rename)" },
    });
    await putElementAsOwner(api, draft.body.id, {
      elementType: "template",
      stableKey: "T13",
      removed: true,
      attributes: {},
    });
    await putElementAsOwner(api, draft.body.id, {
      elementType: "checklist_item",
      stableKey: "synthetic.check",
      origin: "admin",
      ordinal: 1,
      attributes: { labelEn: "Synthetic check", gateCode: "G2", mandatory: true },
    });
    const gates = await call<Body>(api.app, "GET", `${V}/${draft.body.id}/elements?elementType=gate`, {
      session: admin,
    });
    const g3 = gates.body.items.find((g: Body) => g.stableKey === "G3");
    expect(g3).toMatchObject({ overridden: true, attributes: { labelEn: "Gate 3 (synthetic rename)" } });
    expect(g3.catalogueAttributes.labelEn).not.toBe("Gate 3 (synthetic rename)");
    expect(g3.attributes.defaultApproverRoleCode).toBe(g3.catalogueAttributes.defaultApproverRoleCode);
    const templates = (q: string) =>
      call<Body>(api.app, "GET", `${V}/${draft.body.id}/elements?elementType=template${q}`, { session: admin });
    expect((await templates("")).body.items.map((t: Body) => t.stableKey)).not.toContain("T13");
    const withRemoved = (await templates("&includeRemoved=true")).body.items;
    expect(withRemoved.find((t: Body) => t.stableKey === "T13")).toMatchObject({ removed: true, overridden: true });
    const checks = await call<Body>(api.app, "GET", `${V}/${draft.body.id}/elements?elementType=checklist_item`, {
      session: admin,
    });
    expect(checks.body.items).toEqual([
      {
        elementType: "checklist_item",
        stableKey: "synthetic.check",
        origin: "admin",
        removed: false,
        ordinal: 1,
        sourceRef: null,
        catalogueAttributes: {},
        attributes: { labelEn: "Synthetic check", gateCode: "G2", mandatory: true },
        overridden: true,
      },
    ]);
    const weights = await call<Body>(api.app, "GET", `${V}/${draft.body.id}/elements?elementType=scoring_weight`, {
      session: admin,
    });
    expect(weights.body.items).toEqual([]);
    // The playbook v1 catalogue is unchanged by the draft's rows.
    const v1 = await call<Body>(api.app, "GET", `${V}/${PLAYBOOK_V1}/elements?elementType=gate`, { session: admin });
    expect(v1.body.items[2].overridden).toBe(false);
  });
});

describe("ConfigResolver and pins (ADR-0039 §3)", () => {
  it("an unpinned kind resolves to version 1 of its default key, never the latest; a pin wins", async () => {
    // A transformation row without instantiation: no pin of any kind.
    const bare = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const pins = await call<Body>(api.app, "GET", `/api/v1/transformations/${bare}/config-pins`, { session: office });
    expect(pins.status).toBe(200);
    expect(pins.body.items).toEqual([
      {
        kind: "methodology",
        versionId: PLAYBOOK_V1,
        key: "playbook",
        versionNo: 1,
        pinned: false,
        lastMigrationId: null,
        pinnedAt: null,
        version: null,
      },
      {
        kind: "scoring_defaults",
        versionId: SCORING_V1,
        key: "scoring-defaults",
        versionNo: 1,
        pinned: false,
        lastMigrationId: null,
        pinnedAt: null,
        version: null,
      },
      // T-DG5-BE-D (ADR-0041 §2): form_schema has its default key `forms` (0068 seeds v1), so it resolves too.
      {
        kind: "form_schema",
        versionId: "01920005-0200-7000-8000-000000000001",
        key: "forms",
        versionNo: 1,
        pinned: false,
        lastMigrationId: null,
        pinnedAt: null,
        version: null,
      },
      // T-DG5-KBE-G (ADR-0048 §5, §6): health_check_scheme has its default key `health-check` (0086 seeds v1).
      {
        kind: "health_check_scheme",
        versionId: "01920005-0860-7000-8000-000000000001",
        key: "health-check",
        versionNo: 1,
        pinned: false,
        lastMigrationId: null,
        pinnedAt: null,
        version: null,
      },
    ]);
    const resolver = createConfigResolver();
    expect(await resolver.pinnedVersion(api.db, bare, "methodology")).toEqual({
      versionId: PLAYBOOK_V1,
      versionNo: 1,
      key: "playbook",
    });
    await expect(resolver.pinnedVersion(api.db, bare, "procedure")).rejects.toThrow(/no resolvable version/);

    // A transformation created through the API is pinned to methodology by the DG2 instantiation.
    const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
      session: office,
      headers: { "idempotency-key": `pins-${crypto.randomUUID()}` },
      body: { businessUnitId: w.a1, name: "Synthetic pinned", mode: "modular", entryPhase: "define" },
    });
    const pinned = await call<Body>(api.app, "GET", `/api/v1/transformations/${t.body.id}/config-pins`, {
      session: auditor,
    });
    const m = pinned.body.items.find((p: Body) => p.kind === "methodology");
    expect(m).toMatchObject({ pinned: true, key: "playbook", lastMigrationId: null, version: 1 });
    expect(m.pinnedAt).not.toBeNull();
    for (const p of pinned.body.items.filter((x: Body) => !x.pinned)) expect(p.versionNo).toBe(1);
    const history = await call<Body>(api.app, "GET", `/api/v1/transformations/${t.body.id}/config-pins/history`, {
      session: auditor,
    });
    expect([history.status, history.body]).toEqual([200, { items: [], nextCursor: null }]);
  });

  it("pins are scoped per transformation: outside scope 404 (TO of another organization, TL of another unit)", async () => {
    const t = await createTransformationRow(api.db, w.orgA.id, w.a2, w.office.id);
    const officeB = await signIn(api.app, w.officeB.subject);
    const leadA1 = await signIn(api.app, w.leadA1.subject);
    for (const s of [officeB, leadA1]) {
      expect((await call(api.app, "GET", `/api/v1/transformations/${t}/config-pins`, { session: s })).status).toBe(404);
      expect(
        (await call(api.app, "GET", `/api/v1/transformations/${t}/config-pins/history`, { session: s })).status,
      ).toBe(404);
    }
    expect((await call(api.app, "GET", `/api/v1/transformations/${t}/config-pins`, { session: admin })).status).toBe(
      200,
    );
  });

  it("withDraft resolves the draft's kind to the draft and persists nothing", async () => {
    const base = await seedStudioBase(api, "methodology");
    const draft = await createDraft(base.id);
    const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const sandbox = createConfigResolver().withDraft(draft.body.id);
    expect(await sandbox.pinnedVersion(api.db, t, "methodology")).toEqual({
      versionId: draft.body.id,
      versionNo: 2,
      key: base.key,
    });
    expect((await sandbox.pinnedVersion(api.db, t, "scoring_defaults")).versionId).toBe(SCORING_V1);
    const pins = await api.db
      .selectFrom("transformation_config_pin")
      .select("id")
      .where("transformation_id", "=", t)
      .execute();
    expect(pins).toEqual([]);
  });
});
