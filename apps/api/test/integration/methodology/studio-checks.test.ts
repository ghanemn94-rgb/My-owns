// Playbook Studio element edits, invariants, diff, affected records, compatibility and preview (ADR-0039 §2, §5, §9,
// §11-§13; REQ-S06-004 (slice A part), REQ-S06-006, REQ-S06-007 (slice A part); p5-work-split §A.2; T-DG5-BE-B)
// against a real PostgreSQL:
//  - REQ-S06-006 literal: renaming G3's label succeeds; changing its stable key -> 422 config_version.stable_id_change;
//    deleting a TOM dimension -> 422 config_version.source_element_protected; ADM_METHOD as approver -> 422
//    config_version.admin_approver_forbidden; a gate approver outside the DG2 allowed set -> 422
//    config_version.approver_not_allowed;
//  - deleting T13 in a draft is recorded; the diff lists added, removed and changed elements; preview writes nothing but
//    its run (and the stage step on pass); compatibility is `warn` for a changed approver and `fail` for an unknown role;
//    affected records count live, and Unknown is never 0;
//  - every mutation: ADM_METHOD positive; AUD, TO and BO 403; If-Match 428/409; one audit event per row written;
//    authorization re-checked at commit time (403, nothing written); a published version -> 409 not_editable.
// Each test seeds its own synthetic base key (test/support/studio-fixtures.ts), so parallel suites never share a draft.
// All data is synthetic; nothing here approves anything or touches the engineering gates DG0-DG7.
import { createDb, insertAuditEvent } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";
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
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const actions = async (recordId: string) => (await auditOf(api.db, recordId)).map((a) => a.action);
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];

/** A fresh draft of a fresh synthetic methodology base; returns the draft body. */
async function freshDraft(): Promise<{ id: string; key: string; baseId: string }> {
  const base = await seedStudioBase(api, "methodology");
  const res = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(res.status).toBe(201);
  return { id: res.body.id, key: base.key, baseId: base.id };
}
const putEl = (id: string, type: string, key: string, version: number, body: Record<string, unknown>, s = admin) =>
  call<Body>(api.app, "PUT", `${V}/${id}/elements/${type}/${key}`, { session: s, headers: ifm(version), body });
const removeEl = (id: string, type: string, key: string, version: number, s = admin) =>
  call<Body>(api.app, "POST", `${V}/${id}/elements/${type}/${key}/remove`, { session: s, headers: ifm(version) });
const elementRows = (id: string) =>
  api.db.selectFrom("methodology_element").selectAll().where("methodology_version_id", "=", id).execute();

