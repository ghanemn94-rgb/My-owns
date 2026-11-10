// The contrast rule for runtime branding against a real PostgreSQL (T-DG6-BE-W; ADR-0061 §1, §2, §5, §6, §10;
// REQ-S15-003; p6-work-split §I/K.1). Literal tests:
//  - a failing primary (#FFD700) and a failing secondary (#6FA8DC) each answer 422 branding.contrast_insufficient with
//    one `errors` item per failing pair (pointer, code branding.contrast_pair_below_threshold, message exactly
//    "<fg> / <bg> | <use> | <ratio>:1 < <threshold>:1"), and write nothing (version, head, report, pair and audit
//    counts unchanged);
//  - the ADR-0049 §11 codes keep their order (an invalid colour is still branding.colour_invalid);
//  - the seeds publish with one report of 50 pairs and the audit events of the version, the head and the report; the
//    report's tokenSourceSha256 equals the SHA-256 of tokens.json;
//  - getBrandingVersionContrast answers recorded for it, not_recorded (failing pairs listed) for a version inserted
//    before the requirement migration (a fixture), 404 for an unknown version and for another organization's version,
//    403 for AUD and for a transformation lead;
//  - AUD reads the branding_contrast_report.recorded event through /audit-events;
//  - If-Match 428/409 and the commit-time branding.configure re-check are unchanged;
//  - the requirement migration 0119: a version without a report fails at COMMIT; with its report it commits; a version
//    inserted before the rule is untouched; the constraint mappings of platform/db-errors.ts.
// All data is SYNTHETIC. Branding is configuration, not a business approval: nothing here approves anything, and nothing
// touches the engineering delivery gates. #0078FF is a provisional brand token, not a verified Mobily colour.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { checkContrast } from "@mth/design-tokens";
import { createDb, insertAuditEvent, sql, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRANDING_CONTRAST_INSUFFICIENT_TEXT } from "../../../src/modules/admin/branding.ts";
import {
  BRANDING_CONTRAST_INSUFFICIENT_DETAIL,
  mapDatabaseGuardError,
} from "../../../src/modules/platform/db-errors.ts";
import {
  call,
  createOrg,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const SETTINGS = "/api/v1/admin/branding";
const contrastOf = (n: number | string) => `/api/v1/admin/branding/versions/${n}/contrast`;
const CONTRAST_TEXT =
  "These colours do not meet the contrast rules: at least one text or control combination is below 4.5:1 (3:1 for large text and controls). Nothing was published.";
const TOKENS_SHA256 = createHash("sha256")
  .update(readFileSync(createRequire(import.meta.url).resolve("@mth/design-tokens/tokens.json")))
  .digest("hex");

function settings(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productNameEn: "Mobily Transformation Hub",
    productNameAr: "منصة موبايلي للتحوّل",
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
    changeNote: "Synthetic contrast test",
    ...over,
  };
}

let api: TestApi;
let w: World;
let tech: Session;
let auditor: Session;
let lead: Session;
let techB: Session;

const put = (session: Session, body: unknown, ifMatch?: string) =>
  call<Body>(api.app, "PUT", SETTINGS, {
    session,
    body,
    ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }),
  });

async function head(session: Session = tech): Promise<number> {
  const r = await call<Body>(api.app, "GET", SETTINGS, { session });
  expect(r.status).toBe(200);
  return r.body.version as number;
}

/** Scope-local counts of one organization: versions, head version, reports, pairs and branding audit events. */
async function counts(organizationId: string) {
  const n = async (q: Promise<{ n: string } | undefined>) => Number((await q)?.n ?? 0);
  return {
    versions: await n(
      api.db
        .selectFrom("branding_version")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("organization_id", "=", organizationId)
        .executeTakeFirst(),
    ),
    head:
      (
        await api.db
          .selectFrom("branding_setting")
          .select("version")
          .where("organization_id", "=", organizationId)
          .executeTakeFirst()
      )?.version ?? 0,
    reports: await n(
      api.db
        .selectFrom("branding_contrast_report")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("organization_id", "=", organizationId)
        .executeTakeFirst(),
    ),
    pairs: await n(
      api.db
        .selectFrom("branding_contrast_pair as p")
        .innerJoin("branding_contrast_report as r", "r.id", "p.report_id")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("r.organization_id", "=", organizationId)
        .executeTakeFirst(),
    ),
    audit: await n(
      api.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("organization_id", "=", organizationId)
        .where("record_type", "in", ["branding_version", "branding_setting", "branding_contrast_report"])
        .executeTakeFirst(),
    ),
  };
}

