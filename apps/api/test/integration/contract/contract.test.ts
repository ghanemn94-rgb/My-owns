// Contract tests (ADR-0007 §2):
//  1. route coverage: every Fastify route under /api/v1 (plus /healthz, /readyz) has an OpenAPI operation and every
//     operation has a route, with the same method;
//  2. every operation is exercised at least once in this file through the validating client (status, body, headers
//     checked against docs/api/openapi.yaml), with at least one success response each;
//  3. zod lockstep: every successful body also parses with the @mth/shared/schemas mirror of its component, and the
//     problem bodies parse with the problem mirror;
//  4. platform statuses (T-DG2-ARCH-03, ADR-0007 §5b, platform-statuses.ts): every status the platform layer can
//     return (400/401/403/409/428/429, derived from each route's access) is declared, and a live sweep gets the
//     declared 429 from every operation.
import {
  actionItem,
  actionItemPage,
  auditEvent,
  brandingTokens,
  businessUnit,
  capabilityHeatmapEntry,
  capabilityHeatmapEntryPage,
  charterVersion,
  charterVersionPage,
  charterView,
  decision,
  decisionPage,
  dependency,
  dependencyPage,
  diagnosticFinding,
  diagnosticFindingPage,
  diagnosticItem,
  diagnosticItemPage,
  evidence,
  evidenceLink,
  evidenceLinkPage,
  evidencePage,
  gateDecision,
  gateList,
  gateSubmission,
  gateSubmissionPage,
  gateSubmissionView,
  gateView,
  journey,
  journeyPage,
  journeyPainPoint,
  journeyPainPointPage,
  logoutResult,
  me,
  methodologyCatalogue,
  northStar,
  northStarPage,
  organization,
  outcome,
  outcomePage,
  page,
  permissionEntry,
  problem,
  role,
  roleAccountabilityList,
  roleAssignment,
  strategicGuardrail,
  strategicGuardrailPage,
  teamAssignmentPage,
  tomCanvas,
  tomCanvasCellView,
  tomDimension,
  tomGap,
  tomGapPage,
  tomWorkshop,
  tomWorkshopItem,
  tomWorkshopItemPage,
  tomWorkshopPage,
  tomWorkshopParticipant,
  tomWorkshopParticipantList,
  transformation,
  user,
  workstreamOutput,
  workstreamOutputPage,
} from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeIdp } from "../../support/fake-idp.ts";
import { exercised, findOperation, openapi, operations } from "../../support/contract.ts";
import { P2_PENDING_OPERATIONS } from "../../support/p2-pending.ts";
import { exerciseKpiOperations } from "./kpi-exercises.ts";
import { exerciseP2BackendOperations } from "./p2-exercises.ts";
// P3 seams (p3-work-split §5): one file per task, each exporting its exercise function and its zod mirror map.
import { exerciseP3BeAOperations, P3_MIRRORS_BE_A } from "./p3-exercises-be-a.ts";
import { exerciseP3BeBOperations, P3_MIRRORS_BE_B } from "./p3-exercises-be-b.ts";
import { exerciseP3BeCOperations, P3_MIRRORS_BE_C } from "./p3-exercises-be-c.ts";
import { exerciseP3BeDOperations, P3_MIRRORS_BE_D } from "./p3-exercises-be-d.ts";
import { exerciseP3BeEOperations, P3_MIRRORS_BE_E } from "./p3-exercises-be-e.ts";
import { exerciseP3KbeBOperations, P3_MIRRORS_KBE_B } from "./p3-exercises-kbe-b.ts";
import { exerciseP3KbeCOperations, P3_MIRRORS_KBE_C } from "./p3-exercises-kbe-c.ts";
// P4 seams (p4-work-split §1 S-10): one per P4 implementer task with operations; T-DG4-BE-A created them all.
import { exerciseP4BeAOperations, P4_MIRRORS_BE_A } from "./p4-exercises-be-a.ts";
import { exerciseP4BeBOperations, P4_MIRRORS_BE_B } from "./p4-exercises-be-b.ts";
import { exerciseP4BeCOperations, P4_MIRRORS_BE_C } from "./p4-exercises-be-c.ts";
import { exerciseP4BeDOperations, P4_MIRRORS_BE_D } from "./p4-exercises-be-d.ts";
import { exerciseP4BeEOperations, P4_MIRRORS_BE_E } from "./p4-exercises-be-e.ts";
import { exerciseP4BeFOperations, P4_MIRRORS_BE_F } from "./p4-exercises-be-f.ts";
import { exerciseP4BeGOperations, P4_MIRRORS_BE_G } from "./p4-exercises-be-g.ts";
import { exerciseP4BeHOperations, P4_MIRRORS_BE_H } from "./p4-exercises-be-h.ts";
import { exerciseP4BeIOperations, P4_MIRRORS_BE_I } from "./p4-exercises-be-i.ts";
import { exerciseP4BeJOperations, P4_MIRRORS_BE_J } from "./p4-exercises-be-j.ts";
import { exerciseP4BeKOperations, P4_MIRRORS_BE_K } from "./p4-exercises-be-k.ts";
import { exerciseP4BeLOperations, P4_MIRRORS_BE_L } from "./p4-exercises-be-l.ts";
import { exerciseP4BeMOperations, P4_MIRRORS_BE_M } from "./p4-exercises-be-m.ts";
import { exerciseP4KbeBOperations, P4_MIRRORS_KBE_B } from "./p4-exercises-kbe-b.ts";
import { exerciseP4KbeCOperations, P4_MIRRORS_KBE_C } from "./p4-exercises-kbe-c.ts";
import { exerciseP4KbeDOperations, P4_MIRRORS_KBE_D } from "./p4-exercises-kbe-d.ts";
import { exerciseP4KbeD2Operations, P4_MIRRORS_KBE_D2 } from "./p4-exercises-kbe-d2.ts";
import { exerciseP4KbeEOperations, P4_MIRRORS_KBE_E } from "./p4-exercises-kbe-e.ts";
import { exerciseP4KbeFOperations, P4_MIRRORS_KBE_F } from "./p4-exercises-kbe-f.ts";
import { exerciseP4KbeGOperations, P4_MIRRORS_KBE_G } from "./p4-exercises-kbe-g.ts";
// P5 seams (p5-work-split §2 rule 14): one per P5 backend implementer task; T-DG5-BE-A created them all.
import { exerciseP5BeAOperations, P5_MIRRORS_BE_A } from "./p5-exercises-be-a.ts";
import { exerciseP5BeBOperations, P5_MIRRORS_BE_B } from "./p5-exercises-be-b.ts";
import { exerciseP5BeB2Operations, P5_MIRRORS_BE_B2 } from "./p5-exercises-be-b2.ts";
import { exerciseP5BeB3Operations, P5_MIRRORS_BE_B3 } from "./p5-exercises-be-b3.ts";
import { exerciseP5BeCOperations, P5_MIRRORS_BE_C } from "./p5-exercises-be-c.ts";
import { exerciseP5KbeAOperations, P5_MIRRORS_KBE_A } from "./p5-exercises-kbe-a.ts";
import { exerciseP5BeDOperations, P5_MIRRORS_BE_D } from "./p5-exercises-be-d.ts";
import { exerciseP5BeEOperations, P5_MIRRORS_BE_E } from "./p5-exercises-be-e.ts";
import { exerciseP5BeE2Operations, P5_MIRRORS_BE_E2 } from "./p5-exercises-be-e2.ts"; // T-DG5-BE-E2
import { exerciseP5BeFOperations, P5_MIRRORS_BE_F } from "./p5-exercises-be-f.ts";
import { exerciseP5BeF2Operations, P5_MIRRORS_BE_F2 } from "./p5-exercises-be-f2.ts";
import { exerciseP5BeGOperations, P5_MIRRORS_BE_G } from "./p5-exercises-be-g.ts";
import { exerciseP5BeHOperations, P5_MIRRORS_BE_H } from "./p5-exercises-be-h.ts";
import { exerciseP5BeH2Operations, P5_MIRRORS_BE_H2 } from "./p5-exercises-be-h2.ts";
import { exerciseP5BeIOperations, P5_MIRRORS_BE_I } from "./p5-exercises-be-i.ts";
import { exerciseP5BeI2Operations, P5_MIRRORS_BE_I2 } from "./p5-exercises-be-i2.ts";
import { exerciseP5BeJOperations, P5_MIRRORS_BE_J } from "./p5-exercises-be-j.ts";
import { exerciseP5BeKOperations, P5_MIRRORS_BE_K } from "./p5-exercises-be-k.ts";
import { exerciseP5BeLOperations, P5_MIRRORS_BE_L } from "./p5-exercises-be-l.ts";
import { exerciseP5BeL2Operations, P5_MIRRORS_BE_L2 } from "./p5-exercises-be-l2.ts"; // T-DG5-BE-L2
import { exerciseP5KbeCOperations, P5_MIRRORS_KBE_C } from "./p5-exercises-kbe-c.ts";
import { exerciseP5KbeDOperations, P5_MIRRORS_KBE_D } from "./p5-exercises-kbe-d.ts";
import { exerciseP5BeMOperations, P5_MIRRORS_BE_M } from "./p5-exercises-be-m.ts";
import { exerciseP5BeNOperations, P5_MIRRORS_BE_N } from "./p5-exercises-be-n.ts";
import { exerciseP5BeOOperations, P5_MIRRORS_BE_O } from "./p5-exercises-be-o.ts";
import { exerciseP5KbeEOperations, P5_MIRRORS_KBE_E } from "./p5-exercises-kbe-e.ts";
import { exerciseP5KbeE2Operations, P5_MIRRORS_KBE_E2 } from "./p5-exercises-kbe-e2.ts"; // T-DG5-KBE-E2
import { exerciseP5KbeFOperations, P5_MIRRORS_KBE_F } from "./p5-exercises-kbe-f.ts";
import { exerciseP5BePOperations, P5_MIRRORS_BE_P } from "./p5-exercises-be-p.ts";
import { exerciseP5BeP2Operations, P5_MIRRORS_BE_P2 } from "./p5-exercises-be-p2.ts"; // T-DG5-BE-P2
import { exerciseP5KbeGOperations, P5_MIRRORS_KBE_G } from "./p5-exercises-kbe-g.ts";
import { exerciseP5KbeG2Operations, P5_MIRRORS_KBE_G2 } from "./p5-exercises-kbe-g2.ts"; // T-DG5-KBE-G2
import { exerciseP5BeQOperations, P5_MIRRORS_BE_Q } from "./p5-exercises-be-q.ts";
import { exerciseP5BeQ2Operations, P5_MIRRORS_BE_Q2 } from "./p5-exercises-be-q2.ts"; // T-DG5-BE-Q2
import { exerciseP5BeROperations, P5_MIRRORS_BE_R } from "./p5-exercises-be-r.ts";
import { exerciseP5BeR2Operations, P5_MIRRORS_BE_R2 } from "./p5-exercises-be-r2.ts"; // T-DG5-BE-R2
import { exerciseP5BeSOperations, P5_MIRRORS_BE_S } from "./p5-exercises-be-s.ts";
import { exerciseP5BeT2Operations, P5_MIRRORS_BE_T2 } from "./p5-exercises-be-t2.ts"; // T-DG5-BE-T2
// P6 seams (p6-work-split §2 rule 16; T-DG6-BE-A): one stub per P6 API task, filled by its owner.
import { exerciseP6BeBOperations, P6_MIRRORS_BE_B } from "./p6-exercises-be-b.ts";
import { exerciseP6BeCOperations, P6_MIRRORS_BE_C } from "./p6-exercises-be-c.ts";
import { exerciseP6BeDOperations, P6_MIRRORS_BE_D } from "./p6-exercises-be-d.ts";
import { exerciseP6BeEOperations, P6_MIRRORS_BE_E } from "./p6-exercises-be-e.ts";
import { exerciseP6BeGOperations, P6_MIRRORS_BE_G } from "./p6-exercises-be-g.ts";
import { exerciseP6BeHOperations, P6_MIRRORS_BE_H } from "./p6-exercises-be-h.ts";
import { exerciseP6BeIOperations, P6_MIRRORS_BE_I } from "./p6-exercises-be-i.ts";
import { exerciseP6BeJOperations, P6_MIRRORS_BE_J } from "./p6-exercises-be-j.ts";
import { exerciseP6BeKOperations, P6_MIRRORS_BE_K } from "./p6-exercises-be-k.ts";
import { exerciseP6BeLOperations, P6_MIRRORS_BE_L } from "./p6-exercises-be-l.ts";
import { exerciseP6BeMOperations, P6_MIRRORS_BE_M } from "./p6-exercises-be-m.ts";
import { exerciseP6KbeAOperations, P6_MIRRORS_KBE_A } from "./p6-exercises-kbe-a.ts";
import { exerciseP6BeNOperations, P6_MIRRORS_BE_N } from "./p6-exercises-be-n.ts";
import { exerciseP6BeOOperations, P6_MIRRORS_BE_O } from "./p6-exercises-be-o.ts";
import { exerciseP6BePOperations, P6_MIRRORS_BE_P } from "./p6-exercises-be-p.ts";
import { exerciseP6BeQOperations, P6_MIRRORS_BE_Q } from "./p6-exercises-be-q.ts";
import { exerciseP6BeTOperations, P6_MIRRORS_BE_T } from "./p6-exercises-be-t.ts";
import { exerciseP6BeUOperations, P6_MIRRORS_BE_U } from "./p6-exercises-be-u.ts";
import {
  exerciseInvalidCharacterQuery,
  exerciseMalformedPathParams,
  getOperationsWithPathParams,
  NO_400_OPERATIONS,
} from "./malformed-input.ts";
import { exerciseRateLimitSweep, platformStatuses, undeclaredPlatformStatuses } from "./platform-statuses.ts";
import { BODY_METHODS, consumesDrift, declaredRequestMediaTypes, exerciseUndeclaredMediaTypes } from "./media-types.ts";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { OidcService } from "../../../src/modules/identity/index.ts";
import { testConfig } from "../../support/harness.ts";

