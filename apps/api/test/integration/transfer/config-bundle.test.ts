// T-D1…T-D5 and T-D8 (ADR-0065 §2-§9; p7-work-split §D.1, §D.3; T-DG7-BE-F): the nine configuration-bundle operations
// on a scratch database of this run's disposable PostgreSQL cluster (Studio versions and job schedules are
// installation-wide, so no other suite shares it).
//   T-D1 an unknown bundleSchemaVersion ("mth-config-bundle/2", "", missing) is 422 schema_version_unsupported, and
//        no row and no object are written;
//   T-D2 a changed content under the old contentSha256 is 422 checksum_mismatch; an invalid item is 422 item_invalid
//        with its pointer; 5 MiB + 1 byte is 413 config_bundle.too_large;
//   T-D3 the plan: create_draft, new_draft, identical, conflict (the open draft is not touched) and refused (kind not
//        permitted, kind unavailable, reference missing); invalid is terminal;
//   T-D4 the commit writes DRAFTS for the Studio kinds (never published), job schedules arrive disabled, each write
//        has its kind's own audit event, and config_bundle.plan_changed writes nothing;
//   T-D5 ADM_TECH and ADM_METHOD only (AUD and a user without grants: 403 on all nine operations); an item of a kind
//        the caller cannot write is refused with config_bundle.kind_not_permitted; If-Match is required and checked;
//   T-D8 no source id appears in a bundle (every uuid in the file is exportId).
// Every value is SYNTHETIC. A bundle approves nothing (no G1-G6, Finance or IT approval) and touches no DG0-DG7 record.
import { createDb, createPool, migrate, sql, transferSha256, type Db } from "@mth/db";
import { canonicalBundleJson, contentSha256 } from "@mth/shared/transfer";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  call,
  createOrg,
  createUser,
  grant,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = { kind: string; itemCode: string; sourceVersionNo: number | null; contentSha256: string; content: any };

const BASE = "/api/v1/admin/config-bundles";
const MISSING = "01900000-0000-7000-8000-00000000beef";
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const sha = (content: unknown) => contentSha256(content, (t) => transferSha256(t));

let api: TestApi;
let scratch: string;
let owner: Db;
let orgId: string;
let both: Session; // ADM_METHOD + ADM_TECH + TO
let method: Session; // ADM_METHOD only
let tech: Session; // ADM_TECH only
let auditor: Session;
let nobody: Session;
let exported: { id: string; bundle: Body };

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const withOrg = (path: string) => `${path}${path.includes("?") ? "&" : "?"}organizationId=${orgId}`;
const upload = (session: Session, bundle: unknown, name = "bundle.json") =>
  send("POST", withOrg(`${BASE}/imports`), { session, body: bundle, headers: { "x-file-name": name } });
const validate = (session: Session, id: string, version: number) =>
  send("POST", `${BASE}/imports/${id}/validate`, { session, headers: { "if-match": `"${version}"` } });
const commit = (session: Session, id: string, version: number) =>
  send("POST", `${BASE}/imports/${id}/commit`, { session, headers: { "if-match": `"${version}"` } });

/** A bundle of `items` in the exported envelope (fresh exportId so it is a different file). */
function bundleOf(items: Item[]): Body {
  return { ...exported.bundle, items };
}
/** The item with its content changed and its hash recomputed. */
function changed(item: Item, patch: (c: Body) => Body): Item {
  const content = patch(structuredClone(item.content));
  return { ...item, content, contentSha256: sha(content) };
}
const itemOf = (kind: string, code?: string): Item => {
  const found = (exported.bundle.items as Item[]).find(
    (i) => i.kind === kind && (code === undefined || i.itemCode === code),
  );
  if (found === undefined) throw new Error(`no exported ${kind} ${code ?? ""}`);
  return found;
};

async function importRows(): Promise<number> {
  const r = await owner
    .selectFrom("config_bundle_import")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}
