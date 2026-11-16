// Administration > About (getReleaseAbout; ADR-0071 §4; p7-work-split §I.1; REQ-S02-005, REQ-S21-003; T-DG7-BE-H).
// Built from the build-time register snapshot and the API's own versions only. `null` means unknown: a missing
// snapshot gives `register`, `statusCounts`, `openItems` and `laterClauses` null (never 0 or []), and a build without
// external-dependencies.json gives `externalDependencies` null (Unknown, never "none"). Statuses and notes are the
// register's text verbatim, so no planned item is labelled delivered. Nothing here is a DG0-DG7 gate decision or a
// G1-G6 business approval, and nothing says the release "is approved".
import { z } from "zod";
import { REQUIREMENT_STATUSES, type RegisterRow, type Snapshot } from "./snapshot.ts";

/** The marker AN-P7 writes into the notes of a row whose last clause completes after the gate (D-243 Q19, §5.3). */
export const LATER_CLAUSE_MARKER = "completes-after-gate:";

const timestamp = z.iso.datetime({ offset: true });
const reqId = z
  .string()
  .regex(/^REQ-[A-Z0-9]+-[0-9]{3}$/)
  .max(16);
const status = z.enum(REQUIREMENT_STATUSES);
const finalGate = z.string().regex(/^DG[0-7]$/);

// docs/api/openapi.yaml RegisterSnapshotInfo, ReleaseOpenItem, ExternalDependency, ReleaseAbout (response mirrors).
export const registerSnapshotInfoView = z.strictObject({
  schemaVersion: z.literal("mth-register-snapshot/1"),
  sourcePath: z.literal("docs/delivery/requirements.csv"),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  rowCount: z.number().int().min(0),
  generatedAt: timestamp,
});
export const releaseOpenItemView = z.strictObject({
  reqId,
  title: z.string().max(2000),
  status,
  finalGate,
  notes: z.string().max(262144),
});
export const externalDependencyView = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  title: z.string().max(500),
  owner: z.string().max(200),
  status: z.enum(["not_configured", "not_verified", "blocked"]),
});
export const releaseAboutView = z.strictObject({
  appVersion: z.string().max(50),
  contractVersion: z.string().max(50),
  register: registerSnapshotInfoView.nullable(),
  statusCounts: z
    .strictObject({
      PLANNED: z.number().int().min(0),
      SPECIFIED: z.number().int().min(0),
      IMPLEMENTED: z.number().int().min(0),
      BLOCKED: z.number().int().min(0),
    })
    .nullable(),
  openItems: z.array(releaseOpenItemView).nullable(),
  laterClauses: z.array(releaseOpenItemView).nullable(),
  externalDependencies: z.array(externalDependencyView).nullable(),
  checkedAt: timestamp,
});
export type ReleaseAbout = z.infer<typeof releaseAboutView>;

export interface ReleaseVersions {
  readonly appVersion: string;
  readonly contractVersion: string;
}

const openItem = (r: RegisterRow) => ({
  reqId: r.reqId,
  title: r.title,
  status: r.status,
  finalGate: r.finalGate,
  notes: r.notes,
});

/** ADR-0071 §4. `snapshot` null = unavailable (G4). `checkedAt` is the response time. */
export function buildAbout(snapshot: Snapshot | null, versions: ReleaseVersions, checkedAt = new Date()): ReleaseAbout {
  const base = { appVersion: versions.appVersion, contractVersion: versions.contractVersion };
  if (snapshot === null)
    return releaseAboutView.parse({
      ...base,
      register: null,
      statusCounts: null,
      openItems: null,
      laterClauses: null,
      // The dependency list travels inside the snapshot: without the snapshot it is unknown too.
      externalDependencies: null,
      checkedAt: checkedAt.toISOString(),
    });
  const count = (status: RegisterRow["status"]) => snapshot.rows.filter((r) => r.status === status).length;
  const statusCounts = {
    PLANNED: count("PLANNED"),
    SPECIFIED: count("SPECIFIED"),
    IMPLEMENTED: count("IMPLEMENTED"),
    BLOCKED: count("BLOCKED"),
  };
  return releaseAboutView.parse({
    ...base,
    register: { ...snapshot.info },
    statusCounts,
    // Every row not IMPLEMENTED, in reqId order, notes verbatim: never truncated, never paginated.
    openItems: snapshot.rows.filter((r) => r.status !== "IMPLEMENTED").map(openItem),
    laterClauses: snapshot.rows
      .filter((r) => r.status === "IMPLEMENTED" && r.notes.includes(LATER_CLAUSE_MARKER))
      .map(openItem),
    externalDependencies:
      snapshot.externalDependencies === null ? null : snapshot.externalDependencies.map((d) => ({ ...d })),
    checkedAt: checkedAt.toISOString(),
  });
}
