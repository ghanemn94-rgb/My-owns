// zod mirrors of the P4 portfolios and workstreams tags (docs/api/openapi.yaml; ADR-0038 §9-§12; T-DG4-BE-M3;
// REQ-S03-001). The OpenAPI file is the source of truth; the contract test parses every success body with these.
// A portfolio groups transformations of one organization; a workstream groups initiatives inside one transformation.
// Neither grants access (scoped_assignment stays the only source, ADR-0006) and neither is a business approval.
// Free text goes through the shared rules (S-1): `freeText` (not blank, no invalid character, stored as entered) and the
// shared `reason`.
import { z } from "zod";
import { code, freeText, page, timestamp, uuid, version } from "./common.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const stamps = {
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
};

/** The `WS-nn` code of a workstream (record_code_counter prefix WS; 0055). */
export const WORKSTREAM_CODE_PATTERN = /^WS-[0-9]{2,6}$/;

const structureName = freeText(1, 300);
const structureDescription = freeText(1, 4000).nullable();
const archiveReason = freeText(3, 1000);

/**
 * The shared rule of `PortfolioUpdate` and `WorkstreamUpdate`: "status archived needs archiveReason". A reason without
 * the archive is refused too (`validation.not_applicable`), so no reason is ever silently dropped.
 */
function archiveNeedsReason(
  v: { status?: "archived" | undefined; archiveReason?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (v.status === "archived" && v.archiveReason === undefined)
    ctx.addIssue({ code: "custom", path: ["archiveReason"], message: "validation.required" });
  if (v.status === undefined && v.archiveReason !== undefined)
    ctx.addIssue({ code: "custom", path: ["archiveReason"], message: "validation.not_applicable" });
}

// ------------------------------------------------------------------------------------------------ portfolios

export const PORTFOLIO_STATUSES = ["active", "archived"] as const;
export const MEMBERSHIP_STATUSES = ["active", "removed"] as const;

export const portfolio = z.strictObject({
  id: uuid,
  organizationId: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  ownerUserId: nullableUuid,
  status: z.enum(PORTFOLIO_STATUSES),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().nullable(),
  ...stamps,
});
export type Portfolio = z.infer<typeof portfolio>;
export const portfolioPage = page(portfolio);

/** OpenAPI `PortfolioCreate`: the code is upper case, unique per organization (409 portfolio.code_taken). */
export const portfolioCreate = z.strictObject({
  code,
  name: structureName,
  description: structureDescription.optional(),
  ownerUserId: nullableUuid.optional(),
});
export type PortfolioCreate = z.infer<typeof portfolioCreate>;

/** OpenAPI `PortfolioUpdate` (minProperties 1): edit, or archive with a reason (terminal; read-only afterwards). */
export const portfolioUpdate = z
  .strictObject({
    code: code.optional(),
    name: structureName.optional(),
    description: structureDescription.optional(),
    ownerUserId: nullableUuid.optional(),
    status: z.enum(["archived"]).optional(),
    archiveReason: archiveReason.optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties")
  .superRefine(archiveNeedsReason);
export type PortfolioUpdate = z.infer<typeof portfolioUpdate>;

export const portfolioTransformation = z.strictObject({
  id: uuid,
  portfolioId: uuid,
  transformationId: uuid,
  transformationCode: z.string(),
  transformationName: z.string(),
  status: z.enum(MEMBERSHIP_STATUSES),
  removedAt: nullableTimestamp,
  removedBy: nullableUuid,
  removeReason: z.string().nullable(),
  ...stamps,
});
export type PortfolioTransformation = z.infer<typeof portfolioTransformation>;
export const portfolioTransformationPage = page(portfolioTransformation);

export const portfolioTransformationCreate = z.strictObject({ transformationId: uuid });
export type PortfolioTransformationCreate = z.infer<typeof portfolioTransformationCreate>;

// ------------------------------------------------------------------------------------------------ workstreams

export const workstream = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(WORKSTREAM_CODE_PATTERN),
  name: z.string(),
  description: z.string().nullable(),
  leadUserId: nullableUuid,
  status: z.enum(PORTFOLIO_STATUSES),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().nullable(),
  ...stamps,
});
export type Workstream = z.infer<typeof workstream>;
export const workstreamPage = page(workstream);

/** OpenAPI `WorkstreamCreate`: the code WS-nn is assigned by the server. */
export const workstreamCreate = z.strictObject({
  name: structureName,
  description: structureDescription.optional(),
  leadUserId: nullableUuid.optional(),
});
export type WorkstreamCreate = z.infer<typeof workstreamCreate>;

/** OpenAPI `WorkstreamUpdate` (minProperties 1): edit, or archive with a reason (terminal; read-only afterwards). */
export const workstreamUpdate = z
  .strictObject({
    name: structureName.optional(),
    description: structureDescription.optional(),
    leadUserId: nullableUuid.optional(),
    status: z.enum(["archived"]).optional(),
    archiveReason: archiveReason.optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties")
  .superRefine(archiveNeedsReason);
export type WorkstreamUpdate = z.infer<typeof workstreamUpdate>;

export const workstreamInitiative = z.strictObject({
  id: uuid,
  workstreamId: uuid,
  initiativeId: uuid,
  initiativeCode: z.string(),
  initiativeName: z.string(),
  status: z.enum(MEMBERSHIP_STATUSES),
  removedAt: nullableTimestamp,
  removedBy: nullableUuid,
  removeReason: z.string().nullable(),
  ...stamps,
});
export type WorkstreamInitiative = z.infer<typeof workstreamInitiative>;
export const workstreamInitiativePage = page(workstreamInitiative);

export const workstreamInitiativeCreate = z.strictObject({ initiativeId: uuid });
export type WorkstreamInitiativeCreate = z.infer<typeof workstreamInitiativeCreate>;
