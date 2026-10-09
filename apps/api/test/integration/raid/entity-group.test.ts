// REQ-S16-018 (ADR-0031 §12; T-DG4-BE-D2): the RAID, decisions and approvals entity group through the API. A09:
// "an integration test creates and reads each one through the API with authorization enforced". For each of Risk,
// Assumption, Issue, Action, Decision (design) and Approval this file creates the record through its API operation,
// reads it back, gets 403 for an AUD user on the write and 404 for a caller outside the transformation's scope (an
// other-organization office user, and the ADM-only technical administrator) on both the write and the read.
// The ChangeRequest case is added to this file by BE-L (slice H) when that entity exists (ADR-0031 §12); until then
// REQ-S16-018 is not complete. All data is SYNTHETIC; the approval is a demo BUSINESS approval request on a synthetic
// decision and approves nothing real; nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { newDecision, requestBody, setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";
import { approvedMilestone, selectedInitiative, type ChangeWorld } from "../workflows/change-fixtures.ts";

let api: TestApi;
let w: World;
let p: ApprovalWorld;
let outsiders: { name: string; session: Session }[];
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupApprovalWorld(api, w);
  outsiders = [
    { name: "other-organization office", session: await signIn(api.app, w.officeB.subject) },
    { name: "ADM-only technical admin", session: await signIn(api.app, w.admin.subject) },
  ];
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const base = () => `/api/v1/transformations/${p.transformationId}`;

/** The write as AUD (403) and as each outsider (404), then the read as each outsider (404). */
async function enforced(write: { method: string; url: string; body: unknown }, readUrl: string): Promise<void> {
  const aud = await call(api.app, write.method, write.url, { session: p.auditor.session, body: write.body });
  expect([write.url, aud.status]).toEqual([write.url, 403]);
  for (const o of outsiders) {
    const wr = await call(api.app, write.method, write.url, { session: o.session, body: write.body });
    expect([o.name, write.url, wr.status]).toEqual([o.name, write.url, 404]);
    const rd = await call(api.app, "GET", readUrl, { session: o.session });
    expect([o.name, readUrl, rd.status]).toEqual([o.name, readUrl, 404]);
  }
}

describe("REQ-S16-018: Risk, Assumption, Issue (raid_entry), with owner and status", () => {
  for (const [type, extra, prefix] of [
    ["risk", { probability: "medium" }, "R"],
    ["assumption", {}, "A"],
    ["issue", {}, "I"],
  ] as const) {
    it(`${type}: create and read through the API; AUD 403 on the write; 404 outside scope`, async () => {
      const write = {
        method: "POST",
        url: `${base()}/raid`,
        body: {
          type,
          description: `Synthetic ${type}`,
          impact: "high",
          ownerUserId: p.contributor.id,
          ...extra,
        },
      };
      const created = await call(api.app, write.method, write.url, { session: p.lead.session, body: write.body });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const read = await call(api.app, "GET", `${write.url}/${created.body.id}`, { session: p.auditor.session });
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({
        id: created.body.id,
        type,
        ownerUserId: p.contributor.id,
        status: "open",
        recordTable: "raid_entry",
      });
      expect(read.body.code).toMatch(new RegExp(`^${prefix}-[0-9]{2,6}$`));
      await enforced(write, `${write.url}/${created.body.id}`);
    });
  }
});

