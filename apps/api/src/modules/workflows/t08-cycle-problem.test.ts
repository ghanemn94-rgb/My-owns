// T-DG3-ARCH-03 (BE-C §7.4): the T08 cycle check now throws the platform's DependencyCycleProblem instead of its own
// copy (T08CycleProblem, deleted). This pins that the 422 body is BYTE-IDENTICAL to the one the deleted class produced:
// `LegacyT08CycleProblem` below is the deleted class verbatim (from commit 6e5a0fb), kept here only as the reference.
// The integration suite (test/integration/dependencies/t08.test.ts, "cycles") checks the same body over HTTP.
import { describe, expect, it } from "vitest";
import { DependencyCycleProblem, HttpProblem } from "../platform/index.ts";
import type { CycleNode } from "./t08-dependencies.ts";

class LegacyT08CycleProblem extends HttpProblem {
  readonly cycle: readonly CycleNode[];
  constructor(cycle: readonly CycleNode[]) {
    const text = `Dependency cycle: ${cycle.map((n) => n.code).join(" → ")}`;
    super({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "dependency.cycle",
      title: "Business rule violated",
      detail: text,
      errors: [{ pointer: "/toInitiativeId", code: "dependency.cycle", message: text }],
    });
    this.cycle = cycle;
  }
  override toBody(requestId: string, instance?: string) {
    return { ...super.toBody(requestId, instance), cycle: this.cycle };
  }
}

const A = "0190f5a0-0000-7000-8000-00000000000a";
const B = "0190f5a0-0000-7000-8000-00000000000b";
const C = "0190f5a0-0000-7000-8000-00000000000c";

describe("one dependency-cycle problem class (T-DG3-ARCH-03)", () => {
  it.each([
    [
      "A→B→C→A with names",
      [
        { initiativeId: A, code: "INI-01", name: "Synthetic A" },
        { initiativeId: B, code: "INI-02", name: "Synthetic B" },
        { initiativeId: C, code: "INI-03", name: "Synthetic C" },
        { initiativeId: A, code: "INI-01", name: "Synthetic A" },
      ],
    ],
    [
      "A→B→A, an unnamed node (empty name)",
      [
        { initiativeId: A, code: "INI-01", name: "" },
        { initiativeId: B, code: "INI-02", name: "Synthetic B" },
        { initiativeId: A, code: "INI-01", name: "" },
      ],
    ],
  ] as const)("%s: same status and byte-identical JSON body", (_label, cycle) => {
    const now = new DependencyCycleProblem(cycle);
    const legacy = new LegacyT08CycleProblem(cycle);
    expect(now.status).toBe(legacy.status);
    for (const instance of [undefined, "/api/v1/transformations/x/dependencies"])
      expect(JSON.stringify(now.toBody("req-1", instance))).toBe(JSON.stringify(legacy.toBody("req-1", instance)));
  });
});
