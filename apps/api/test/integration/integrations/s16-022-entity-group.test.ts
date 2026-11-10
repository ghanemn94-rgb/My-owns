// The S16-022 entity group (ADR-0055 §7; REQ-S16-022 "A06;A13: the ERD and migrations contain every entity listed
// (FormSchemaVersion, AutomationRuleVersion, Job, Notification, IntegrationRun, ReportSnapshot, AuditEvent) with primary
// keys, owner and status where applicable, and an integration test creates and reads each one through the API with
// authorization enforced"; D-195 Q12 "creates" = the API mutation that produces the entity; p6-work-split §B/A.8;
// T-DG6-BE-O). For each entity: the producing mutation as an authorized user, then the read as that user (200), an
// out-of-scope read (403 or 404, as the entity's read rule answers), an AUD read and the AUD write refusal (403, nothing
// written), plus the entity's key, owner and status in the database.
//
//   FormSchemaVersion      publishConfigVersion (a form_schema methodology_version)  -> getFormSchemaAdmin
//   AutomationRuleVersion  createAutomationRuleVersion                               -> getAutomationRuleVersion
//   Job                    runJobNow (+ the worker's recordJobRun for the run row)   -> getJobOperation
//   Notification           submitKpiActual on a review route (the reviewer's inbox)  -> listMyInbox
//   IntegrationRun         runConnector                                              -> getIntegrationRun
//   ReportSnapshot         issueReportSnapshot                                       -> getReportSnapshot
//   AuditEvent             any mutation (here the snapshot issue)                    -> getAuditEvent
//
// AUD and the Job entity: `job.read` is held by the administrators only (DG5 REQ-S12-022, tested there: "a non-admin
// (TL, AUD) gets 403"), so AUD's read of a job is 403 here; this is stated in the handback, not changed.
// This suite publishes a forms version and runs a job now (both global), so it runs on its OWN scratch database, as
// job-operations.test.ts does. Every value is SYNTHETIC. Nothing here approves anything in the business (a Studio
// review is a configuration review) and nothing reads or writes the engineering gates DG0-DG7.
import { createDb, insertAuditEvent, migrate, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { recordJobRun } from "../../../../worker/src/job-runs.ts";
import { seedFormsVersion } from "../../support/forms-fixtures.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";
import { mapPartyTo, monthlyPeriod, ownedKpi, REVIEW_FLOW, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let owner: Db;
let scratchDb: string;
let methodAdmin: { id: string; session: Session }; // ADM_METHOD @ A
let techAdmin: Session; // ADM_TECH (+ ADM_ACCESS) @ A: jobs, connectors, audit events
let office: Session; // TO @ A: the Studio reviewer
let auditor: Session; // AUD @ A
let officeB: Session; // TO @ B: out of scope for org A's records
let nobody: Session; // no grant

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_s16022");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  owner = createDb(api.owner);
  const m = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, m.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  methodAdmin = { id: m.id, session: await signIn(api.app, m.subject) };
  [techAdmin, office, auditor, officeB, nobody] = await Promise.all([
    signIn(api.app, w.admin.subject),
    signIn(api.app, w.office.subject),
    signIn(api.app, w.auditor.subject),
    signIn(api.app, w.officeB.subject),
    signIn(api.app, w.nobody.subject),
  ]);
}, 180_000);