describe("REQ-S16-018: Action (action_item), with owner and status", () => {
  it("an action on a Risk and a DG2 action: create and read; AUD 403; 404 outside scope", async () => {
    const risk = await call(api.app, "POST", `${base()}/raid`, {
      session: p.lead.session,
      body: { type: "risk", description: "Synthetic", impact: "low", probability: "low", ownerUserId: p.lead.id },
    });
    const linked = {
      method: "POST",
      url: `${base()}/raid/${risk.body.id}/actions`,
      body: { title: "Synthetic action", ownerUserId: p.contributor.id },
    };
    const a = await call(api.app, linked.method, linked.url, { session: p.lead.session, body: linked.body });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const read = await call(api.app, "GET", `${base()}/action-register/${a.body.id}`, { session: p.auditor.session });
    expect([read.status, read.body.ownerUserId, read.body.status, read.body.sourceKind]).toEqual([
      200,
      p.contributor.id,
      "open",
      "raid_entry",
    ]);
    await enforced(linked, `${base()}/action-register/${a.body.id}`);

    const dg2 = { method: "POST", url: `${base()}/actions`, body: { title: "Synthetic DG2", ownerUserId: p.lead.id } };
    const d = await call(api.app, dg2.method, dg2.url, { session: p.lead.session, body: dg2.body });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const dr = await call(api.app, "GET", `${base()}/actions/${d.body.id}`, { session: p.auditor.session });
    expect([dr.status, dr.body.ownerUserId, dr.body.status]).toEqual([200, p.lead.id, "open"]);
    await enforced(dg2, `${base()}/actions/${d.body.id}`);
  });
});

describe("REQ-S16-018: Decision (design, the canonical decision table), with owner and status", () => {
  it("create and read through the API; AUD 403; 404 outside scope", async () => {
    const write = {
      method: "POST",
      url: "/api/v1/decisions",
      body: { transformationId: p.transformationId, title: "Synthetic design decision", ownerUserId: p.lead.id },
    };
    const created = await call(api.app, write.method, write.url, { session: p.lead.session, body: write.body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const read = await call(api.app, "GET", `/api/v1/decisions/${created.body.id}`, { session: p.auditor.session });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: created.body.id, kind: "design", ownerUserId: p.lead.id, status: "open" });
    expect(read.body.code).toMatch(/^D-[0-9]{2,6}$/);
    await enforced(write, `/api/v1/decisions/${created.body.id}`);
  });
});

describe("REQ-S16-018: Approval (the P4 canonical approval), with requester, assignee and status", () => {
  it("request and read through the API; AUD 403; 404 outside scope", async () => {
    const decisionId = await newDecision((m, u, o) => call(api.app, m, u, o), p, "Synthetic decision for the group");
    const write = {
      method: "POST",
      url: `${base()}/approvals`,
      body: requestBody(decisionId, p.rights["target_state_design"]!),
    };
    const created = await call(api.app, write.method, write.url, { session: p.lead.session, body: write.body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const read = await call(api.app, "GET", `/api/v1/approvals/${created.body.id}`, { session: p.auditor.session });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: created.body.id, status: "pending", requestedBy: p.lead.id });
    const second = await newDecision((m, u, o) => call(api.app, m, u, o), p, "Synthetic decision, refusals");
    await enforced(
      { ...write, body: requestBody(second, p.rights["target_state_design"]!) },
      `/api/v1/approvals/${created.body.id}`,
    );
  });
});

// T-DG4-BE-L (ADR-0036 §11, ADR-0031 §12; append-only): the ChangeRequest case, which completes the entity group.
describe("REQ-S16-018: ChangeRequest (change_request), with owner (raised_by) and status", () => {
  it("create and read through the API; AUD 403 on the write; 404 outside scope", async () => {
    const c = { ...p, organizationId: w.orgA.id, base: base() } as unknown as ChangeWorld;
    const initiativeId = await selectedInitiative(api.db, c);
    const milestoneId = await approvedMilestone(api.db, c, initiativeId, "2026-11-02", "2026-11-16");
    const write = {
      method: "POST",
      url: `${base()}/change-requests`,
      body: {
        changeKind: "schedule_rebaseline",
        subjectType: "milestone",
        subjectId: milestoneId,
        subjectVersion: 1,
        proposedChange: { approvedDate: { from: "2026-11-02", to: "2026-11-16" } },
        reason: "Synthetic rebaseline for the entity group",
      },
    };
    const created = await call(api.app, write.method, write.url, { session: p.lead.session, body: write.body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const read = await call(api.app, "GET", `${write.url}/${created.body.id}`, { session: p.auditor.session });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: created.body.id, raisedBy: p.lead.id, status: "draft", origin: "manual" });
    expect(read.body.code).toMatch(/^CR-[0-9]{2,}$/);
    await enforced(write, `${write.url}/${created.body.id}`);
  });
});
