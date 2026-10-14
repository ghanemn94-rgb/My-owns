// Report definitions, live reports and report snapshots (T-DG5-KBE-C; ADR-0045 §1-§5, §9-§11; p5-work-split §F.1).
// Proves, against the run's disposable PostgreSQL:
//  - REQ-S13-004: `charter` and `registers` generate from a seeded transformation and contain its ID and records;
//  - REQ-S13-007: after a later change to a KPI shown in a register, the issued snapshot still returns the old values
//    with their kpi_version rows; a reissue, once issued, is issueVersion 2 and v1 is `superseded` with its content
//    unchanged; two concurrent issues of reissues of one series -> one 200, one 409 report_snapshot.series_changed;
//  - the refusals: issue by WL -> 403; issuing a non-generated snapshot -> 422 report_snapshot.not_generated;
//    reissuing a superseded one -> 422 report_snapshot.not_issued; subject, period and parameter refusals;
//  - every write: AUD 403, If-Match 428/409, one audit event per row written, commit-time re-authorization.
// All data is SYNTHETIC. Issuing a report approves nothing; product gates G1-G6 are business approvals inside the
// product, and nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let kds: { id: string; session: Session };
let charterId: string;

async function person(role: string): Promise<{ id: string; subject: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: p.transformationId }, w.orgA.id);
  return { ...u, session: await signIn(api.app, u.subject) };
}

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

const generate = (code: string, body: Record<string, unknown> = {}, session: Session = p.lead.session) =>
  call<Body>(api.app, "POST", `${T}/reports/${code}/generate`, { session, body });
const snap = (id: string, suffix = "", session: Session = p.lead.session) =>
  call<Body>(api.app, "GET", `${T}/report-snapshots/${id}${suffix}`, { session });
const act = (id: string, action: string, version: number | null, body: Record<string, unknown>, s = p.lead.session) =>
  call<Body>(api.app, "POST", `${T}/report-snapshots/${id}/${action}`, {
    session: s,
    headers: version === null ? {} : ifm(version),
    body,
  });
const snapshotCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("report_snapshot")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", p.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

/** A KPI created and activated with an active version of target `target` (KDS through the API). */
async function activeKpi(name: string, target: string): Promise<{ id: string; version: number; versionId: string }> {
  const created = ok(
    await call<Body>(api.app, "POST", `${T}/kpi-definitions`, {
      session: kds.session,
      body: { name, unitKind: "count", unitLabel: "lines", polarity: "higher_is_better", frequency: "monthly" },
    }),
    201,
    "createKpiDefinition",
  );
  const active = ok(
    await call<Body>(api.app, "POST", `${T}/kpi-definitions/${created.id}/activate`, {
      session: kds.session,
      headers: ifm(created.version),
    }),
    200,
    "activateKpiDefinition",
  );
  const v = ok(
    await call<Body>(api.app, "POST", `${T}/kpi-definitions/${created.id}/versions`, {
      session: kds.session,
      body: {
        measureType: "higher_is_better",
        valueNature: "flow",
        aggregationRule: "sum",
        submissionRoute: "direct_accept",
        targetValue: target,
      },
    }),
    201,
    "createKpiVersion",
  );
  ok(
    await call<Body>(api.app, "POST", `${T}/kpi-versions/${v.id}/activate`, {
      session: kds.session,
      headers: ifm(v.version),
    }),
    200,
    "activateKpiVersion",
  );
  return { id: created.id, version: active.version, versionId: v.id };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  kds = await person("KDS");
  const charter = ok(
    await call<Body>(api.app, "POST", `${T}/charter`, {
      session: p.lead.session,
      body: {
        transformationName: "Synthetic roaming uplift",
        executiveSponsorUserId: p.sponsor.id,
        transformationLeadUserId: p.lead.id,
        caseForChange: "Synthetic case for change: roaming revenue declines while competitors grow.",
        inScope: "Consumer roaming products and journeys (synthetic).",
        outOfScope: "Enterprise contracts (synthetic).",
        baselineDate: "2026-01-31",
      },
    }),
    201,
    "createCharter",
  );
  charterId = charter.charter?.id ?? charter.id;
}, 60_000);
afterAll(() => api.close());