const ZOD_MIRRORS: Record<string, z.ZodType> = {
  getMe: me,
  updateMyPreferences: user,
  listOrganizations: page(organization),
  createOrganization: organization,
  getOrganization: organization,
  updateOrganization: organization,
  listBusinessUnits: page(businessUnit),
  createBusinessUnit: businessUnit,
  getBusinessUnit: businessUnit,
  updateBusinessUnit: businessUnit,
  listUsers: page(user),
  createUser: user,
  getUser: user,
  updateUser: user,
  listRoles: z.strictObject({ items: z.array(role) }),
  listPermissions: z.strictObject({ items: z.array(permissionEntry) }),
  listRoleAssignments: page(roleAssignment),
  createRoleAssignment: roleAssignment,
  getRoleAssignment: roleAssignment,
  revokeRoleAssignment: roleAssignment,
  listTransformations: page(transformation),
  createTransformation: transformation,
  getTransformation: transformation,
  updateTransformation: transformation,
  archiveTransformation: transformation,
  listTransformationAudit: page(auditEvent),
  getBrandingTokens: brandingTokens,
  logout: logoutResult,
  // P2 backend operations (p2-exercises.ts). downloadEvidenceContent returns bytes (no JSON mirror).
  getTransformationMethodology: methodologyCatalogue,
  updateTomDimensionLabels: tomDimension,
  listRoleAccountabilities: roleAccountabilityList,
  listTransformationTeam: teamAssignmentPage,
  assignTransformationTeamRole: roleAssignment,
  getNorthStar: northStar,
  setNorthStar: northStar,
  listNorthStarHistory: northStarPage,
  getCharter: charterView,
  createCharter: charterView,
  updateCharter: charterView,
  listCharterVersions: charterVersionPage,
  getCharterVersion: charterVersion,
  listStrategicGuardrails: strategicGuardrailPage,
  createStrategicGuardrail: strategicGuardrail,
  getStrategicGuardrail: strategicGuardrail,
  updateStrategicGuardrail: strategicGuardrail,
  archiveStrategicGuardrail: strategicGuardrail,
  listOutcomes: outcomePage,
  createOutcome: outcome,
  getOutcome: outcome,
  updateOutcome: outcome,
  archiveOutcome: outcome,
  listDiagnosticItems: diagnosticItemPage,
  createDiagnosticItem: diagnosticItem,
  getDiagnosticItem: diagnosticItem,
  updateDiagnosticItem: diagnosticItem,
  archiveDiagnosticItem: diagnosticItem,
  listDiagnosticFindings: diagnosticFindingPage,
  createDiagnosticFinding: diagnosticFinding,
  getDiagnosticFinding: diagnosticFinding,
  updateDiagnosticFinding: diagnosticFinding,
  archiveDiagnosticFinding: diagnosticFinding,
  listWorkstreamOutputs: workstreamOutputPage,
  createWorkstreamOutput: workstreamOutput,
  getWorkstreamOutput: workstreamOutput,
  updateWorkstreamOutput: workstreamOutput,
  archiveWorkstreamOutput: workstreamOutput,
  listTomGaps: tomGapPage,
  createTomGap: tomGap,
  getTomGap: tomGap,
  updateTomGap: tomGap,
  archiveTomGap: tomGap,
  listCapabilityHeatmapEntries: capabilityHeatmapEntryPage,
  createCapabilityHeatmapEntry: capabilityHeatmapEntry,
  getCapabilityHeatmapEntry: capabilityHeatmapEntry,
  updateCapabilityHeatmapEntry: capabilityHeatmapEntry,
  archiveCapabilityHeatmapEntry: capabilityHeatmapEntry,
  listJourneies: journeyPage,
  createJourney: journey,
  getJourney: journey,
  updateJourney: journey,
  archiveJourney: journey,
  listJourneyPainPoints: journeyPainPointPage,
  createJourneyPainPoint: journeyPainPoint,
  updateJourneyPainPoint: journeyPainPoint,
  archiveJourneyPainPoint: journeyPainPoint,
  listDependencies: dependencyPage,
  createDependency: dependency,
  getDependency: dependency,
  updateDependency: dependency,
  archiveDependency: dependency,
  listActionItems: actionItemPage,
  createActionItem: actionItem,
  getActionItem: actionItem,
  updateActionItem: actionItem,
  listTomWorkshops: tomWorkshopPage,
  createTomWorkshop: tomWorkshop,
  getTomWorkshop: tomWorkshop,
  updateTomWorkshop: tomWorkshop,
  listTomWorkshopParticipants: tomWorkshopParticipantList,
  addTomWorkshopParticipant: tomWorkshopParticipant,
  removeTomWorkshopParticipant: tomWorkshopParticipant,
  listTomWorkshopItems: tomWorkshopItemPage,
  createTomWorkshopItem: tomWorkshopItem,
  convertTomWorkshopItem: tomWorkshopItem,
  listEvidence: evidencePage,
  createEvidence: evidence,
  getEvidence: evidence,
  updateEvidence: evidence,
  archiveEvidence: evidence,
  uploadEvidenceContent: evidence,
  reviewEvidence: evidence,
  listEvidenceLinks: evidenceLinkPage,
  createEvidenceLink: evidenceLink,
  removeEvidenceLink: evidenceLink,
  listDecisions: decisionPage,
  createDecision: decision,
  getDecision: decision,
  updateDecision: decision,
  addDecisionOption: decision,
  updateDecisionOption: decision,
  decideDecision: decision,
  getTomCanvas: tomCanvas,
  getTomCanvasCell: tomCanvasCellView,
  updateTomCanvasCell: tomCanvasCellView,
  listGates: gateList,
  getGate: gateView,
  configureGateApprover: gateView,
  listGateSubmissions: gateSubmissionPage,
  submitGate: gateSubmission,
  getGateSubmission: gateSubmissionView,
  decideGate: gateDecision,
  // P3 operations: each task's mirrors come from its own seam file (p3-work-split §5).
  ...P3_MIRRORS_BE_A,
  ...P3_MIRRORS_BE_B,
  ...P3_MIRRORS_BE_C,
  ...P3_MIRRORS_BE_D,
  ...P3_MIRRORS_BE_E,
  ...P3_MIRRORS_KBE_B,
  ...P3_MIRRORS_KBE_C,
  // P4 operations: each task's mirrors come from its own seam file (p4-work-split §1 S-10).
  ...P4_MIRRORS_BE_A,
  ...P4_MIRRORS_BE_B,
  ...P4_MIRRORS_BE_C,
  ...P4_MIRRORS_BE_D,
  ...P4_MIRRORS_BE_E,
  ...P4_MIRRORS_BE_F,
  ...P4_MIRRORS_BE_G,
  ...P4_MIRRORS_BE_H,
  ...P4_MIRRORS_BE_I,
  ...P4_MIRRORS_BE_J,
  ...P4_MIRRORS_BE_K,
  ...P4_MIRRORS_BE_L,
  ...P4_MIRRORS_BE_M,
  ...P4_MIRRORS_KBE_B,
  ...P4_MIRRORS_KBE_C,
  ...P4_MIRRORS_KBE_D,
  ...P4_MIRRORS_KBE_D2,
  ...P4_MIRRORS_KBE_E,
  ...P4_MIRRORS_KBE_F,
  ...P4_MIRRORS_KBE_G,
  // P5 operations: each task's mirrors come from its own seam file (p5-work-split §2 rule 14).
  ...P5_MIRRORS_BE_A,
  ...P5_MIRRORS_BE_B,
  ...P5_MIRRORS_BE_B2,
  ...P5_MIRRORS_BE_B3,
  ...P5_MIRRORS_BE_C,
  ...P5_MIRRORS_KBE_A,
  ...P5_MIRRORS_BE_D,
  ...P5_MIRRORS_BE_E,
  ...P5_MIRRORS_BE_E2, // T-DG5-BE-E2
  ...P5_MIRRORS_BE_F,
  ...P5_MIRRORS_BE_F2,
  ...P5_MIRRORS_BE_G,
  ...P5_MIRRORS_BE_H,
  ...P5_MIRRORS_BE_H2,
  ...P5_MIRRORS_BE_I,
  ...P5_MIRRORS_BE_I2,
  ...P5_MIRRORS_BE_J,
  ...P5_MIRRORS_BE_K,
  ...P5_MIRRORS_BE_L,
  ...P5_MIRRORS_BE_L2, // T-DG5-BE-L2
  ...P5_MIRRORS_KBE_C,
  ...P5_MIRRORS_KBE_D,
  ...P5_MIRRORS_BE_M,
  ...P5_MIRRORS_BE_N,
  ...P5_MIRRORS_BE_O,
  ...P5_MIRRORS_KBE_E,
  ...P5_MIRRORS_KBE_E2,
  ...P5_MIRRORS_KBE_F,
  ...P5_MIRRORS_BE_P,
  ...P5_MIRRORS_BE_P2, // T-DG5-BE-P2
  ...P5_MIRRORS_KBE_G,
  ...P5_MIRRORS_KBE_G2, // T-DG5-KBE-G2
  ...P5_MIRRORS_BE_Q,
  ...P5_MIRRORS_BE_Q2, // T-DG5-BE-Q2
  ...P5_MIRRORS_BE_R,
  ...P5_MIRRORS_BE_R2, // T-DG5-BE-R2
  ...P5_MIRRORS_BE_S,
  ...P5_MIRRORS_BE_T2, // T-DG5-BE-T2
  // P6 operations: each task's mirrors come from its own seam file (p6-work-split §2 rule 16).
  ...P6_MIRRORS_BE_B,
  ...P6_MIRRORS_BE_C,
  ...P6_MIRRORS_BE_D,
  ...P6_MIRRORS_BE_E,
  ...P6_MIRRORS_BE_G,
  ...P6_MIRRORS_BE_H,
  ...P6_MIRRORS_BE_I,
  ...P6_MIRRORS_BE_J,
  ...P6_MIRRORS_BE_K,
  ...P6_MIRRORS_BE_L,
  ...P6_MIRRORS_BE_M,
  ...P6_MIRRORS_KBE_A,
  ...P6_MIRRORS_BE_N,
  ...P6_MIRRORS_BE_O,
  ...P6_MIRRORS_BE_P,
  ...P6_MIRRORS_BE_Q,
  ...P6_MIRRORS_BE_T,
  ...P6_MIRRORS_BE_U,
};