describe("putConfigElement and the REQ-S06-006 invariants (ADR-0039 §2, §13)", () => {
  it("renaming G3's label succeeds: one element row, the hash recomputed, one audit event per row written", async () => {
    const d = await freshDraft();
    const before = await call<Body>(api.app, "GET", `${V}/${d.id}`, { session: admin });
    const res = await putEl(d.id, "gate", "G3", 1, {
      attributes: { labelEn: "G3 - Target State (renamed, synthetic)" },
    });
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBe('"2"');
    expect(res.body).toMatchObject({ version: 2, draftStage: "editing" });
    expect(res.body.contentSha256).not.toBe(before.body.contentSha256);
    const rows = await elementRows(d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ element_type: "gate", stable_key: "G3", origin: "source", removed: false });
    const g3 = await call<Body>(api.app, "GET", `${V}/${d.id}/elements?elementType=gate`, { session: auditor });
    const resolved = g3.body.items.find((e: Body) => e.stableKey === "G3");
    expect(resolved.attributes.labelEn).toBe("G3 - Target State (renamed, synthetic)");
    expect(resolved.catalogueAttributes.labelEn).toBe("G3 - Target State");
    expect(resolved.attributes.defaultApproverRoleCode).toBe("SP"); // unchanged attributes stay the catalogue's
    // The catalogue (stable-identity registry) is untouched.
    const cat = await api.db
      .selectFrom("gate_definition")
      .select("source_name_en")
      .where("code", "=", "G3")
      .executeTakeFirstOrThrow();
    expect(cat.source_name_en).toBe("G3 - Target State");
    expect(await actions(rows[0]!.id)).toEqual(["methodology_element.put"]);
    expect(await actions(d.id)).toEqual(["methodology_version.create_draft", "methodology_version.element_put"]);
    // A second put updates the same row (version +1 on the element and the draft).
    const again = await putEl(d.id, "gate", "G3", 2, { attributes: { labelEn: "G3 again", labelAr: "ب٣ تجريبي" } });
    expect(again.status).toBe(200);
    const updated = await elementRows(d.id);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ version: 2 });
    expect(await actions(rows[0]!.id)).toEqual(["methodology_element.put", "methodology_element.put"]);
  });

  it("changing G3's stable key, origin or position is refused with 422 config_version.stable_id_change", async () => {
    const d = await freshDraft();
    for (const attributes of [{ stableKey: "G9" }, { code: "G7" }, { key: "G3x" }, { elementType: "phase" }]) {
      const res = await putEl(d.id, "gate", "G3", 1, { attributes });
      expect(codeOf(res)).toEqual([422, "config_version.stable_id_change"]);
      expect(res.body.detail).toBe("Stable identifiers cannot be changed. Change the label instead.");
    }
    expect(codeOf(await putEl(d.id, "gate", "G3", 1, { attributes: {}, ordinal: 5 }))).toEqual([
      422,
      "config_version.stable_id_change",
    ]);
    // A seventh gate cannot be added, nor a gate claimed as admin-authored.
    const seventh = await putEl(d.id, "gate", "G7", 1, { attributes: { labelEn: "G7" } });
    expect(codeOf(seventh)).toEqual([422, "config_version.source_element_protected"]);
    expect(seventh.body.detail).toBe("Source phases, gates and TOM dimensions cannot be added or deleted.");
    expect(codeOf(await putEl(d.id, "gate", "G3", 1, { origin: "admin", attributes: {} }))).toEqual([
      422,
      "config_version.source_element_protected",
    ]);
    // An admin-authored element keeps its origin.
    expect(
      (await putEl(d.id, "checklist_item", "synthetic-check", 1, { attributes: { labelEn: "Check" } })).status,
    ).toBe(200);
    expect(
      codeOf(await putEl(d.id, "checklist_item", "synthetic-check", 2, { origin: "source", attributes: {} })),
    ).toEqual([422, "config_version.stable_id_change"]);
    // Same-value identity fields are accepted and never stored.
    expect((await putEl(d.id, "gate", "G3", 2, { attributes: { stableKey: "G3", labelEn: "ok" } })).status).toBe(200);
    const g3 = (await elementRows(d.id)).find((r) => r.stable_key === "G3");
    expect(g3?.attributes).toEqual({ labelEn: "ok" });
  });

  it("an administrator role or AUD as approver -> 422 admin_approver_forbidden; outside the DG2 set -> 422 approver_not_allowed", async () => {
    const d = await freshDraft();
    for (const role of ["ADM_METHOD", "ADM_TECH", "ADM_ACCESS", "AUD"]) {
      const gate = await putEl(d.id, "gate", "G3", 1, { attributes: { defaultApproverRoleCode: role } });
      expect(codeOf(gate)).toEqual([422, "config_version.admin_approver_forbidden"]);
      expect(gate.body.detail).toBe("An administrator role or the auditor cannot be configured as an approver.");
      const route = await putEl(d.id, "approver_route", "t13.submission", 1, {
        attributes: { approverRoleCodes: ["SP", role] },
      });
      expect(codeOf(route)).toEqual([422, "config_version.admin_approver_forbidden"]);
    }
    const outside = await putEl(d.id, "gate", "G3", 1, { attributes: { defaultApproverRoleCode: "TO" } });
    expect(codeOf(outside)).toEqual([422, "config_version.approver_not_allowed"]);
    expect(outside.body.detail).toBe("This role is not an allowed approver for this gate.");
    expect(
      codeOf(await putEl(d.id, "approver_route", "gate.G1", 1, { attributes: { approverRoleCode: "BO" } })),
    ).toEqual([422, "config_version.approver_not_allowed"]);
    expect(
      codeOf(await putEl(d.id, "approver_route", "gate.G9", 1, { attributes: { approverRoleCode: "SP" } })),
    ).toEqual([422, "config_version.unknown_element"]);
    // Nothing was written by any refusal.
    expect(await elementRows(d.id)).toEqual([]);
    // Inside the allowed set: G3 may be approved by BO (DG2 allowed set SP, BO).
    expect((await putEl(d.id, "gate", "G3", 1, { attributes: { defaultApproverRoleCode: "BO" } })).status).toBe(200);
  });

  it("refuses an element type of another kind, an unknown source identity and a malformed attribute", async () => {
    const d = await freshDraft();
    expect(
      codeOf(await putEl(d.id, "scoring_weight", "feasibility", 1, { attributes: { weightPercent: "10" } })),
    ).toEqual([422, "config_version.unknown_element"]);
    expect(codeOf(await putEl(d.id, "template", "T99", 1, { origin: "source", attributes: {} }))).toEqual([
      422,
      "config_version.unknown_element",
    ]);
    const bad = await putEl(d.id, "reminder", "synthetic-reminder", 1, { attributes: { offsetWorkingDays: 1.5 } });
    expect(bad.status).toBe(400);
    const extra = await putEl(d.id, "gate", "G3", 1, { attributes: { notAnAttribute: true } });
    expect(extra.status).toBe(400);
    expect(await elementRows(d.id)).toEqual([]);
  });
});

