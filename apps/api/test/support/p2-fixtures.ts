// P2 integration fixtures (backend-workflow-engineer). All data is SYNTHETIC. A "P2 world" is a transformation created
// through the API by a Transformation Lead (who thereby holds the derived TL assignment at the transformation,
// F-DG1-106), a Sponsor (SP) granted at the transformation, a Transformation Office user (TO, inherits from the
// organization; reviewer of evidence), a Workstream Lead (WL, contributor), a methodology admin and the read-only
// auditor (AUD). `makeG1Ready` completes every G1 required output through the API - including VERIFIED evidence - so
// the gate can be submitted and decided. The G1 decision in a test is a demo decision on synthetic data: it approves
// nothing real, and it is a PRODUCT gate (business approval), unrelated to the engineering gates DG0-DG7.
import { expect } from "vitest";
import {
  call,
  createUser,
  grant,
  signIn,
  type RequestOptions,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "./harness.ts";

export const ifm = (v: number | string): Record<string, string> => ({ "if-match": `"${v}"` });

export interface P2World {
  readonly transformationId: string;
  readonly lead: { id: string; session: Session };
  readonly sponsor: { id: string; session: Session };
  readonly office: { id: string; session: Session };
  readonly contributor: { id: string; session: Session };
  readonly auditor: { id: string; session: Session };
  readonly methodologyAdmin: { id: string; session: Session };
}

type Caller = (method: string, url: string, opts?: RequestOptions) => Promise<Res>;

/** Creates a P2 world on BU a1 of org A. `send` lets the contract test route calls through its mirror check. */
export async function setupP2World(api: TestApi, w: World, send?: Caller): Promise<P2World> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const lead = await createUser(api.db, w.orgA.id);
  const sponsor = await createUser(api.db, w.orgA.id);
  const contributor = await createUser(api.db, w.orgA.id);
  const methodologyAdmin = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, lead.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  await grant(
    api.db,
    w.grantor.id,
    methodologyAdmin.id,
    "ADM_METHOD",
    { type: "organization", id: w.orgA.id },
    w.orgA.id,
  );
  const leadSession = await signIn(api.app, lead.subject);
  const t = await req("POST", "/api/v1/transformations", {
    session: leadSession,
    body: { businessUnitId: w.a1, name: "Synthetic P2 transformation", mode: "end_to_end" },
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  const transformationId = (t.body as { id: string }).id;
  await grant(api.db, w.grantor.id, sponsor.id, "SP", { type: "transformation", id: transformationId }, w.orgA.id);
  await grant(api.db, w.grantor.id, contributor.id, "WL", { type: "transformation", id: transformationId }, w.orgA.id);
  return {
    transformationId,
    lead: { id: lead.id, session: leadSession },
    sponsor: { id: sponsor.id, session: await signIn(api.app, sponsor.subject) },
    office: { id: w.office.id, session: await signIn(api.app, w.office.subject) },
    contributor: { id: contributor.id, session: await signIn(api.app, contributor.subject) },
    auditor: { id: w.auditor.id, session: await signIn(api.app, w.auditor.subject) },
    methodologyAdmin: { id: methodologyAdmin.id, session: await signIn(api.app, methodologyAdmin.subject) },
  };
}

const ok = (res: Res, status: number, what: string) => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 600)}`).toBe(status);
  return res.body as { id: string; version: number } & Record<string, unknown>;
};

/** Completes every G1 required output of the world's transformation through the API (synthetic data). */
export async function makeG1Ready(
  api: TestApi,
  p: P2World,
  send?: Caller,
): Promise<{ evidenceId: string; baselineId: string }> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const T = `/api/v1/transformations/${p.transformationId}`;
  const lead = p.lead.session;

  ok(
    await req("POST", `${T}/charter`, {
      session: lead,
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
  const baseline = ok(
    await req("POST", `${T}/baselines`, {
      session: lead,
      body: {
        metric: "Roaming revenue per month (synthetic)",
        unit: "SAR",
        scope: "revenue",
        value: "1250000",
        currency: "SAR",
        source: "Synthetic finance extract",
        baselineDate: "2026-01-31",
      },
    }),
    201,
    "createBaseline",
  );
  ok(
    await req("POST", `${T}/value-pools`, {
      session: lead,
      body: {
        name: "Roaming bundles (synthetic)",
        quantificationStatus: "unquantified",
        unquantifiedReason: "Synthetic: sizing pending market data.",
        materiality: "material",
      },
    }),
    201,
    "createValuePool",
  );
  ok(
    await req("POST", `${T}/diagnostic-findings`, {
      session: lead,
      body: {
        workstreamCode: "business_financial",
        kind: "root_cause",
        statement: "Synthetic: bundle pricing is uncompetitive.",
        status: "confirmed",
      },
    }),
    201,
    "createDiagnosticFinding",
  );
  // One native-note evidence item, verified by someone other than its creator, linked to every T01 row and the baseline.
  const evidence = ok(
    await req("POST", `${T}/evidence`, {
      session: lead,
      body: {
        kind: "note",
        title: "Synthetic diagnostic interview notes",
        noteBody: "Synthetic interview notes supporting the T01 rows.",
        ownerUserId: p.lead.id,
      },
    }),
    201,
    "createEvidence",
  );
  ok(
    await req("POST", `${T}/evidence/${evidence.id}/review`, {
      session: p.office.session,
      headers: ifm(evidence.version),
      body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: read and accepted." },
    }),
    200,
    "reviewEvidence",
  );
  const items = (await req("GET", `${T}/diagnostic-items?limit=50`, { session: lead })).body as {
    items: { id: string; version: number; isSeeded: boolean }[];
  };
  for (const item of items.items.filter((i) => i.isSeeded)) {
    ok(
      await req("PATCH", `${T}/diagnostic-items/${item.id}`, {
        session: lead,
        headers: ifm(item.version),
        body: {
          currentState: "Synthetic current state.",
          rootCause: "Synthetic root cause.",
          impactText: "Synthetic impact on revenue.",
          confidence: "M",
        },
      }),
      200,
      "updateDiagnosticItem",
    );
    ok(
      await req("POST", `${T}/evidence-links`, {
        session: lead,
        body: { evidenceId: evidence.id, recordType: "diagnostic_item", recordId: item.id },
      }),
      201,
      "createEvidenceLink",
    );
  }
  ok(
    await req("POST", `${T}/evidence-links`, {
      session: lead,
      body: { evidenceId: evidence.id, recordType: "baseline", recordId: baseline.id },
    }),
    201,
    "createEvidenceLink(baseline)",
  );
  return { evidenceId: evidence.id, baselineId: baseline.id };
}

/** The gate instance version (for If-Match on submit/configure). */
export async function gateVersion(api: TestApi, p: P2World, gateCode: string): Promise<number> {
  const res = await call<{ gate: { version: number } }>(
    api.app,
    "GET",
    `/api/v1/transformations/${p.transformationId}/gates/${gateCode}`,
    { session: p.lead.session },
  );
  expect(res.status).toBe(200);
  return res.body.gate.version;
}
