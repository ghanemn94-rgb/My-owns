// branding queue (P5 slice I; ADR-0049 §8, §12; p5-work-split §I.3; T-DG5-BE-R), created with the standard bounded
// retry policy and the ops.failed dead-letter queue (queues/index.ts):
//   branding.published  the consumer of the internal outbox event `branding.published` (a new branding version is
//                       current). Without a queue the relay would record every save as a publish failure.
// Branding is configuration; no queue here decides an approval.
import type { QueueSpec } from "./spec.ts";

export const BRANDING_QUEUES: readonly QueueSpec[] = [{ name: "branding.published" }];
export const BRANDING_EVENT_QUEUES: Readonly<Record<string, string>> = { "branding.published": "branding.published" };
