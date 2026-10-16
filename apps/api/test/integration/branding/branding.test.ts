// Versioned branding and the configurable product name against a real PostgreSQL (ADR-0049 §8, §10-§12; REQ-S01-002,
// REQ-S15-004; p5-work-split §I.3; T-DG5-BE-R). Literal tests:
//  - REQ-S01-002: a fresh database returns "Mobily Transformation Hub" (version 0); after a PUT with a new name,
//    getBranding returns it in en and ar, and the next generated report's header carries it (the worker's export
//    runner reads the branding at generation time);
//  - REQ-S15-004: changing primaryColour changes GET /branding/tokens brand.primary and the derived action shade, and
//    the header colour of a newly generated PDF, without a restart (same API process, same worker code);
//  - If-Match "0" creates; a stale If-Match gives 409 and a missing one 428; one audit event per row;
//  - each §11 refusal: an SVG logo, #0078ff, a font outside the bundled pair, a header in one language only,
//    "PMI certified" in the name, "DG7" in the footer;
//  - AUD and WL get 403; the logo returns image/png, or 404 branding.logo_not_found;
// plus commit-time re-authorization, the outbox event branding.published, versions (list, pagination, one, 404),
// organization isolation and a concurrent save. All data is SYNTHETIC. Branding is configuration, not a business
// approval: nothing here approves anything, and nothing touches the engineering delivery gates.
import { crc32, deflateSync } from "node:zlib";
import { deriveDarkerShade } from "@mth/design-tokens";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drawsArabic, lines, readPdf } from "../../../../../packages/reporting/src/pdf/read.ts";
import { FilesystemExportStore } from "../../../../../packages/reporting/src/storage.ts";
import { handleBrandingPublished } from "../../../../worker/src/handlers/branding.ts";
import { DOMAIN_HANDLERS } from "../../../../worker/src/handlers/index.ts";
import { QUEUES_FOR_EVENT } from "../../../../worker/src/queues/index.ts";
import { runExport } from "../../../../worker/src/reports/export-runner.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  testEvidenceDir,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const CURRENT = "/api/v1/branding";
const TOKENS = "/api/v1/branding/tokens";
const LOGO = "/api/v1/branding/logo";
const SETTINGS = "/api/v1/admin/branding";
const VERSIONS = "/api/v1/admin/branding/versions";
const DEFAULT_EN = "Mobily Transformation Hub";
const DEFAULT_AR = "منصة موبايلي للتحوّل";

/** A real 2x2 RGB PNG (synthetic test image), built here so no binary fixture is committed. */
function testPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.from([0, 0, 120, 255, 0, 59, 115, 0, 255, 255, 255, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A complete, valid settings body (the defaults' values unless overridden). */
function settings(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productNameEn: DEFAULT_EN,
    productNameAr: DEFAULT_AR,
    primaryColour: "#0078FF",
    secondaryColour: "#003B73",
    colourApprovalReference: null,
    fontLatin: "IBM Plex Sans",
    fontArabic: "IBM Plex Sans Arabic",
    logo: { mode: "keep" },
    reportHeaderEn: null,
    reportHeaderAr: null,
    reportFooterEn: null,
    reportFooterAr: null,
    changeNote: null,
    ...over,
  };
}

let api: TestApi;
let w: World;
let tech: Session;
let auditor: Session;
let lead: Session;
let wl: Session;
let officeB: Session;

const put = (session: Session, body: unknown, ifMatch?: string) =>
  call<Body>(api.app, "PUT", SETTINGS, {
    session,
    body,
    ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }),
  });

async function versionCount(organizationId: string): Promise<number> {
  const r = await api.db
    .selectFrom("branding_version")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("organization_id", "=", organizationId)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

async function head(): Promise<number> {
  const r = await call<Body>(api.app, "GET", SETTINGS, { session: tech });
  expect(r.status).toBe(200);
  return r.body.version as number;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const wlUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, wlUser.id, "WL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  tech = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  lead = await signIn(api.app, w.leadA1.subject);
  wl = await signIn(api.app, wlUser.subject);
  officeB = await signIn(api.app, w.officeB.subject);
}, 120_000);
afterAll(() => api.close());