describe("listReportDefinitions (ADR-0045 §1)", () => {
  it("lists the twelve definitions in catalogue order, with subject, period need and formats", async () => {
    const res = ok(
      await call<Body>(api.app, "GET", "/api/v1/report-definitions", { session: p.auditor.session }),
      200,
      "list",
    );
    expect(res.items.map((d: Body) => d.code)).toEqual([
      "charter",
      "diagnostic",
      "tom",
      "business_cases",
      "roadmap",
      "registers",
      "meeting_minutes",
      "gate_pack",
      "executive_dashboard",
      "handover",
      "executive_pack",
      "meeting_pack",
    ]);
    expect(res.items.find((d: Body) => d.code === "executive_dashboard")).toMatchObject({
      needsReportingPeriod: true,
      subjectType: "transformation",
      formats: ["pdf", "pptx", "xlsx"],
    });
  });
});

describe("REQ-S13-004: charter and registers generate from a seeded transformation", () => {
  it("the charter snapshot contains the transformation's ID, its charter text and the charter record with its revision", async () => {
    const s = ok(await generate("charter"), 201, "generate charter");
    expect(s).toMatchObject({
      transformationId: p.transformationId,
      definitionCode: "charter",
      subjectType: "transformation",
      subjectId: p.transformationId,
      status: "generated",
      version: 1,
      issueVersion: null,
      reportingPeriodId: null,
    });
    expect(s.content.transformation.id).toBe(p.transformationId);
    expect(s.content.definitionCode).toBe("charter");
    const fields = s.content.sections.find((x: Body) => x.key === "charter").fields;
    expect(fields.find((f: Body) => f.key === "case_for_change").value).toEqual({
      type: "text",
      value: "Synthetic case for change: roaming revenue declines while competitors grow.",
      authored: "user",
      validation: "not_applicable",
      reason: null,
    });
    // A field the charter does not have is Unknown with no value, never blank.
    expect(fields.find((f: Body) => f.key === "governance_forum").value).toMatchObject({
      value: null,
      validation: "unknown",
      reason: "missing",
    });
    const sources = ok(await snap(s.id, "/sources"), 200, "sources").items;
    const c = sources.find((r: Body) => r.recordType === "charter");
    expect(c).toMatchObject({ recordId: charterId, recordVersion: 1, sectionKey: "charter" });
    // The approval state is G1's recorded state (no G1 decision yet): nothing is approved by generating.
    expect(s.approvalState).toBe("not_submitted");
    const versions = ok(await snap(s.id, "/versions"), 200, "versions").items;
    expect(versions.map((v: Body) => v.versionKind)).toEqual(["methodology_version"]);
    expect(versions[0].referenceId).toBe(s.methodologyVersionId);
    expect((await auditOf(api.db, s.id)).map((a) => a.action)).toEqual(["report_snapshot.generate"]);
  });

  it("the live report is the same assembly, never stored, with snapshotId null", async () => {
    const before = await snapshotCount();
    const live = ok(
      await call<Body>(api.app, "GET", `${T}/reports/charter/live`, { session: p.auditor.session }),
      200,
      "live",
    );
    expect(live.snapshotId).toBeNull();
    expect(live.document.transformation.id).toBe(p.transformationId);
    expect(live.document.sections.map((s: Body) => s.key)).toEqual([
      "charter",
      "north_star",
      "top_outcomes",
      "guardrails",
    ]);
    expect(await snapshotCount()).toBe(before);
  });

  it("the snapshot cites the evidence linked to the charter with its revision and SHA-256", async () => {
    const e = ok(
      await call<Body>(api.app, "POST", `${T}/evidence`, {
        session: p.lead.session,
        body: { kind: "file", title: "Synthetic charter extract", ownerUserId: p.lead.id },
      }),
      201,
      "createEvidence",
    );
    const up = ok(
      await call<Body>(api.app, "POST", `${T}/evidence/${e.id}/content`, {
        session: p.lead.session,
        headers: { ...ifm(e.version), "content-type": "application/octet-stream", "x-file-name": "charter.csv" },
        body: Buffer.from("a,b\n1,2\n"),
      }),
      200,
      "uploadEvidenceContent",
    );
    ok(
      await call<Body>(api.app, "POST", `${T}/evidence-links`, {
        session: p.lead.session,
        body: { evidenceId: e.id, recordType: "charter", recordId: charterId },
      }),
      201,
      "createEvidenceLink",
    );
    const s = ok(await generate("charter"), 201, "generate");
    const cited = ok(await snap(s.id, "/evidence"), 200, "evidence").items;
    const content = await api.db
      .selectFrom("evidence_content")
      .select(["id", "revision", "sha256"])
      .where("id", "=", up.currentContentId)
      .executeTakeFirstOrThrow();
    expect(cited).toEqual([
      {
        sectionKey: "charter",
        evidenceId: e.id,
        contentId: content.id,
        contentRevision: 1,
        contentSha256: content.sha256.trim(),
        reviewStatus: "unverified",
      },
    ]);
  });

  it("a RAID register snapshot contains the transformation's ID and its RAID rows", async () => {
    const r = ok(
      await call<Body>(api.app, "POST", `${T}/raid`, {
        session: p.lead.session,
        body: {
          type: "risk",
          description: "Synthetic roaming partner delay",
          impact: "high",
          probability: "medium",
          ownerUserId: p.lead.id,
        },
      }),
      201,
      "createRaidEntry",
    );
    const s = ok(await generate("registers", { parameters: { register: "raid" } }), 201, "generate registers");
    expect(s.content.transformation.id).toBe(p.transformationId);
    expect(s.parameters).toEqual({ register: "raid", filters: {} });
    const table = s.content.sections.find((x: Body) => x.key === "register");
    const row = table.rows.find((x: Body) => x.recordId === r.id);
    expect(row.cells[0]).toMatchObject({ value: r.code });
    expect(row.cells[2]).toMatchObject({ value: "Synthetic roaming partner delay" });
  });
});

