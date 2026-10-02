// Read-only auditor write-deny (ADR-0020 §4c; REQ-S10-001 / A12: "a read-only auditor can view but every write returns
// 403"). GENERATED from docs/api/openapi.yaml: every P2 mutating operation (every non-GET operation that is not one of
// the 33 DG1-approved P1 operations) is called by an AUD user against EXISTING records of a fully populated synthetic
// transformation, and must answer 403 with nothing written (the request's only audit event is the denial). A new P2
// mutating route cannot escape: the list comes from the contract, and a route whose path parameters this fixture
// cannot fill fails the test. The kpi operations are included too (kpi-benefits-engineer covers them in more depth
// in test/integration/kpi/kpi-aud-write-deny.test.ts). The same auditor can READ every P2 resource (200).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../support/contract.ts";
import { auditOfRequest, call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

/** The 33 P1 operations (DG1-approved, byte-stable); everything else in the contract is P2. */
const P1_OPERATIONS = new Set([
  "getHealth",
  "getReadiness",
  "startOidcLogin",
  "completeOidcLogin",
  "devLogin",
  "logout",
  "getMe",
  "updateMyPreferences",
  "listOrganizations",
  "createOrganization",
  "getOrganization",
  "updateOrganization",
  "listBusinessUnits",
  "createBusinessUnit",
  "getBusinessUnit",
  "updateBusinessUnit",
  "listUsers",
  "createUser",
  "getUser",
  "updateUser",
  "listRoles",
  "listPermissions",
  "getBrandingTokens",
  "listRoleAssignments",
  "createRoleAssignment",
  "getRoleAssignment",
  "revokeRoleAssignment",
  "listTransformations",
  "createTransformation",
  "getTransformation",
  "updateTransformation",
  "archiveTransformation",
  "listTransformationAudit",
]);

const P2_OPERATIONS = operations.filter((o) => !P1_OPERATIONS.has(o.operationId));
const P2_MUTATIONS = P2_OPERATIONS.filter((o) => o.method !== "GET");
const P2_READS = P2_OPERATIONS.filter((o) => o.method === "GET");

let api: TestApi;
let w: World;
let p: P2World;
const params = new Map<string, string>();

async function created(
  method: string,
  url: string,
  body: unknown,
  session = p.lead.session,
): Promise<{ id: string } & Record<string, unknown>> {
  const res = await call(api.app, method, url, { session, body });
  expect(res.status, `${method} ${url}: ${JSON.stringify(res.body).slice(0, 400)}`).toBeLessThan(300);
  return res.body;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  const T = `/api/v1/transformations/${p.transformationId}`;
  params.set("transformationId", p.transformationId);
  params.set("dimensionCode", "technology");
  params.set("gateCode", "G1");
  params.set("versionNo", "1");
  await created("POST", `${T}/charter`, { transformationName: "AUD sweep (synthetic)" });
  await created("PUT", `${T}/north-star`, { statement: "Synthetic North Star." });
  params.set(
    "strategicGuardrailId",
    (await created("POST", `${T}/strategic-guardrails`, { title: "g", category: "risk", statement: "s" })).id,
  );
  const outcomeId = (await created("POST", `${T}/outcomes`, { statement: "Synthetic outcome" })).id;
  params.set("outcomeId", outcomeId);
  const kpiDefinitionId = (
    await created("POST", `${T}/kpi-definitions`, {
      name: "Synthetic KPI",
      unitKind: "count",
      polarity: "higher_is_better",
    })
  ).id;
  params.set("kpiDefinitionId", kpiDefinitionId);
  params.set(
    "baselineId",
    (await created("POST", `${T}/baselines`, { metric: "m", unit: "count", scope: "operational" })).id,
  );
  params.set(
    "outcomeKpiId",
    (await created("POST", `${T}/outcome-kpis`, { outcomeId, kpiDefinitionId, targetDate: "2027-12-31" })).id,
  );
  params.set("valuePoolId", (await created("POST", `${T}/value-pools`, { name: "Synthetic pool" })).id);
  const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
  params.set("diagnosticItemId", items.body.items[0].id);
  params.set(
    "diagnosticFindingId",
    (await created("POST", `${T}/diagnostic-findings`, { workstreamCode: "customer", kind: "symptom", statement: "s" }))
      .id,
  );
  params.set(
    "diagnosticWorkstreamOutputId",
    (
      await created("POST", `${T}/workstream-outputs`, {
        workstreamCode: "customer",
        title: "t",
        recordType: "diagnostic_item",
        recordId: params.get("diagnosticItemId"),
      })
    ).id,
  );
  params.set("tomGapId", (await created("POST", `${T}/tom-gaps`, { dimensionCode: "technology" })).id);
  params.set("capabilityId", (await created("POST", `${T}/capability-heatmap`, { name: "c" })).id);
  const stepKey = "01920099-0000-7000-8000-0000000000aa";
  const journeyId = (
    await created("POST", `${T}/journeys`, {
      name: "j",
      kind: "journey",
      state: "current",
      steps: [{ key: stepKey, ordinal: 1, name: "s" }],
    })
  ).id;
  params.set("journeyId", journeyId);
  params.set("painPointId", (await created("POST", `${T}/journeys/${journeyId}/pain-points`, { description: "d" })).id);
  params.set(
    "dependencyId",
    (
      await created("POST", `${T}/dependencies`, {
        description: "d",
        fromKind: "other",
        fromLabel: "a",
        toKind: "other",
        toLabel: "b",
        dependencyType: "other",
      })
    ).id,
  );
  params.set("actionItemId", (await created("POST", `${T}/actions`, { title: "a", ownerUserId: p.lead.id })).id);
  const workshopId = (
    await created("POST", `${T}/tom-workshops`, {
      title: "w",
      workshopDate: "2026-11-01",
      durationMinutes: 60,
      facilitatorUserId: p.lead.id,
    })
  ).id;
  params.set("workshopId", workshopId);
  params.set(
    "participantId",
    (await created("POST", `${T}/tom-workshops/${workshopId}/participants`, { userId: p.sponsor.id })).id,
  );
  params.set(
    "itemId",
    (await created("POST", `${T}/tom-workshops/${workshopId}/items`, { kind: "unresolved", body: "b" })).id,
  );
  const evidenceId = (await created("POST", `${T}/evidence`, { kind: "file", title: "f", ownerUserId: p.lead.id })).id;
  params.set("evidenceId", evidenceId);
  const up = await call(api.app, "POST", `${T}/evidence/${evidenceId}/content`, {
    session: p.lead.session,
    headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "f.txt" },
    body: Buffer.from("synthetic"),
  });
  expect(up.status).toBe(200);
  params.set(
    "linkId",
    (await created("POST", `${T}/evidence-links`, { evidenceId, recordType: "outcome", recordId: outcomeId })).id,
  );
  const decision = await created("POST", "/api/v1/decisions", {
    transformationId: p.transformationId,
    title: "d",
    options: [{ title: "A" }],
  });
  params.set("decisionId", decision.id);
  params.set("optionId", (decision as unknown as { options: { id: string }[] }).options[0]!.id);
});
afterAll(() => api.close());