/**
 * A branding version inserted as it was before 0119 (no contrast report): as the owner, inside ONE transaction with
 * 0119's trigger disabled while the row is inserted (the ALTER's lock keeps every other session from inserting while it is off), with the
 * version's audit event (ADR-0004). Test-only manipulation of SYNTHETIC data, in an organization of its own.
 */
async function insertPreRuleVersion(organizationId: string, userId: string, primary: string, secondary: string) {
  const id = uuidv7();
  await createDb(api.owner)
    .transaction()
    .execute(async (tx) => {
      await sql`ALTER TABLE branding_version DISABLE TRIGGER branding_version_contrast_required`.execute(tx);
      await insertVersionRow(tx, id, organizationId, userId, 1, primary, secondary);
      // The version's deferred audit check runs now, so no trigger event is pending when the ALTER re-enables 0119.
      await sql`SET CONSTRAINTS ALL IMMEDIATE`.execute(tx);
      await sql`ALTER TABLE branding_version ENABLE TRIGGER branding_version_contrast_required`.execute(tx);
    });
  return id;
}

async function insertVersionRow(
  tx: Tx,
  id: string,
  organizationId: string,
  userId: string,
  versionNo: number,
  primary: string,
  secondary: string,
): Promise<void> {
  await tx
    .insertInto("branding_version")
    .values({
      id,
      organization_id: organizationId,
      version_no: versionNo,
      product_name_en: "Synthetic Hub",
      product_name_ar: "المنصة التجريبية",
      primary_colour: primary,
      secondary_colour: secondary,
      colours_provisional: true,
      colour_approval_reference: null,
      font_latin: "IBM Plex Sans",
      font_arabic: "IBM Plex Sans Arabic",
      logo_png: null,
      logo_sha256: null,
      logo_alt_en: null,
      logo_alt_ar: null,
      report_header_en: null,
      report_header_ar: null,
      report_footer_en: null,
      report_footer_ar: null,
      change_note: "Synthetic fixture",
      created_by: userId,
    })
    .execute();
  await insertAuditEvent(
    tx,
    { actorType: "user", actorUserId: userId, requestId: `fixture-${id}`, source: "api" },
    {
      action: "branding_version.create",
      recordType: "branding_version",
      recordId: id,
      organizationId,
      changes: { version_no: { from: versionNo - 1, to: versionNo } },
    },
  );
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const adminB = await createUser(api.db, w.orgB.id);
  await grant(api.db, w.grantor.id, adminB.id, "ADM_TECH", { type: "organization", id: w.orgB.id }, w.orgB.id);
  tech = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  lead = await signIn(api.app, w.leadA1.subject);
  techB = await signIn(api.app, adminB.subject);
}, 120_000);
afterAll(() => api.close());

describe("organization isolation first: another organization's version is 404 (ADR-0061 §5)", () => {
  it("org B publishes version 1; org A's administrator gets 404 not_found for it (org A has none yet)", async () => {
    const b = await put(techB, settings(), '"0"');
    expect([b.status, b.body.versionNo]).toEqual([200, 1]);
    expect((await call<Body>(api.app, "GET", contrastOf(1), { session: techB })).body.status).toBe("recorded");
    const a = await call<Body>(api.app, "GET", contrastOf(1), { session: tech });
    expect([a.status, a.body.code]).toEqual([404, "not_found"]);
  });
});