describe("REQ-S13-007: issue, immutability after a later KPI change, reissue as version 2", () => {
  it("the issued snapshot keeps the old values and kpi_version; the issued reissue is v2 and v1 is superseded unchanged", async () => {
    const kpi = await activeKpi("Synthetic roaming lines", "100");
    const s1 = ok(await generate("registers", { parameters: { register: "kpis" } }), 201, "generate kpis");
    const issued = ok(await act(s1.id, "issue", 1, { note: "Synthetic issue for the SteerCo" }), 200, "issue");
    expect(issued).toMatchObject({
      status: "issued",
      issueVersion: 1,
      version: 2,
      issueNote: "Synthetic issue for the SteerCo",
    });
    expect(issued.contentSha256).toBe(s1.contentSha256);
    const kpiRow = (doc: Body) =>
      doc.sections.find((x: Body) => x.key === "register").rows.find((r: Body) => r.recordId === kpi.id);
    expect(kpiRow(issued.content).cells[0].value).toBe("Synthetic roaming lines");
    const v1Versions = ok(await snap(s1.id, "/versions"), 200, "versions").items;
    expect(v1Versions).toContainEqual({
      versionKind: "kpi_version",
      referenceId: kpi.versionId,
      referenceKey: `kpi_definition:${kpi.id}`,
      versionLabel: "v1",
    });

    // A later change to the KPI (renamed through the DG2 route).
    ok(
      await call<Body>(api.app, "PATCH", `${T}/kpi-definitions/${kpi.id}`, {
        session: kds.session,
        headers: ifm(kpi.version),
        body: { name: "Synthetic roaming lines (renamed)" },
      }),
      200,
      "renameKpi",
    );
    const after = ok(await snap(s1.id), 200, "get issued");
    expect(after.contentSha256).toBe(s1.contentSha256);
    expect(kpiRow(after.content).cells[0].value).toBe("Synthetic roaming lines");
    const src = ok(await snap(s1.id, "/sources?limit=100"), 200, "sources").items;
    expect(src.find((x: Body) => x.recordId === kpi.id)).toMatchObject({
      recordType: "kpi_definition",
      recordVersion: kpi.version,
    });
    // The live report refreshes.
    const live = ok(
      await call<Body>(
        api.app,
        "GET",
        `${T}/reports/registers/live?parameters=${encodeURIComponent('{"register":"kpis"}')}`,
        {
          session: p.lead.session,
        },
      ),
      200,
      "live",
    );
    expect(kpiRow(live.document).cells[0].value).toBe("Synthetic roaming lines (renamed)");

    // Reissue (a new generated snapshot of the same series); issuing it supersedes v1.
    const r = ok(await act(s1.id, "reissue", 2, { reason: "Synthetic KPI rename" }), 201, "reissue");
    expect(r).toMatchObject({
      status: "generated",
      seriesId: s1.id,
      reissueOfId: s1.id,
      reissueReason: "Synthetic KPI rename",
    });
    expect(kpiRow(r.content).cells[0].value).toBe("Synthetic roaming lines (renamed)");
    expect(ok(await snap(s1.id), 200, "v1 still issued").status).toBe("issued");
    const r2 = ok(await act(r.id, "issue", 1, {}), 200, "issue reissue");
    expect(r2).toMatchObject({ status: "issued", issueVersion: 2, seriesId: s1.id });
    const v1 = ok(await snap(s1.id), 200, "v1");
    expect(v1).toMatchObject({
      status: "superseded",
      supersededById: r.id,
      issueVersion: 1,
      contentSha256: s1.contentSha256,
    });
    expect(v1.content).toEqual(s1.content);
    expect((await auditOf(api.db, s1.id)).map((a) => a.action)).toEqual([
      "report_snapshot.generate",
      "report_snapshot.issue",
      "report_snapshot.supersede",
    ]);
    expect((await auditOf(api.db, r.id)).map((a) => a.action)).toEqual([
      "report_snapshot.reissue",
      "report_snapshot.issue",
    ]);

    // Reissuing the superseded v1 -> 422 not_issued; issuing the issued reissue again -> 422 not_generated.
    const again = await act(s1.id, "reissue", v1.version, { reason: "Synthetic second reissue" });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "report_snapshot.not_issued",
      "Only the current issued snapshot can be reissued.",
    ]);
    const twice = await act(r.id, "issue", r2.version, {});
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([
      422,
      "report_snapshot.not_generated",
      "Only a generated snapshot can be issued or discarded.",
    ]);

    // Two reissues of the current issue, issued concurrently: one 200, one 409 series_changed.
    const a = ok(await act(r.id, "reissue", r2.version, { reason: "Synthetic concurrent A" }), 201, "reissue A");
    const b = ok(await act(r.id, "reissue", r2.version, { reason: "Synthetic concurrent B" }), 201, "reissue B");
    const both = await Promise.all([act(a.id, "issue", 1, {}), act(b.id, "issue", 1, {})]);
    const statuses = both.map((x) => x.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = both.find((x) => x.status === 409)!;
    expect([loser.body.code, loser.body.detail]).toEqual([
      "report_snapshot.series_changed",
      "This report was issued or reissued meanwhile; reload it.",
    ]);
    const winner = both.find((x) => x.status === 200)!;
    expect(winner.body.issueVersion).toBe(3);
    const issuedNow = await api.db
      .selectFrom("report_snapshot")
      .select("id")
      .where("series_id", "=", s1.id)
      .where("status", "=", "issued")
      .execute();
    expect(issuedNow.map((x) => x.id)).toEqual([winner.body.id]);
  });
});