describe("version 0: a fresh database shows the shipped defaults (REQ-S01-002)", () => {
  it("getBranding returns 'Mobily Transformation Hub' (en, ar), the provisional colours and the provisional wordmark", async () => {
    const r = await call<Body>(api.app, "GET", CURRENT, { session: lead });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      versionNo: 0,
      source: "default",
      productNameEn: DEFAULT_EN,
      productNameAr: DEFAULT_AR,
      primaryColour: "#0078FF",
      secondaryColour: "#003B73",
      coloursProvisional: true,
      fontLatin: "IBM Plex Sans",
      fontArabic: "IBM Plex Sans Arabic",
      logo: null,
      wordmarkProvisional: true,
      reportHeaderEn: null,
      reportHeaderAr: null,
      reportFooterEn: null,
      reportFooterAr: null,
    });
    expect((await call(api.app, "GET", CURRENT)).status).toBe(401);
    expect((await call(api.app, "GET", `${CURRENT}?x=1`, { session: lead })).status).toBe(400);
  });

  it('getBrandingSettings answers version 0 with ETag "0"; the logo answers 404 branding.logo_not_found', async () => {
    const r = await call<Body>(api.app, "GET", SETTINGS, { session: tech });
    expect([r.status, r.headers["etag"], r.body.version, r.body.updatedAt, r.body.updatedBy]).toEqual([
      200,
      '"0"',
      0,
      null,
      null,
    ]);
    expect(r.body.colourApprovalReference).toBeNull();
    const logo = await call<Body>(api.app, "GET", LOGO, { session: lead });
    expect([logo.status, logo.body.code, logo.body.detail]).toEqual([
      404,
      "branding.logo_not_found",
      "No logo is configured; the provisional text wordmark is shown.",
    ]);
  });

  it("GET /branding/tokens keeps its shape: the seeded tokens plus the derived action shades of #0078FF, provisional", async () => {
    const r = await call<Body>(api.app, "GET", TOKENS, { session: lead });
    expect(r.status).toBe(200);
    expect(r.body.provenance).toBe("provisional");
    const byName = new Map((r.body.tokens as Body[]).map((t) => [t.name, t]));
    expect(byName.get("brand.primary")).toMatchObject({ value: "#0078FF", provisional: true });
    expect(byName.get("brand.deep")).toMatchObject({ value: "#003B73", provisional: true });
    // The tokens.json values of the ADR-0009 §3 rule (#0078FF -> #006DE9 / #0055B6).
    expect(byName.get("action.primary")).toMatchObject({ value: "#006DE9", provisional: true });
    expect(byName.get("action.primary-hover")).toMatchObject({ value: "#0055B6", provisional: true });
  });
});

describe("authorization (ADR-0049 §10): branding.configure, held by ADM_TECH only", () => {
  it("AUD and WL get 403 on every settings operation, TL too; nothing is written", async () => {
    const before = await versionCount(w.orgA.id);
    for (const s of [auditor, wl, lead]) {
      expect((await call(api.app, "GET", SETTINGS, { session: s })).status).toBe(403);
      expect((await put(s, settings({ productNameEn: "Synthetic denied" }), '"0"')).status).toBe(403);
      expect((await call(api.app, "GET", VERSIONS, { session: s })).status).toBe(403);
      expect((await call(api.app, "GET", `${VERSIONS}/1`, { session: s })).status).toBe(403);
    }
    expect((await put(null as unknown as Session, settings(), '"0"')).status).toBe(401);
    expect(await versionCount(w.orgA.id)).toBe(before);
    // Reading the current branding, the logo and the tokens is a session read: AUD and WL may.
    for (const s of [auditor, wl]) expect((await call(api.app, "GET", CURRENT, { session: s })).status).toBe(200);
  });

  it("commit-time re-authorization: branding.configure revoked while the request waits -> 403, no version", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const before = await versionCount(w.orgA.id);
    const current = await head();
    const res = await afterIdentity(
      api,
      user.id,
      () => put(s, settings({ productNameEn: "Synthetic revoked" }), `"${current}"`),
      () => revokeAll(api, w.grantor.id, user.id),
    );
    expect(res.status).toBe(403);
    expect(await versionCount(w.orgA.id)).toBe(before);
  });
});