describe("the publish refusal: 422 branding.contrast_insufficient, nothing written (ADR-0061 §1.2, §6)", () => {
  it("a failing primary (#FFD700): one errors item per failing pair, on /primaryColour, with the exact message", async () => {
    const before = await counts(w.orgA.id);
    const r = await put(tech, settings({ primaryColour: "#FFD700" }), `"${await head()}"`);
    expect([r.status, r.body.code, r.body.detail]).toEqual([422, "branding.contrast_insufficient", CONTRAST_TEXT]);
    expect(r.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(r.body.errors).toEqual([
      {
        pointer: "/primaryColour",
        code: "branding.contrast_pair_below_threshold",
        message: "brand.primary / surface.card | ui | 1.40:1 < 3.0:1",
      },
      {
        pointer: "/primaryColour",
        code: "branding.contrast_pair_below_threshold",
        message: "brand.primary / surface.page | large-text | 1.31:1 < 3.0:1",
      },
    ]);
    expect(await counts(w.orgA.id)).toEqual(before);
  });

  it("a failing secondary (#6FA8DC): the brand.deep pairs, each on /secondaryColour, in declared order", async () => {
    const before = await counts(w.orgA.id);
    const r = await put(tech, settings({ secondaryColour: "#6FA8DC" }), `"${await head()}"`);
    expect([r.status, r.body.code]).toEqual([422, "branding.contrast_insufficient"]);
    expect(r.body.errors).toEqual(
      [
        "brand.deep / surface.page | text | 2.37:1 < 4.5:1",
        "brand.deep / surface.card | text | 2.52:1 < 4.5:1",
        "nav.selected-text / nav.selected-background | text | 2.52:1 < 4.5:1",
        "text.inverse / header.gradient-start | text | 2.52:1 < 4.5:1",
        "brand.deep / surface.selected | text | 2.21:1 < 4.5:1",
        "feedback.info.fg / feedback.info.bg | text | 2.21:1 < 4.5:1",
        "text.inverse / brand.deep | text | 2.52:1 < 4.5:1",
        "badge.provisional.bg / header.gradient-start | ui | 2.26:1 < 3.0:1",
      ].map((message) => ({ pointer: "/secondaryColour", code: "branding.contrast_pair_below_threshold", message })),
    );
    expect(await counts(w.orgA.id)).toEqual(before);
  });

  it("both colours failing: the primary pairs and the secondary pairs together, in declared order", async () => {
    const r = await put(tech, settings({ primaryColour: "#FFD700", secondaryColour: "#6FA8DC" }), `"${await head()}"`);
    expect(r.status).toBe(422);
    const pointers = (r.body.errors as Body[]).map((e) => e.pointer);
    expect(pointers.filter((p) => p === "/primaryColour")).toHaveLength(2);
    expect(pointers.filter((p) => p === "/secondaryColour")).toHaveLength(8);
  });

  it("the ADR-0049 §11 codes keep their order: an invalid colour is still branding.colour_invalid (checked first)", async () => {
    const before = await counts(w.orgA.id);
    const lower = await put(tech, settings({ primaryColour: "#ffd700" }), `"${await head()}"`);
    expect([lower.status, lower.body.code]).toEqual([422, "branding.colour_invalid"]);
    const font = await put(tech, settings({ primaryColour: "#FFD700", fontLatin: "Arial" }), `"${await head()}"`);
    expect([font.status, font.body.code]).toEqual([422, "branding.font_unavailable"]);
    const pair = await put(
      tech,
      settings({ primaryColour: "#FFD700", reportHeaderEn: "Synthetic header" }),
      `"${await head()}"`,
    );
    expect([pair.status, pair.body.code]).toEqual([422, "branding.text_pair_required"]);
    expect(await counts(w.orgA.id)).toEqual(before);
  });

  it("a branded colour that makes a prohibited pair pass is published (only the declared pairs decide)", async () => {
    // #003B73 as primary: white small text on it passes, so the prohibited pair text.inverse on brand.primary passes.
    const before = await counts(w.orgA.id);
    const r = await put(tech, settings({ primaryColour: "#003B73" }), `"${await head()}"`);
    expect(r.status).toBe(200);
    const after = await counts(w.orgA.id);
    expect([after.versions - before.versions, after.reports - before.reports, after.pairs - before.pairs]).toEqual([
      1, 1, 50,
    ]);
  });

  it("the refusal text is ADR-0061 §6 verbatim, and the database mapping uses the same text", () => {
    expect(BRANDING_CONTRAST_INSUFFICIENT_TEXT).toBe(CONTRAST_TEXT);
    expect(BRANDING_CONTRAST_INSUFFICIENT_DETAIL).toBe(CONTRAST_TEXT);
  });
});

describe("a published version records its report (ADR-0061 §1.3)", () => {
  let versionNo: number;
  let reportId: string;

  it("the seeds publish with one report of 50 pairs in declared order and the version, head and report audit events", async () => {
    const before = await counts(w.orgA.id);
    const r = await put(tech, settings(), `"${await head()}"`);
    expect(r.status).toBe(200);
    versionNo = r.body.versionNo as number;
    const after = await counts(w.orgA.id);
    expect(after).toEqual({
      versions: before.versions + 1,
      head: versionNo,
      reports: before.reports + 1,
      pairs: before.pairs + 50,
      audit: before.audit + 3,
    });
    const report = await api.db
      .selectFrom("branding_contrast_report")
      .selectAll()
      .where("organization_id", "=", w.orgA.id)
      .where("branding_version_no", "=", versionNo)
      .executeTakeFirstOrThrow();
    reportId = report.id;
    expect([report.rules, report.pair_count, report.created_by]).toEqual(["wcag2x-aa-v1", 50, w.admin.id]);
    expect(report.token_source_sha256).toBe(TOKENS_SHA256);
    const pairs = await api.db
      .selectFrom("branding_contrast_pair")
      .selectAll()
      .where("report_id", "=", report.id)
      .orderBy("ordinal")
      .execute();
    const build = checkContrast().pairs;
    expect(pairs.map((p) => [p.ordinal, p.fg_token, p.bg_token, p.use, p.fg_hex, p.bg_hex])).toEqual(
      build.map((b, i) => [i + 1, b.fg, b.bg, b.use, b.fgHex, b.bgHex]),
    );
    expect(pairs.map((p) => [String(p.ratio), String(p.threshold), p.usage_note])).toEqual(
      build.map((b) => [b.ratio.toFixed(2), b.threshold.toFixed(1), b.note]),
    );
    // The audit events of the version, the head and the report, in the request's transaction.
    const events = await api.db
      .selectFrom("audit_event")
      .select(["action", "record_type", "record_id", "prior_version", "new_version", "changes", "request_id"])
      .where("organization_id", "=", w.orgA.id)
      .where("request_id", "=", r.headers["x-request-id"] as string)
      .orderBy("seq")
      .execute();
    expect(events.map((e) => e.action)).toEqual([
      "branding_version.create",
      "branding_contrast_report.recorded",
      "branding_setting.update",
    ]);
    const rec = events[1]!;
    expect([rec.record_type, rec.record_id, rec.prior_version, rec.new_version]).toEqual([
      "branding_contrast_report",
      report.id,
      null,
      null,
    ]);
    const lowest = Math.min(...build.map((b) => b.ratio)).toFixed(2);
    expect(rec.changes).toEqual({
      branding_version_no: { from: null, to: versionNo },
      rules: { from: null, to: "wcag2x-aa-v1" },
      design_source_sha256: { from: null, to: TOKENS_SHA256 },
      pair_count: { from: null, to: 50 },
      lowest_ratio: { from: null, to: lowest },
    });
    expect(lowest).toBe("3.23");
  });

  it("getBrandingVersionContrast answers recorded: the stored pairs, the token-source hash, ETag of the version", async () => {
    const r = await call<Body>(api.app, "GET", contrastOf(versionNo), { session: tech });
    expect([r.status, r.headers["etag"]]).toEqual([200, `"${versionNo}"`]);
    expect(r.body).toMatchObject({
      versionNo,
      status: "recorded",
      rules: "wcag2x-aa-v1",
      tokenSourceSha256: TOKENS_SHA256,
      pairCount: 50,
      failingCount: 0,
    });
    expect(typeof r.body.recordedAt).toBe("string");
    const build = checkContrast().pairs;
    expect(r.body.pairs).toEqual(
      build.map((b, i) => ({
        ordinal: i + 1,
        fg: b.fg,
        bg: b.bg,
        use: b.use,
        fgHex: b.fgHex,
        bgHex: b.bgHex,
        ratio: b.ratio.toFixed(2),
        threshold: b.threshold.toFixed(1),
        pass: true,
      })),
    );
  });

  it("AUD reads the branding_contrast_report.recorded event through /audit-events (and gets 403 on the route)", async () => {
    const q = new URLSearchParams({
      organizationId: w.orgA.id,
      recordType: "branding_contrast_report",
      recordId: reportId,
    });
    const r = await call<Body>(api.app, "GET", `/api/v1/audit-events?${q}`, { session: auditor });
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ action: "branding_contrast_report.recorded", recordId: reportId });
    expect(JSON.stringify(r.body.items[0])).toContain(TOKENS_SHA256);
    const denied = await call<Body>(api.app, "GET", contrastOf(versionNo), { session: auditor });
    expect([denied.status, denied.body.code]).toEqual([403, "forbidden"]);
  });
});

