// T-DG5-BE-C4 (D-164 d): the builder catalogue's example payloads (samples.ts). Every sample parses with its event's
// v1 outbox payload schema, every event with a v1 schema has one (except those no trigger names), and a sample's
// transformationId is the documented placeholder. Synthetic data only.
import { OUTBOX_EVENT_SCHEMAS, outboxPayloadSchema } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { SAMPLE_EVENT_CODES, SAMPLE_TRANSFORMATION_ID, samplePayloadOf } from "./samples.ts";

/** Outbox events that are internal plumbing, never an automation trigger (0074/0075 list no trigger for them). */
const NOT_TRIGGERS = new Set([
  "job_schedule.updated",
  "benefit.value_validated",
  "benefit.value_rejected",
  "automation_failure.retry_requested",
  "job.run_requested",
  "export_job.requested",
  "demo.reset_requested",
  "kpi_restatement.approved",
  "branding.published",
  // T-DG6-BE-L2: the recovery of a connector (consumed by integrations.connector_exception only; no catalogue trigger).
  "connector.run_recovered",
]);

describe("automation samples (D-164 d)", () => {
  it("every sample parses with its event's v1 payload schema", () => {
    expect(SAMPLE_EVENT_CODES.length).toBeGreaterThan(0);
    for (const code of SAMPLE_EVENT_CODES) {
      const schema = outboxPayloadSchema(code, 1);
      expect(schema, code).not.toBeNull();
      const sample = samplePayloadOf(code, "event");
      expect(sample, code).toBeDefined();
      const parsed = schema!.safeParse(sample);
      expect(parsed.success, `${code}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it("every outbox event with a v1 schema that can be a trigger has a sample", () => {
    const missing = Object.keys(OUTBOX_EVENT_SCHEMAS).filter(
      (code) => !NOT_TRIGGERS.has(code) && !SAMPLE_EVENT_CODES.includes(code),
    );
    expect(missing).toEqual([]);
  });

  it("transformationId is the fixed placeholder; schedules, requests and unknown events have no sample", () => {
    expect(SAMPLE_TRANSFORMATION_ID).toBe("00000000-0000-7000-8000-000000000000");
    for (const code of SAMPLE_EVENT_CODES) {
      const sample = samplePayloadOf(code, "event")!;
      if ("transformationId" in sample) expect(sample["transformationId"], code).toBe(SAMPLE_TRANSFORMATION_ID);
    }
    expect(samplePayloadOf("gate.submitted", "schedule")).toBeUndefined();
    expect(samplePayloadOf("automation.tick_daily", "schedule")).toBeUndefined();
    // T-DG5-BE-T5 (D-167): dependency.slipped v1 is registered and has a complete sample now.
    expect(samplePayloadOf("dependency.slipped", "event")).toEqual({
      slipId: "01920000-0000-7000-8000-00000000003c",
      dependencyId: "01920000-0000-7000-8000-00000000003d",
      transformationId: SAMPLE_TRANSFORMATION_ID,
      slipDays: 5,
    });
  });

  it("returns a fresh copy (a caller's change never leaks into the next response)", () => {
    const a = samplePayloadOf("gate.submitted", "event")!;
    a["transformationId"] = "changed";
    expect(samplePayloadOf("gate.submitted", "event")!["transformationId"]).toBe(SAMPLE_TRANSFORMATION_ID);
  });
});
