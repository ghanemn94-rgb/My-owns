// Setup helpers of the P3 end-to-end journeys (p3-journeys.spec.ts; T-DG3-FE-D). Everything here is SYNTHETIC demo
// data sent through the REAL API (CSRF, Origin, If-Match, Idempotency-Key; never a mock), and only for steps that P2
// already covers on its own screens (the G1-G3 records, as the P2 specs do through the same API helpers) or that
// create the synthetic users of the journey. A demo approval recorded here approves nothing real, and product gates
// G1-G6 never imply any engineering gate (DG0-DG7).
import { expect, type Browser, type Page } from "@playwright/test";
import { signIn, type ApiSession, type Lang } from "./ui.ts";

/** The issuer of the development sign-in (packages/db DEV_ISSUER): a user with this identity can use dev-login. */
const DEV_ISSUER = "urn:mth:dev-local";

export interface SyntheticUser {
  readonly username: string;
  readonly id: string;
}

/**
 * Creates a SYNTHETIC development user (dev issuer identity, so the development sign-in accepts it) and grants it ONE
 * role on ONE transformation. seed-dev has no Finance or Sponsor user, and the journeys need a distinct person per
 * role; granting one of the five seed users (e.g. dev.nobody) a role would change what the other specs assert.
 */
export async function syntheticUser(
  admin: ApiSession,
  orgId: string,
  tid: string,
  username: string,
  displayName: string,
  roleCode: string,
  lang: Lang,
): Promise<SyntheticUser> {
  const user = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: orgId,
    displayName,
    preferredLocale: lang,
    identity: { issuer: DEV_ISSUER, subject: username },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: user.id,
    roleCode,
    scope: { type: "transformation", id: tid },
    reason: `Synthetic demo ${roleCode} for the P3 end-to-end journey (approves nothing real)`,
  });
  return { username, id: user.id };
}

