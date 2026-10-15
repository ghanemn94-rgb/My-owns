// P5 slice J (T-DG5-BE-S; ADR-0050 §1-§6): the 0090 demo-environment guards map to 500 (mth_app only reads these
// tables, so the API reaching one is a programming error), and an unrelated constraint is left to the other mappers.
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError, mapP5DemoEnvironmentError } from "./db-errors.ts";

const CONSTRAINTS = [
  "deployment_environment_kind_via",
  "deployment_environment_demo_dataset",
  "demo_seed_record_demo_only",
  "demo_seed_record_ref",
  "demo_seed_record_fixture_key",
  "demo_dataset_run_demo_only",
  "demo_dataset_run_step",
  "demo_dataset_run_requester",
  "demo_dataset_run_api_reset",
  "demo_dataset_run_run_no_key",
];

describe("P5 slice J database guard mapping (demo environment)", () => {
  it.each(CONSTRAINTS)("%s -> 500 internal", (constraint) => {
    const p = mapDatabaseGuardError({ code: "23514", constraint, message: "synthetic" });
    expect([p?.status, p?.code]).toEqual([500, "internal"]);
  });

  it("leaves other constraints alone", () => {
    expect(mapP5DemoEnvironmentError({ code: "23514", constraint: "some_other_check", message: "x" })).toBeNull();
  });
});
