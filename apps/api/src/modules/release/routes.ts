// The in-app requirement register and About (P7 slice I; ADR-0071 §3, §4; p7-work-split §I.1; REQ-S02-003,
// REQ-S02-005, REQ-S21-003). Route file created as a stub by T-DG7-BE-A; filled by T-DG7-BE-H:
//   GET /api/v1/admin/requirements           listRequirements   (operations.read; ADM_TECH, TO, KDS, TD, AUD)
//   GET /api/v1/admin/requirements/{reqId}   getRequirement     (operations.read)
//   GET /api/v1/admin/about                  getReleaseAbout    (operations.read)
// The register shown is the build-time snapshot of docs/delivery/requirements.csv (snapshot.ts): release reads no
// delivery record at run time, imports only the platform plumbing and the policy function, and nothing it shows is a
// DG0-DG7 gate decision or a G1-G6 business approval. The register is maintained in the repository; no route edits it.
//
// Guard table (ADR-0071 §3; p7-work-split §I.4; D-251 item 3):
// | Guard | Clause                                                                              | Test(s)                                         |
// | G1    | no session -> 401                                                                   | T-I5; the contract 401 sweep (p7-exercises-be-h) |
// | G2    | operations.read at installation scope -> else 403; ADM_TECH, TO, KDS, TD, AUD -> 200 | T-I5 (all 14 roles)                             |
// | G3    | parameters by contract pattern and enum; cursor bound to filters -> else 400        | T-I4, T-I5; response-validation.test.ts         |
// | G4    | missing or invalid snapshot -> 503 (list, get) or null fields (About); not cached   | T-I6, T-I7                                      |
// | G5    | read-only: GET only, no audit, no version                                          | the contract; T-I9; route-inventory.test.ts      |
// | G6    | no sensitive data added; register text secret-scanned                               | ADR-0063 payload scan (DO-B); sensitive-ref inv. |
// | G7    | only the snapshot file is read at run time                                          | T-I9                                            |
// | G8    | platform rate limit -> 429                                                          | the platform limiter tests; p7-exercises-be-h   |
// G2 "installation scope": operations.read is held at organization level; a holder in some organization is admitted,
// decided by the access module's one policy function, as getWorkerHeartbeat and getDeploymentStatus decide it.
import { readFileSync } from "node:fs";
import { PROBLEM_TYPES } from "@mth/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authorize, organizationsWith, principalOf } from "../access/index.ts";
import { CONTRACT_VERSION, HttpProblem, parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import { buildAbout, registerSnapshotInfoView } from "./about.ts";
import { decodeRequirementCursor, encodeRequirementCursor, requirementFiltersHash } from "./cursor.ts";
import {
  AREA_PATTERN,
  defaultRegisterSnapshotSource,
  FINAL_GATE_PATTERN,
  REQUIREMENT_CLASSES,
  REQUIREMENT_STATUSES,
  SnapshotUnavailable,
  type RegisterRow,
  type RegisterSnapshotSource,
  type Snapshot,
} from "./snapshot.ts";

export const RELEASE_PATHS = {
  listRequirements: "/api/v1/admin/requirements",
  getRequirement: "/api/v1/admin/requirements/:reqId",
  getReleaseAbout: "/api/v1/admin/about",
} as const;

const PERMISSION = "operations.read" as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// docs/api/openapi.yaml RequirementSummary, RequirementPage, Requirement (response mirrors).
const reqIdSchema = z
  .string()
  .regex(/^REQ-[A-Z0-9]+-[0-9]{3}$/)
  .max(16);
const statusSchema = z.enum(REQUIREMENT_STATUSES);
const classSchema = z.enum(REQUIREMENT_CLASSES);
const areaSchema = z.string().regex(AREA_PATTERN);
const finalGateSchema = z.string().regex(FINAL_GATE_PATTERN);
export const requirementSummaryView = z.strictObject({
  reqId: reqIdSchema,
  class: classSchema,
  area: areaSchema,
  title: z.string().max(2000),
  sourceRef: z.string().max(2000),
  finalGate: finalGateSchema,
  status: statusSchema,
  increments: z.string().max(200),
  hasNotes: z.boolean(),
});
export const requirementPageView = z.strictObject({
  items: z.array(requirementSummaryView),
  nextCursor: z.string().nullable(),
  snapshot: registerSnapshotInfoView,
});
export const requirementView = z.strictObject({
  reqId: reqIdSchema,
  class: classSchema,
  area: areaSchema,
  title: z.string().max(2000),
  sourceRef: z.string().max(2000),
  sourceHeading: z.string().max(2000),
  templateId: z.string().max(200),
  inputFields: z.string().max(20000),
  procedure: z.string().max(65536),
  output: z.string().max(20000),
  ownerRoles: z.string().max(2000),
  permissions: z.string().max(2000),
  automation: z.string().max(2000),
  screenApi: z.string().max(2000),
  acceptance: z.string().max(65536),
  increments: z.string().max(200),
  finalGate: finalGateSchema,
  status: statusSchema,
  evidence: z.string().max(262144),
  notes: z.string().max(262144),
  snapshot: registerSnapshotInfoView,
});

// Query and path parameters (G3): strict, by the contract's patterns and enums.
const listQuery = z.strictObject({
  class: classSchema.optional(),
  status: statusSchema.optional(),
  area: areaSchema.optional(),
  finalGate: finalGateSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});
const getParams = z.strictObject({ reqId: reqIdSchema });
const noQuery = z.strictObject({});

/** The §I.3 problem: the register of this release is not available (G4). */
export const registerSnapshotUnavailable = (): HttpProblem =>
  new HttpProblem({
    status: 503,
    type: PROBLEM_TYPES.unavailable,
    code: "release.register_snapshot_unavailable",
    title: "Service unavailable",
    detail:
      "The requirement register of this release is not available. The build did not include its register snapshot.",
  });

/**
 * The API's package version, `unknown` when unreadable or invalid: the getDeploymentStatus rule (ADR-0069 §3), from the
 * same file (apps/api/package.json; `../../../package.json` from both src/ and dist/ module trees). Read once, at
 * registration, never during a request (G7).
 */
export function releaseAppVersion(packageJson: URL = new URL("../../../package.json", import.meta.url)): string {
  try {
    const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version !== "" && pkg.version.length <= 50 ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

const summaryOf = (r: RegisterRow) => ({
  reqId: r.reqId,
  class: r.class,
  area: r.area,
  title: r.title,
  sourceRef: r.sourceRef,
  finalGate: r.finalGate,
  status: r.status,
  increments: r.increments,
  hasNotes: r.notes !== "",
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerReleaseRoutes(
  app: FastifyInstance,
  deps: ModuleDeps,
  source: RegisterSnapshotSource = defaultRegisterSnapshotSource(),
  options: { readonly appVersion?: string } = {},
): string[] {
  const appVersion = options.appVersion ?? releaseAppVersion();

  /** G2: operations.read in some organization, through the access module's policy function. */
  const requireRead = async (request: FastifyRequest): Promise<void> => {
    const principal = principalOf(request);
    for (const organizationId of organizationsWith(principal, PERMISSION))
      if ((await authorize(deps.db, principal, PERMISSION, { type: "organization", id: organizationId })).allowed)
        return;
    throw problems.forbidden();
  };

  /** G4: the snapshot, or the 503 problem (the source retries on the next request). */
  const snapshotOr503 = async (request: FastifyRequest): Promise<Snapshot> => {
    try {
      return await source.load(request.log);
    } catch (error) {
      if (error instanceof SnapshotUnavailable) throw registerSnapshotUnavailable();
      throw error;
    }
  };

  const access = { config: { access: { permission: PERMISSION } } };

  app.get(RELEASE_PATHS.listRequirements, access, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireRead(request);
    const { cursor, limit, ...filters } = query;
    const hash = requirementFiltersHash(filters);
    const after = decodeRequirementCursor(cursor, hash);
    const snapshot = await snapshotOr503(request);
    const matching = snapshot.rows.filter(
      (r) =>
        (filters.class === undefined || r.class === filters.class) &&
        (filters.status === undefined || r.status === filters.status) &&
        (filters.area === undefined || r.area === filters.area) &&
        (filters.finalGate === undefined || r.finalGate === filters.finalGate) &&
        (after === null || r.reqId > after),
    );
    const items = matching.slice(0, limit);
    const nextCursor = matching.length > limit ? encodeRequirementCursor(items[items.length - 1]!.reqId, hash) : null;
    return requirementPageView.parse({ items: items.map(summaryOf), nextCursor, snapshot: { ...snapshot.info } });
  });

  app.get(RELEASE_PATHS.getRequirement, access, async (request) => {
    parseQuery(noQuery, request.query);
    const params = parse(getParams, request.params, "params");
    await requireRead(request);
    const snapshot = await snapshotOr503(request);
    const row = snapshot.byId.get(params.reqId);
    if (row === undefined) throw problems.notFound();
    return requirementView.parse({ ...row, snapshot: { ...snapshot.info } });
  });

  app.get(RELEASE_PATHS.getReleaseAbout, access, async (request) => {
    parseQuery(noQuery, request.query);
    await requireRead(request);
    let snapshot: Snapshot | null;
    try {
      snapshot = await source.load(request.log);
    } catch (error) {
      if (!(error instanceof SnapshotUnavailable)) throw error;
      snapshot = null; // G4: About answers 200 with null fields, never 0 or [].
    }
    return buildAbout(snapshot, { appVersion, contractVersion: CONTRACT_VERSION });
  });

  return Object.values(RELEASE_PATHS).map((path) => `GET ${path}`);
}
