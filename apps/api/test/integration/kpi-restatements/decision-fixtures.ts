// Fixtures of the KPI restatement decision tests and contract exercises (T-DG5-KBE-E2; ADR-0047 §3; p5-work-split
// §G.2). All data is SYNTHETIC. A decision here is made by a synthetic user holding kpi_restatement.approve through the
// API: a demo business approval that approves nothing real. The worker's own kpi.recalculate consumer applies an
// approved restatement (runRestatementEvents), as the relay would deliver its outbox event. Nothing here touches the
// engineering gates DG0-DG7.
import { expect } from "vitest";
import { recalculate, RESTATEMENT_APPROVED_EVENT } from "../../../../worker/src/handlers/kpi.ts";
import { call, type Session, type TestApi } from "../../support/harness.ts";
import { ifMatch, type KpiWorld } from "../kpi/fixtures.ts";
import type { Body } from "./fixtures.ts";

/** POST decideKpiRestatement. */
export function decide(api: TestApi, k: KpiWorld, id: string, body: object, version: number | null, session: Session) {
  return call<Body>(api.app, "POST", `${k.base}/kpi-restatements/${id}/decision`, {
    session,
    body,
    ...(version === null ? {} : { headers: ifMatch(version) }),
  });
}

/** GET listKpiRestatementReissueOffers. */
export function reissueOffers(api: TestApi, k: KpiWorld, id: string, session: Session) {
  return call<Body>(api.app, "GET", `${k.base}/kpi-restatements/${id}/reissue-offers`, { session });
}

/**
 * Runs the worker's kpi.recalculate consumer for every `kpi_restatement.approved` outbox event of the restatement, as
 * the relay would deliver it (the outbox row's envelope), `times` times each (a redelivery replays the same envelope).
 */
export async function runRestatementEvents(api: TestApi, restatementId: string, times = 1) {
  const rows = await api.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("aggregate_id", "=", restatementId)
    .where("event_type", "=", RESTATEMENT_APPROVED_EVENT)
    .orderBy("seq")
    .execute();
  const results = [];
  for (const r of rows)
    for (let i = 0; i < times; i += 1)
      results.push(
        await recalculate(
          api.db,
          {
            outboxEventId: r.id,
            eventType: r.event_type,
            schemaVersion: r.schema_version,
            idempotencyKey: r.idempotency_key,
            organizationId: r.organization_id,
            payload: r.payload,
          },
          `test-${r.id}-${i}`,
        ),
      );
  return results;
}

/** A KPI register report generated and issued by the Transformation Lead (records the KPI's active kpi_version). */
export async function issuedKpiRegister(api: TestApi, k: KpiWorld): Promise<Body> {
  const gen = await call<Body>(api.app, "POST", `${k.base}/reports/registers/generate`, {
    session: k.s.tl,
    body: { parameters: { register: "kpis" } },
  });
  expect(gen.status, JSON.stringify(gen.body)).toBe(201);
  const issued = await call<Body>(api.app, "POST", `${k.base}/report-snapshots/${gen.body.id}/issue`, {
    session: k.s.tl,
    headers: ifMatch(gen.body.version),
    body: { note: "Synthetic issue" },
  });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  return issued.body;
}
