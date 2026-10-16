// qa-verifier A15 "Reporting" (T-DG5-QA-C): snapshots, packs and presentation, literal from the acceptance texts of
//  - REQ-S13-007: "after a later KPI change, the issued snapshot still shows the old values and their versions";
//  - REQ-S09-011: "the executive pack's workstream section contains the submitted update text and current metrics
//    without manual editing";
//  - REQ-S10-013: "changing a linked decision before cut-off changes the presentation; the issued pack remains the
//    snapshot";
//  - REQ-S12-015: "cut-off creates one draft agenda containing current open asks; it is not published without review".
// Through the REAL API (generate/issue/live report, exports, owner updates, executive decisions, meeting presentation,
// cut-off pack) on the run's disposable PostgreSQL; the meeting cut-off scan is the REAL worker handler and the export
// the REAL worker runner, delivered through the harness (the e2e stack runs no worker, D-162 d). The worlds are the
// backend's synthetic fixtures, used only to stage records through the API. Amounts are compared as decimal strings.
// All data is SYNTHETIC; issuing a report or reviewing a pack approves nothing, product gates G1-G6 are business
// approvals inside the product, and nothing here names DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleMeetingCutoffScan } from "../../../apps/worker/src/handlers/meetings.ts";
import {
  businessToday,
  plusDays,
  setupMeetingWorld,
  type MeetingWorld,
} from "../../../apps/api/test/integration/governance/meeting-fixtures.ts";
import { raiseAsk } from "../../../apps/api/test/integration/governance/t16-fixtures.ts";
import {
  decide,
  kpiWithDraft,
  setupChangeWorld,
  type ChangeWorld,
} from "../../../apps/api/test/integration/workflows/change-fixtures.ts";
import { richMeetings, type RichMeetings } from "../../../apps/api/test/integration/reporting/kbe-d2-fixtures.ts";
import { seedWorld, type World } from "../../../apps/api/test/support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../../apps/api/test/support/p2-fixtures.ts";
import { call, signIn, startApi, uniq, type TestApi } from "../support/api.ts";
import { contains, exportFile, ok, viewOf, type Body } from "../support/a15.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

/** Canonical decimal string: no exponent, no trailing fractional zeros ("4321.0000" -> "4321"). */
const dec = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
/** Every decimal string carried by a JSON value (report values hold amounts as strings). */
function decimalsIn(x: unknown): string[] {
  if (typeof x === "string") return /^-?\d+(\.\d+)?$/.test(x) ? [dec(x)] : [];
  if (Array.isArray(x)) return x.flatMap(decimalsIn);
  if (x !== null && typeof x === "object") return Object.values(x).flatMap(decimalsIn);
  return [];
}
/** The rows of a document (snapshot content or live document) that are about record `id`. */
const rowsOf = (doc: Body, id: string): Body[] =>
  doc.sections.flatMap((s: Body) => (s.rows ?? []).filter((r: Body) => r.recordId === id));

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
}, 120_000);
afterAll(() => api?.close());