let api: TestApi;
let w: World;
let idp: FakeIdp;
const zodChecked = new Set<string>();

async function mirrored<T = { id: string; user: { version: number } }>(
  method: string,
  url: string,
  opts: Parameters<typeof call>[3] = {},
) {
  const res = await call<T>(api.app, method, url, opts);
  // The most specific operation (T-DG5-KBE-F): `/transformations/{t}/benefits/financial-metrics` also matches
  // getBenefit's `/transformations/{t}/benefits/{benefitId}`; findOperation prefers more literal segments, as Fastify
  // prefers a static segment, and as the validating client already does.
  const op = findOperation(method, url)!;
  if (res.status >= 400) {
    expect(problem.safeParse(res.body).success, `problem mirror for ${op.operationId} ${res.status}`).toBe(true);
  } else if (ZOD_MIRRORS[op.operationId] && res.status !== 204) {
    const parsed = ZOD_MIRRORS[op.operationId]!.safeParse(res.body);
    expect(
      parsed.success,
      `zod mirror for ${op.operationId}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`,
    ).toBe(true);
    zodChecked.add(op.operationId);
  }
  return res;
}

beforeAll(async () => {
  idp = await new FakeIdp().start();
  const oidc = new OidcService(
    testConfig({ OIDC_ISSUER_URL: idp.issuer, OIDC_CLIENT_ID: idp.clientId, OIDC_CLIENT_SECRET: idp.clientSecret }),
  );
  api = await startApi({ oidc });
  w = await seedWorld(api.db);
});
afterAll(async () => {
  await api.close();
  await idp.stop();
});

describe("route coverage", () => {
  const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");
  it("maps every governed Fastify route to an OpenAPI operation with the same method, and back", () => {
    const governed = api.routes
      .filter(
        (r) =>
          (r.url.startsWith("/api/") || r.url === "/healthz" || r.url === "/readyz") &&
          r.method !== "HEAD" &&
          r.method !== "OPTIONS",
      )
      .map((r) => `${r.method} ${toOpenApi(r.url)}`)
      .sort();
    const contract = operations
      .filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId))
      .map((o) => `${o.method} ${o.path}`)
      .sort();
    // dev-login is registered only in AUTH_MODE=dev and OIDC routes only with OIDC configured: this app has both.
    expect(governed).toEqual(contract);
    // Pending P2 operations (p2-pending.ts) are declared but not routed yet; a routed one must leave the list.
    const pending = operations.filter((o) => P2_PENDING_OPERATIONS.has(o.operationId));
    expect(pending.map((o) => o.operationId).sort()).toEqual([...P2_PENDING_OPERATIONS].sort());
    expect(pending.filter((o) => governed.includes(`${o.method} ${o.path}`)).map((o) => o.operationId)).toEqual([]);
  });

  it("declares access on every governed route (public or a permission)", () => {
    for (const r of api.routes.filter((r) => r.url.startsWith("/api/"))) {
      expect(r.access, `${r.method} ${r.url}`).toBeTruthy();
    }
  });
});