function storedImportObjects(): string[] {
  const dir = join(api.config.evidenceStorage.path, "transfer", "config-bundle-imports");
  return existsSync(dir) ? readdirSync(dir) : [];
}
/** An owner-role change of a job schedule's cron, with the audit event its guard requires (SYNTHETIC test setup). */
async function ownerSetCron(code: string, cron: string): Promise<void> {
  await owner.transaction().execute(async (tx) => {
    const row = await tx
      .updateTable("job_schedule")
      .set({ cron, version: sql<number>`version + 1` })
      .where("code", "=", code)
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    await sql`INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source)
      VALUES (${uuidv7()}, 'system', 'job_schedule.update', 'job_schedule', ${row.id}, ${row.version - 1}, ${row.version},
      'worker')`.execute(tx);
  });
}

async function auditActions(recordId: string): Promise<string[]> {
  const rows = await owner
    .selectFrom("audit_event")
    .select(["action", "seq"])
    .where("record_id", "=", recordId)
    .orderBy("seq")
    .execute();
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_config_bundle_api");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 3 }));
  api = await startApi({ database: scratch });
  const org = await createOrg(api.db);
  orgId = org.id;
  const grantor = await createUser(api.db, org.id);
  const scope = { type: "organization" as const, id: org.id };
  const mk = async (roles: string[]) => {
    const u = await createUser(api.db, org.id);
    for (const r of roles) await grant(api.db, grantor.id, u.id, r, scope, org.id);
    return signIn(api.app, u.subject);
  };
  both = await mk(["ADM_METHOD", "ADM_TECH", "TO"]);
  method = await mk(["ADM_METHOD"]);
  tech = await mk(["ADM_TECH"]);
  auditor = await mk(["AUD"]);
  nobody = await mk([]);
  // The organization's own non-draft settings, written through their existing operations (so they are exported).
  const put = await send("PUT", `/api/v1/admin/upload-policy?organizationId=${orgId}`, {
    session: both,
    headers: { "if-match": '"0"' },
    body: { allowedTypes: ["pdf", "png"], maxBytes: 1048576, reason: "Synthetic upload policy" },
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  const created = await send("POST", withOrg(`${BASE}/exports`), {
    session: both,
    body: { reason: "Synthetic export of every kind" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const download = await send("GET", `${BASE}/exports/${created.body.id}/download`, { session: both });
  expect(download.status).toBe(200);
  exported = { id: created.body.id, bundle: JSON.parse(download.raw.body) };
}, 240_000);

afterAll(async () => {
  await api?.close();
  await owner?.destroy();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("export (ADR-0065 §3) and T-D8", () => {
  it("writes the published configuration of every registered kind, stable keys only, and audits it", async () => {
    const b = exported.bundle;
    expect(b.bundleSchemaVersion).toBe("mth-config-bundle/1");
    expect(b.exportId).toBe(exported.id);
    const kinds = new Set((b.items as Item[]).map((i) => i.kind));
    for (const k of [
      "methodology",
      "scoring_defaults",
      "form_schema",
      "procedure",
      "job_schedule",
      "config_review_policy",
      "upload_policy",
    ])
      expect(kinds, k).toContain(k);
    // Every item's hash is the canonical hash of its content; items are ordered by kind (ADR order), then itemCode.
    for (const i of b.items as Item[]) expect(sha(i.content)).toBe(i.contentSha256);
    // T-D8: the only uuid in the whole file is exportId.
    const download = await send("GET", `${BASE}/exports/${exported.id}/download`, { session: both });
    const uuids = new Set((download.raw.body.match(UUID_G) ?? []).map((u) => u.toLowerCase()));
    expect([...uuids]).toEqual([exported.id]);
    expect(download.headers["etag"]).toBe(`"${transferSha256(download.raw.body)}"`);
    const row = await owner
      .selectFrom("config_bundle_export")
      .selectAll()
      .where("id", "=", exported.id)
      .executeTakeFirstOrThrow();
    expect(row.sha256).toBe(transferSha256(download.raw.body));
    expect(await auditActions(exported.id)).toEqual(["config_bundle_export.created"]);
    // Only published versions travel: no draft's content appears.
    expect((b.items as Item[]).every((i) => i.sourceVersionNo === null || i.sourceVersionNo >= 1)).toBe(true);
  });

  it("refuses an unportable reference at export (422 naming kind, key and field), never dropping it", async () => {
    // A SYNTHETIC id planted as the owner role in a job schedule's cron (five fields; the API would refuse the value).
    const job = itemOf("job_schedule");
    const planted = "0190aaaa-0000-7000-8000-00000000abcd";
    const before = await owner
      .selectFrom("job_schedule")
      .select(["cron"])
      .where("code", "=", job.itemCode)
      .executeTakeFirstOrThrow();
    await ownerSetCron(job.itemCode, `${planted} * * * *`);
    try {
      const rows = (await owner.selectFrom("config_bundle_export").select("id").execute()).length;
      const res = await send("POST", withOrg(`${BASE}/exports`), {
        session: tech,
        body: { kinds: ["job_schedule"], reason: "Synthetic unportable export" },
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("config_bundle.unportable_reference");
      expect(res.body.errors[0].pointer).toBe(`/job_schedule/${job.itemCode}/cron`);
      expect(JSON.stringify(res.body)).not.toContain(planted);
      expect((await owner.selectFrom("config_bundle_export").select("id").execute()).length).toBe(rows);
    } finally {
      await ownerSetCron(job.itemCode, before.cron);
    }
  });

  it("re-hashes on download: an altered object is 422 checksum_mismatch", async () => {
    const created = await send("POST", withOrg(`${BASE}/exports`), {
      session: tech,
      body: { kinds: ["job_schedule"], reason: "Synthetic job export" },
    });
    expect(created.status).toBe(201);
    expect(created.body.kinds).toEqual(["job_schedule"]);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(api.config.evidenceStorage.path, "transfer", "config-bundles", `${created.body.id}.json`),
      "{}",
      "utf8",
    );
    const res = await send("GET", `${BASE}/exports/${created.body.id}/download`, { session: tech });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("config_bundle.checksum_mismatch");
  });

  it("a kind named in the request that this installation cannot export is 422 kind_unavailable, never left out", async () => {
    const res = await send("POST", withOrg(`${BASE}/exports`), {
      session: both,
      body: { kinds: ["job_schedule", "automation_rule"], reason: "Synthetic export of an unavailable kind" },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("config_bundle.kind_unavailable");
    expect(res.body.errors[0].message).toContain("automation_rule");
    // The default (all kinds) records exactly the kinds it covered.
    const row = await owner
      .selectFrom("config_bundle_export")
      .select("kinds")
      .where("id", "=", exported.id)
      .executeTakeFirstOrThrow();
    expect(row.kinds as unknown).not.toContain("automation_rule");
  });

  it("422 nothing_published when the chosen kinds have nothing published", async () => {
    const res = await send("POST", withOrg(`${BASE}/exports`), {
      session: both,
      body: { kinds: ["notification_policy"], reason: "Synthetic empty export" },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("config_bundle.nothing_published");
  });
});

describe("T-D1 unknown schema versions are refused and nothing is stored", () => {
  it.each([["mth-config-bundle/2"], [""], [undefined]])("bundleSchemaVersion %j", async (version) => {
    const rows = await importRows();
    const objects = storedImportObjects().length;
    const bundle = { ...exported.bundle };
    if (version === undefined) delete bundle.bundleSchemaVersion;
    else bundle.bundleSchemaVersion = version;
    const res = await upload(both, bundle);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe("config_bundle.schema_version_unsupported");
    expect(await importRows()).toBe(rows);
    expect(storedImportObjects()).toHaveLength(objects);
  });
});

describe("T-D2 checksums, item schemas and the size limit", () => {
  it("a changed content under the old contentSha256 is 422 checksum_mismatch", async () => {
    const item = itemOf("job_schedule");
    const res = await upload(both, bundleOf([{ ...item, content: { ...item.content, cron: "1 2 3 4 5" } }]));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("config_bundle.checksum_mismatch");
    expect(res.body.errors[0].pointer).toBe("/items/0/contentSha256");
  });

  it("an invalid item is 422 item_invalid with its pointer", async () => {
    const good = itemOf("upload_policy");
    const bad = changed(itemOf("job_schedule"), (c) => ({ ...c, cron: "not a cron" }));
    const res = await upload(both, bundleOf([good, bad]));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("config_bundle.item_invalid");
    expect(res.body.errors[0].pointer).toMatch(/^\/items\/1\/content/);
  });

  it("5 MiB + 1 byte is 413 config_bundle.too_large", async () => {
    const raw = JSON.stringify(exported.bundle);
    const pad = 5 * 1024 * 1024 + 1 - Buffer.byteLength(raw);
    const body = `${raw.slice(0, -1)}${" ".repeat(pad)}}`;
    expect(Buffer.byteLength(body)).toBe(5 * 1024 * 1024 + 1);
    const res = await api.app.inject({
      method: "POST",
      url: withOrg(`${BASE}/imports`),
      headers: {
        cookie: both.cookie,
        "x-csrf-token": both.csrf,
        origin: "http://localhost:5173",
        "content-type": "application/json",
        "x-file-name": "big.json",
      },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(413);
    expect(JSON.parse(res.body).code).toBe("config_bundle.too_large");
  });
});

describe("T-D3 the plan", () => {
  it("plans each action; a conflict leaves the open draft untouched; invalid is terminal", async () => {
    const studio = itemOf("form_schema");
    const conflictItem = itemOf("procedure");
    const newDraft = changed(itemOf("scoring_defaults"), (c) => ({ ...c, titleEn: `${c.titleEn} (synthetic)` }));
    // An open draft of the procedure key (created through the existing operation).
    const base = await owner
      .selectFrom("methodology_version")
      .select(["id"])
      .where("config_kind", "=", "procedure")
      .where("key", "=", conflictItem.itemCode)
      .where("status", "=", "published")
      .orderBy("version_no", "desc")
      .executeTakeFirstOrThrow();
    const draft = await send("POST", "/api/v1/admin/methodology-versions", {
      session: method,
      body: { basedOnVersionId: base.id },
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const draftBefore = await owner
      .selectFrom("methodology_version")
      .selectAll()
      .where("id", "=", draft.body.id)
      .executeTakeFirstOrThrow();
    const notificationCreate = {
      kind: "notification_policy",
      itemCode: "notification_policy",
      sourceVersionNo: 1,
      content: {
        nonUrgentWorkingDaysOnly: true,
        defaultQuietHoursStart: "20:00",
        defaultQuietHoursEnd: "07:00",
        defaultDigestMode: "daily",
      },
      contentSha256: "",
    };
    notificationCreate.contentSha256 = sha(notificationCreate.content);
    const unknownReviewer = changed(itemOf("config_review_policy"), (c) => ({
      ...c,
      reviewerRoleCode: "NO_SUCH_ROLE",
    }));
    // automation_rule has no adapter in this installation (T-DG7-BE-F handback, known gaps).
    const rule = { kind: "automation_rule", itemCode: "synthetic_rule", sourceVersionNo: 1, content: { name: "x" } };
    const ruleItem = { ...rule, contentSha256: sha(rule.content) };
    const items = [studio, newDraft, conflictItem, notificationCreate, unknownReviewer, ruleItem];
    const up = await upload(both, bundleOf(items));
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body).toMatchObject({ status: "uploaded", validationNo: 0, counts: null, items: [] });
    expect(up.headers["etag"]).toBe('"1"');
    expect(await auditActions(up.body.id)).toEqual(["config_bundle_import.uploaded"]);
    const v = await validate(both, up.body.id, 1);
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const actions = (v.body.items as Body[]).map((i) => [i.kind, i.action, i.problemCode]);
    expect(actions).toEqual([
      ["form_schema", "identical", null],
      ["scoring_defaults", "new_draft", null],
      ["procedure", "conflict", "config_bundle.open_draft_exists"],
      ["notification_policy", "create_draft", null],
      ["config_review_policy", "refused", "config_bundle.reference_missing"],
      ["automation_rule", "refused", "config_bundle.kind_unavailable"],
    ]);
    expect(v.body).toMatchObject({
      status: "invalid",
      validationNo: 1,
      version: 2,
      counts: { createDraft: 1, newDraft: 1, identical: 1, conflict: 1, refused: 2 },
    });
    expect(await auditActions(up.body.id)).toEqual(["config_bundle_import.uploaded", "config_bundle_import.validated"]);
    // The open draft is not touched.
    const draftAfter = await owner
      .selectFrom("methodology_version")
      .selectAll()
      .where("id", "=", draft.body.id)
      .executeTakeFirstOrThrow();
    expect(draftAfter).toEqual(draftBefore);
    // invalid is terminal.
    expect((await validate(both, up.body.id, 2)).body.code).toBe("config_bundle.not_validatable");
    expect((await commit(both, up.body.id, 2)).body.code).toBe("config_bundle.not_committable");
    // The draft is discarded so later tests see no conflict.
    const discard = await send("POST", `/api/v1/admin/methodology-versions/${draft.body.id}/discard`, {
      session: method,
      headers: { "if-match": `"${draftAfter.version}"` },
    });
    expect(discard.status).toBe(200);
  });
});

describe("T-D4 commit writes drafts, never publishes; job schedules arrive disabled", () => {
  it("writes each item through its kind's path with its own audit event", async () => {
    const studioKinds = ["methodology", "scoring_defaults", "form_schema", "procedure"];
    const studio = studioKinds.map((k) => changed(itemOf(k), (c) => ({ ...c, titleEn: `${c.titleEn} (imported)` })));
    const job = changed(itemOf("job_schedule"), (c) => ({ ...c, cron: "17 3 * * *" }));
    const upload_ = changed(itemOf("upload_policy"), (c) => ({ ...c, allowedTypes: ["pdf"] }));
    const notification = {
      kind: "notification_policy",
      itemCode: "notification_policy",
      sourceVersionNo: 1,
      content: {
        nonUrgentWorkingDaysOnly: false,
        defaultQuietHoursStart: null,
        defaultQuietHoursEnd: null,
        defaultDigestMode: "off",
      },
    };
    const review = changed(itemOf("config_review_policy"), (c) => ({ ...c, reviewRequired: !c.reviewRequired }));
    const brandingContent = {
      productNameEn: "Synthetic Transformation Hub",
      productNameAr: "منصة التحول التجريبية",
      primaryColour: "#0078FF",
      secondaryColour: "#003B73",
      colourApprovalReference: null,
      fontLatin: "IBM Plex Sans",
      fontArabic: "IBM Plex Sans Arabic",
      logo: null,
      reportHeaderEn: null,
      reportHeaderAr: null,
      reportFooterEn: null,
      reportFooterAr: null,
    };
    const branding = {
      kind: "branding",
      itemCode: "branding",
      sourceVersionNo: 1,
      content: brandingContent,
      contentSha256: sha(brandingContent),
    };
    const items = [
      ...studio,
      branding,
      { ...notification, contentSha256: sha(notification.content) },
      job,
      review,
      upload_,
    ];
    const up = await upload(both, bundleOf(items));
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const v = await validate(both, up.body.id, 1);
    expect(v.body.status, JSON.stringify(v.body.items)).toBe("validated");
    const c = await commit(both, up.body.id, 2);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body).toMatchObject({ status: "committed", version: 3 });
    expect(c.headers["etag"]).toBe('"3"');
    expect(await auditActions(up.body.id)).toEqual([
      "config_bundle_import.uploaded",
      "config_bundle_import.validated",
      "config_bundle_import.committed",
    ]);
    const byKind = new Map((c.body.items as Body[]).map((i) => [i.kind, i]));
    for (const k of studioKinds) {
      const i = byKind.get(k);
      expect(i.targetRecordType).toBe("methodology_version");
      const row = await owner
        .selectFrom("methodology_version")
        .selectAll()
        .where("id", "=", i.targetRecordId)
        .executeTakeFirstOrThrow();
      // A DRAFT, never published by the commit.
      expect(row).toMatchObject({ status: "draft", draft_stage: "editing", origin: "draft", published_at: null });
      expect(row.title_en).toMatch(/\(imported\)$/);
      expect(row.content_sha256).toBe(i.contentSha256);
      expect(await auditActions(row.id)).toEqual(["methodology_version.create_draft"]);
    }
    const sched = await owner
      .selectFrom("job_schedule")
      .selectAll()
      .where("code", "=", job.itemCode)
      .executeTakeFirstOrThrow();
    expect(sched).toMatchObject({ cron: "17 3 * * *", enabled: false });
    expect(byKind.get("job_schedule").targetRecordId).toBe(sched.id);
    expect((await auditActions(sched.id)).at(-1)).toBe("job_schedule.update");
    const notif = byKind.get("notification_policy");
    expect(await auditActions(notif.targetRecordId)).toEqual(["notification_policy.create"]);
    expect((await auditActions(byKind.get("upload_policy").targetRecordId)).at(-1)).toBe("upload_policy.changed");
    expect((await auditActions(byKind.get("config_review_policy").targetRecordId)).at(-1)).toBe(
      "config_review_policy.update",
    );
    const brand = byKind.get("branding");
    expect(brand.targetRecordType).toBe("branding_version");
    expect(await auditActions(brand.targetRecordId)).toContain("branding_version.create");
    const brandRow = await owner
      .selectFrom("branding_version")
      .select(["product_name_en", "colours_provisional"])
      .where("id", "=", brand.targetRecordId)
      .executeTakeFirstOrThrow();
    // #0078FF stays a provisional colour (no approval reference travels unless the source had one).
    expect(brandRow).toEqual({ product_name_en: "Synthetic Transformation Hub", colours_provisional: true });
    // A committed import is immutable.
    expect((await validate(both, up.body.id, 3)).body.code).toBe("config_bundle.not_validatable");
  });

  it("config_bundle.plan_changed when the target changed since validation: nothing is written", async () => {
    const item = changed(itemOf("health_check_scheme"), (c) => ({ ...c, titleEn: `${c.titleEn} (second)` }));
    const job = changed(itemOf("job_schedule"), (c) => ({ ...c, cron: "29 4 * * *" }));
    const up = await upload(both, bundleOf([item, job]));
    const v = await validate(both, up.body.id, 1);
    expect(v.body.status).toBe("validated");
    // Someone opens a draft of the same key in between.
    const base = await owner
      .selectFrom("methodology_version")
      .select(["id"])
      .where("config_kind", "=", "health_check_scheme")
      .where("key", "=", item.itemCode)
      .where("status", "=", "published")
      .orderBy("version_no", "desc")
      .executeTakeFirstOrThrow();
    const draft = await send("POST", "/api/v1/admin/methodology-versions", {
      session: method,
      body: { basedOnVersionId: base.id },
    });
    expect(draft.status).toBe(201);
    const schedBefore = await owner
      .selectFrom("job_schedule")
      .selectAll()
      .where("code", "=", job.itemCode)
      .executeTakeFirstOrThrow();
    const c = await commit(both, up.body.id, 2);
    expect(c.status).toBe(422);
    expect(c.body.code).toBe("config_bundle.plan_changed");
    const after = await send("GET", `${BASE}/imports/${up.body.id}`, { session: both });
    expect(after.body).toMatchObject({ status: "validated", version: 2 });
    expect(after.body.items.every((i: Body) => i.targetRecordId === null)).toBe(true);
    const schedAfter = await owner
      .selectFrom("job_schedule")
      .selectAll()
      .where("code", "=", job.itemCode)
      .executeTakeFirstOrThrow();
    expect(schedAfter).toEqual(schedBefore);
    // Re-validating shows the conflict and makes the import invalid.
    const again = await validate(both, up.body.id, 2);
    expect(again.body).toMatchObject({ status: "invalid", validationNo: 2 });
  });
});

describe("T-D5 permissions and concurrency", () => {
  it("AUD and a user without grants get 403 on all nine operations", async () => {
    const up = await upload(both, bundleOf([itemOf("upload_policy")]));
    expect(up.status).toBe(201);
    for (const s of [auditor, nobody]) {
      const r = await Promise.all([
        send("GET", withOrg(`${BASE}/exports`), { session: s }),
        send("POST", withOrg(`${BASE}/exports`), { session: s, body: { reason: "Synthetic denied export" } }),
        send("GET", `${BASE}/exports/${exported.id}`, { session: s }),
        send("GET", `${BASE}/exports/${exported.id}/download`, { session: s }),
        send("GET", withOrg(`${BASE}/imports`), { session: s }),
        upload(s, exported.bundle),
        send("GET", `${BASE}/imports/${up.body.id}`, { session: s }),
        validate(s, up.body.id, 1),
        commit(s, up.body.id, 1),
      ]);
      expect(r.map((x) => x.status)).toEqual(Array(9).fill(403));
    }
  });

  it("ADM_METHOD and ADM_TECH each hold both rights; the kind's own right decides per item", async () => {
    for (const s of [method, tech]) {
      const e = await send("POST", withOrg(`${BASE}/exports`), {
        session: s,
        body: { kinds: ["job_schedule"], reason: "Synthetic export" },
      });
      expect(e.status).toBe(201);
      expect((await send("GET", withOrg(`${BASE}/exports?limit=1`), { session: s })).status).toBe(200);
      expect((await send("GET", withOrg(`${BASE}/imports?limit=1`), { session: s })).status).toBe(200);
    }
    const studio = changed(itemOf("methodology"), (c) => ({ ...c, titleEn: `${c.titleEn} (perm)` }));
    const job = changed(itemOf("job_schedule"), (c) => ({ ...c, cron: "41 5 * * *" }));
    // ADM_METHOD: the job schedule is refused; ADM_TECH: the methodology is refused (ADR-0065 §8).
    for (const [s, refused] of [
      [method, "job_schedule"],
      [tech, "methodology"],
    ] as const) {
      const up = await upload(s, bundleOf([studio, job]));
      expect(up.status).toBe(201);
      const v = await validate(s, up.body.id, 1);
      expect(v.body.status).toBe("invalid");
      const r = (v.body.items as Body[]).find((i) => i.action === "refused");
      expect(r).toMatchObject({ kind: refused, problemCode: "config_bundle.kind_not_permitted" });
    }
  });

  it("validate and commit need If-Match (428) and refuse a stale one (409); unknown ids are 404", async () => {
    const up = await upload(both, bundleOf([itemOf("upload_policy")]));
    const noMatch = await send("POST", `${BASE}/imports/${up.body.id}/validate`, { session: both });
    expect(noMatch.status).toBe(428);
    expect((await validate(both, up.body.id, 7)).status).toBe(409);
    const v = await validate(both, up.body.id, 1);
    // The policy was changed by T-D4, so this plan is new_draft (applied again by the commit below).
    expect(v.body).toMatchObject({ status: "validated", counts: { newDraft: 1 } });
    expect((await commit(both, up.body.id, 1)).status).toBe(409);
    const done = await commit(both, up.body.id, 2);
    expect(done.body).toMatchObject({ status: "committed" });
    expect((await send("GET", `${BASE}/imports/${MISSING}`, { session: both })).status).toBe(404);
    expect((await send("GET", `${BASE}/exports/${MISSING}`, { session: both })).status).toBe(404);
    expect((await send("GET", `${BASE}/exports?organizationId=${MISSING}`, { session: both })).status).toBe(404);
  });

  it("the upload stores the canonical bytes: an unchanged exported bundle keeps the export's SHA-256", async () => {
    const up = await upload(both, exported.bundle);
    expect(up.status).toBe(201);
    const exportRow = await owner
      .selectFrom("config_bundle_export")
      .select("sha256")
      .where("id", "=", exported.id)
      .executeTakeFirstOrThrow();
    expect(up.body.sha256).toBe(exportRow.sha256);
    expect(up.body.sha256).toBe(transferSha256(canonicalBundleJson(exported.bundle)));
  });
});