/** Fills an OpenAPI path from the fixture ids; throws on a parameter the fixture does not provide. */
function urlOf(path: string): string {
  return path.replace(/\{([A-Za-z]+)\}/g, (_m, name: string) => {
    const v = params.get(name);
    if (v === undefined) throw new Error(`AUD sweep fixture has no value for path parameter {${name}} (${path})`);
    return v;
  });
}

describe("read-only auditor (AUD) write-deny over every P2 mutating operation (generated from the contract)", () => {
  it("the generated list covers the P2 mutations (128 P2 operations in the contract)", () => {
    // 127 (T-DG2-ARCH-01B) + POST /kpi-definitions/{id}/activate (D-061, F-DG2-201).
    expect(P2_OPERATIONS).toHaveLength(128);
    expect(P2_MUTATIONS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(P2_MUTATIONS.map((o) => [o.operationId, o.method, o.path] as const))(
    "%s (%s %s): AUD gets 403 and nothing is written",
    async (_id, method, path) => {
      const url = urlOf(path);
      const res = await call(api.app, method, url, {
        session: p.auditor.session,
        headers: ifm(1),
        body: method === "POST" && path.endsWith("/decisions") ? { transformationId: p.transformationId } : {},
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      const written = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
      expect(written).toEqual(["authorization.denied"]);
    },
  );
});

describe("the same auditor can read every P2 resource", () => {
  // getGateSubmission needs a submitted gate (gates.test.ts covers its read by AUD-equivalent readers).
  const reads = P2_READS.filter((o) => o.operationId !== "getGateSubmission");
  it.each(reads.map((o) => [o.operationId, o.path] as const))("%s (GET %s): 200", async (_id, path) => {
    const url = urlOf(path) + (path === "/api/v1/decisions" ? `?transformationId=${p.transformationId}` : "");
    const res = await call(api.app, "GET", url, { session: p.auditor.session });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  });
});