describe("refusals, authorization and concurrency on every write", () => {
  it("issue by a WL -> 403; AUD -> 403 on generate, issue, discard and reissue; nothing written", async () => {
    const s = ok(await generate("charter"), 201, "generate");
    const before = await snapshotCount();
    const wl = await act(s.id, "issue", 1, {}, p.contributor.session);
    expect(wl.status).toBe(403);
    expect((await generate("charter", {}, p.auditor.session)).status).toBe(403);
    expect((await act(s.id, "issue", 1, {}, p.auditor.session)).status).toBe(403);
    expect((await act(s.id, "discard", 1, { reason: "Synthetic" }, p.auditor.session)).status).toBe(403);
    expect((await act(s.id, "reissue", 1, { reason: "Synthetic" }, p.auditor.session)).status).toBe(403);
    // A WL may generate (report.generate) but not issue.
    expect((await generate("charter", {}, p.contributor.session)).status).toBe(201);
    expect(await snapshotCount()).toBe(before + 1);
    expect(ok(await snap(s.id), 200, "get").status).toBe("generated");
    // An outsider cannot see the transformation: 404.
    const outsider = await signIn(api.app, w.officeB.subject);
    expect((await generate("charter", {}, outsider)).status).toBe(404);
    expect((await snap(s.id, "", outsider)).status).toBe(404);
  });

  it("If-Match: 428 when missing, 409 when stale, on issue, discard and reissue", async () => {
    const s = ok(await generate("charter"), 201, "generate");
    for (const [action, body] of [
      ["issue", {}],
      ["discard", { reason: "Synthetic discard" }],
    ] as const) {
      const missing = await act(s.id, action, null, body);
      expect([missing.status, missing.body.code]).toEqual([428, "precondition_required"]);
      const stale = await act(s.id, action, 7, body);
      expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    }
    const issued = ok(await act(s.id, "issue", 1, {}), 200, "issue");
    expect((await act(s.id, "reissue", null, { reason: "Synthetic" })).status).toBe(428);
    expect((await act(s.id, "reissue", 1, { reason: "Synthetic" })).status).toBe(409);
    expect((await act(s.id, "reissue", issued.version, { reason: "x" })).status).toBe(400);
  });

  it("discard: a generated snapshot is discarded with its reason and kept; a discarded one cannot be issued", async () => {
    const s = ok(await generate("charter"), 201, "generate");
    expect((await act(s.id, "discard", 1, {})).status).toBe(400);
    const d = ok(await act(s.id, "discard", 1, { reason: "Synthetic: wrong selection" }), 200, "discard");
    expect(d).toMatchObject({ status: "discarded", discardReason: "Synthetic: wrong selection", version: 2 });
    expect(d.discardedBy).toBe(p.lead.id);
    const issue = await act(s.id, "issue", 2, {});
    expect([issue.status, issue.body.code]).toEqual([422, "report_snapshot.not_generated"]);
    expect((await auditOf(api.db, s.id)).map((a) => a.action)).toEqual([
      "report_snapshot.generate",
      "report_snapshot.discard",
    ]);
    const list = ok(
      await call<Body>(api.app, "GET", `${T}/report-snapshots?status=discarded&definitionCode=charter`, {
        session: p.auditor.session,
      }),
      200,
      "list",
    );
    expect(list.items.map((x: Body) => x.id)).toContain(s.id);
    expect(list.items[0]).not.toHaveProperty("content");
  });

  it("subject, period and parameter refusals (422, exact texts); nothing written", async () => {
    const before = await snapshotCount();
    const subject = await generate("charter", { subjectId: crypto.randomUUID() });
    expect([subject.status, subject.body.code, subject.body.detail]).toEqual([
      422,
      "report.subject_invalid",
      "The subject must be a record of this transformation of the type this output reports on.",
    ]);
    const periodNo = await generate("charter", { reportingPeriodId: crypto.randomUUID() });
    expect([periodNo.status, periodNo.body.code, periodNo.body.detail]).toEqual([
      422,
      "report.period_not_allowed",
      "This output takes no reporting period.",
    ]);
    const periodNeeded = await generate("executive_dashboard");
    expect([periodNeeded.status, periodNeeded.body.code, periodNeeded.body.detail]).toEqual([
      422,
      "report.period_required",
      "This output needs a reporting period.",
    ]);
    const params = await generate("registers", { parameters: { register: "unknown" } });
    expect([params.status, params.body.code, params.body.detail]).toEqual([
      422,
      "report.parameters_invalid",
      "The report settings are not valid for this output.",
    ]);
    const charterParams = await generate("charter", { parameters: { register: "raid" } });
    expect([charterParams.status, charterParams.body.code]).toEqual([422, "report.parameters_invalid"]);
    const meeting = await generate("meeting_minutes");
    expect([meeting.status, meeting.body.code]).toEqual([422, "report.subject_invalid"]);
    const badJson = await call<Body>(api.app, "GET", `${T}/reports/registers/live?parameters=%7Bnot-json`, {
      session: p.lead.session,
    });
    expect([badJson.status, badJson.body.code]).toEqual([422, "report.parameters_invalid"]);
    expect(await snapshotCount()).toBe(before);
  });

  it("commit-time authorization: report.generate / report.issue revoked while the request waits -> 403; nothing written", async () => {
    const tl = await person("TL");
    const before = await snapshotCount();
    const res = await afterIdentity(
      api,
      tl.id,
      () => call(api.app, "POST", `${T}/reports/charter/generate`, { session: tl.session, body: {} }),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    expect(await snapshotCount()).toBe(before);
    const tl2 = await person("TL");
    const s = ok(await generate("charter", {}, tl2.session), 201, "generate");
    const issue = await afterIdentity(
      api,
      tl2.id,
      () =>
        call(api.app, "POST", `${T}/report-snapshots/${s.id}/issue`, {
          session: tl2.session,
          headers: ifm(1),
          body: {},
        }),
      () => revokeAll(api, w.grantor.id, tl2.id),
    );
    expect(issue.status).toBe(403);
    expect(ok(await snap(s.id), 200, "get").status).toBe("generated");
  });
});