describe("removeConfigElement (ADR-0039 §2)", () => {
  it("deleting a TOM dimension, a phase or a gate is refused with 422 source_element_protected", async () => {
    const d = await freshDraft();
    for (const [type, key] of [
      ["tom_dimension", "technology"],
      ["phase", "design"],
      ["gate", "G3"],
    ] as const) {
      const res = await removeEl(d.id, type, key, 1);
      expect(codeOf(res)).toEqual([422, "config_version.source_element_protected"]);
    }
    expect(await elementRows(d.id)).toEqual([]);
  });

  it("deleting T13 in a draft is recorded (removed = true), resolves as removed and is audited", async () => {
    const d = await freshDraft();
    const res = await removeEl(d.id, "template", "T13", 1);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    const rows = await elementRows(d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ element_type: "template", stable_key: "T13", origin: "source", removed: true });
    const visible = await call<Body>(api.app, "GET", `${V}/${d.id}/elements?elementType=template`, { session: admin });
    expect(visible.body.items.map((e: Body) => e.stableKey)).not.toContain("T13");
    const all = await call<Body>(api.app, "GET", `${V}/${d.id}/elements?elementType=template&includeRemoved=true`, {
      session: admin,
    });
    expect(all.body.items.find((e: Body) => e.stableKey === "T13")).toMatchObject({ removed: true });
    expect(await actions(rows[0]!.id)).toEqual(["methodology_element.remove"]);
    expect(await actions(d.id)).toEqual(["methodology_version.create_draft", "methodology_version.element_remove"]);
    // Removing it again changes nothing and writes nothing.
    const again = await removeEl(d.id, "template", "T13", 2);
    expect(again.status).toBe(200);
    expect(again.body.version).toBe(2);
    expect(await actions(d.id)).toHaveLength(2);
    // A put restores it.
    expect(
      (await putEl(d.id, "template", "T13", 2, { attributes: { labelEn: "Template 13 (restored)" } })).status,
    ).toBe(200);
    expect((await elementRows(d.id))[0]).toMatchObject({ removed: false, version: 2 });
    // An unknown element cannot be removed.
    expect(codeOf(await removeEl(d.id, "template", "T99", 3))).toEqual([422, "config_version.unknown_element"]);
  });
});

