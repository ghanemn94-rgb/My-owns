// A17 / A11, REQ-S01-005 (qa-verifier, T-DG6-QA-A): "marking the task complete leaves the deliverable Unconfirmed; a
// filename-only link does not confirm it; reviewed evidence or a test-adapter confirmation sets it and records the
// source" (docs/delivery/requirements.csv, binding text, tested literally).
//
// Environment: the REAL API (Fastify inject) on the run's disposable PostgreSQL; every request through `call` is
// validated against docs/api/openapi.yaml. The task on the deliverable is created with the tasks module's own creation
// service (the path its producers use; there is no public "create task" route) and completed through the public route.
// The test-adapter confirmation is a `deliverable_status_push` outbound write to the local test adapter (no network).
// Assertions come from the row text and the contract (getDeliverableConfirmation, confirmDeliverableExternalChange,
// executeOutboundWrite). All data is SYNTHETIC; nothing here approves anything real (G1-G6) or touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkItemOnce } from "../../../apps/api/src/modules/tasks/index.ts";
import { ifm, setupP2World, type P2World } from "../../../apps/api/test/support/p2-fixtures.ts";
import { createInitiative } from "../../../apps/api/test/integration/contract/p3-exercises-be-b.ts";
import {
  call,
  createUser,
  grant,
  signIn,
  startApi,
  uniq,
  type Loose,
  type Session,
  type TestApi,
} from "../support/api.ts";
import { seedWorld, type World } from "../support/p4.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let bo: Session; // BO @ the transformation: flags and confirms with reviewed evidence
let td: Session; // TD @ the transformation: executes the outbound write
let admin: Session; // ADM_TECH @ org A: configures the test connector
let initiativeId: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  const scope = { type: "transformation" as const, id: p.transformationId };
  const boUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, boUser.id, "BO", scope, w.orgA.id);
  const tdUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tdUser.id, "TD", scope, w.orgA.id);
  bo = await signIn(api.app, boUser.subject);
  td = await signIn(api.app, tdUser.subject);
  admin = await signIn(api.app, w.admin.subject);
  initiativeId = (
    await createInitiative((m, u, o) => call<Loose>(api.app, m, u, o), p, {
      executiveOwnerUserId: p.sponsor.id,
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await api?.close();
});

const C = (d: string) => `/api/v1/deliverables/${d}/confirmation`;

/** A new deliverable flagged as an external change (customer system), Unconfirmed. */
async function flaggedDeliverable(): Promise<string> {
  const d = await call<Loose>(api.app, "POST", `/api/v1/initiatives/${initiativeId}/deliverables`, {
    session: p.lead.session,
    body: { title: uniq("QA A17 synthetic external deliverable ") },
  });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const f = await call<Loose>(api.app, "PUT", `/api/v1/deliverables/${d.body.id}/external-change`, {
    session: bo,
    headers: ifm(0),
    body: { isExternalChange: true, changeType: "customer_system", description: "Synthetic: a CRM change goes live." },
  });
  expect(f.status, JSON.stringify(f.body)).toBe(200);
  expect(f.body.externalChange).toMatchObject({ confirmationStatus: "unconfirmed", confirmationSource: null });
  return d.body.id as string;
}

async function state(d: string): Promise<Loose> {
  const r = await call<Loose>(api.app, "GET", C(d), { session: p.auditor.session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.externalChange;
}

async function evidence(kind: "note" | "file_reference", verify: boolean): Promise<string> {
  const body =
    kind === "note"
      ? { kind, title: uniq("QA A17 go-live record "), noteBody: "Synthetic.", ownerUserId: p.lead.id }
      : { kind, title: uniq("QA A17 filename link "), fileName: "go-live-signoff.pdf", ownerUserId: p.lead.id };
  const e = await call<Loose>(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body });
  expect(e.status, JSON.stringify(e.body)).toBe(201);
  if (verify) {
    const r = await call<Loose>(api.app, "POST", `${T}/evidence/${e.body.id}/review`, {
      session: p.office.session,
      headers: ifm(1),
      body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic review" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  return e.body.id as string;
}

describe("REQ-S01-005: only reviewed evidence or a test-adapter confirmation confirms an external change", () => {
  it("marking the task complete leaves the deliverable Unconfirmed", async () => {
    const d = await flaggedDeliverable();
    const { workItemId } = await api.db.transaction().execute((tx) =>
      createWorkItemOnce(
        tx,
        { actorType: "service", actorUserId: null, requestId: `qa-a17-${randomUUID()}`, source: "worker" },
        {
          organizationId: w.orgA.id,
          transformationId: p.transformationId,
          kind: "gate_condition_due",
          assigneeUserId: p.lead.id,
          subjectType: "deliverable",
          subjectId: d,
          linkPath: `/deliverables/${d}`,
          messageKey: "tasks.synthetic",
          messageParams: {},
          dueDate: null,
          dedupeKey: `qa.a17:${randomUUID()}`,
        },
      ),
    );
    const done = await call<Loose>(api.app, "POST", `/api/v1/work-items/${workItemId}/complete`, {
      session: p.lead.session,
      headers: ifm(1),
      body: {},
    });
    expect([done.status, done.body.status], JSON.stringify(done.body)).toEqual([200, "done"]);
    expect(await state(d)).toMatchObject({
      confirmationStatus: "unconfirmed",
      confirmationSource: null,
      confirmedAt: null,
    });
  });

  it("a filename-only link does not confirm it (422 external_change.evidence_not_verified); it stays Unconfirmed", async () => {
    const d = await flaggedDeliverable();
    const link = await evidence("file_reference", false);
    const r = await call<Loose>(api.app, "POST", C(d), {
      session: bo,
      headers: ifm(1),
      body: { evidenceId: link, note: null },
    });
    expect([r.status, r.body.code], JSON.stringify(r.body)).toEqual([422, "external_change.evidence_not_verified"]);
    expect(await state(d)).toMatchObject({ confirmationStatus: "unconfirmed", evidenceId: null });
  });

  it("reviewed evidence sets it and records the source (the evidence and who confirmed)", async () => {
    const d = await flaggedDeliverable();
    const ev = await evidence("note", true);
    const r = await call<Loose>(api.app, "POST", C(d), {
      session: bo,
      headers: ifm(1),
      body: { evidenceId: ev, note: "Synthetic: reviewed go-live record." },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const x = await state(d);
    expect(x).toMatchObject({
      confirmationStatus: "confirmed",
      confirmationSource: "reviewed_evidence",
      evidenceId: ev,
    });
    expect(x.confirmedBy).toEqual(expect.any(String));
    expect(x.confirmedAt).toEqual(expect.any(String));
  });

  it("a test-adapter confirmation sets it and records the source (connector, source system id, reference, time)", async () => {
    const d = await flaggedDeliverable();
    const c = await call<Loose>(api.app, "POST", "/api/v1/admin/connectors", {
      session: admin,
      body: {
        organizationId: w.orgA.id,
        code: uniq("qa-a17-dx-").toLowerCase(),
        nameEn: "QA A17 synthetic customer system",
        nameAr: "نظام عملاء اصطناعي",
        adapterKind: "test_adapter",
        targetKind: "none",
        config: {
          sourceSystemId: "synthetic.qa-a17:crm",
          endpointUrl: null,
          credentialRefs: {},
          fieldMappings: [],
          targetTransformationId: null,
          cadence: "manual",
          retryMaxAttempts: 0,
          retryBackoffSeconds: 60,
          commitMode: "manual",
          commitOnBehalfOf: null,
          outboundActions: ["deliverable_status_push"],
          reconciliationRule: "none",
          adapterSettings: { mode: "healthy", confirm: "immediate" },
          reason: "QA A17 synthetic outbound connector",
        },
      },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const en = await call<Loose>(api.app, "POST", `/api/v1/admin/connectors/${c.body.id}/enable`, {
      session: admin,
      headers: ifm(1),
      body: { reason: null },
    });
    expect(en.status, JSON.stringify(en.body)).toBe(200);
    const write = await call<Loose>(api.app, "POST", `${T}/outbound-writes`, {
      session: td,
      body: {
        connectorId: c.body.id,
        actionCode: "deliverable_status_push",
        deliverableId: d,
        idempotencyKey: uniq("qa-a17-key-"),
        payload: { status: "done" },
      },
    });
    expect([write.status, write.body.status], JSON.stringify(write.body)).toEqual([201, "confirmed"]);
    const x = await state(d);
    expect(x).toMatchObject({
      confirmationStatus: "confirmed",
      confirmationSource: "connector_result",
      outboundWriteId: write.body.id,
      connectorId: c.body.id,
      sourceSystemId: "synthetic.qa-a17:crm",
      evidenceId: null,
    });
    expect(x.sourceReference).toEqual(expect.any(String));
    expect(x.sourceConfirmedAt).toEqual(expect.any(String));
  });
});