describe("the §11 refusals (exact codes and texts); none writes a version", () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
    [
      "an SVG logo",
      {
        logo: {
          mode: "set",
          pngBase64: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
          ).toString("base64"),
          altEn: "Synthetic logo",
          altAr: "شعار تجريبي",
        },
      },
      "branding.logo_invalid",
      "The logo must be a PNG image of at most 256 KiB, with alternative text in English and Arabic.",
    ],
    [
      "a PNG without Arabic alternative text",
      { logo: { mode: "set", pngBase64: testPng().toString("base64"), altEn: "Synthetic logo" } },
      "branding.logo_invalid",
      "The logo must be a PNG image of at most 256 KiB, with alternative text in English and Arabic.",
    ],
    [
      "#0078ff (lower case)",
      { primaryColour: "#0078ff" },
      "branding.colour_invalid",
      "Colours must be six-digit hexadecimal values such as #0078FF.",
    ],
    [
      "a three-digit secondary colour",
      { secondaryColour: "#03F" },
      "branding.colour_invalid",
      "Colours must be six-digit hexadecimal values such as #0078FF.",
    ],
    [
      "a font outside the bundled pair",
      { fontLatin: "Arial" },
      "branding.font_unavailable",
      "Only the bundled fonts IBM Plex Sans and IBM Plex Sans Arabic can be selected.",
    ],
    [
      "a report header in one language only",
      { reportHeaderEn: "Synthetic header" },
      "branding.text_pair_required",
      "Enter the report header and footer in both English and Arabic, or leave both empty.",
    ],
    [
      "a report footer in Arabic only",
      { reportFooterAr: "تذييل تجريبي" },
      "branding.text_pair_required",
      "Enter the report header and footer in both English and Arabic, or leave both empty.",
    ],
    [
      '"PMI certified" in the name',
      { productNameEn: "PMI certified Transformation Hub" },
      "branding.prohibited_claim",
      "Branding text must not claim official PMI status or certification.",
    ],
    [
      '"DG7" in the footer',
      { reportFooterEn: "Released after DG7", reportFooterAr: "تذييل تجريبي" },
      "branding.engineering_gate_reference",
      "Branding text must not name an engineering delivery gate.",
    ],
  ];
  for (const [what, over, code, detail] of cases)
    it(`422 ${code}: ${what}`, async () => {
      const before = await versionCount(w.orgA.id);
      const res = await put(tech, settings(over), `"${await head()}"`);
      expect([res.status, res.body.code, res.body.detail]).toEqual([422, code, detail]);
      expect(await versionCount(w.orgA.id)).toBe(before);
    });

  it("a disclaimer such as 'not an official PMI standard' is allowed (the claim rule's negation)", async () => {
    const res = await put(
      tech,
      settings({ reportFooterEn: "Not an official PMI standard.", reportFooterAr: "ليس معيارًا رسميًا من PMI" }),
      `"${await head()}"`,
    );
    expect(res.status).toBe(200);
  });

  it("400 for a malformed body: an unknown member, a blank name, a missing member", async () => {
    const h = `"${await head()}"`;
    expect((await put(tech, { ...settings(), extra: 1 }, h)).status).toBe(400);
    expect((await put(tech, settings({ productNameEn: "   " }), h)).status).toBe(400);
    const { logo: _l, ...noLogo } = settings();
    expect((await put(tech, noLogo, h)).status).toBe(400);
  });
});