describe("REQ-S13-007: after a later KPI change, the issued snapshot still shows the old values and their versions", () => {
  // The change-control world (approval world + KDS): an active KPI with v1 (target 100) and a draft v2 (target 120).
  // v2 becomes active only through an approved change request; the BO's decision below is a SYNTHETIC in-product
  // business decision on test data (it approves nothing real).
  let c: ChangeWorld;
  let k: Awaited<ReturnType<typeof kpiWithDraft>>;
  let kpiName: string;
  let issued: Body;
  let base: string;

  beforeAll(async () => {
    c = await setupChangeWorld(api, w);
    base = c.base;
    k = await kpiWithDraft(send, c);
    kpiName = ok(await send("GET", `${base}/kpi-definitions/${k.kpiId}`, { session: c.lead.session }), 200, "kpi").name;
    const generated = ok(
      await send("POST", `${base}/reports/registers/generate`, {
        session: c.lead.session,
        body: { parameters: { register: "kpis" } },
      }),
      201,
      "generate kpis register",
    );
    issued = ok(
      await send("POST", `${base}/report-snapshots/${generated.id}/issue`, {
        session: c.lead.session,
        headers: ifm(generated.version),
        body: { note: "QA-A15 synthetic issue" },
      }),
      200,
      "issue",
    );
    expect(issued).toMatchObject({ status: "issued", issueVersion: 1 });
    expect(decimalsIn(rowsOf(issued.content, k.kpiId))).toContain("100");
    // The later KPI change: target 100 -> 120 through an approved change request.
    const CR = `${base}/change-requests`;
    const cr = ok(
      await send("POST", CR, {
        session: c.lead.session,
        body: {
          changeKind: "target",
          subjectType: "kpi_definition",
          subjectId: k.kpiId,
          subjectVersion: k.kpiVersion,
          proposedRecordType: "kpi_version",
          proposedRecordId: k.v2.id,
          proposedChange: { targetValue: { from: "100", to: "120" } },
          reason: "QA-A15 synthetic: stretch target",
        },
      }),
      201,
      "change request",
    );
    const sub = ok(await send("POST", `${CR}/${cr.id}/submit`, { session: c.lead.session, headers: ifm(1) }), 200, "");
    ok(await decide(send, sub.approvalId, c.bo.session), 200, "synthetic BO decision");
    const v2 = ok(await send("GET", `${base}/kpi-versions/${k.v2.id}`, { session: c.lead.session }), 200, "v2");
    expect([v2.status, dec(v2.targetValue)]).toEqual(["active", "120"]);
  }, 180_000);

  it("GET the issued snapshot: unchanged content and hash, the old target, never the new one", async () => {
    const now = ok(await send("GET", `${base}/report-snapshots/${issued.id}`, { session: c.lead.session }), 200, "get");
    expect(now.status).toBe("issued");
    expect(now.contentSha256).toBe(issued.contentSha256);
    expect(now.content).toEqual(issued.content);
    const values = decimalsIn(rowsOf(now.content, k.kpiId));
    expect(values).toContain("100");
    expect(values).not.toContain("120");
  });

  it("its versions still cite the KPI version in force at the as-of time (v1), not v2", async () => {
    const versions = ok(
      await send("GET", `${base}/report-snapshots/${issued.id}/versions`, { session: c.lead.session }),
      200,
      "versions",
    ).items as Body[];
    const kpiVersions = versions.filter((v) => v.versionKind === "kpi_version").map((v) => v.referenceId);
    expect(kpiVersions).toContain(k.v1.id);
    expect(kpiVersions).not.toContain(k.v2.id);
  });

  it("the live report refreshes to the new target", async () => {
    const live = ok(
      await send("GET", `${base}/reports/registers/live?parameters=${encodeURIComponent('{"register":"kpis"}')}`, {
        session: c.lead.session,
      }),
      200,
      "live",
    );
    expect(live.snapshotId).toBeNull();
    const values = decimalsIn(rowsOf(live.document, k.kpiId));
    expect(values).toContain("120");
    expect(values).not.toContain("100");
  });

  for (const [language, issuedLine] of [
    ["en", "Issued report, version 1"],
    ["ar", "تقرير صادر، الإصدار 1"],
  ] as const)
    it(`a PDF (${language}) of the issued snapshot exported after the change shows the old target and the issue`, async () => {
      const v = await viewOf(
        "pdf",
        (await exportFile(api, c.lead.session, { snapshotId: issued.id, format: "pdf", language })).bytes,
      );
      // The KPI's table row: the pieces drawn on the baseline of its name (each cell is its own piece).
      const shown = v.pdf!.shown;
      const name = shown.find((x) => x.text.includes(kpiName.slice(0, 18)));
      expect(name, `the row of ${kpiName}`).toBeDefined();
      const cells = shown
        .filter((x) => x.page === name!.page && Math.abs(x.y - name!.y) < 0.5)
        .map((x) => x.text.trim())
        .filter((t) => /^-?\d+(\.\d+)?$/.test(t))
        .map(dec);
      expect(cells).toContain("100");
      expect(cells).not.toContain("120");
      expect(contains(v, issuedLine), issuedLine).toBe(true);
    });
});