describe("getBrandingVersionContrast: refusals and a version published before the rule (ADR-0061 §5, §10)", () => {
  it("403 for AUD and for a transformation lead; 404 for an unknown version; 400 for a malformed number; 401", async () => {
    for (const s of [auditor, lead]) {
      const r = await call<Body>(api.app, "GET", contrastOf(1), { session: s });
      expect([r.status, r.body.code]).toEqual([403, "forbidden"]);
    }
    const unknown = await call<Body>(api.app, "GET", contrastOf(999_999), { session: tech });
    expect([unknown.status, unknown.body.code]).toEqual([404, "not_found"]);
    expect((await call(api.app, "GET", contrastOf("x"), { session: tech })).status).toBe(400);
    expect((await call(api.app, "GET", contrastOf(0), { session: tech })).status).toBe(400);
    expect((await call(api.app, "GET", `${contrastOf(1)}?x=1`, { session: tech })).status).toBe(400);
    expect((await call(api.app, "GET", contrastOf(1))).status).toBe(401);
  });

  it("a version inserted before the requirement migration is not_recorded and lists its failing pairs", async () => {
    const orgC = await createOrg(api.db);
    const adminC = await createUser(api.db, orgC.id);
    await grant(api.db, w.grantor.id, adminC.id, "ADM_TECH", { type: "organization", id: orgC.id }, orgC.id);
    const id = await insertPreRuleVersion(orgC.id, adminC.id, "#FFD700", "#003B73");
    const techC = await signIn(api.app, adminC.subject);
    const r = await call<Body>(api.app, "GET", contrastOf(1), { session: techC });
    expect([r.status, r.headers["etag"]]).toEqual([200, '"1"']);
    expect(r.body).toMatchObject({
      versionNo: 1,
      status: "not_recorded",
      rules: "wcag2x-aa-v1",
      tokenSourceSha256: null,
      recordedAt: null,
      pairCount: 50,
      failingCount: 2,
    });
    expect((r.body.pairs as Body[]).filter((p) => !p.pass)).toEqual([
      expect.objectContaining({ fg: "brand.primary", bg: "surface.card", use: "ui", ratio: "1.40", threshold: "3.0" }),
      expect.objectContaining({
        fg: "brand.primary",
        bg: "surface.page",
        use: "large-text",
        ratio: "1.31",
        threshold: "3.0",
      }),
    ]);
    // Reading it changes nothing: no report is backfilled; the version row is as inserted.
    const reports = await api.db
      .selectFrom("branding_contrast_report")
      .select("id")
      .where("organization_id", "=", orgC.id)
      .execute();
    expect(reports).toEqual([]);
    const row = await api.db
      .selectFrom("branding_version")
      .select(["id", "primary_colour"])
      .where("organization_id", "=", orgC.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ id, primary_colour: "#FFD700" });
  });
});