describe("every operation, validated against the contract and the zod mirrors", () => {
  let admin: Session;
  let office: Session;

  it("health", async () => {
    await mirrored("GET", "/healthz");
    await mirrored("GET", "/readyz");
  });

  it("auth + me", async () => {
    await mirrored("POST", "/api/v1/auth/dev-login", { body: { username: "nobody.here" } });
    admin = await signIn(api.app, w.admin.subject);
    office = await signIn(api.app, w.office.subject);
    const meRes = await mirrored("GET", "/api/v1/me", { session: office });
    await mirrored("PUT", "/api/v1/me/preferences", {
      session: office,
      headers: { "if-match": `"${meRes.body.user.version}"` },
      body: { preferredLocale: "en" },
    });
    await mirrored("GET", "/api/v1/me");
    const login = await mirrored("GET", "/api/v1/auth/login?returnTo=%2F");
    // An existing (issuer, subject) binding, so the sign-in does not depend on how many organizations the shared run
    // database holds (just-in-time provisioning needs exactly one).
    const sub = `contract-${uniq("s")}`;
    await api.db
      .insertInto("user_identity")
      .values({ id: crypto.randomUUID(), user_id: w.office.id, issuer: idp.issuer, subject: sub })
      .execute();
    const { code, state } = idp.issueCode(String(login.headers["location"]), { sub });
    // The browser that started the login presents its binding cookie (F-DG1-103), so this is a real sign-in.
    const setCookie = [login.headers["set-cookie"] ?? []].flat().map(String);
    const binding = setCookie.find((c) => c.startsWith("mth_login="))!.split(";")[0]!;
    const cb = await mirrored("GET", `/api/v1/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: binding },
    });
    expect([cb.status, cb.headers["location"]]).toEqual([302, "/"]);
    expect(
      [cb.headers["set-cookie"] ?? []]
        .flat()
        .map(String)
        .some((c) => c.startsWith("mth_session=")),
    ).toBe(true);
  });

  it("organizations and business units", async () => {
    await mirrored("GET", "/api/v1/organizations", { session: office });
    const org = await mirrored("POST", "/api/v1/organizations", {
      session: admin,
      body: { code: uniq("C"), nameEn: "Contract org", nameAr: "مؤسسة" },
    });
    await mirrored("GET", `/api/v1/organizations/${org.body.id}`, { session: admin });
    await mirrored("PATCH", `/api/v1/organizations/${org.body.id}`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { nameEn: "Contract org 2" },
    });
    await mirrored("PATCH", `/api/v1/organizations/${org.body.id}`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { nameEn: "stale" },
    });
    await mirrored("GET", `/api/v1/organizations/${w.orgA.id}/business-units`, { session: office });
    const bu = await mirrored("POST", `/api/v1/organizations/${w.orgA.id}/business-units`, {
      session: admin,
      body: { code: uniq("C"), nameEn: "Contract BU", nameAr: "وحدة" },
    });
    await mirrored("GET", `/api/v1/business-units/${bu.body.id}`, { session: admin });
    await mirrored("PATCH", `/api/v1/business-units/${bu.body.id}`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { status: "inactive" },
    });
    await mirrored("PATCH", `/api/v1/business-units/${bu.body.id}`, { session: admin, body: { status: "active" } });
  });

  it("users, roles, permissions and assignments", async () => {
    await mirrored("GET", `/api/v1/users?organizationId=${w.orgA.id}`, { session: admin });
    const u = await mirrored("POST", "/api/v1/users", {
      session: admin,
      body: { organizationId: w.orgA.id, displayName: "Contract user" },
    });
    await mirrored("GET", `/api/v1/users/${u.body.id}`, { session: admin });
    await mirrored("PATCH", `/api/v1/users/${u.body.id}`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { preferredLocale: "en" },
    });
    await mirrored("GET", "/api/v1/roles", { session: admin });
    await mirrored("GET", "/api/v1/permissions", { session: admin });
    await mirrored("GET", `/api/v1/role-assignments?organizationId=${w.orgA.id}`, { session: admin });
    const a = await mirrored("POST", "/api/v1/role-assignments", {
      session: admin,
      body: {
        userId: u.body.id,
        roleCode: "WL",
        scope: { type: "business_unit", id: w.a1 },
        reason: "Contract test grant",
        effectiveFrom: new Date().toISOString(),
      },
    });
    await mirrored("GET", `/api/v1/role-assignments/${a.body.id}`, { session: admin });
    await mirrored("POST", `/api/v1/role-assignments/${a.body.id}/revoke`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { reason: "Contract test revoke" },
    });
    await mirrored("POST", "/api/v1/role-assignments", {
      session: admin,
      body: { userId: u.body.id, roleCode: "WL", scope: { type: "forum", id: w.a1 }, reason: "Reserved" },
    });
  });

  it("transformations and audit", async () => {
    const t = await mirrored("POST", "/api/v1/transformations", {
      session: office,
      headers: { "idempotency-key": uniq("contract-key-") },
      body: { businessUnitId: w.a1, name: "Contract", mode: "modular", entryPhase: "define" },
    });
    await mirrored("GET", "/api/v1/transformations?sort=code:asc&limit=5", { session: office });
    await mirrored("GET", `/api/v1/transformations/${t.body.id}`, { session: office });
    await mirrored("PATCH", `/api/v1/transformations/${t.body.id}`, {
      session: office,
      headers: { "if-match": '"1"' },
      body: { description: "Synthetic description", sponsorUserId: null },
    });
    await mirrored("PATCH", `/api/v1/transformations/${t.body.id}`, { session: office, body: { name: "no if-match" } });
    // F-DG1-001: closure is the G6 business decision (absent in P1), so a status edit to closed is a declared 422.
    const close = await mirrored("PATCH", `/api/v1/transformations/${t.body.id}`, {
      session: office,
      headers: { "if-match": '"2"' },
      body: { status: "closed" },
    });
    expect([close.status, (close.body as unknown as { code: string }).code]).toEqual([422, "invalid_transition"]);
    await mirrored("POST", `/api/v1/transformations/${t.body.id}/archive`, {
      session: office,
      headers: { "if-match": '"2"' },
      body: { reason: "Contract archive" },
    });
    await mirrored("GET", `/api/v1/transformations/${t.body.id}/audit?limit=2`, { session: office });
    await mirrored("POST", "/api/v1/auth/logout", { session: office });
  });

  it("branding tokens (getBrandingTokens): authenticated-only, provisional provenance, contract + zod valid", async () => {
    const anonymous = await mirrored("GET", "/api/v1/branding/tokens");
    expect(anonymous.status).toBe(401);
    const res = await mirrored<{ provenance: string; tokens: { name: string; value: string; provisional: boolean }[] }>(
      "GET",
      "/api/v1/branding/tokens",
      { session: admin },
    );
    expect(res.status).toBe(200);
    // #0078FF is a provisional brand token, not a verified Mobily colour: the API must never call the set official.
    expect(res.body.provenance).toBe("provisional");
    expect(res.body.tokens.length).toBeGreaterThan(0);
    expect(res.body.tokens.some((t) => t.value.toUpperCase() === "#0078FF" && t.provisional)).toBe(true);
  });

  it("kpi module operations (P2; kpi-exercises.ts, owned by kpi-benefits-engineer)", async () => {
    await exerciseKpiOperations({
      api,
      world: w,
      sessions: { admin, office },
      mirrored: (m, u, o) => mirrored(m, u, o),
    });
  });

  it("P2 backend operations (p2-exercises.ts): every routed operation exercised with a success", async () => {
    await exerciseP2BackendOperations({ api, world: w, mirrored: (m, u, o) => mirrored(m, u, o) });
  });

  // P3 seams (p3-work-split §5): each task's routed operations, exercised through the same validating client.
  const p3 = () => ({
    api,
    world: w,
    mirrored: (m: string, u: string, o?: Parameters<typeof call>[3]) => mirrored(m, u, o),
  });
  it("P3 BE-A operations (p3-exercises-be-a.ts): readiness, outcome hierarchy, gate dispensations", async () => {
    await exerciseP3BeAOperations(p3());
  });
  it("P3 BE-B operations (p3-exercises-be-b.ts)", async () => {
    await exerciseP3BeBOperations(p3());
  });
  it("P3 BE-C operations (p3-exercises-be-c.ts)", async () => {
    await exerciseP3BeCOperations(p3());
  });
  it("P3 BE-D operations (p3-exercises-be-d.ts)", async () => {
    await exerciseP3BeDOperations(p3());
  });
  it("P3 BE-E operations (p3-exercises-be-e.ts)", async () => {
    await exerciseP3BeEOperations(p3());
  });
  it("P3 KBE-B operations (p3-exercises-kbe-b.ts)", async () => {
    await exerciseP3KbeBOperations(p3());
  });
  it("P3 KBE-C operations (p3-exercises-kbe-c.ts)", async () => {
    await exerciseP3KbeCOperations(p3());
  });

  // P4 seams (p4-work-split §1 S-10): the same context shape (P4ExerciseContext = P3ExerciseContext).
  it("P4 BE-A operations (p4-exercises-be-a.ts)", async () => {
    await exerciseP4BeAOperations(p3());
  });
  it("P4 BE-B operations (p4-exercises-be-b.ts)", async () => {
    await exerciseP4BeBOperations(p3());
  });
  it("P4 BE-C operations (p4-exercises-be-c.ts)", async () => {
    await exerciseP4BeCOperations(p3());
  });
  it("P4 BE-D operations (p4-exercises-be-d.ts)", async () => {
    await exerciseP4BeDOperations(p3());
  });
  it("P4 BE-E operations (p4-exercises-be-e.ts)", async () => {
    await exerciseP4BeEOperations(p3());
  });
  it("P4 BE-F operations (p4-exercises-be-f.ts)", async () => {
    await exerciseP4BeFOperations(p3());
  });
  it("P4 BE-G operations (p4-exercises-be-g.ts)", async () => {
    await exerciseP4BeGOperations(p3());
  });
  it("P4 BE-H operations (p4-exercises-be-h.ts)", async () => {
    await exerciseP4BeHOperations(p3());
  });
  it("P4 BE-I operations (p4-exercises-be-i.ts)", async () => {
    await exerciseP4BeIOperations(p3());
  });
  it("P4 BE-J operations (p4-exercises-be-j.ts)", async () => {
    await exerciseP4BeJOperations(p3());
  });
  it("P4 BE-K operations (p4-exercises-be-k.ts)", async () => {
    await exerciseP4BeKOperations(p3());
  });
  it("P4 BE-L operations (p4-exercises-be-l.ts)", async () => {
    await exerciseP4BeLOperations(p3());
  });
  it("P4 BE-M operations (p4-exercises-be-m.ts)", async () => {
    await exerciseP4BeMOperations(p3());
  });
  it("P4 KBE-B operations (p4-exercises-kbe-b.ts)", async () => {
    await exerciseP4KbeBOperations(p3());
  });
  it("P4 KBE-C operations (p4-exercises-kbe-c.ts)", async () => {
    await exerciseP4KbeCOperations(p3());
  });
  it("P4 KBE-D operations (p4-exercises-kbe-d.ts)", async () => {
    await exerciseP4KbeDOperations(p3());
  });
  it("P4 KBE-D2 operations (p4-exercises-kbe-d2.ts)", async () => {
    await exerciseP4KbeD2Operations(p3());
  });
  it("P4 KBE-E operations (p4-exercises-kbe-e.ts)", async () => {
    await exerciseP4KbeEOperations(p3());
  });
  it("P4 KBE-F operations (p4-exercises-kbe-f.ts)", async () => {
    await exerciseP4KbeFOperations(p3());
  });
  it("P4 KBE-G operations (p4-exercises-kbe-g.ts)", async () => {
    await exerciseP4KbeGOperations(p3());
  });
  // P5 seams (p5-work-split §2 rule 14): each task's routed operations, through the same validating client.
  it("P5 BE-A operations (p5-exercises-be-a.ts)", async () => {
    await exerciseP5BeAOperations(p3());
  });
  it("P5 BE-B operations (p5-exercises-be-b.ts)", async () => {
    await exerciseP5BeBOperations(p3());
  });
  it("P5 BE-B2 operations (p5-exercises-be-b2.ts)", async () => {
    await exerciseP5BeB2Operations(p3());
  });
  it("P5 BE-B3 operations (p5-exercises-be-b3.ts)", async () => {
    await exerciseP5BeB3Operations(p3());
  });
  it("P5 BE-C operations (p5-exercises-be-c.ts)", async () => {
    await exerciseP5BeCOperations(p3());
  });
  it("P5 KBE-A operations (p5-exercises-kbe-a.ts)", async () => {
    await exerciseP5KbeAOperations(p3());
  });
  it("P5 BE-D operations (p5-exercises-be-d.ts)", async () => {
    await exerciseP5BeDOperations(p3());
  });
  it("P5 BE-E operations (p5-exercises-be-e.ts)", async () => {
    await exerciseP5BeEOperations(p3());
  });
  it("P5 BE-E2 operations (p5-exercises-be-e2.ts)", async () => {
    await exerciseP5BeE2Operations(p3());
  });
  it("P5 BE-F operations (p5-exercises-be-f.ts)", async () => {
    await exerciseP5BeFOperations(p3());
  });
  it("P5 BE-F2 operations (p5-exercises-be-f2.ts)", async () => {
    await exerciseP5BeF2Operations(p3());
  });
  it("P5 BE-G operations (p5-exercises-be-g.ts)", async () => {
    await exerciseP5BeGOperations(p3());
  });
  it("P5 BE-H operations (p5-exercises-be-h.ts)", async () => {
    await exerciseP5BeHOperations(p3());
  });
  it("P5 BE-H2 operations (p5-exercises-be-h2.ts)", async () => {
    await exerciseP5BeH2Operations(p3());
  });
  it("P5 BE-I operations (p5-exercises-be-i.ts)", async () => {
    await exerciseP5BeIOperations(p3());
  });
  it("P5 BE-I2 operations (p5-exercises-be-i2.ts)", async () => {
    await exerciseP5BeI2Operations(p3());
  });
  it("P5 BE-J operations (p5-exercises-be-j.ts)", async () => {
    await exerciseP5BeJOperations(p3());
  });
  it("P5 BE-K operations (p5-exercises-be-k.ts)", async () => {
    await exerciseP5BeKOperations(p3());
  });
  it("P5 BE-L operations (p5-exercises-be-l.ts)", async () => {
    await exerciseP5BeLOperations(p3());
  });
  it("P5 BE-L2 operations (p5-exercises-be-l2.ts)", async () => {
    await exerciseP5BeL2Operations(p3());
  });
  it("P5 KBE-C operations (p5-exercises-kbe-c.ts)", async () => {
    await exerciseP5KbeCOperations(p3());
  });
  it("P5 KBE-D operations (p5-exercises-kbe-d.ts)", async () => {
    await exerciseP5KbeDOperations(p3());
  });
  it("P5 BE-M operations (p5-exercises-be-m.ts)", async () => {
    await exerciseP5BeMOperations(p3());
  });
  it("P5 BE-N operations (p5-exercises-be-n.ts)", async () => {
    await exerciseP5BeNOperations(p3());
  });
  it("P5 BE-O operations (p5-exercises-be-o.ts)", async () => {
    await exerciseP5BeOOperations(p3());
  });
  it("P5 KBE-E operations (p5-exercises-kbe-e.ts)", async () => {
    await exerciseP5KbeEOperations(p3());
  });
  it("P5 KBE-E2 operations (p5-exercises-kbe-e2.ts)", async () => {
    await exerciseP5KbeE2Operations(p3());
  });
  it("P5 KBE-F operations (p5-exercises-kbe-f.ts)", async () => {
    await exerciseP5KbeFOperations(p3());
  });
  it("P5 BE-P operations (p5-exercises-be-p.ts)", async () => {
    await exerciseP5BePOperations(p3());
  });
  it("P5 BE-P2 operations (p5-exercises-be-p2.ts)", async () => {
    await exerciseP5BeP2Operations(p3());
  });
  it("P5 KBE-G operations (p5-exercises-kbe-g.ts)", async () => {
    await exerciseP5KbeGOperations(p3());
  });
  it("P5 KBE-G2 operations (p5-exercises-kbe-g2.ts)", async () => {
    await exerciseP5KbeG2Operations(p3());
  });
  it("P5 BE-Q operations (p5-exercises-be-q.ts)", async () => {
    await exerciseP5BeQOperations(p3());
  });
  it("P5 BE-Q2 operations (p5-exercises-be-q2.ts)", async () => {
    await exerciseP5BeQ2Operations(p3());
  });
  it("P5 BE-R operations (p5-exercises-be-r.ts)", async () => {
    await exerciseP5BeROperations(p3());
  });
  it("P5 BE-R2 operations (p5-exercises-be-r2.ts)", async () => {
    await exerciseP5BeR2Operations(p3());
  }); // T-DG5-BE-R2
  it("P5 BE-S operations (p5-exercises-be-s.ts)", async () => {
    await exerciseP5BeSOperations(p3());
  });
  it("P5 BE-T2 operations (p5-exercises-be-t2.ts)", async () => {
    await exerciseP5BeT2Operations(p3());
  }); // T-DG5-BE-T2

  // P6 seams (p6-work-split §2 rule 16; T-DG6-BE-A): each task's routed operations, through the same validating client.
  it("P6 BE-B operations (p6-exercises-be-b.ts)", async () => {
    await exerciseP6BeBOperations(p3());
  });
  it("P6 BE-C operations (p6-exercises-be-c.ts)", async () => {
    await exerciseP6BeCOperations(p3());
  });
  it("P6 BE-D operations (p6-exercises-be-d.ts)", async () => {
    await exerciseP6BeDOperations(p3());
  });
  it("P6 BE-E operations (p6-exercises-be-e.ts)", async () => {
    await exerciseP6BeEOperations(p3());
  });
  it("P6 BE-G operations (p6-exercises-be-g.ts)", async () => {
    await exerciseP6BeGOperations(p3());
  });
  it("P6 BE-H operations (p6-exercises-be-h.ts)", async () => {
    await exerciseP6BeHOperations(p3());
  });
  it("P6 BE-I operations (p6-exercises-be-i.ts)", async () => {
    await exerciseP6BeIOperations(p3());
  });
  it("P6 BE-J operations (p6-exercises-be-j.ts)", async () => {
    await exerciseP6BeJOperations(p3());
  });
  it("P6 BE-K operations (p6-exercises-be-k.ts)", async () => {
    await exerciseP6BeKOperations(p3());
  });
  it("P6 BE-L operations (p6-exercises-be-l.ts)", async () => {
    await exerciseP6BeLOperations(p3());
  });
  it("P6 BE-M operations (p6-exercises-be-m.ts)", async () => {
    await exerciseP6BeMOperations(p3());
  });
  it("P6 KBE-A operations (p6-exercises-kbe-a.ts)", async () => {
    await exerciseP6KbeAOperations(p3());
  });
  it("P6 BE-N operations (p6-exercises-be-n.ts)", async () => {
    await exerciseP6BeNOperations(p3());
  });
  it("P6 BE-O operations (p6-exercises-be-o.ts)", async () => {
    await exerciseP6BeOOperations(p3());
  });
  it("P6 BE-P operations (p6-exercises-be-p.ts)", async () => {
    await exerciseP6BePOperations(p3());
  });
  it("P6 BE-Q operations (p6-exercises-be-q.ts)", async () => {
    await exerciseP6BeQOperations(p3());
  });
  it("P6 BE-T operations (p6-exercises-be-t.ts)", async () => {
    await exerciseP6BeTOperations(p3());
  });
  it("P6 BE-U operations (p6-exercises-be-u.ts)", async () => {
    await exerciseP6BeUOperations(p3());
  });

  // T-DG2-ARCH-02 (ADR-0007 §5a): every operation that validates input declares 400.
  it("every GET operation with a path parameter: a malformed id is a declared 400 at /params/<name>; nothing written", async () => {
    // A fresh session: `office` signed out in "transformations and audit".
    const reader = await signIn(api.app, w.office.subject);
    const checked = await exerciseMalformedPathParams({ api, world: w, session: reader });
    expect(checked.sort()).toEqual(
      getOperationsWithPathParams()
        .map((o) => o.operationId)
        .sort(),
    );
    // At least the 33 GET-by-id operations of the T-DG2-BE10 handback (P1 and P2), plus the transformation-part reads.
    expect(checked.length).toBeGreaterThanOrEqual(33);
    for (const id of ["getTomGap", "getUser", "getOrganization", "getKpiDefinition", "getGateSubmission"]) {
      expect(checked).toContain(id);
    }
  });

  it("the contract: every operation but the OIDC callback declares 400 (ADR-0007 §5a)", () => {
    const undeclared = operations
      .filter((o) => !NO_400_OPERATIONS.has(o.operationId) && !("400" in o.responses))
      .map((o) => o.operationId);
    expect(undeclared).toEqual([]);
    expect(
      [...NO_400_OPERATIONS].filter((id) => "400" in operations.find((o) => o.operationId === id)!.responses),
    ).toEqual([]);
  });

  it("every operation but the OIDC callback: U+0000 in the query is a declared 400 invalid_character", async () => {
    const checked = await exerciseInvalidCharacterQuery({ api, world: w, session: admin });
    expect(checked).toHaveLength(operations.length - P2_PENDING_OPERATIONS.size - NO_400_OPERATIONS.size);
  });

  // F-DG2-320 (T-DG2-BE14): every operation accepts only the request media types it declares (media-types.ts).
  it("the contract: every route accepts exactly the request media types its operation declares", () => {
    expect(consumesDrift(operations, api.routes)).toEqual([]);
    const withBody = operations.filter(
      (o) => !P2_PENDING_OPERATIONS.has(o.operationId) && declaredRequestMediaTypes(o) !== null,
    );
    const byType = (t: string) => withBody.filter((o) => declaredRequestMediaTypes(o)!.includes(t)).length;
    // T-DG3-BE-A: + createGateDispensation, decideGateDispensation, revokeGateDispensation (JSON bodies).
    // Wave 2 of P3 (orchestrator reconciliation of the per-task pins): 90 after BE-A, + 14 JSON bodies T-DG3-BE-B,
    // + 14 T-DG3-BE-C (waves 2, deliverables 4, milestones 3, T08 dependencies 3, dependency types 2), + 9 T-DG3-BE-D,
    // + 7 T-DG3-KBE-B.
    // T-DG4-BE-A: + createBusinessCalendar, updateBusinessCalendar, createCalendarHoliday, updateCalendarHoliday,
    // updateJobSchedule (JSON bodies; completeWorkItem and markInboxNotificationRead are bodiless).
    // T-DG4-BE-B: + createGroup, updateGroup, addGroupMember, removeGroupMember, createRoleMapping, endRoleMapping,
    // createDelegation, revokeDelegation, requestApproval, decideApproval, resubmitApproval, withdrawApproval (12 JSON).
    // T-DG4-KBE-D: + createBenefit, updateBenefit, archiveBenefit, advanceBenefitLifecycle, createBenefitEnabler,
    // removeBenefitEnabler, replaceBenefitAllocations, createBenefitGroup, updateBenefitGroup (9 JSON bodies).
    // T-DG4-KBE-B: + createKpiVersion, updateKpiVersion, withdrawKpiVersion, createKpiRagThreshold,
    // createTargetTrajectory, approveTargetTrajectory, withdrawTargetTrajectory, resolveDataQualityFinding (JSON bodies;
    // activateKpiVersion is bodiless).
    // T-DG4-KBE-D2: + createBenefitOverlap, resolveBenefitOverlap, createBenefitScenario, updateBenefitScenario,
    // createBenefitScenarioValue, updateBenefitScenarioValue, createBenefitValuationMethod, decideBenefitValuationMethod
    // (8 JSON bodies).
    // T-DG4-BE-C: + createDecisionRight, updateDecisionRight, createRaciDeliverable, updateRaciDeliverable,
    // submitGovernanceMatrix (5 JSON bodies).
    // T-DG4-KBE-C: + requestKpiVersionApproval, createReportingPeriod, submitKpiActual, addKpiActualValue,
    // acceptKpiActual, rejectKpiActual, createRagOverride, revokeRagOverride (8 JSON bodies; openReportingPeriod,
    // closeReportingPeriod and submitKpiActualDraft are bodiless).
    // T-DG4-BE-D: + createRaidEntry, updateRaidEntry, closeRaidEntry, createRaidEntryAction, updateActionRegisterItem
    // (5 JSON bodies).
    // T-DG4-KBE-E: + decideBenefitBaseline, createBenefitPlanValue, updateBenefitPlanValue, createBenefitMeasurement,
    // updateBenefitMeasurement, decideFinanceValidation, amendFinanceValidation, reverseFinanceValidation (8 JSON bodies;
    // submitBenefitMeasurement is bodiless).
    // T-DG4-BE-D2: + createCorrectiveCase, updateCorrectiveCase, closeCorrectiveCase, createCorrectiveCaseAction,
    // createCorrectiveActionRule, updateCorrectiveActionRule (6 JSON bodies).
    // T-DG4-BE-E: + createBudgetLine, updateBudgetLine, archiveBudgetLine, createInitiativeSchedule,
    // updateInitiativeSchedule (5 JSON bodies).
    // T-DG4-BE-H: + createStakeholderGroup, updateStakeholderGroup, archiveStakeholderGroup, addStakeholderChampion,
    // createAdoptionIntervention, updateAdoptionIntervention, createStakeholderInvolvement,
    // withdrawStakeholderInvolvement, createChampionConstraint, resolveChampionConstraint (10 JSON bodies;
    // removeStakeholderChampion is bodiless).
    // T-DG4-BE-I: + createPerformanceArea, updatePerformanceArea, reopenPerformanceArea, retirePerformanceArea,
    // createPerformanceAreaLink, createBauHandover, updateBauHandover, addBauHandoverEvidence, acceptBauHandover,
    // returnBauHandover (10 JSON bodies; removePerformanceAreaLink and submitBauHandover are bodiless).
    // T-DG4-BE-F: + createForum, updateForum, addForumParticipant, createMeetingSeries, updateMeetingSeries,
    // createMeeting, updateMeeting, cancelMeeting (8 JSON bodies; removeForumParticipant, endMeetingSeries,
    // publishMeetingAgenda, startMeeting and closeMeeting are bodiless).
    // T-DG4-BE-G: + createExecutiveDecision, updateExecutiveDecision, recordExecutiveDecisionOutcome,
    // createEscalationRule, updateEscalationRule, recordBlockerStatus (6 JSON bodies).
    // T-DG4-KBE-F: + createAdoptionMetricLink (1 JSON body; removeAdoptionMetricLink is bodiless).
    // T-DG4-BE-H2: + createAssessmentForm, updateAssessmentForm, createAssessmentInvitations, createAssessmentRecord,
    // reviewAssessmentRecord, withdrawAssessmentRecord, createTrainingRecord, updateTrainingRecord (8 JSON bodies;
    // publishAssessmentForm, retireAssessmentForm and cancelAssessmentInvitation are bodiless).
    // T-DG4-BE-I2: + createControl, updateControl, recordControlCheck, completeSustainmentReview, createImprovementItem,
    // updateImprovementItem, createLesson, updateLesson (8 JSON bodies; publishLesson is bodiless).
    // T-DG4-BE-J: + completeInitiativeDelivery, setInitiativeAdoptionStatus, closeInitiative, closeTransformation,
    // createTransitionDecision, updateTransitionDecision (6 JSON bodies; submitTransitionDecision is bodiless).
    // T-DG4-BE-K: + createScaleTransition, createRiskDisposition (2 JSON bodies).
    // T-DG4-BE-L: + putChangeControlPolicy, createChangeRequest, previewChangeImpact, updateChangeRequest (4 JSON bodies;
    // submitChangeRequest and withdrawChangeRequest are bodiless).
    // T-DG4-BE-K2: + createGateCriterionReview, createGateException, decideGateException, revokeGateException (4 JSON
    // bodies; withdrawGateException is bodiless).
    // T-DG4-KBE-G: + putDashboardRagPolicy (1 JSON body; the five dashboard reads are GETs).
    // T-DG4-BE-M: + createTraceLink, updateTraceLink, removeTraceLink, setOutcomeContributionAllocation (4 JSON bodies).
    // T-DG4-BE-L2: + updatePhaseStep, reviewPhaseStep, linkPhaseStepEvidence (3 JSON bodies; requestPhaseStepReview and
    // removePhaseStepEvidence are bodiless).
    // T-DG4-BE-F2: + createAgendaItem, updateAgendaItem, recordAgendaItemOutcome, recordMeetingAttendance,
    // updateMeetingAttendance, createMeetingMinutes, updateMeetingMinutes, createMeetingOutput, createMeetingAction
    // (9 JSON bodies; publishAgendaItem, withdrawAgendaItem, approveMeetingMinutes and publishMeetingMinutes are bodiless).
    // T-DG4-BE-M2: + createInheritedRecord, withdrawInheritedRecord (2 JSON bodies; getMissingLinks and
    // listInheritedRecords are GETs).
    // T-DG4-BE-M3: + createPortfolio, updatePortfolio, addPortfolioTransformation, removePortfolioTransformation,
    // createWorkstream, updateWorkstream, addWorkstreamInitiative, removeWorkstreamInitiative (8 JSON bodies).
    // T-DG5-BE-A: + createConfigDraft, updateConfigDraft (2 JSON bodies; discardConfigDraft is bodiless and the other
    // five BE-A operations are GETs).
    // T-DG5-BE-B: + putConfigElement, runConfigPreview (2 JSON bodies; removeConfigElement and
    // runConfigCompatibilityCheck are bodiless, the other three are GETs).
    // T-DG5-BE-B2: + runSourceCoverageCheck (1 JSON body; getSourceCoverage and listRevisionProposals are GETs).
    // T-DG5-BE-D: + putFormRecordCustomFields (1 JSON body; the other four BE-D operations are GETs).
    // T-DG5-BE-H: + createAutomationRule, updateAutomationRule, disableAutomationRule, createAutomationRuleVersion,
    // updateAutomationRuleVersion (5 JSON bodies; enableAutomationRule is bodiless, the other five are GETs).
    // T-DG5-BE-B3: + submitConfigReview, decideConfigReview, rollbackConfigVersion, updateConfigReviewPolicy (4 JSON
    // bodies; withdrawConfigReview and publishConfigVersion are bodiless, the other two are GETs).
    // T-DG5-BE-E: + createFormRecordComment, attachFormRecordEvidence, removeFormRecordAttachment (3 JSON bodies; the
    // other three BE-E operations are GETs).
    // T-DG5-BE-H2: + 2 JSON bodies (the rule-version dry run and review; its three other POSTs are bodiless).
    // T-DG5-BE-C: + createMethodologyMigration, previewMethodologyMigration, decideMethodologyMigration (3 JSON bodies;
    // submit, execute and withdraw are bodiless, the other three are GETs).
    // T-DG5-KBE-A: + putScoringDefaultsDraft (1 JSON body). T-DG5-BE-F: + validateProcedureDefinition,
    // putProcedureDefinition (2 JSON bodies; removeProcedureDefinition is bodiless).
    // T-DG5-BE-F2: + launchProcedureInstance, updateProcedureInstanceInputs, completeProcedureStep, skipProcedureStep,
    // assignProcedureStep, linkProcedureStepEvidence, cancelProcedureInstance (7 JSON bodies).
    // T-DG5-BE-I: + dismissAutomationFailure (1 JSON body; retryAutomationFailure is bodiless, the other four are GETs).
    // T-DG5-KBE-C: + generateReportSnapshot, issueReportSnapshot, discardReportSnapshot, reissueReportSnapshot (4 JSON
    // bodies; the other seven KBE-C operations are GETs).
    // T-DG5-KBE-D: + createOwnerUpdate, updateOwnerUpdate, reopenOwnerUpdate (3 JSON bodies; submitOwnerUpdate is
    // bodiless, listOwnerUpdates, getOwnerUpdate and listOwnerUpdateRevisions are GETs).
    // T-DG5-BE-K: + decideApprovalRouteStep, closeGateCondition (2 JSON bodies). T-DG5-BE-L: + putMyNotificationPreferences,
    // putNotificationPolicy (2 JSON bodies). T-DG5-BE-L2: + reviewMeetingCutoffPack (1 JSON body; getMeetingCutoffPack
    // is a GET). T-DG5-BE-M: + createExport (1 JSON body; cancelExport is bodiless, the other three are GETs).
    // T-DG5-BE-Q2: none (its four operations are bodiless GETs).
    // T-DG5-KBE-E: + createKpiRestatement (1 JSON body; submitKpiRestatement and withdrawKpiRestatement are bodiless,
    // the other three are GETs).
    // T-DG5-KBE-F: + previewFormula, putFinancialMetricEnablement, putFinancialMetricAssumptions,
    // putBusinessCaseCashFlows (4 JSON bodies; the other four KBE-F operations are GETs).
    // T-DG5-BE-P: + generateLaunchPlan, updateLaunchPlan, createLaunchTask, updateLaunchTask, putLaunchTaskPredecessors
    // (5 JSON bodies; the other four are GETs). T-DG5-BE-C2: none. Sum (D-156): 370 + 1 + 4 + 5 = 380.
    // T-DG5-KBE-E2: + decideKpiRestatement (1 JSON body; listKpiRestatementReissueOffers is a GET). 380 + 1 = 381.
    // T-DG5-BE-P2: + putDayNinetyResponse (1 JSON body; getDayNinetyTest is a GET, completeDayNinetyTest is bodiless).
    // T-DG5-BE-E2: + bulkUpdateFormRecords, createFormDraft, updateFormDraft, closeFormDraft (4 JSON bodies;
    // exportFormRecords, listFormDrafts and getFormDraft are GETs). 381 + 4 = 385.
    // Sum (D-159): 381 + 1 (BE-P2) + 4 (BE-E2) + 0 (KBE-D2, BE-O) = 386.
    // T-DG5-KBE-G2: + createHealthCheck, updateHealthCheck, putHealthCheckAnswer, putHealthCheckActions (4 JSON bodies;
    // listHealthChecks and getHealthCheck are GETs, submitHealthCheck is bodiless). T-DG5-BE-R: + putBrandingSettings
    // (1 JSON body). T-DG5-BE-E3, T-DG5-KBE-H: none. Sum (D-160): 386 + 4 (KBE-G2) + 1 (BE-R) = 391.
    // T-DG6-BE-B: + putRecordSensitivity, createSensitiveGrant, revokeSensitiveGrant (3 JSON bodies; the other three
    // are GETs). 391 + 3 = 394 (the orchestrator reconciles the parallel W3 deltas at merge). W6 merge (D-201): T-DG6-BE-H
    // + 2 JSON bodies (storage), T-DG6-BE-J + putServiceIdentity (1 JSON body); ARCH-06 and BE-I none. 394 + 3 = 397.
    // T-DG6-BE-L: + createConnector, putConnector, enableConnector, disableConnector, testConnector,
    // putConnectorMappings (6 JSON bodies; listConnectors, getConnector, getConnectorMappings are GETs). 397 + 6 = 403
    // (the orchestrator reconciles the parallel W7 deltas at merge). W7 merge: T-DG6-BE-K + acknowledge and resolve an
    // operational exception (2 JSON bodies). 403 + 2 = 405.
    // T-DG6-BE-L2: + runConnector, retryIntegrationRun (2 JSON bodies; listIntegrationRuns and getIntegrationRun are
    // GETs). 405 + 2 = 407 (the orchestrator reconciles the parallel W9 deltas at merge).
    // T-DG6-BE-M2: + createImport (text/csv and the XLSX media type: the first non-JSON, non-octet-stream request
    // bodies), commitImport, cancelImport (2 JSON bodies; the five other import operations are GETs). 407 + 3 = 410;
    // JSON 406 + 2 = 408 (the orchestrator reconciles the parallel W10 deltas at merge).
    // T-DG6-BE-N: + createWebhookEndpoint, rotateWebhookSecret, disableWebhookEndpoint, receiveWebhook (4 JSON bodies;
    // listWebhookEndpoints and getWebhookEndpoint are GETs). 410 + 4 = 414; JSON 408 + 4 = 412 (the orchestrator
    // reconciles the parallel deltas at merge).
    expect([withBody.length, byType("application/json"), byType("application/octet-stream")]).toEqual([414, 412, 1]);
    expect([byType("text/csv"), byType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]).toEqual([
      1, 1,
    ]);
    expect(declaredRequestMediaTypes(operations.find((o) => o.operationId === "createImport")!)).toEqual([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ]);
    expect(declaredRequestMediaTypes(operations.find((o) => o.operationId === "uploadEvidenceContent")!)).toEqual([
      "application/octet-stream",
    ]);
  });

  it("every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written", async () => {
    const checked = await exerciseUndeclaredMediaTypes({ api, world: w, session: admin }, operations);
    const live = operations.filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId));
    expect(checked.bodyOperations.sort()).toEqual(
      live
        .filter((o) => BODY_METHODS.has(o.method))
        .map((o) => o.operationId)
        .sort(),
    );
    expect(checked.bodyOperations.length + checked.getOperations.length).toBe(live.length);
    expect(checked.bodyOperations).toContain("uploadEvidenceContent");
  });

  // T-DG2-ARCH-03 (ADR-0007 §5b): every status the platform layer can return is declared on the operation.
  it("the contract: every operation declares each platform status derived from its route (ADR-0007 §5b)", () => {
    expect(undeclaredPlatformStatuses(operations, api.routes, openapi)).toEqual([]);
    // The derivation itself, pinned on known operations (a public read, a protected read, a create, an If-Match change).
    const byId = (id: string) => platformStatuses(operations.find((o) => o.operationId === id)!, api.routes, openapi);
    expect(byId("getHealth")).toEqual([400, 429]);
    expect(byId("completeOidcLogin")).toEqual([429]);
    expect(byId("getMe")).toEqual([400, 401, 429]);
    expect(byId("createCharter")).toEqual([400, 401, 403, 429]);
    expect(byId("updateTransformation")).toEqual([400, 401, 403, 409, 428, 429]);
    // Every governed route feeds the derivation with its declared access (public or a permission).
    // T-DG6-ARCH-03: + receiveWebhook, the session-less, CSRF-exempt webhook receiver authenticated by its signature
    // (ADR-0056 §7; p6-plan §3 row 12). It declares its own 401 webhook.unauthenticated.
    const publicIds = operations.filter((o) => !platformStatuses(o, api.routes, openapi).includes(401));
    expect(publicIds.map((o) => o.operationId).sort()).toEqual(
      ["completeOidcLogin", "devLogin", "getHealth", "getReadiness", "receiveWebhook", "startOidcLogin"].sort(),
    );
  });

  it("every operation: the rate limiter's 429 is a declared RateLimited problem (live, limits of 1 per minute)", async () => {
    const oidc = new OidcService(
      testConfig({ OIDC_ISSUER_URL: idp.issuer, OIDC_CLIENT_ID: idp.clientId, OIDC_CLIENT_SECRET: idp.clientSecret }),
    );
    const limited = await startApi({ oidc, env: { RATE_LIMIT_PER_MINUTE: "1", AUTH_RATE_LIMIT_PER_MINUTE: "1" } });
    try {
      const live = operations.filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId));
      const checked = await exerciseRateLimitSweep(limited, live);
      expect(checked).toHaveLength(live.length);
      // 161 P1/P2 operations + all 109 P3 operations: 6 T-DG3-BE-A, 20 T-DG3-BE-B, 25 T-DG3-BE-C, 17 T-DG3-BE-D,
      // 11 T-DG3-KBE-B, 13 T-DG3-KBE-C and 17 T-DG3-BE-E (orchestrator reconciliation). Every contract operation is live.
      // + 15 T-DG4-BE-A (slice I: calendars, working days, job schedules, My Work items, inbox).
      expect(live.length).toBeGreaterThanOrEqual(285);
    } finally {
      await limited.close();
    }
  });

  it("covers every operation with at least one success and every successful body with its zod mirror", () => {
    const live = operations.filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId));
    const missing = live.filter((o) => !exercised.has(o.operationId)).map((o) => o.operationId);
    expect(missing).toEqual([]);
    expect([...P2_PENDING_OPERATIONS].filter((id) => exercised.has(id))).toEqual([]);
    const noSuccess = live
      .filter((o) => ![...exercised.get(o.operationId)!].some((s) => s < 400))
      .map((o) => o.operationId);
    expect(noSuccess).toEqual([]);
    const mirrorsNotChecked = Object.keys(ZOD_MIRRORS).filter((id) => !zodChecked.has(id));
    expect(mirrorsNotChecked).toEqual([]);
    // 33 P1 operations + 128 P2 operations (T-DG2-ARCH-01B, plus activateKpiDefinition: D-061, F-DG2-201) + 109 P3
    // operations (T-DG3-ARCH-01) + 51 P4 operations of slices I and C (T-DG4-ARCH-01; pending in p4-pending-be-a/b/c.ts)
    // + 39 P4 operations of slice A (T-DG4-ARCH-02; pending in p4-pending-kbe-b/c.ts) + 45 P4 operations of slice B
    // (T-DG4-ARCH-03; pending in p4-pending-kbe-d/d2/e.ts) + 31 P4 operations of slice E (T-DG4-ARCH-04; pending in
    // p4-pending-be-d/d2/e.ts) + 49 P4 operations of slice D (T-DG4-ARCH-05; pending in p4-pending-be-f/g/f2.ts)
    // + 85 P4 operations of slices F and G (T-DG4-ARCH-06; pending in p4-pending-be-h/h2/i/i2/j.ts and p4-pending-kbe-f.ts)
    // + 37 P4 operations of slice H (T-DG4-ARCH-07; pending in p4-pending-be-k/k2/l/l2.ts)
    // + 38 P4 operations of slices J and K (T-DG4-ARCH-08; pending in p4-pending-be-m/m2/m3.ts and p4-pending-kbe-g/g2.ts)
    // + 2 repair operations (T-DG4-ARCH-R1; pending in p4-pending-arch-r1.ts)
    // + 2 repair operations (T-DG4-ARCH-R2; pending in p4-pending-arch-r2.ts)
    // + 3 repair operations (T-DG4-ARCH-R3; pending in p4-pending-arch-r3.ts)
    // + 38 P5 operations of slice A (T-DG5-ARCH-01; pending in p5-pending-be-a/b/b2/b3/c.ts and p5-pending-kbe-a.ts)
    // + 34 P5 operations of slices B and C (T-DG5-ARCH-02; pending in p5-pending-be-d/e/e2/f/f2/g.ts)
    // + 39 P5 operations of slices D and E (T-DG5-ARCH-03; pending in p5-pending-be-h/h2/i/i2/j/k/l/l2.ts)
    // + 26 P5 operations of slice F (T-DG5-ARCH-04; pending in p5-pending-kbe-c/kbe-d/be-m/be-o.ts)
    // + 38 P5 operations of slices G and H (T-DG5-ARCH-05; pending in p5-pending-kbe-e/kbe-e2/kbe-f/be-p/be-p2/kbe-g/kbe-g2.ts)
    // + 19 P5 operations of slices I and J (T-DG5-ARCH-06; pending in p5-pending-be-q/q2/r/r2/s/t2.ts)
    // + 13 P6 operations of slices E and F (T-DG6-ARCH-01; pending in p6-pending-be-b/c/d/e.ts).
    // + 17 P6 operations of slices J and C (T-DG6-ARCH-02; pending in p6-pending-be-g/h2/i/i2/j/k.ts).
    // + 34 P6 operations of slices B and A (T-DG6-ARCH-03; pending in p6-pending-be-l/l2/m2/n/n2/o.ts).
    // + 12 P6 operations of slices H and G (T-DG6-ARCH-04; pending in p6-pending-be-p/q/q2.ts).
    // + 9 P6 operations of slice D (T-DG6-ARCH-05; pending in p6-pending-be-t/u.ts).
    // + 1 P6 operation of slice I (T-DG6-ARCH-06; pending in p6-pending-be-w.ts).
    // A new operation needs a contract change first.
    expect(operations).toHaveLength(932);
  });
});