describe("REQ-S09-011: the executive pack's workstream section has the submitted update text and current metrics", () => {
  const ACHIEVEMENTS = "QA-A15 synthetic: 3 partner tariffs renegotiated; pass activation journey live in 2 markets";
  const ASKS = "QA-A15 synthetic: decision on the Gulf partner bundle by month end";
  let pack: Body;
  let workstream: Body;

  beforeAll(async () => {
    const office = await signIn(api.app, w.office.subject);
    const base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
    const period = ok(
      await send("POST", base, {
        session: office,
        body: {
          frequency: "monthly",
          periodLabel: "2041-09",
          periodStart: "2041-09-01",
          periodEnd: "2041-09-30",
          updateDueDate: "2041-10-10",
        },
      }),
      201,
      "period",
    );
    ok(await send("POST", `${base}/${period.id}/open`, { session: office, headers: ifm(1) }), 200, "open period");
    workstream = ok(
      await send("POST", `${T}/workstreams`, {
        session: p.lead.session,
        body: { name: "QA-A15 synthetic roaming workstream", leadUserId: p.contributor.id },
      }),
      201,
      "workstream",
    );
    const upd = ok(
      await send("POST", `${T}/updates`, {
        session: p.contributor.session,
        body: {
          subjectType: "workstream",
          subjectId: workstream.id,
          reportingPeriodId: period.id,
          achievements: ACHIEVEMENTS,
          nextSteps: "QA-A15 synthetic: launch in 2 more markets",
          asks: ASKS,
        },
      }),
      201,
      "createUpdate",
    );
    ok(
      await send("POST", `${T}/updates/${upd.id}/submit`, {
        session: p.contributor.session,
        headers: ifm(upd.version),
        body: {},
      }),
      200,
      "submitUpdate",
    );
    pack = ok(
      await send("POST", `${T}/reports/executive_pack/generate`, {
        session: p.lead.session,
        body: { reportingPeriodId: period.id },
      }),
      201,
      "generate executive_pack",
    );
  }, 120_000);

  it("the snapshot holds the workstream's update verbatim and a metrics section for it", () => {
    const json = JSON.stringify(pack.content);
    expect(json).toContain(ACHIEVEMENTS);
    expect(json).toContain(ASKS);
    const keys = pack.content.sections.map((s: Body) => s.key as string);
    expect(keys.filter((k: string) => k.startsWith("metrics_")).length).toBeGreaterThanOrEqual(2); // transformation + workstream
  });

  for (const format of ["pdf", "docx", "pptx"] as const)
    for (const language of ["en", "ar"] as const)
      it(`${format} (${language}) prints the submitted update text and the workstream`, async () => {
        const v = await viewOf(
          format,
          (await exportFile(api, p.lead.session, { snapshotId: pack.id, format, language })).bytes,
        );
        expect(contains(v, ACHIEVEMENTS), "achievements").toBe(true);
        expect(contains(v, ASKS), "asks").toBe(true);
        expect(contains(v, workstream.code) || contains(v, workstream.name), "workstream").toBe(true);
        expect(v.rtl).toBe(language === "ar");
      });
});