describe("every element mutation: authorization, If-Match, editability", () => {
  it("AUD, TO and BO get 403 on every write; nothing is written", async () => {
    const d = await freshDraft();
    for (const s of [auditor, office, bo]) {
      expect((await putEl(d.id, "gate", "G3", 1, { attributes: { labelEn: "x" } }, s)).status).toBe(403);
      expect((await removeEl(d.id, "template", "T13", 1, s)).status).toBe(403);
      for (const path of ["compatibility-checks", "preview"])
        expect(
          (
            await call(api.app, "POST", `${V}/${d.id}/${path}`, {
              session: s,
              headers: ifm(1),
              body: path === "preview" ? { samples: [] } : undefined,
            })
          ).status,
        ).toBe(403);
    }
    expect(await elementRows(d.id)).toEqual([]);
    expect(await actions(d.id)).toEqual(["methodology_version.create_draft"]);
    const runs = await api.db
      .selectFrom("config_check_run")
      .select("id")
      .where("methodology_version_id", "=", d.id)
      .execute();
    expect(runs).toEqual([]);
  });

  it("If-Match: 428 when missing, 409 when stale", async () => {
    const d = await freshDraft();
    const missing = await call<Body>(api.app, "PUT", `${V}/${d.id}/elements/gate/G3`, {
      session: admin,
      body: { attributes: { labelEn: "x" } },
    });
    expect(missing.status).toBe(428);
    expect((await call(api.app, "POST", `${V}/${d.id}/elements/template/T13/remove`, { session: admin })).status).toBe(
      428,
    );
    expect((await call(api.app, "POST", `${V}/${d.id}/compatibility-checks`, { session: admin })).status).toBe(428);
    expect(
      (await call(api.app, "POST", `${V}/${d.id}/preview`, { session: admin, body: { samples: [] } })).status,
    ).toBe(428);
    expect((await putEl(d.id, "gate", "G3", 7, { attributes: { labelEn: "x" } })).status).toBe(409);
    expect((await removeEl(d.id, "template", "T13", 7)).status).toBe(409);
    for (const path of ["compatibility-checks", "preview"])
      expect(
        (
          await call(api.app, "POST", `${V}/${d.id}/${path}`, {
            session: admin,
            headers: ifm(7),
            body: { samples: [] },
          })
        ).status,
      ).toBe(409);
    expect(await elementRows(d.id)).toEqual([]);
  });

  it("a published version is not editable: 409 config_version.not_editable", async () => {
    const base = await seedStudioBase(api, "methodology");
    const res = await putEl(base.id, "gate", "G3", 1, { attributes: { labelEn: "x" } });
    expect(codeOf(res)).toEqual([409, "config_version.not_editable"]);
    expect(res.body.detail).toBe(
      "This configuration version is published or no longer being edited. Create a new draft to change it.",
    );
    expect(codeOf(await removeEl(base.id, "template", "T13", 1))).toEqual([409, "config_version.not_editable"]);
    expect(
      codeOf(
        await call<Body>(api.app, "POST", `${V}/${base.id}/compatibility-checks`, { session: admin, headers: ifm(1) }),
      ),
    ).toEqual([409, "config_version.not_editable"]);
    expect(
      codeOf(
        await call<Body>(api.app, "POST", `${V}/${base.id}/preview`, {
          session: admin,
          headers: ifm(1),
          body: { samples: [] },
        }),
      ),
    ).toEqual([409, "config_version.not_editable"]);
  });

  it("re-checks authorization at commit time: a grant revoked mid-request gives 403 and writes nothing", async () => {
    const d = await freshDraft();
    for (const send of [
      (s: Session) => putEl(d.id, "gate", "G3", 1, { attributes: { labelEn: "late" } }, s),
      (s: Session) => removeEl(d.id, "template", "T13", 1, s),
      (s: Session) => call(api.app, "POST", `${V}/${d.id}/compatibility-checks`, { session: s, headers: ifm(1) }),
      (s: Session) =>
        call(api.app, "POST", `${V}/${d.id}/preview`, { session: s, headers: ifm(1), body: { samples: [] } }),
    ]) {
      const u = await methodologyAdmin(api.db, w);
      const s = await signIn(api.app, u.subject);
      const res = await afterIdentity(
        api,
        u.id,
        () => send(s),
        () => revokeAll(api, w.grantor.id, u.id),
      );
      expect(res.status).toBe(403);
    }
    expect(await elementRows(d.id)).toEqual([]);
    const runs = await api.db
      .selectFrom("config_check_run")
      .select("id")
      .where("methodology_version_id", "=", d.id)
      .execute();
    expect(runs).toEqual([]);
    expect(await actions(d.id)).toEqual(["methodology_version.create_draft"]);
  });
});

