// Contract exercises of the P2 backend operations (backend-workflow-engineer; p2-work-split §5). contract.test.ts
// calls exerciseP2BackendOperations once; every call goes through `mirrored` (OpenAPI status/body/header validation,
// the problem mirror for errors and, for operations in ZOD_MIRRORS, the zod mirror of the success body). Every one of
// the 104 operations is exercised with at least one success, so p2-pending.ts is empty. All data is SYNTHETIC; the G1
// decision below is a demo business decision on synthetic data and approves nothing real (it is a PRODUCT gate,
// unrelated to the engineering delivery gates DG0-DG7).
import { expect } from "vitest";
import { createUser, type RequestOptions, type Res, type TestApi, type World } from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, ifm, makeG1Ready, setupP2World } from "../../support/p2-fixtures.ts";

export interface P2ContractContext {
  readonly api: TestApi;
  readonly world: World;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly mirrored: (method: string, url: string, opts?: RequestOptions) => Promise<Res<any>>;
}

export async function exerciseP2BackendOperations({ api, world: w, mirrored: m }: P2ContractContext): Promise<void> {
  const p = await setupP2World(api, w, m);
  const T = `/api/v1/transformations/${p.transformationId}`;
  const lead = p.lead.session;
  const office = p.office.session;
  const expectStatus = (res: Res, status: number, what: string) =>
    expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 500)}`).toBe(status);

  // ---------------------------------------------------------------- methodology, accountabilities, team
  const catalogue = await m("GET", `${T}/methodology`, { session: lead });
  expectStatus(catalogue, 200, "getTransformationMethodology");
  const tech = (catalogue.body.tomDimensions as { code: string; version: number; labelEn: string }[]).find(
    (d) => d.code === "technology",
  )!;
  expectStatus(
    await m("PATCH", "/api/v1/methodology/tom-dimensions/technology", {
      session: p.methodologyAdmin.session,
      headers: ifm(tech.version),
      body: { labelEn: tech.labelEn },
    }),
    200,
    "updateTomDimensionLabels",
  );
  expectStatus(await m("GET", "/api/v1/role-accountabilities", { session: lead }), 200, "listRoleAccountabilities");
  const member = await createUser(api.db, w.orgA.id);
  expectStatus(
    await m("POST", `${T}/scoped-assignments`, {
      session: lead,
      body: { userId: member.id, roleCode: "KDS", reason: "Synthetic team staffing" },
    }),
    201,
    "assignTransformationTeamRole",
  );
  expectStatus(await m("GET", `${T}/scoped-assignments`, { session: lead }), 200, "listTransformationTeam");

  // ---------------------------------------------------------------- North Star
  expectStatus(
    await m("PUT", `${T}/north-star`, { session: lead, body: { statement: "Grow roaming revenue (synthetic)." } }),
    200,
    "setNorthStar",
  );
  expectStatus(
    await m("PUT", `${T}/north-star`, {
      session: lead,
      headers: ifm(1),
      body: { statement: "Double roaming revenue by 2028 (synthetic)." },
    }),
    200,
    "setNorthStar (refine)",
  );
  expectStatus(await m("GET", `${T}/north-star`, { session: lead }), 200, "getNorthStar");
  expectStatus(await m("GET", `${T}/north-star/history`, { session: lead }), 200, "listNorthStarHistory");

  // ---------------------------------------------------------------- G1 readiness (charter, T01, findings, evidence...)
  const { evidenceId } = await makeG1Ready(api, p, m);
  expectStatus(await m("GET", `${T}/charter`, { session: lead }), 200, "getCharter");
  expectStatus(
    await m("PATCH", `${T}/charter`, {
      session: lead,
      headers: ifm(1),
      body: { governanceForum: "Synthetic steering committee", changeSummary: "Add the forum" },
    }),
    200,
    "updateCharter",
  );
  expectStatus(await m("GET", `${T}/charter/versions`, { session: lead }), 200, "listCharterVersions");
  expectStatus(await m("GET", `${T}/charter/versions/2`, { session: lead }), 200, "getCharterVersion");

  // ---------------------------------------------------------------- generic registers
  const register = async (
    name: string,
    path: string,
    create: Record<string, unknown>,
    update: Record<string, unknown>,
    opts: { archive?: boolean; get?: boolean; session?: typeof lead } = {},
  ) => {
    const session = opts.session ?? lead;
    expectStatus(await m("GET", `${T}/${path}`, { session }), 200, `list ${name}`);
    const created = await m("POST", `${T}/${path}`, { session, body: create });
    expectStatus(created, 201, `create ${name}`);
    const id = created.body.id as string;
    if (opts.get !== false) expectStatus(await m("GET", `${T}/${path}/${id}`, { session }), 200, `get ${name}`);
    const updated = await m("PATCH", `${T}/${path}/${id}`, { session, headers: ifm(1), body: update });
    expectStatus(updated, 200, `update ${name}`);
    // Stale If-Match: 409 version-conflict with the current version.
    const stale = await m("PATCH", `${T}/${path}/${id}`, { session, headers: ifm(1), body: update });
    expectStatus(stale, 409, `stale update ${name}`);
    if (opts.archive !== false)
      expectStatus(
        await m("POST", `${T}/${path}/${id}/archive`, {
          session,
          headers: ifm(2),
          body: { reason: "Synthetic archive" },
        }),
        200,
        `archive ${name}`,
      );
    return id;
  };

  await register(
    "strategic guardrail",
    "strategic-guardrails",
    { title: "No CAPEX overrun (synthetic)", category: "capex", statement: "Stay within the approved envelope." },
    { statement: "Stay within the approved CAPEX envelope." },
  );
  await register(
    "outcome",
    "outcomes",
    { statement: "Roaming revenue grows (synthetic)" },
    { isTopOutcome: true, topRank: 1 },
  );
  await register(
    "diagnostic item",
    "diagnostic-items",
    { dimensionCode: "customer", currentState: "Extra synthetic T01 row", confidence: "L" },
    { impactAmount: "1500000.5", impactCurrency: "SAR" },
  );
  await register(
    "diagnostic finding",
    "diagnostic-findings",
    { workstreamCode: "customer", kind: "symptom", statement: "Synthetic churn spike" },
    { status: "confirmed" },
  );
  const itemId = ((await m("GET", `${T}/diagnostic-items`, { session: lead })).body.items as { id: string }[])[0]!.id;
  await register(
    "workstream output",
    "workstream-outputs",
    { workstreamCode: "customer", title: "Synthetic churn analysis", recordType: "diagnostic_item", recordId: itemId },
    { note: "Synthetic note" },
  );
  await register(
    "TOM gap",
    "tom-gaps",
    { dimensionCode: "technology", currentState: "Legacy BSS (synthetic)", targetState: "Modern BSS" },
    { ownerUserId: p.lead.id },
  );
  await register(
    "capability",
    "capability-heatmap",
    { name: "Real-time rating (synthetic)", currentLevel: 2, targetLevel: 4, sourcingNeed: "buy" },
    { sourcingNeed: "partner" },
  );
  const stepKey = "01920099-0000-7000-8000-000000000001";
  const journeyId = await register(
    "journey",
    "journeys",
    {
      name: "Roaming activation (synthetic)",
      kind: "journey",
      state: "future",
      steps: [{ key: stepKey, ordinal: 1, name: "Activate bundle", actor: "Customer", systems: ["App"] }],
    },
    { status: "active" },
    { archive: false },
  );
  expectStatus(
    await m("POST", `${T}/journeys/${journeyId}/archive`, {
      session: lead,
      headers: ifm(2),
      body: { reason: "Synthetic archive" },
    }),
    200,
    "archiveJourney",
  );
  const liveJourney = await m("POST", `${T}/journeys`, {
    session: lead,
    body: {
      name: "Roaming support (synthetic)",
      kind: "process",
      state: "current",
      steps: [{ key: stepKey, ordinal: 1, name: "Call" }],
    },
  });
  expectStatus(liveJourney, 201, "createJourney");
  const PP = `${T}/journeys/${liveJourney.body.id}/pain-points`;
  const pain = await m("POST", PP, { session: lead, body: { description: "Long wait (synthetic)", stepKey } });
  expectStatus(pain, 201, "createJourneyPainPoint");
  expectStatus(await m("GET", PP, { session: lead }), 200, "listJourneyPainPoints");
  expectStatus(
    await m("PATCH", `${PP}/${pain.body.id}`, {
      session: lead,
      headers: ifm(1),
      body: { description: "Very long wait" },
    }),
    200,
    "updateJourneyPainPoint",
  );
  expectStatus(
    await m("POST", `${PP}/${pain.body.id}/archive`, {
      session: lead,
      headers: ifm(2),
      body: { reason: "Synthetic fix" },
    }),
    200,
    "archiveJourneyPainPoint",
  );
  await register(
    "dependency",
    "dependencies",
    {
      description: "Needs vendor API (synthetic)",
      fromKind: "tom_dimension",
      toKind: "external",
      toLabel: "Vendor X",
      dependencyType: "vendor",
      tomDimensionCode: "technology",
    },
    { status: "at_risk" },
  );
  await register(
    "action",
    "actions",
    { title: "Draft vendor RFP (synthetic)", ownerUserId: p.lead.id, dueDate: "2026-12-15" },
    { status: "in_progress" },
    { archive: false },
  );

  // ---------------------------------------------------------------- evidence (file content) and links
  const file = await m("POST", `${T}/evidence`, {
    session: lead,
    body: { kind: "file", title: "Synthetic market study", ownerUserId: p.lead.id },
  });
  expectStatus(file, 201, "createEvidence(file)");
  expectStatus(await m("GET", `${T}/evidence`, { session: lead }), 200, "listEvidence");
  expectStatus(await m("GET", `${T}/evidence/${file.body.id}`, { session: lead }), 200, "getEvidence");
  expectStatus(
    await m("PATCH", `${T}/evidence/${file.body.id}`, {
      session: lead,
      headers: ifm(1),
      body: { source: "Synthetic vendor" },
    }),
    200,
    "updateEvidence",
  );
  const upload = await m("POST", `${T}/evidence/${file.body.id}/content`, {
    session: lead,
    headers: { ...ifm(2), "content-type": "application/octet-stream", "x-file-name": "market-study.pdf" },
    body: Buffer.from("%PDF-1.4 synthetic"),
  });
  expectStatus(upload, 200, "uploadEvidenceContent");
  const download = await m("GET", `${T}/evidence/${file.body.id}/content`, { session: lead });
  expectStatus(download, 200, "downloadEvidenceContent");
  expect(download.body).toBe("%PDF-1.4 synthetic");
  expect(download.headers["content-disposition"]).toMatch(/^attachment; filename="market-study.pdf"/);
  expect(download.headers["x-content-type-options"]).toBe("nosniff");
  expectStatus(
    await m("POST", `${T}/evidence/${file.body.id}/archive`, {
      session: lead,
      headers: ifm(3),
      body: { reason: "Synthetic" },
    }),
    200,
    "archiveEvidence",
  );
  const links = await m("GET", `${T}/evidence-links?recordType=baseline`, { session: lead });
  expectStatus(links, 200, "listEvidenceLinks");
  const outcomeForLink = await m("POST", `${T}/outcomes`, {
    session: lead,
    body: { statement: "Link target (synthetic)" },
  });
  const link = await m("POST", `${T}/evidence-links`, {
    session: lead,
    body: { evidenceId, recordType: "outcome", recordId: outcomeForLink.body.id },
  });
  expectStatus(link, 201, "createEvidenceLink");
  expectStatus(
    await m("POST", `${T}/evidence-links/${link.body.id}/remove`, {
      session: lead,
      headers: ifm(1),
      body: { reason: "Synthetic unlink" },
    }),
    200,
    "removeEvidenceLink",
  );

  // ---------------------------------------------------------------- decisions (T04)
  const decision = await m("POST", "/api/v1/decisions", {
    session: lead,
    body: {
      transformationId: p.transformationId,
      title: "Build or buy the rating engine (synthetic)",
      ownerUserId: p.lead.id,
      tomDimensionCode: "technology",
      options: [{ title: "Build" }, { title: "Buy" }],
    },
  });
  expectStatus(decision, 201, "createDecision");
  expect(decision.body).toMatchObject({ kind: "design", status: "open", code: expect.stringMatching(/^D-\d{2,}$/) });
  const D = `/api/v1/decisions/${decision.body.id}`;
  expectStatus(
    await m("GET", `/api/v1/decisions?transformationId=${p.transformationId}&kind=design`, { session: lead }),
    200,
    "listDecisions",
  );
  expectStatus(await m("GET", D, { session: lead }), 200, "getDecision");
  expectStatus(
    await m("PATCH", D, { session: lead, headers: ifm(1), body: { context: "Synthetic context" } }),
    200,
    "updateDecision",
  );
  const withC = await m("POST", `${D}/options`, { session: lead, headers: ifm(2), body: { title: "Partner" } });
  expectStatus(withC, 200, "addDecisionOption");
  const optionB = (withC.body.options as { id: string; label: string }[]).find((o) => o.label === "B")!;
  expectStatus(
    await m("PATCH", `${D}/options/${optionB.id}`, {
      session: lead,
      headers: ifm(3),
      body: { description: "Synthetic SaaS" },
    }),
    200,
    "updateDecisionOption",
  );
  expectStatus(
    await m("POST", `${D}/decide`, {
      session: lead,
      headers: ifm(4),
      body: { chosenOptionId: optionB.id, outcomeText: "Buy (synthetic)" },
    }),
    200,
    "decideDecision",
  );

  // ---------------------------------------------------------------- workshops (workshop mode)
  const workshop = await m("POST", `${T}/tom-workshops`, {
    session: lead,
    body: {
      title: "TOM canvas workshop (synthetic)",
      workshopDate: "2026-11-02",
      durationMinutes: 120,
      facilitatorUserId: p.lead.id,
    },
  });
  expectStatus(workshop, 201, "createTomWorkshop");
  const WS = `${T}/tom-workshops/${workshop.body.id}`;
  expectStatus(await m("GET", `${T}/tom-workshops`, { session: lead }), 200, "listTomWorkshops");
  expectStatus(await m("GET", WS, { session: lead }), 200, "getTomWorkshop");
  const participant = await m("POST", `${WS}/participants`, {
    session: lead,
    body: { userId: p.sponsor.id, isBusinessOwner: true },
  });
  expectStatus(participant, 201, "addTomWorkshopParticipant");
  expectStatus(await m("GET", `${WS}/participants`, { session: lead }), 200, "listTomWorkshopParticipants");
  expectStatus(
    await m("POST", `${WS}/participants/${participant.body.id}/remove`, {
      session: lead,
      headers: ifm(1),
      body: { reason: "Synthetic" },
    }),
    200,
    "removeTomWorkshopParticipant",
  );
  const item = await m("POST", `${WS}/items`, {
    session: lead,
    body: { kind: "unresolved", body: "Who owns partner onboarding? (synthetic)", dimensionCode: "partners_sourcing" },
  });
  expectStatus(item, 201, "createTomWorkshopItem");
  expectStatus(await m("GET", `${WS}/items`, { session: lead }), 200, "listTomWorkshopItems");
  // Closing with an open unresolved item is refused (REQ-PB-042).
  expectStatus(
    await m("PATCH", WS, { session: lead, headers: ifm(1), body: { status: "closed" } }),
    422,
    "close with open item",
  );
  expectStatus(
    await m("POST", `${WS}/items/${item.body.id}/convert`, {
      session: lead,
      headers: ifm(1),
      body: { target: "design_decision", title: "Partner onboarding owner (synthetic)", ownerUserId: p.sponsor.id },
    }),
    200,
    "convertTomWorkshopItem",
  );
  expectStatus(
    await m("PATCH", WS, { session: lead, headers: ifm(1), body: { status: "closed" } }),
    200,
    "updateTomWorkshop",
  );

  // ---------------------------------------------------------------- TOM canvas
  expectStatus(await m("GET", `${T}/tom-canvas`, { session: lead }), 200, "getTomCanvas");
  const cell = await m("GET", `${T}/tom-canvas/technology`, { session: lead });
  expectStatus(cell, 200, "getTomCanvasCell");
  expectStatus(
    await m("PATCH", `${T}/tom-canvas/technology`, {
      session: lead,
      headers: ifm(cell.body.cell.version),
      body: { targetDesign: "Cloud-native BSS (synthetic)", ownerUserId: p.lead.id, status: "ready" },
    }),
    200,
    "updateTomCanvasCell",
  );

  // ---------------------------------------------------------------- product gates (business approvals)
  expectStatus(await m("GET", `${T}/gates`, { session: lead }), 200, "listGates");
  expectStatus(await m("GET", `${T}/gates/G1`, { session: lead }), 200, "getGate");
  expectStatus(
    await m("PATCH", `${T}/gates/G2`, {
      session: office,
      headers: ifm(await gateVersion(api, p, "G2")),
      body: { approverRoleCode: "SP" },
    }),
    200,
    "configureGateApprover",
  );
  const submitted = await m("POST", `${T}/gates/G1/submissions`, {
    session: lead,
    headers: ifm(await gateVersion(api, p, "G1")),
    body: { submissionNote: "Synthetic G1 submission" },
  });
  expectStatus(submitted, 201, "submitGate");
  expectStatus(await m("GET", `${T}/gates/G1/submissions`, { session: lead }), 200, "listGateSubmissions");
  expectStatus(await m("GET", `${T}/gates/G1/submissions/1`, { session: lead }), 200, "getGateSubmission");
  // The submitter never decides (403), and only the sponsor (configured approver role) does.
  expectStatus(
    await m("POST", `${T}/gates/G1/decision`, {
      session: lead,
      body: { submissionNo: 1, outcome: "approved", rationale: "Self" },
    }),
    403,
    "decideGate by a non-approver",
  );
  const decided = await m("POST", `${T}/gates/G1/decision`, {
    session: p.sponsor.session,
    body: {
      submissionNo: 1,
      outcome: "approved",
      rationale: "Synthetic demo approval on synthetic data.",
      // P3 (ADR-0021 §8): G1 approval carries the three B0032 leadership agreement confirmations.
      agreements: G1_AGREEMENTS,
    },
  });
  expectStatus(decided, 201, "decideGate");
}
