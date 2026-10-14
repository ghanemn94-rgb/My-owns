// The Preview/Test sandbox (ADR-0039 §5; REQ-S06-007; p5-work-split §A.2; T-DG5-BE-B). In a READ ONLY transaction that
// is always rolled back, it runs the kind's invariant checks over the draft's stored elements (invariants.ts) and the
// admin's sample inputs through the kind's provider preview hook, which resolves configuration through
// `ConfigResolver.withDraft` (the methodology provider: formulas through the DG3 engine unchanged, sample submissions
// routed through the draft's approver routes). Nothing is written here; the route (checks.ts) records the run in a
// separate write transaction. A sample the kind cannot evaluate fails the run with a reason (never a silent pass).
import type { Db } from "@mth/db";
import { configKind, type ConfigPreviewRequest } from "@mth/shared/schemas";
import type { CheckOutcome } from "./compatibility.ts";
import type { MethodologyVersionRow } from "./drafts.ts";
import { elementRowFindings } from "./invariants.ts";
import { configKindProvider } from "./kinds.ts";

/** Carries the outcome out of the sandbox transaction while forcing its rollback. */
class SandboxOutcome extends Error {
  readonly outcome: CheckOutcome;
  constructor(outcome: CheckOutcome) {
    super("preview sandbox rolled back");
    this.outcome = outcome;
  }
}

/** Runs the sandbox for `version` (its stored content at call time) and returns the outcome; writes nothing. */
export async function runPreviewSandbox(
  db: Db,
  version: MethodologyVersionRow,
  samples: ConfigPreviewRequest["samples"],
): Promise<CheckOutcome> {
  try {
    await db
      .transaction()
      .setAccessMode("read only")
      .execute(async (tx) => {
        const invariants = await elementRowFindings(tx, version);
        const hook = configKindProvider(configKind.parse(version.config_kind)).preview;
        let sampleReport: Record<string, unknown>;
        let samplesPass = true;
        if (samples.length === 0) {
          sampleReport = { evaluated: 0, results: [] };
        } else if (hook === undefined) {
          samplesPass = false;
          sampleReport = {
            evaluated: 0,
            results: samples.map((s, i) => ({ index: i, kind: s.kind, result: "fail", code: "preview.not_available" })),
          };
        } else {
          const out = await hook(tx, { versionId: version.id, samples });
          samplesPass = out.result === "pass";
          sampleReport = { ...out.report };
        }
        const result = invariants.length === 0 && samplesPass ? "pass" : "fail";
        throw new SandboxOutcome({
          result,
          report: {
            schema: "mth.config-preview/1",
            contentSha256: version.content_sha256,
            invariants: invariants.map((f) => ({ ...f, params: { ...f.params } })),
            samples: sampleReport,
          },
        });
      });
  } catch (e) {
    if (e instanceof SandboxOutcome) return e.outcome;
    throw e;
  }
  throw new Error("preview sandbox returned without an outcome");
}