export async function asUser(
  browser: Browser,
  lang: Lang,
  username: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

/** The G1 required outputs (the same synthetic records as p3-prioritization-roadmap.spec.ts), not the decision. */
export async function g1Records(base: string, lead: ApiSession, reviewer: ApiSession, sponsorId: string) {
  const baseline = await lead.call<{ id: string }>("POST", `${base}/baselines`, {
    metric: "Synthetic billing error rate",
    unit: "%",
    scope: "operational",
    value: "4.25",
    source: "Synthetic billing extract",
    baselineDate: "2026-09-01",
  });
  const note = await lead.call<{ id: string; version: number }>("POST", `${base}/evidence`, {
    kind: "note",
    title: "Synthetic baseline working paper",
    ownerUserId: lead.userId,
    noteBody: "Synthetic: 4.25% of bills corrected in August.",
  });
  await lead.call("POST", `${base}/evidence-links`, {
    evidenceId: note.id,
    recordType: "baseline",
    recordId: baseline.id,
  });
  await reviewer.call(
    "POST",
    `${base}/evidence/${note.id}/review`,
    { result: "verified", accessibilityStatus: "accessible", note: "Synthetic check" },
    { ifMatch: note.version },
  );
  const items = await lead.call<{ items: { id: string; version: number }[] }>(
    "GET",
    `${base}/diagnostic-items?limit=100`,
  );
  for (const item of items.items)
    await lead.call(
      "PATCH",
      `${base}/diagnostic-items/${item.id}`,
      {
        currentState: "Synthetic current state",
        rootCause: "Synthetic root cause",
        impactText: "Synthetic impact",
        confidence: "M",
        baselineId: baseline.id,
      },
      { ifMatch: item.version },
    );
  const methodology = await lead.call<{ diagnosticWorkstreams: { code: string }[] }>("GET", `${base}/methodology`);
  await lead.call("POST", `${base}/diagnostic-findings`, {
    workstreamCode: methodology.diagnosticWorkstreams[0]!.code,
    kind: "root_cause",
    statement: "Synthetic: no validation at order entry",
    status: "confirmed",
  });
  await lead.call("POST", `${base}/value-pools`, {
    name: "Synthetic billing leakage pool",
    quantificationStatus: "unquantified",
    unquantifiedReason: "Synthetic: not sized yet",
    materiality: "material",
  });
  await lead.call("POST", `${base}/charter`, {
    transformationName: "Synthetic P3 journey charter",
    caseForChange: "Synthetic: billing errors",
    outOfScope: "Synthetic: wholesale billing",
    inScope: "Synthetic: retail consumer billing",
    executiveSponsorUserId: sponsorId,
    transformationLeadUserId: lead.userId,
    baselineDate: "2026-09-01",
  });
}

/** The Define records the journey's initiatives contribute to: a top outcome with one T02 row (an active KPI). */
export async function defineRecords(base: string, lead: ApiSession) {
  const outcome = await lead.call<{ id: string }>("POST", `${base}/outcomes`, {
    statement: "Synthetic retail bills are right the first time",
    ownerUserId: lead.userId,
    isTopOutcome: true,
    topRank: 1,
    specificConfirmed: true,
    strategicallyRelevantConfirmed: true,
    causalChain: "Synthetic: validated orders -> fewer billing errors -> lower cost to serve",
  });
  const kpi = await lead.call<{ id: string; version: number }>("POST", `${base}/kpi-definitions`, {
    name: "Synthetic billing error rate KPI",
    unitKind: "percentage",
    polarity: "lower_is_better",
    ownerUserId: lead.userId,
  });
  await lead.call("POST", `${base}/kpi-definitions/${kpi.id}/activate`, {}, { ifMatch: kpi.version });
  const okpi = await lead.call<{ id: string }>("POST", `${base}/outcome-kpis`, {
    outcomeId: outcome.id,
    kpiDefinitionId: kpi.id,
    targetDate: "2027-12-31",
    targetValue: "1.5",
    ownerUserId: lead.userId,
  });
  return { outcomeId: outcome.id, kpiId: kpi.id, outcomeKpiId: okpi.id };
}

/** The rest of the G2 required outputs: North Star, thesis, guardrail, the T02 trajectory approved by the Sponsor. */
export async function g2Records(base: string, lead: ApiSession, sponsor: ApiSession, outcomeKpiId: string) {
  const ns = await lead.call<{ id: string }>("PUT", `${base}/north-star`, {
    statement: "Every synthetic retail bill is right the first time",
  });
  const charter = await lead.call<{ charter: { version: number } }>("GET", `${base}/charter`);
  await lead.call(
    "PATCH",
    `${base}/charter`,
    {
      northStarId: ns.id,
      thesisChange: "the retail order-to-bill journey",
      thesisOutcomes: "first-time-right bills",
      thesisBenefits: "a lower cost to serve",
      thesisBecause: "billing rework drives most of the cost to serve",
      changeSummary: "Synthetic: thesis for the P3 journey",
    },
    { ifMatch: charter.charter.version },
  );
  await lead.call("POST", `${base}/strategic-guardrails`, {
    title: "Synthetic: no customer price rise",
    category: "cx",
    statement: "Synthetic: the billing change must not raise any retail tariff.",
  });
  const okpi = await sponsor.call<{ version: number }>("GET", `${base}/outcome-kpis/${outcomeKpiId}`);
  await sponsor.call(
    "POST",
    `${base}/outcome-kpis/${outcomeKpiId}/trajectory-approval`,
    { note: "Synthetic demo approval of the trajectory" },
    { ifMatch: okpi.version },
  );
}

/** The G3 required outputs (as p2-journeys.spec.ts): TOM canvas ready, a T03 gap, a capability gap, a future journey. */
export async function g3Records(base: string, lead: ApiSession): Promise<{ tomGapId: string }> {
  const canvas = await lead.call<{ cells: { cell: { dimensionCode: string; version: number } }[] }>(
    "GET",
    `${base}/tom-canvas`,
  );
  for (const { cell } of canvas.cells)
    await lead.call(
      "PATCH",
      `${base}/tom-canvas/${cell.dimensionCode}`,
      { targetDesign: `Synthetic target design: ${cell.dimensionCode}`, ownerUserId: lead.userId, status: "ready" },
      { ifMatch: cell.version },
    );
  const gap = await lead.call<{ id: string }>("POST", `${base}/tom-gaps`, {
    dimensionCode: canvas.cells[0]!.cell.dimensionCode,
    gap: "Synthetic: no order validation",
    ownerUserId: lead.userId,
  });
  await lead.call("POST", `${base}/capability-heatmap`, {
    name: "Synthetic order validation",
    currentLevel: 2,
    targetLevel: 4,
    sourcingNeed: "build",
  });
  await lead.call("POST", `${base}/journeys`, {
    name: "Synthetic future order-to-bill",
    kind: "journey",
    state: "future",
  });
  return { tomGapId: gap.id };
}

/** Lead submits a gate, the Sponsor approves it (API; the P2 specs decide these gates on their screens). */
export async function submitAndApprove(base: string, code: string, lead: ApiSession, sponsor: ApiSession) {
  const view = await lead.call<{
    gate: { version: number };
    criteria: { key: string; completeness: string; missing: unknown[] }[];
  }>("GET", `${base}/gates/${code}`);
  const incomplete = view.criteria.filter((c) => c.completeness !== "complete");
  expect(incomplete, `${code} readiness`).toEqual([]);
  await lead.call(
    "POST",
    `${base}/gates/${code}/submissions`,
    { submissionNote: `Synthetic ${code} submission` },
    { ifMatch: view.gate.version },
  );
  const fresh = await sponsor.call<{ gate: { version: number; latestSubmissionNo: number } }>(
    "GET",
    `${base}/gates/${code}`,
  );
  await sponsor.call(
    "POST",
    `${base}/gates/${code}/decision`,
    {
      submissionNo: fresh.gate.latestSubmissionNo,
      outcome: "approved",
      rationale: `Synthetic demo approval of ${code} for the P3 journey (approves nothing real).`,
    },
    { ifMatch: fresh.gate.version },
  );
}
