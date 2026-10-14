// zod mirrors of the P5 slice A element edits, diff, affected records and check runs (docs/api/openapi.yaml tag
// `studio`: putConfigElement, removeConfigElement, getConfigVersionDiff, getConfigAffectedRecords, listConfigCheckRuns,
// runConfigCompatibilityCheck, runConfigPreview; ADR-0039 §2, §5, §12; p5-work-split §A.2; T-DG5-BE-B). The OpenAPI
// file is the source of truth; the contract test parses every success body with these.
// A check run is configuration testing, not a business approval: nothing here grants or records a G1-G6 decision.
import { z } from "zod";
import { page, timestamp, uuid } from "./common.ts";

// ------------------------------------------------------------------------------------------------ element edits

/** putConfigElement body (`ConfigElementPut`). `attributes` is validated per element type by the API (ADR-0039 §2). */
export const configElementPut = z.strictObject({
  origin: z.enum(["source", "admin"]).optional(),
  ordinal: z.number().int().min(1).max(999).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()),
});
export type ConfigElementPut = z.infer<typeof configElementPut>;

// ------------------------------------------------------------------------------------------------ check runs

export const CONFIG_CHECK_KINDS = ["preview", "compatibility", "source_coverage", "invariants"] as const;
export type ConfigCheckKind = (typeof CONFIG_CHECK_KINDS)[number];
export const configCheckKind = z.enum(CONFIG_CHECK_KINDS);

/** One append-only check run over exactly one content hash (`ConfigCheckRun`). */
export const configCheckRun = z.strictObject({
  id: uuid,
  versionId: uuid,
  checkKind: configCheckKind,
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  result: z.enum(["pass", "warn", "fail"]),
  report: z.record(z.string(), z.unknown()),
  runBy: uuid,
  createdAt: timestamp,
});
export type ConfigCheckRun = z.infer<typeof configCheckRun>;
export const configCheckRunPage = page(configCheckRun);

export const configCheckRunListQuery = z.strictObject({ checkKind: configCheckKind.optional() });

/** runConfigPreview body (`ConfigPreviewRequest`): at most 50 sample inputs. */
export const configPreviewRequest = z.strictObject({
  samples: z
    .array(
      z.strictObject({
        kind: z.enum(["record", "formula", "submission"]),
        recordType: z.string().min(1).max(64).optional(),
        input: z.record(z.string(), z.unknown()),
      }),
    )
    .max(50),
});
export type ConfigPreviewRequest = z.infer<typeof configPreviewRequest>;

// ------------------------------------------------------------------------------------------------ diff

export const configDiffEntry = z.strictObject({
  elementType: z.string(),
  stableKey: z.string(),
  change: z.enum(["added", "removed", "changed"]),
  fields: z.array(z.strictObject({ field: z.string(), from: z.unknown(), to: z.unknown() })),
});
export type ConfigDiffEntry = z.infer<typeof configDiffEntry>;

export const configVersionDiff = z.strictObject({
  fromVersionId: uuid,
  toVersionId: uuid,
  titleChanged: z.boolean(),
  definitionChanged: z.boolean(),
  entries: z.array(configDiffEntry),
});
export type ConfigVersionDiff = z.infer<typeof configVersionDiff>;

export const configDiffQuery = z.strictObject({ against: uuid.optional() });

// ------------------------------------------------------------------------------------------------ affected records

/** Counts are integers, or null with `unknownReason` when not countable (never 0 for Unknown; ADR-0039 §12). */
export const configAffectedRecordCount = z.strictObject({
  recordType: z.string(),
  count: z.number().int().min(0).nullable(),
  unknownReason: z.string().nullable(),
});
export const configAffectedRecords = z.strictObject({
  versionId: uuid,
  transformations: z.array(
    z.strictObject({
      transformationId: uuid,
      code: z.string(),
      pinnedVersionId: uuid,
      records: z.array(configAffectedRecordCount),
    }),
  ),
});
export type ConfigAffectedRecords = z.infer<typeof configAffectedRecords>;