describe("REQ-S10-013 / REQ-S12-015: meeting presentation, issued meeting pack and the cut-off draft agenda", () => {
  let x: MeetingWorld;
  let m: RichMeetings;
  let today: string;
  const title1 = "QA-A15 synthetic ask: approve the roaming partner switch (edited before cut-off)";
  const title2 = "QA-A15 synthetic ask: title changed after the pack was issued";
  let pack: Body;

  const decision = async () =>
    ok(
      await send("GET", `/api/v1/transformations/${x.transformationId}/executive-decisions/${m.steerco.decisionId}`, {
        session: x.lead.session,
      }),
      200,
      "decision",
    );
  const editTitle = async (title: string) => {
    const d = await decision();
    return send("PATCH", `/api/v1/transformations/${x.transformationId}/executive-decisions/${d.id}`, {
      session: x.lead.session,
      headers: ifm(d.version),
      body: { title },
    });
  };
  const presentation = async (snapshotId?: string) =>
    ok(
      await send("GET", `${m.steerco.url}/presentation${snapshotId === undefined ? "" : `?snapshotId=${snapshotId}`}`, {
        session: x.lead.session,
      }),
      200,
      "presentation",
    );

  beforeAll(async () => {
    x = await setupMeetingWorld(api, w);
    m = await richMeetings(api, x);
    today = await businessToday(api);
  }, 180_000);

  it("changing the linked decision before the cut-off changes the live presentation", async () => {
    const before = JSON.stringify(await presentation());
    expect(before).toContain((await decision()).decision); // the T16 "decision" text, edited through `title`
    const r = await editTitle(title1);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = JSON.stringify(await presentation());
    expect(after).toContain(title1);
  });

  it("the issued meeting pack remains the snapshot after a later change; the live view follows the change", async () => {
    const generated = ok(
      await send("POST", `/api/v1/transformations/${x.transformationId}/reports/meeting_pack/generate`, {
        session: x.lead.session,
        body: { subjectId: m.steerco.id },
      }),
      201,
      "generate meeting_pack",
    );
    pack = ok(
      await send("POST", `/api/v1/transformations/${x.transformationId}/report-snapshots/${generated.id}/issue`, {
        session: x.lead.session,
        headers: ifm(generated.version),
        body: {},
      }),
      200,
      "issue meeting pack",
    );
    const r = await editTitle(title2);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const fromPack = JSON.stringify(await presentation(pack.id));
    expect(fromPack).toContain(title1);
    expect(fromPack).not.toContain(title2);
    const live = JSON.stringify(await presentation());
    expect(live).toContain(title2);
    // The printable pack (PDF of the issued snapshot, exported now) is the snapshot too.
    for (const language of ["en", "ar"] as const) {
      const v = await viewOf(
        "pdf",
        (await exportFile(api, x.lead.session, { snapshotId: pack.id, format: "pdf", language })).bytes,
      );
      expect(contains(v, title1), `${language} pack shows the issued title`).toBe(true);
      expect(contains(v, title2), `${language} pack does not show the later title`).toBe(false);
    }
  });

  it("the cut-off creates ONE draft agenda with the current open asks; its items are not published before review", async () => {
    const TX = `/api/v1/transformations/${x.transformationId}`;
    const meeting = ok(
      await send("POST", `${TX}/meetings`, {
        session: x.lead.session,
        body: {
          forumId: x.forums.executive_steerco,
          scheduledDate: plusDays(today, 1), // tomorrow: its cut-off has passed
          startTime: "09:00",
          durationMinutes: 60,
          chairUserId: x.lead.id,
        },
      }),
      201,
      "meeting",
    );
    const ask = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15), {
      title: "QA-A15 synthetic open ask for the cut-off agenda",
    });
    // The worker's cut-off scan, delivered twice (a retry): one pack, one draft agenda.
    await handleMeetingCutoffScan(api.db, null, uniq("job:qa-a15-"), { meetingIds: [meeting.id] });
    await handleMeetingCutoffScan(api.db, null, uniq("job:qa-a15-"), { meetingIds: [meeting.id] });
    const packs = await api.db
      .selectFrom("meeting_cutoff_pack")
      .select("id")
      .where("meeting_id", "=", meeting.id)
      .execute();
    expect(packs).toHaveLength(1);
    const cut = ok(await send("GET", `${TX}/meetings/${meeting.id}/cutoff-pack`, { session: x.lead.session }), 200, "");
    expect(cut.status).toBe("draft");
    expect(JSON.stringify(cut.openAsks)).toContain(ask.id);
    expect(cut.agendaItemIds.length).toBeGreaterThan(0);
    // Not published without review: publishing a pack item is refused and nothing changes.
    const itemId = cut.agendaItemIds[0];
    const agendaItem = async (): Promise<Body> =>
      (
        ok(await send("GET", `${TX}/meetings/${meeting.id}/agenda-items`, { session: x.lead.session }), 200, "agenda")
          .items as Body[]
      ).find((i) => i.id === itemId)!;
    const item = await agendaItem();
    expect(item.status).not.toBe("published");
    const refused = await send("POST", `${TX}/meetings/${meeting.id}/agenda-items/${itemId}/publish`, {
      session: x.lead.session,
      headers: ifm(item.version),
      body: {},
    });
    expect([refused.status, refused.body.code]).toEqual([422, "agenda_item.pack_not_reviewed"]);
    const again = await agendaItem();
    expect(again.version).toBe(item.version);
    expect(again.status).toBe(item.status);
    // After the chair's review, the same item publishes.
    ok(
      await send("POST", `${TX}/meetings/${meeting.id}/cutoff-pack/review`, {
        session: x.lead.session,
        headers: ifm(cut.version),
        body: { note: "QA-A15 synthetic review" },
      }),
      200,
      "review",
    );
    const published = await send("POST", `${TX}/meetings/${meeting.id}/agenda-items/${itemId}/publish`, {
      session: x.lead.session,
      headers: ifm(again.version),
      body: {},
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
  });
});