describe("getConfigVersionDiff (ADR-0039 §5)", () => {
  it("lists added, removed and changed elements with field-level from/to, against the base by default", async () => {
    const d = await freshDraft();
    let v = 1;
    expect(
      (await putEl(d.id, "gate", "G3", v++, { attributes: { labelEn: "Renamed G3", defaultApproverRoleCode: "BO" } }))
        .status,
    ).toBe(200);
    expect((await removeEl(d.id, "template", "T13", v++)).status).toBe(200);
    expect(
      (
        await putEl(d.id, "checklist_item", "synthetic-item", v++, {
          ordinal: 1,
          attributes: { labelEn: "New item", gateCode: "G3", mandatory: true },
        })
      ).status,
    ).toBe(200);
    const patched = await call<Body>(api.app, "PATCH", `${V}/${d.id}`, {
      session: admin,
      headers: ifm(v++),
      body: { titleEn: "Synthetic v2" },
    });
    expect(patched.status).toBe(200);
    const res = await call<Body>(api.app, "GET", `${V}/${d.id}/diff`, { session: auditor });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fromVersionId: d.baseId,
      toVersionId: d.id,
      titleChanged: true,
      definitionChanged: false,
    });
    const byKey = new Map(res.body.entries.map((e: Body) => [`${e.elementType}:${e.stableKey}`, e]));
    expect(byKey.size).toBe(3);
    expect(byKey.get("gate:G3")).toEqual({
      elementType: "gate",
      stableKey: "G3",
      change: "changed",
      fields: [
        { field: "defaultApproverRoleCode", from: "SP", to: "BO" },
        { field: "labelEn", from: "G3 - Target State", to: "Renamed G3" },
      ],
    });
    expect(byKey.get("template:T13")).toMatchObject({ change: "removed" });
    expect(byKey.get("checklist_item:synthetic-item")).toMatchObject({
      change: "added",
      fields: expect.arrayContaining([{ field: "labelEn", from: null, to: "New item" }]),
    });
    // Against itself: no entries. Against a version of another configuration: 404 (not in this lineage).
    const self = await call<Body>(api.app, "GET", `${V}/${d.id}/diff?against=${d.id}`, { session: admin });
    expect(self.body.entries).toEqual([]);
    const other = await seedStudioBase(api, "methodology");
    expect((await call(api.app, "GET", `${V}/${d.id}/diff?against=${other.id}`, { session: admin })).status).toBe(404);
  });
});

/** A transformation of org A pinned (as the owner, audited) to `versionId`, with a G3 gate instance. */
async function pinnedTransformation(versionId: string): Promise<{ id: string; code: string }> {
  const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.admin.id);
  const owner = createDb(api.owner);
  await owner.transaction().execute(async (tx) => {
    const pinId = uuidv7();
    await tx
      .insertInto("transformation_config_pin")
      .values({
        id: pinId,
        organization_id: w.orgA.id,
        transformation_id: t,
        kind: "methodology",
        methodology_version_id: versionId,
        pinned_by: w.admin.id,
        created_by: w.admin.id,
        updated_by: w.admin.id,
      })
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "transformation_config_pin",
      recordId: pinId,
      organizationId: w.orgA.id,
      newVersion: 1,
    });
    const gateId = uuidv7();
    await tx
      .insertInto("gate_instance")
      .values({
        id: gateId,
        organization_id: w.orgA.id,
        transformation_id: t,
        gate_code: "G3",
        approver_role_code: "SP",
        created_by: w.admin.id,
        updated_by: w.admin.id,
      })
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "gate_instance",
      recordId: gateId,
      organizationId: w.orgA.id,
      newVersion: 1,
    });
  });
  const row = await api.db.selectFrom("transformation").select("code").where("id", "=", t).executeTakeFirstOrThrow();
  return { id: t, code: row.code };
}

describe("getConfigAffectedRecords (ADR-0039 §5, §12)", () => {
  it("counts the records each pinned transformation of the lineage has for the changed elements; Unknown is never 0", async () => {
    const d = await freshDraft();
    const t = await pinnedTransformation(d.baseId);
    const empty = await call<Body>(api.app, "GET", `${V}/${d.id}/affected-records`, { session: auditor });
    expect(empty.status).toBe(200);
    expect(empty.body.transformations).toEqual([
      { transformationId: t.id, code: t.code, pinnedVersionId: d.baseId, records: [] },
    ]);
    expect((await putEl(d.id, "gate", "G3", 1, { attributes: { defaultApproverRoleCode: "BO" } })).status).toBe(200);
    expect(
      (await putEl(d.id, "tom_dimension", "technology", 2, { attributes: { labelEn: "Technology (synthetic)" } }))
        .status,
    ).toBe(200);
    expect((await removeEl(d.id, "template", "T13", 3)).status).toBe(200);
    const res = await call<Body>(api.app, "GET", `${V}/${d.id}/affected-records`, { session: admin });
    expect(res.status).toBe(200);
    const records = res.body.transformations[0].records;
    expect(records).toEqual(
      expect.arrayContaining([
        { recordType: "gate_instance", count: 1, unknownReason: null },
        { recordType: "tom_canvas_cell", count: 0, unknownReason: null },
        { recordType: "template", count: null, unknownReason: "affected_records.no_counter" },
      ]),
    );
    // A caller of another organization sees none of org A's transformations.
    const otherAdmin = await createUser(api.db, w.orgB.id);
    await grant(api.db, w.grantor.id, otherAdmin.id, "ADM_METHOD", { type: "organization", id: w.orgB.id }, w.orgB.id);
    const b = await call<Body>(api.app, "GET", `${V}/${d.id}/affected-records`, {
      session: await signIn(api.app, otherAdmin.subject),
    });
    expect(b.status).toBe(200);
    expect(b.body.transformations).toEqual([]);
  });
});