describe("publish: If-Match, one audit event per row, the outbox event (ADR-0049 §8, §12)", () => {
  let o: World;
  let s: Session;
  beforeAll(async () => {
    o = await seedWorld(api.db);
    s = await signIn(api.app, o.admin.subject);
  });

  it('428 without If-Match; If-Match "0" creates version 1; a stale "0" then gives 409; "1" steps to version 2', async () => {
    expect((await put(s, settings())).status).toBe(428);
    const created = await put(
      s,
      settings({
        productNameEn: "Synthetic Transformation Hub",
        productNameAr: "منصة التحول التجريبية",
        primaryColour: "#C8102E",
        changeNote: "Synthetic first save",
      }),
      '"0"',
    );
    expect(created.status).toBe(200);
    expect(created.headers["etag"]).toBe('"1"');
    expect(created.body).toMatchObject({
      versionNo: 1,
      version: 1,
      source: "configured",
      productNameEn: "Synthetic Transformation Hub",
      productNameAr: "منصة التحول التجريبية",
      primaryColour: "#C8102E",
      coloursProvisional: true,
      colourApprovalReference: null,
      updatedBy: o.admin.id,
    });

    const versionRow = await api.db
      .selectFrom("branding_version")
      .selectAll()
      .where("organization_id", "=", o.orgA.id)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow();
    const headRow = await api.db
      .selectFrom("branding_setting")
      .selectAll()
      .where("organization_id", "=", o.orgA.id)
      .executeTakeFirstOrThrow();
    const va = await auditOf(api.db, versionRow.id);
    expect(va).toHaveLength(1);
    expect(va[0]).toMatchObject({ action: "branding_version.create", record_type: "branding_version" });
    const ha = await auditOf(api.db, headRow.id);
    expect(ha.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([["branding_setting.create", null, 1]]);
    const events = await api.db
      .selectFrom("outbox_event")
      .selectAll()
      .where("event_type", "=", "branding.published")
      .where("organization_id", "=", o.orgA.id)
      .execute();
    expect(events.map((e) => [e.payload, e.idempotency_key])).toEqual([
      [{ organizationId: o.orgA.id, versionNo: 1 }, `branding.published:${o.orgA.id}:1`],
    ]);

    const stale = await put(s, settings(), '"0"');
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    const stepped = await put(s, settings({ colourApprovalReference: "Synthetic brand approval BR-001" }), '"1"');
    expect([stepped.status, stepped.headers["etag"], stepped.body.versionNo]).toEqual([200, '"2"', 2]);
    // Colours count as approved only with the recorded reference (the platform approves nothing).
    expect(stepped.body).toMatchObject({
      coloursProvisional: false,
      colourApprovalReference: "Synthetic brand approval BR-001",
    });
    const ha2 = await auditOf(api.db, headRow.id);
    expect(ha2.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["branding_setting.create", null, 1],
      ["branding_setting.update", 1, 2],
    ]);
    expect((await put(s, settings(), '"1"')).status).toBe(409);
    expect(await versionCount(o.orgA.id)).toBe(2);
    // The tokens' provenance stays provisional: every other shipped token is still provisional (ADR-0049 §8).
    const tokens = await call<Body>(api.app, "GET", TOKENS, { session: s });
    expect(tokens.body.provenance).toBe("provisional");
  });

  it("the worker consumes branding.published on its own queue and acknowledges each event exactly once", async () => {
    expect(QUEUES_FOR_EVENT["branding.published"]).toEqual(["branding.published"]);
    expect(DOMAIN_HANDLERS.filter((h) => h.queue === "branding.published")).toHaveLength(1);
    const row = await api.db
      .selectFrom("outbox_event")
      .selectAll()
      .where("idempotency_key", "=", `branding.published:${o.orgA.id}:1`)
      .executeTakeFirstOrThrow();
    const envelope = {
      outboxEventId: row.id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      idempotencyKey: row.idempotency_key,
      organizationId: row.organization_id,
      payload: row.payload,
    };
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await handleBrandingPublished(api.db, envelope));
    expect(results.map((r) => r.outcome)).toEqual(["acknowledged", "duplicate", "duplicate"]);
    const ledger = await api.db
      .selectFrom("processed_message")
      .selectAll()
      .where("consumer", "=", "branding.published")
      .where("idempotency_key", "=", row.idempotency_key)
      .execute();
    expect(ledger).toHaveLength(1);
  });

  it("two concurrent saves with the same If-Match: exactly one wins, the other gets 409", async () => {
    const h = `"${(await call<Body>(api.app, "GET", SETTINGS, { session: s })).body.version}"`;
    const [a, b] = await Promise.all([
      put(s, settings({ productNameEn: "Synthetic A" }), h),
      put(s, settings({ productNameEn: "Synthetic B" }), h),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("organization isolation: org B still reads the defaults; org A's versions are not listed for org B", async () => {
    const r = await call<Body>(api.app, "GET", CURRENT, { session: officeB });
    expect(r.body).toMatchObject({ versionNo: 0, productNameEn: DEFAULT_EN });
  });
});

describe("render-time reads: name, tokens and the logo change without a restart (REQ-S01-002, REQ-S15-004)", () => {
  it("a new name is returned in en and ar; a new primary colour changes brand.primary and the derived action shade", async () => {
    const res = await put(
      tech,
      settings({ productNameEn: "Synthetic Hub", productNameAr: "المنصة التجريبية", primaryColour: "#00A651" }),
      `"${await head()}"`,
    );
    expect(res.status).toBe(200);
    const cur = await call<Body>(api.app, "GET", CURRENT, { session: lead });
    expect(cur.body).toMatchObject({
      productNameEn: "Synthetic Hub",
      productNameAr: "المنصة التجريبية",
      primaryColour: "#00A651",
    });
    const tokens = await call<Body>(api.app, "GET", TOKENS, { session: lead });
    const byName = new Map((tokens.body.tokens as Body[]).map((t) => [t.name, t.value]));
    expect(byName.get("brand.primary")).toBe("#00A651");
    const shade = deriveDarkerShade("#00A651", ["#FFFFFF", "#F5F8FC"], 4.5);
    expect(shade).not.toBe("#006DE9");
    expect(byName.get("action.primary")).toBe(shade);
  });

  it("logo: set -> image/png with the same bytes; keep keeps it; none removes it (404 again)", async () => {
    const png = testPng();
    const set = await put(
      tech,
      settings({
        logo: { mode: "set", pngBase64: png.toString("base64"), altEn: "Synthetic logo", altAr: "شعار تجريبي" },
      }),
      `"${await head()}"`,
    );
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ wordmarkProvisional: false, logo: { altEn: "Synthetic logo", url: LOGO } });
    const logo = await call(api.app, "GET", LOGO, { session: auditor });
    expect([logo.status, logo.headers["content-type"]]).toEqual([200, "image/png"]);
    expect(Buffer.from(logo.raw.rawPayload).equals(png)).toBe(true);
    const kept = await put(tech, settings({ productNameEn: "Synthetic Hub" }), `"${await head()}"`);
    expect(kept.body.logo).toEqual(set.body.logo);
    const none = await put(tech, settings({ logo: { mode: "none" } }), `"${await head()}"`);
    expect([none.body.logo, none.body.wordmarkProvisional]).toEqual([null, true]);
    expect((await call(api.app, "GET", LOGO, { session: auditor })).status).toBe(404);
  });

  it("versions: newest first, paginated, immutable; one version; 404 for a version that does not exist", async () => {
    const n = await head();
    const first = await call<Body>(api.app, "GET", `${VERSIONS}?limit=1`, { session: tech });
    expect(first.status).toBe(200);
    expect(first.body.items.map((v: Body) => v.versionNo)).toEqual([n]);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await call<Body>(api.app, "GET", `${VERSIONS}?limit=1&cursor=${first.body.nextCursor}`, {
      session: tech,
    });
    expect(second.body.items.map((v: Body) => v.versionNo)).toEqual([n - 1]);
    const all = await call<Body>(api.app, "GET", `${VERSIONS}?limit=100`, { session: tech });
    expect(all.body.items.map((v: Body) => v.versionNo)).toEqual(Array.from({ length: n }, (_, i) => n - i));
    const one = await call<Body>(api.app, "GET", `${VERSIONS}/1`, { session: tech });
    expect([one.status, one.body.versionNo]).toEqual([200, 1]);
    expect((await call(api.app, "GET", `${VERSIONS}/${n + 50}`, { session: tech })).status).toBe(404);
    expect((await call(api.app, "GET", `${VERSIONS}/0`, { session: tech })).status).toBe(400);
    // branding_version is append-only: the database refuses an UPDATE even by the owner.
    await expect(
      api.owner.query("update branding_version set product_name_en = 'x' where organization_id = $1", [w.orgA.id]),
    ).rejects.toThrow(/append-only/);
  });
});

describe("the next generated report carries the current branding and the provenance footer (REQ-S01-002, REQ-S15-004, REQ-PB-001; the worker's export runner)", () => {
  let x: World;
  let b: BenefitWorld;
  let admin: Session;

  beforeAll(async () => {
    x = await seedWorld(api.db);
    b = await seedBenefitWorld(api, x);
    admin = await signIn(api.app, x.admin.subject);
  }, 120_000);

  async function pdf(language: "en" | "ar"): Promise<Buffer> {
    const snap = await call<Body>(api.app, "POST", `${b.base}/reports/registers/generate`, {
      session: b.s.tl,
      body: { parameters: { register: "raid", filters: {} } },
    });
    expect(snap.status, JSON.stringify(snap.body).slice(0, 400)).toBe(201);
    const job = await call<Body>(api.app, "POST", "/api/v1/exports", {
      session: b.s.tl,
      body: { snapshotId: snap.body.id, format: "pdf", language },
    });
    expect(job.status).toBe(202);
    const row = await api.db
      .selectFrom("outbox_event")
      .selectAll()
      .where("idempotency_key", "=", `export_job.requested:${job.body.id}`)
      .executeTakeFirstOrThrow();
    const outcome = await runExport(
      api.db,
      {
        outboxEventId: row.id,
        eventType: row.event_type,
        schemaVersion: row.schema_version,
        idempotencyKey: row.idempotency_key,
        organizationId: row.organization_id,
        payload: row.payload,
      },
      row.id,
      { retryCount: 0, retryLimit: 5 },
      { store: new FilesystemExportStore(testEvidenceDir()) },
    );
    expect(outcome).toMatchObject({ outcome: "succeeded" });
    const file = await call(api.app, "GET", `/api/v1/exports/${job.body.id}/download`, { session: b.s.tl });
    expect(file.status).toBe(200);
    return Buffer.from(file.raw.rawPayload);
  }

  /** True when a page content stream fills the 10 pt header band with the colour `scn` (pdfkit: `r g b scn`). */
  function fillsWith(bytes: Buffer, scn: string): boolean {
    const band = new RegExp(`0 0 [0-9.]+ 10 re\\n/DeviceRGB cs\\n${scn} scn\\nf\\n`);
    const doc = readPdf(bytes);
    return [...doc.objects.values()].some((o) => o.stream !== null && band.test(o.stream.toString("latin1")));
  }

  it("version 0: the shipped name in the header and no brand band; after a PUT: the new name (en, ar) and colour", async () => {
    const before = await pdf("en");
    const beforeLines = lines(readPdf(before));
    expect(beforeLines.some((l) => l.includes(DEFAULT_EN))).toBe(true);
    expect(fillsWith(before, "0 1 0")).toBe(false);
    // The provenance footer (B0004, verbatim from the playbook catalogue) is on every file, also at version 0.
    expect(
      beforeLines.some((l) => l.includes("Practical synthesis inspired by PMI Organizational Transformation")),
    ).toBe(true);

    const res = await put(
      admin,
      settings({
        productNameEn: "Synthetic Roaming Hub",
        productNameAr: "منصة التجوال التجريبية",
        primaryColour: "#00FF00",
        reportHeaderEn: "Synthetic header line",
        reportHeaderAr: "عنوان تجريبي",
        reportFooterEn: "Synthetic footer line",
        reportFooterAr: "تذييل تجريبي",
      }),
      '"0"',
    );
    expect(res.status).toBe(200);

    const en = await pdf("en");
    const enLines = lines(readPdf(en));
    expect(enLines.some((l) => l.includes("Synthetic Roaming Hub"))).toBe(true);
    expect(enLines.some((l) => l.includes(DEFAULT_EN))).toBe(false);
    expect(enLines.some((l) => l.includes("Synthetic header line"))).toBe(true);
    expect(enLines.some((l) => l.includes("Synthetic footer line"))).toBe(true);
    expect(enLines.some((l) => l.includes("Practical synthesis inspired by PMI Organizational Transformation"))).toBe(
      true,
    );
    expect(fillsWith(en, "0 1 0")).toBe(true);
    const ar = readPdf(await pdf("ar"));
    expect(drawsArabic(ar, "التجوال")).toBe(true);
    expect(drawsArabic(ar, "موبايلي")).toBe(false);
    // Words without a final teh marbuta (the test reader maps its final form to another code point).
    expect(drawsArabic(ar, "عنوان")).toBe(true);
    expect(drawsArabic(ar, "تذييل")).toBe(true);
    expect(drawsArabic(ar, "المنافع")).toBe(true); // B0004 in Arabic (provisional translation)
  });
});