afterAll(async () => {
  await api?.close();
  if (scratchDb) await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};
const get = (url: string, session?: Session) => call<Body>(api.app, "GET", url, session ? { session } : {});

describe("REQ-S16-022: each entity of the group is created and read through the API with authorization enforced", () => {
  it("FormSchemaVersion: a Studio form_schema version published through the API, read by getFormSchemaAdmin", async () => {
    const V = "/api/v1/admin/methodology-versions";
    const base = await seedFormsVersion(api);
    const draft = ok(
      await call<Body>(api.app, "POST", V, { session: methodAdmin.session, body: { basedOnVersionId: base.id } }),
      201,
      "createConfigVersion",
    );
    const id = draft.id as string;
    const version = async () => ok(await get(`${V}/${id}`, methodAdmin.session), 200, "getConfigVersion").version;
    ok(
      await call<Body>(api.app, "PUT", `${V}/${id}/elements/form_field/T03.s16_022_note`, {
        session: methodAdmin.session,
        headers: ifm(await version()),
        body: {
          attributes: { fieldType: "text", labelEn: "Synthetic note", labelAr: "ملاحظة اصطناعية", maxLength: 200 },
        },
      }),
      200,
      "putConfigElement",
    );
    const preview = ok(
      await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
        session: methodAdmin.session,
        headers: ifm(await version()),
        body: { samples: [] },
      }),
      201,
      "preview",
    );
    expect(preview.result).toBe("pass");
    ok(
      await call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, {
        session: methodAdmin.session,
        headers: ifm(await version()),
      }),
      201,
      "compatibility",
    );
    const submitted = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
      session: methodAdmin.session,
      headers: ifm(await version()),
      body: {},
    });
    if (submitted.status === 201)
      ok(
        await call<Body>(api.app, "POST", `${V}/${id}/reviews/${submitted.body.id}/decision`, {
          session: office,
          headers: ifm(1),
          body: { outcome: "approve" },
        }),
        200,
        "decideConfigReview",
      );
    // AUD may not publish (403, nothing changes).
    const v = await version();
    expect(
      (await call<Body>(api.app, "POST", `${V}/${id}/publish`, { session: auditor, headers: ifm(v) })).status,
    ).toBe(403);
    const published = ok(
      await call<Body>(api.app, "POST", `${V}/${id}/publish`, { session: methodAdmin.session, headers: ifm(v) }),
      200,
      "publishConfigVersion",
    );
    expect(published.status).toBe("published");

    const url = `/api/v1/admin/form-schemas/T03?versionId=${id}`;
    const read = ok(await get(url, methodAdmin.session), 200, "getFormSchemaAdmin");
    expect(read.fields.find((f: Body) => f.key === "s16_022_note")).toMatchObject({ origin: "admin", extension: true });
    expect((await get(url, auditor)).status).toBe(200);
    expect((await get(url, nobody)).status).toBe(403);
    expect((await get(url)).status).toBe(401);
    const row = await owner
      .selectFrom("methodology_version")
      .select(["id", "status", "published_by", "config_kind"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ id, status: "published", published_by: methodAdmin.id, config_kind: "form_schema" });
  });

  it("AutomationRuleVersion: createAutomationRuleVersion, read by getAutomationRuleVersion", async () => {
    const R = "/api/v1/admin/automation-rules";
    const rule = ok(
      await call<Body>(api.app, "POST", R, {
        session: methodAdmin.session,
        body: {
          code: `test.${uniq("s16").toLowerCase()}`,
          nameEn: "Synthetic S16-022 rule",
          nameAr: "قاعدة اصطناعية",
          scopeLevel: "organization",
          organizationId: w.orgA.id,
          ownerUserId: methodAdmin.id,
          content: {
            triggerCodes: ["gate.decided"],
            conditions: [{ field: "gateCode", op: "eq", value: "G2" }],
            actions: [
              { type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } },
            ],
            runAs: "service",
          },
        },
      }),
      201,
      "createAutomationRule",
    );
    await publishAsOwner(rule.id as string, 1);
    const create = (session: Session) =>
      call<Body>(api.app, "POST", `${R}/${rule.id}/versions`, {
        session,
        headers: ifm(2),
        body: { changeSummary: "Synthetic second version" },
      });
    expect((await create(auditor)).status).toBe(403);
    const v2 = ok(await create(methodAdmin.session), 201, "createAutomationRuleVersion");
    expect(v2).toMatchObject({ versionNo: 2, status: "draft" });
    const url = `${R}/${rule.id}/versions/2`;
    expect(ok(await get(url, methodAdmin.session), 200, "getAutomationRuleVersion").id).toBe(v2.id);
    expect((await get(url, auditor)).status).toBe(200);
    expect((await get(url, officeB)).status).toBe(404);
    const row = await owner
      .selectFrom("automation_rule_version")
      .select(["id", "status", "created_by"])
      .where("id", "=", v2.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ id: v2.id, status: "draft", created_by: methodAdmin.id });
  });

  it("Job: runJobNow (and the worker's run record), read by getJobOperation", async () => {
    const code = "governance.blocker_escalation_scan";
    const J = `/api/v1/admin/jobs/${code}`;
    expect((await call<Body>(api.app, "POST", `${J}/run`, { session: auditor })).status).toBe(403);
    const sent = ok(await call<Body>(api.app, "POST", `${J}/run`, { session: techAdmin }), 202, "runJobNow");
    expect(sent.code).toBe(code);
    // The worker's side (pg-boss is not running in this suite): the dispatched job finishes and the worker records
    // its run through its own recorder (apps/worker/src/job-runs.ts), keyed by the job id run now returned.
    const schedule = await owner
      .selectFrom("job_schedule")
      .select("queue_name")
      .where("code", "=", code)
      .executeTakeFirstOrThrow();
    const started = new Date();
    expect(
      await recordJobRun(owner, {
        queue: schedule.queue_name,
        jobId: sent.jobId,
        retryCount: 0,
        retryLimit: 2,
        startedAt: started,
        finishedAt: new Date(started.getTime() + 1000),
        failed: false,
      }),
    ).toBe("recorded");
    const read = ok(await get(J, techAdmin), 200, "getJobOperation");
    expect(read.runs.find((r: Body) => r.jobId === sent.jobId)).toMatchObject({ outcome: "succeeded" });
    expect((await get(J, auditor)).status).toBe(403); // job.read is the administrators' (see the header)
    expect((await get(J, nobody)).status).toBe(403);
    const run = await owner
      .selectFrom("job_run")
      .select(["id", "job_schedule_code", "outcome"])
      .where("job_id", "=", sent.jobId)
      .executeTakeFirstOrThrow();
    expect(run).toMatchObject({ job_schedule_code: code, outcome: "succeeded" });
  });

  it("Notification: a KPI actual submitted on a review route notifies the reviewer, read by listMyInbox", async () => {
    const k: KpiWorld = await seedKpiWorld(api, w);
    await mapPartyTo(api, k, "BO", k.users.bo.id);
    const kpi = await ownedKpi(api, k, REVIEW_FLOW);
    const period = await monthlyPeriod(api, w);
    // AUD cannot submit (403, nothing written).
    expect((await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "7" }, auditor)).status).toBe(
      403,
    );
    const submitted = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "7" });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const actualId = submitted.body.actual.id as string;
    const inbox = ok(await get("/api/v1/me/inbox?limit=100", k.s.bo), 200, "listMyInbox");
    const mine = inbox.items.find(
      (n: Body) => n.messageKey === "kpi_actual.review_due" && String(n.linkPath).includes(actualId),
    );
    expect(mine).toMatchObject({ transformationId: k.transformationId, readAt: null });
    // Out of scope: the submitter's and the auditor's inboxes do not contain it, and nobody else may mark it read.
    for (const s of [k.s.kds, auditor]) {
      const other = ok(await get("/api/v1/me/inbox?limit=100", s), 200, "listMyInbox (other)");
      expect(other.items.map((n: Body) => n.id)).not.toContain(mine.id);
    }
    const foreign = await call<Body>(api.app, "POST", `/api/v1/me/inbox/${mine.id}/read`, {
      session: k.s.kds,
      headers: ifm(1),
      body: {},
    });
    expect(foreign.status).toBe(404);
    const row = await owner
      .selectFrom("inbox_notification")
      .select(["id", "recipient_user_id", "read_at"])
      .where("id", "=", mine.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ id: mine.id, recipient_user_id: k.users.bo.id, read_at: null });
  });

  it("IntegrationRun: runConnector, read by getIntegrationRun", async () => {
    const k: KpiWorld = await seedKpiWorld(api, w);
    const L = "/api/v1/admin/connectors";
    const created = ok(
      await call<Body>(api.app, "POST", L, {
        session: techAdmin,
        body: {
          organizationId: w.orgA.id,
          code: uniq("s16-").toLowerCase(),
          nameEn: "Synthetic S16-022 source",
          nameAr: "مصدر اصطناعي",
          adapterKind: "test_adapter",
          targetKind: "kpi_actual",
          config: {
            sourceSystemId: "synthetic.kpi-source:s16-022",
            endpointUrl: null,
            credentialRefs: {},
            fieldMappings: [],
            targetTransformationId: k.transformationId,
            cadence: "manual",
            retryMaxAttempts: 0,
            retryBackoffSeconds: 60,
            commitMode: "manual",
            commitOnBehalfOf: null,
            outboundActions: [],
            reconciliationRule: "none",
            adapterSettings: { mode: "healthy" },
            reason: "Synthetic connector for the S16-022 group test.",
          },
        },
      }),
      201,
      "createConnector",
    );
    ok(
      await call<Body>(api.app, "POST", `${L}/${created.id}/enable`, {
        session: techAdmin,
        headers: ifm(1),
        body: { reason: null },
      }),
      200,
      "enableConnector",
    );
    expect((await call<Body>(api.app, "POST", `${L}/${created.id}/runs`, { session: auditor, body: {} })).status).toBe(
      403,
    );
    const runRes = ok(
      await call<Body>(api.app, "POST", `${L}/${created.id}/runs`, { session: techAdmin, body: {} }),
      202,
      "runConnector",
    );
    const url = `${L}/${created.id}/runs/${runRes.id}`;
    expect(ok(await get(url, techAdmin), 200, "getIntegrationRun").run).toMatchObject({
      id: runRes.id,
      status: "queued",
    });
    expect((await get(url, auditor)).status).toBe(200);
    expect((await get(url, officeB)).status).toBe(404);
    const row = await owner
      .selectFrom("integration_run")
      .select(["id", "requested_by", "service_identity_id", "status"])
      .where("id", "=", runRes.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ requested_by: w.admin.id, status: "queued" });
    expect(row.service_identity_id).toBe(created.serviceIdentityId);
  });

  it("ReportSnapshot and AuditEvent: issueReportSnapshot, read by getReportSnapshot; its audit event by getAuditEvent", async () => {
    const p = await setupP2World(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    ok(
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
    const generated = ok(
      await call<Body>(api.app, "POST", `${T}/reports/charter/generate`, { session: p.lead.session, body: {} }),
      201,
      "generateReport",
    );
    const issue = (session: Session) =>
      call<Body>(api.app, "POST", `${T}/report-snapshots/${generated.id}/issue`, {
        session,
        headers: ifm(1),
        body: { note: "Synthetic issue for the S16-022 test" },
      });
    expect((await issue(p.auditor.session)).status).toBe(403);
    const issued = ok(await issue(p.lead.session), 200, "issueReportSnapshot");
    expect(issued.status).toBe("issued");
    const url = `${T}/report-snapshots/${generated.id}`;
    expect(ok(await get(url, p.lead.session), 200, "getReportSnapshot")).toMatchObject({ status: "issued" });
    expect((await get(url, p.auditor.session)).status).toBe(200);
    expect((await get(url, officeB)).status).toBe(404);
    const snapshot = await owner
      .selectFrom("report_snapshot")
      .select(["id", "created_by", "issued_by", "status"])
      .where("id", "=", generated.id)
      .executeTakeFirstOrThrow();
    expect(snapshot).toMatchObject({ created_by: p.lead.id, issued_by: p.lead.id, status: "issued" });

    // AuditEvent: the issue's own audit event (append-only; actor = the issuing user).
    const events = await auditOf(api.db, generated.id);
    const event = events.at(-1)!;
    expect(event.actor_user_id).toBe(p.lead.id);
    const A = `/api/v1/audit-events/${event.id}`;
    expect(ok(await get(A, auditor), 200, "getAuditEvent")).toMatchObject({ id: event.id, recordId: generated.id });
    // ADM_TECH's audit_event.read does not inherit (BE-E, ADR-0052 §8): a transformation's event is not in its scope.
    expect((await get(A, techAdmin)).status).toBe(404);
    expect((await get(A, officeB)).status).toBe(404);
    expect((await get(A)).status).toBe(401);
  });
});

