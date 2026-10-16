// branding job handler (P5 slice I; ADR-0049 §8, §12; REQ-S15-004; p5-work-split §I.3; T-DG5-BE-R).
//
// branding.published: the consumer of the outbox event the API writes with a new branding version's audit events. The
// server keeps no branding cache: screens read GET /branding and /branding/tokens on every request, and the export
// runner reads the current branding at generation time (reports/export-runner.ts brandingAtGeneration), so nothing
// has to be invalidated here. The handler validates the event and acknowledges it exactly once in the processed_message
// ledger (consumer `branding.published`, the event's idempotency key), so a redelivery does nothing; the web shell
// refreshes its theme from the two reads after login and on its own refresh. Branding is configuration, never a
// business approval, and nothing here touches the engineering delivery gates.
import type { Db } from "@mth/db";
import { brandingPublishedV1, outboxEnvelope } from "@mth/shared/schemas";
import { runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const BRANDING_PUBLISHED_QUEUE = "branding.published";
export const BRANDING_PUBLISHED_CONSUMER = "branding.published";

export async function handleBrandingPublished(
  db: Db,
  data: unknown,
): Promise<{ outcome: "acknowledged" | "duplicate"; organizationId: string; versionNo: number }> {
  const envelope = outboxEnvelope.parse(data);
  const payload = brandingPublishedV1.parse(envelope.payload);
  const r = await runOnce(db, BRANDING_PUBLISHED_CONSUMER, envelope.idempotencyKey, async () => payload);
  return {
    outcome: r.outcome === "done" ? "acknowledged" : "duplicate",
    organizationId: payload.organizationId,
    versionNo: payload.versionNo,
  };
}

export const BRANDING_HANDLERS: readonly JobHandler[] = [
  { queue: BRANDING_PUBLISHED_QUEUE, handle: (db, data) => handleBrandingPublished(db, data) },
];