describe("runConfigCompatibilityCheck (ADR-0039 §5)", () => {
  const compat = async (id: string, version: number) =>
    call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, { session: admin, headers: ifm(version) });

  it("label-only changes pass; a changed approver warns and lists the pinned transformations; an unknown role fails", async () => {
    const d = await freshDraft();
    const t = await pinnedTransformation(d.baseId);
    expect((await putEl(d.id, "gate", "G3", 1, { attributes: { labelEn: "Label only" } })).status).toBe(200);
    const pass = await compat(d.id, 2);
    expect(pass.status).toBe(201);
    expect(pass.headers["location"]).toBe(`${V}/${d.id}/check-runs`);
    expect(pass.body).toMatchObject({ versionId: d.id, checkKind: "compatibility", result: "pass", runBy: adminId });
    expect(pass.body.report.compatible).toEqual([{ elementType: "gate", stableKey: "G3", change: "changed" }]);
    expect(await actions(pass.body.id)).toEqual(["config_check_run.compatibility"]);

    expect(
      (await putEl(d.id, "gate", "G3", 2, { attributes: { labelEn: "Label only", defaultApproverRoleCode: "BO" } }))
        .status,
    ).toBe(200);
    const warn = await compat(d.id, 3);
    expect(warn.body.result).toBe("warn");
    expect(warn.body.report.findings).toEqual([
      expect.objectContaining({
        severity: "warn",
        code: "compatibility.approver_changed",
        elementType: "gate",
        stableKey: "G3",
      }),
    ]);
    expect(warn.body.report.affectedTransformations).toEqual([
      { transformationId: t.id, code: t.code, pinnedVersionId: d.baseId },
    ]);
    expect(warn.body.contentSha256).not.toBe(pass.body.contentSha256);

    expect(
      (
        await putEl(d.id, "reminder", "synthetic-reminder", 3, {
          attributes: { offsetWorkingDays: 2, recipientRoleCode: "ZZ_NO_SUCH_ROLE" },
        })
      ).status,
    ).toBe(200);
    const fail = await compat(d.id, 4);
    expect(fail.body.result).toBe("fail");
    expect(fail.body.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "fail",
          code: "compatibility.unknown_reference",
          stableKey: "synthetic-reminder",
          params: { reference: "role", value: "ZZ_NO_SUCH_ROLE" },
        }),
      ]),
    );
    // The run does not step the draft; the version's latest check summary shows the newest run for its hash.
    const v = await call<Body>(api.app, "GET", `${V}/${d.id}`, { session: admin });
    expect(v.body.version).toBe(4);
    expect(v.body.latestChecks.compatibility).toMatchObject({ checkRunId: fail.body.id, result: "fail" });
  });

  it("a removed element and a new mandatory element warn", async () => {
    const d = await freshDraft();
    expect((await removeEl(d.id, "template", "T13", 1)).status).toBe(200);
    expect(
      (
        await putEl(d.id, "mandatory_artifact", "synthetic-artifact", 2, {
          attributes: { gateCode: "G2", mandatory: true },
        })
      ).status,
    ).toBe(200);
    const res = await compat(d.id, 3);
    expect(res.body.result).toBe("warn");
    expect(res.body.report.findings.map((f: Body) => f.code).sort()).toEqual([
      "compatibility.element_removed",
      "compatibility.required_element_added",
    ]);
  });
});