/** Publishes `versionNo` of `ruleId` as the owner through the 0074 state machine (dry run, review, publish), audited
 * (the automation-rules.test.ts fixture: there is no API step before createAutomationRuleVersion needs a published
 * predecessor, and the review needs a second person). */
async function publishAsOwner(ruleId: string, versionNo: number): Promise<void> {
  const reviewerId = (await createUser(api.db, w.orgA.id)).id;
  await owner.transaction().execute(async (tx) => {
    const v = await tx
      .selectFrom("automation_rule_version")
      .selectAll()
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", versionNo)
      .executeTakeFirstOrThrow();
    const runId = uuidv7();
    await tx
      .insertInto("automation_dry_run")
      .values({
        id: runId,
        automation_rule_version_id: v.id,
        content_sha256: v.content_sha256,
        sample_event: JSON.stringify({ fixture: true }),
        outcome: "pass",
        run_by: methodAdmin.id,
      })
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "automation_dry_run",
      recordId: runId,
      organizationId: w.orgA.id,
    });
    const steps: Record<string, unknown>[] = [
      { status: "in_review", submitted_at: new Date() },
      { status: "approved", reviewed_by: reviewerId, reviewed_at: new Date() },
      { status: "published", published_by: methodAdmin.id, published_at: new Date() },
    ];
    let version = v.version;
    for (const s of steps) {
      version += 1;
      await tx
        .updateTable("automation_rule_version")
        .set({ ...s, version })
        .where("id", "=", v.id)
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "automation_rule_version",
        recordId: v.id,
        organizationId: w.orgA.id,
        newVersion: version,
      });
    }
    const rule = await tx.selectFrom("automation_rule").selectAll().where("id", "=", ruleId).executeTakeFirstOrThrow();
    await tx
      .updateTable("automation_rule")
      .set({ effective_version_id: v.id, version: rule.version + 1 })
      .where("id", "=", ruleId)
      .execute();
    await insertAuditEvent(tx, SYSTEM, {
      action: "test.seed",
      recordType: "automation_rule",
      recordId: ruleId,
      organizationId: w.orgA.id,
      newVersion: rule.version + 1,
    });
  });
}
