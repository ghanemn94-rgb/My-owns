// qa-verifier acceptance support for A11 "Adoption and sustainment" and A03 "Modular entry" (DG4, T-DG4-QA-C). Setup
// only: no assertion about an acceptance criterion lives here.
//
// The A11/A03 suites build their synthetic worlds with the backend's own integration fixtures (users and grants, KPI
// and benefit worlds, the closure world with its mapped Sponsor, launched initiatives written with their audit event)
// and drive the behaviour under test through the REAL API (Fastify inject; every response validated against
// docs/api/openapi.yaml by the harness) and the worker's EXPORTED job functions (the functions the production worker
// runs for a queue message: the relay's envelope of a real outbox row is handed to them, as the relay would).
// All data is SYNTHETIC. Every gate, handover, transition or Finance decision made in a fixture is a synthetic
// in-product business action on test data; it approves nothing real and never touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import type { TestApi } from "./api.ts";

export { extraUser, financialBody, seedBenefitWorld } from "../../../apps/api/test/integration/benefits/fixtures.ts";
export {
  createArea,
  createNoteEvidence,
  fullContent,
  seedSustainmentWorld,
  type SustainmentWorld,
} from "../../../apps/api/test/integration/contract/p4-exercises-be-i.ts";
export {
  decideDecision,
  draftDecision,
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  validatedBenefit,
  wireApprovals,
  type ClosureWorld,
} from "../../../apps/api/test/integration/contract/p4-exercises-be-j.ts";
export {
  addBaseline,
  addEvidence,
  addInheritedApproval,
  addOutcomeKpi,
  seedModularWorld,
  type ModularWorld,
} from "../../../apps/api/test/integration/contract/p4-exercises-be-m.ts";
export { handleIndicatorEvaluated } from "../../../apps/worker/src/handlers/adoption.ts";
export {
  handleBenefitVariance,
  handleControlCheckFailed,
  handleKpiDeviation,
} from "../../../apps/worker/src/handlers/raid.ts";
export {
  runControlCheckScan,
  runMonitoringScan,
  runReviewScan,
} from "../../../apps/worker/src/handlers/sustainment.ts";

/**
 * The relay's message for the outbox rows of one aggregate and event type, oldest first (what the queue delivers to a
 * consumer). Throws when there is none, so a missing producer event fails the test instead of passing vacuously.
 */
export async function envelopesOf(api: TestApi, aggregateId: string, eventType: string) {
  const rows = await api.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("aggregate_id", "=", aggregateId)
    .where("event_type", "=", eventType)
    .orderBy("seq")
    .execute();
  expect(rows.length, `no ${eventType} outbox event for ${aggregateId}`).toBeGreaterThan(0);
  return rows.map((r) => ({
    outboxEventId: r.id,
    eventType: r.event_type,
    schemaVersion: r.schema_version,
    idempotencyKey: r.idempotency_key,
    organizationId: r.organization_id,
    payload: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
  }));
}

/** The organization's business date today in its default timezone (the date every server-side check reads). */
export async function businessToday(api: TestApi, organizationId: string): Promise<string> {
  const o = await api.db
    .selectFrom("organization")
    .select("default_timezone")
    .where("id", "=", organizationId)
    .executeTakeFirstOrThrow();
  return new Intl.DateTimeFormat("en-CA", { timeZone: o.default_timezone }).format(new Date());
}