describe("unchanged rules of the publish (shared rule 4)", () => {
  it("If-Match: missing -> 428; stale -> 409; nothing written", async () => {
    const before = await counts(w.orgA.id);
    const missing = await put(tech, settings());
    expect(missing.status).toBe(428);
    const stale = await put(tech, settings(), `"${(await head()) - 1}"`);
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    expect(await counts(w.orgA.id)).toEqual(before);
  });

  it("commit-time re-authorization: branding.configure revoked while the request waits -> 403, no version, no report", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const current = await head();
    const before = await counts(w.orgA.id);
    const res = await afterIdentity(
      api,
      user.id,
      () => put(s, settings({ productNameEn: "Synthetic revoked" }), `"${current}"`),
      () => revokeAll(api, w.grantor.id, user.id),
    );
    expect(res.status).toBe(403);
    const after = await counts(w.orgA.id);
    expect([after.versions, after.reports, after.pairs]).toEqual([before.versions, before.reports, before.pairs]);
  });
});

describe("0119 branding_version_contrast_required (the requirement migration's probe)", () => {
  async function freshOrg() {
    const org = await createOrg(api.db);
    const user = await createUser(api.db, org.id);
    return { org, user };
  }

  it("a version without its report fails at COMMIT (23000 branding_version_contrast_required); nothing stays", async () => {
    const { org, user } = await freshOrg();
    const err = await api.db
      .transaction()
      .execute(async (tx) => insertVersionRow(tx, uuidv7(), org.id, user.id, 1, "#0078FF", "#003B73"))
      .then(
        () => null,
        (e: { code?: string; constraint?: string }) => e,
      );
    expect([err?.code, err?.constraint]).toEqual(["23000", "branding_version_contrast_required"]);
    const left = await api.db
      .selectFrom("branding_version")
      .select("id")
      .where("organization_id", "=", org.id)
      .execute();
    expect(left).toEqual([]);
    // The API maps it to the generic internal problem (the API always writes the report).
    const mapped = mapDatabaseGuardError({
      code: "23000",
      constraint: "branding_version_contrast_required",
      message: "x",
    });
    expect(mapped?.toBody("req-1")).toMatchObject({ status: 500 });
    expect(mapped?.code).not.toBe("branding.contrast_insufficient");
  });

  it("a version with its report (pairs complete, audited) commits", async () => {
    const { org, user } = await freshOrg();
    await api.db.transaction().execute(async (tx) => {
      await insertVersionRow(tx, uuidv7(), org.id, user.id, 1, "#0078FF", "#003B73");
      const reportId = uuidv7();
      await tx
        .insertInto("branding_contrast_report")
        .values({
          id: reportId,
          organization_id: org.id,
          branding_version_no: 1,
          rules: "wcag2x-aa-v1",
          token_source_sha256: TOKENS_SHA256,
          pair_count: 1,
          created_by: user.id,
        })
        .execute();
      await tx
        .insertInto("branding_contrast_pair")
        .values({
          id: uuidv7(),
          report_id: reportId,
          ordinal: 1,
          fg_token: "text.primary",
          bg_token: "surface.page",
          use: "text",
          fg_hex: "#142438",
          bg_hex: "#F5F8FC",
          ratio: "14.79",
          threshold: "4.5",
          usage_note: "Synthetic probe pair",
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: user.id, requestId: `probe-${reportId}`, source: "api" },
        {
          action: "branding_contrast_report.recorded",
          recordType: "branding_contrast_report",
          recordId: reportId,
          organizationId: org.id,
        },
      );
    });
    const rows = await api.db
      .selectFrom("branding_version")
      .select("version_no")
      .where("organization_id", "=", org.id)
      .execute();
    expect(rows).toEqual([{ version_no: 1 }]);
  });

  it("the trigger is deferred, on INSERT of branding_version only", async () => {
    const t = await sql<{ tgdeferrable: boolean; tginitdeferred: boolean; relname: string }>`
      SELECT t.tgdeferrable, t.tginitdeferred, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname = 'branding_version_contrast_required'`.execute(api.db);
    expect(t.rows).toEqual([{ tgdeferrable: true, tginitdeferred: true, relname: "branding_version" }]);
  });

  it("platform/db-errors.ts: a failing stored pair and an incomplete report map to 422 branding.contrast_insufficient", () => {
    for (const [code, constraint] of [
      ["23514", "branding_contrast_pair_passes"],
      ["23000", "branding_contrast_report_pairs_complete"],
    ] as const) {
      expect(mapDatabaseGuardError({ code, constraint, message: "synthetic" })?.toBody("req-1")).toMatchObject({
        status: 422,
        code: "branding.contrast_insufficient",
        detail: CONTRAST_TEXT,
      });
    }
  });
});