describe("runConfigPreview: the sandbox writes nothing but its run (ADR-0039 §5)", () => {
  const preview = (id: string, version: number, samples: unknown[]) =>
    call<Body>(api.app, "POST", `${V}/${id}/preview`, { session: admin, headers: ifm(version), body: { samples } });

  it("a passing preview records one run and moves the stage editing -> preview; samples route through the draft", async () => {
    const d = await freshDraft();
    expect((await putEl(d.id, "gate", "G3", 1, { attributes: { defaultApproverRoleCode: "BO" } })).status).toBe(200);
    expect(
      (
        await putEl(d.id, "approver_route", "t13.submission", 2, {
          attributes: { approverRoleCodes: ["SP", "BO"], mode: "sequential" },
        })
      ).status,
    ).toBe(200);
    const elementsBefore = await elementRows(d.id);
    const res = await preview(d.id, 3, [
      { kind: "submission", input: { routeKey: "gate.G3" } },
      { kind: "submission", input: { routeKey: "t13.submission" } },
      {
        kind: "formula",
        input: {
          expression: "a * 2",
          variables: [{ name: "a", kind: "number", period: "none" }],
          inputs: { a: "1.5" },
        },
      },
    ]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ checkKind: "preview", result: "pass" });
    const results = res.body.report.samples.results;
    expect(results[0]).toMatchObject({ result: "pass", source: "gate_default", approverRoleCodes: ["BO"] });
    expect(results[1]).toMatchObject({
      result: "pass",
      source: "approver_route",
      approverRoleCodes: ["SP", "BO"],
      mode: "sequential",
    });
    expect(results[2]).toMatchObject({ result: "pass", value: "3" });
    const v = await call<Body>(api.app, "GET", `${V}/${d.id}`, { session: admin });
    expect(v.body).toMatchObject({ draftStage: "preview", version: 4 });
    expect(v.body.latestChecks.preview).toMatchObject({ checkRunId: res.body.id, result: "pass" });
    // Nothing else was written: the element rows are unchanged, one run, two audit events (run + stage step).
    expect(await elementRows(d.id)).toEqual(elementsBefore);
    const runs = await api.db
      .selectFrom("config_check_run")
      .select("id")
      .where("methodology_version_id", "=", d.id)
      .execute();
    expect(runs).toHaveLength(1);
    expect(await actions(res.body.id)).toEqual(["config_check_run.preview"]);
    expect((await actions(d.id)).at(-1)).toBe("methodology_version.preview");
    // An edit in preview returns the draft to editing (the run stays recorded for the old hash).
    const edited = await putEl(d.id, "gate", "G3", 4, { attributes: { defaultApproverRoleCode: "SP" } });
    expect(edited.body).toMatchObject({ draftStage: "editing", latestChecks: { preview: null } });
  });

  it("a failing sample records a fail run and leaves the stage in editing; the sandbox transaction is read-only", async () => {
    const d = await freshDraft();
    const res = await preview(d.id, 1, [
      { kind: "submission", input: { routeKey: "t99.unknown" } },
      { kind: "record", recordType: "t13", input: { title: "x" } },
      { kind: "formula", input: { expression: "1 +" } },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.result).toBe("fail");
    expect(res.body.report.samples.results.map((r: Body) => r.code)).toEqual([
      "preview.route_unknown",
      "preview.sample_not_supported",
      "formula.syntax",
    ]);
    const v = await call<Body>(api.app, "GET", `${V}/${d.id}`, { session: admin });
    expect(v.body).toMatchObject({ draftStage: "editing", version: 1 });
    expect(await actions(d.id)).toEqual(["methodology_version.create_draft"]);
  });

  it("listConfigCheckRuns lists the runs newest first, filtered by kind, with a cursor", async () => {
    const d = await freshDraft();
    const a = await call<Body>(api.app, "POST", `${V}/${d.id}/compatibility-checks`, {
      session: admin,
      headers: ifm(1),
    });
    const b = await preview(d.id, 1, []);
    const c = await call<Body>(api.app, "POST", `${V}/${d.id}/compatibility-checks`, {
      session: admin,
      headers: ifm(2),
    });
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    const all = await call<Body>(api.app, "GET", `${V}/${d.id}/check-runs`, { session: auditor });
    expect(all.body.items.map((r: Body) => r.id)).toEqual([c.body.id, b.body.id, a.body.id]);
    const page1 = await call<Body>(api.app, "GET", `${V}/${d.id}/check-runs?checkKind=compatibility&limit=1`, {
      session: auditor,
    });
    expect(page1.body.items.map((r: Body) => r.id)).toEqual([c.body.id]);
    const page2 = await call<Body>(
      api.app,
      "GET",
      `${V}/${d.id}/check-runs?checkKind=compatibility&limit=1&cursor=${page1.body.nextCursor}`,
      { session: auditor },
    );
    expect(page2.body).toMatchObject({ items: [{ id: a.body.id }], nextCursor: null });
  });
});
