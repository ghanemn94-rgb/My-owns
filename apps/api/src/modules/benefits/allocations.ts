// Contribution allocations of a canonical benefit to initiatives (P4 slice B; ADR-0029 §5, §11; T-DG4-KBE-D;
// REQ-S08-013, REQ-PB-058):
//   GET /transformations/{t}/benefits/{benefitId}/allocations   the set in force, the allocated share and the
//                                                               unallocated share (1 - sum) (transformation.read)
//   PUT /transformations/{t}/benefits/{benefitId}/allocations   replace the whole set (benefit.allocate; TL, BO;
//                                                               If-Match = the benefit's ETag)
//
// - Shares are fractions (0.6 = 60 %), numeric(7,6), each above 0 and at most 1; summed with decimal arithmetic, never
//   floats. A set above 1 is 422 benefit_allocation.over_100 ("60 % + 50 %" -> 110 %); below 1 the rest is shown as
//   unallocated ("60 % + 30 %" -> unallocatedShare "0.100000").
// - The replace runs in ONE transaction under the advisory lock class benefitAllocationSet (key: the benefit id; the database trigger
//   benefit_allocation_guard takes the same lock and refuses a set above 1 again): the benefit's allocation_set_no steps
//   by one (benefit version + 1, one audit event `benefit.allocations_replaced` with the old and the new set) and the
//   new rows are inserted. Rows are append-only; an empty array clears the allocations (a new, empty set).
// - Allocations attribute a benefit to initiatives for initiative views only. Transformation and portfolio totals count
//   the benefit itself once and never its allocations (ADR-0030 §7).
import { sql, type BenefitAllocationRow, type DbOrTx, type Tx } from "@mth/db";
import {
  allocationTotals,
  benefitAllocationsReplace,
  percentText,
  shareInRange,
  toColumnString,
  SHARE_COLUMN,
  type BenefitAllocations,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { record } from "../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, parseBody, requireIfMatch, type ModuleDeps } from "../platform/index.ts";
import { assertSameTransformation, bumpStamps } from "../transformations/index.ts";
import {
  BENEFIT_ITEM,
  benefitRule,
  checkBenefitVersion,
  JSON_BODY,
  lockBenefit,
  openBenefitWrite,
  parseBenefitParams,
  readBenefitRow,
} from "./register.ts";

export const BENEFIT_ALLOCATE = "benefit.allocate" as const;
export const ALLOCATIONS = `${BENEFIT_ITEM}/allocations`;

/** The allocation set in force of a benefit, with the allocated and unallocated shares. */
export async function allocationsOf(
  db: DbOrTx,
  benefit: { id: string; allocation_set_no: number },
): Promise<BenefitAllocations> {
  const rows =
    benefit.allocation_set_no === 0
      ? []
      : await db
          .selectFrom("benefit_allocation")
          .selectAll()
          .where("benefit_id", "=", benefit.id)
          .where("set_no", "=", benefit.allocation_set_no)
          .orderBy("id")
          .execute();
  return toAllocations(benefit.id, benefit.allocation_set_no, rows);
}

function toAllocations(benefitId: string, setNo: number, rows: readonly BenefitAllocationRow[]): BenefitAllocations {
  const totals = allocationTotals(rows.map((r) => r.share));
  return {
    benefitId,
    setNo,
    allocations: rows.map((r) => ({
      initiativeId: r.initiative_id,
      share: toColumnString(r.share, SHARE_COLUMN),
      basis: r.basis,
    })),
    allocatedShare: totals.allocatedShare,
    unallocatedShare: totals.unallocatedShare,
  };
}

const shareProblem = (i: number) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code: "benefit_allocation.share_invalid",
    title: "Business rule violated",
    detail: "Each share is above 0 % and at most 100 %.",
    errors: [
      {
        pointer: `/allocations/${i}/share`,
        code: "benefit_allocation.share_invalid",
        message: "Each share is above 0 % and at most 100 %.",
      },
    ],
  });

async function replaceAllocations(tx: Tx, request: FastifyRequest, transformationId: string, benefitId: string) {
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_ALLOCATE);
  const body = parseBody(benefitAllocationsReplace, request.body);
  const expected = requireIfMatch(request);
  // The allocation-set lock before the row lock, in the trigger's order (benefit_allocation_guard takes the same class and key).
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.benefitAllocationSet}::int4, hashtext(${benefitId}))`.execute(
    tx,
  );
  const current = await lockBenefit(tx, transformationId, benefitId);
  checkBenefitVersion(current, expected);
  body.allocations.forEach((a, i) => {
    if (!shareInRange(a.share)) throw shareProblem(i);
  });
  const seen = new Set<string>();
  body.allocations.forEach((a, i) => {
    if (seen.has(a.initiativeId))
      throw benefitRule(
        "benefit_allocation.duplicate_initiative",
        "Each initiative appears once in a benefit's allocations.",
        `/allocations/${i}/initiativeId`,
      );
    seen.add(a.initiativeId);
  });
  const totals = allocationTotals(body.allocations.map((a) => a.share));
  if (totals.overHundred)
    throw benefitRule(
      "benefit_allocation.over_100",
      `The allocations total ${percentText(totals.allocatedShare)} %, above 100 %. Reduce them so they total 100 % or less.`,
      "/allocations",
    );
  for (const [i, a] of body.allocations.entries())
    await assertSameTransformation(
      tx,
      "initiative",
      transformationId,
      a.initiativeId,
      `/allocations/${i}/initiativeId`,
    );
  const before = await allocationsOf(tx, current);
  const updated = await tx
    .updateTable("benefit")
    .set({ allocation_set_no: current.allocation_set_no + 1, ...bumpStamps(ctx.userId) })
    .where("id", "=", benefitId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const rows =
    body.allocations.length === 0
      ? []
      : await tx
          .insertInto("benefit_allocation")
          .values(
            body.allocations.map((a) => ({
              id: uuidv7(),
              organization_id: ctx.organizationId,
              transformation_id: transformationId,
              benefit_id: benefitId,
              set_no: updated.allocation_set_no,
              initiative_id: a.initiativeId,
              share: a.share,
              basis: a.basis ?? null,
              created_by: ctx.userId,
            })),
          )
          .returningAll()
          .execute();
  const after = toAllocations(benefitId, updated.allocation_set_no, rows);
  await record(tx, ctx.audit, {
    action: "benefit.allocations_replaced",
    recordType: "benefit",
    recordId: benefitId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      allocation_set_no: { from: current.allocation_set_no, to: updated.allocation_set_no },
      allocations: {
        from: before.allocations.map((a) => ({ initiativeId: a.initiativeId, share: a.share })),
        to: after.allocations.map((a) => ({ initiativeId: a.initiativeId, share: a.share })),
      },
    },
  });
  return { body: after, version: updated.version };
}

export function registerBenefitAllocationRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(ALLOCATIONS, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const row = await readBenefitRow(db, request, transformationId, benefitId);
    reply.header("ETag", `"${row.version}"`);
    return allocationsOf(db, row);
  });

  app.put(
    ALLOCATIONS,
    { config: { access: { permission: BENEFIT_ALLOCATE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, benefitId } = parseBenefitParams(request.params);
      const result = await db
        .transaction()
        .execute((tx) => replaceAllocations(tx, request, transformationId, benefitId));
      // The ETag is the BENEFIT's version: the next replace sends it in If-Match.
      reply.header("ETag", `"${result.version}"`);
      return reply.code(200).send(result.body);
    },
  );

  return [`GET ${ALLOCATIONS}`, `PUT ${ALLOCATIONS}`];
}
