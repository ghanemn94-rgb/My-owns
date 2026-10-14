// Critical dependency slips (ADR-0044 §7; REQ-S12-012; OpenAPI `DependencySlip`, `DependencySlipPage`; T-DG5-BE-J):
// the response mirrors of listDependencySlips. Dates are business dates `YYYY-MM-DD`; a forecast finish that could not
// be computed is null (Unknown), never 0. slipDays counts calendar days.
import { z } from "zod";
import { timestamp, uuid } from "./common.ts";

const businessDate = z.iso.date();

export const dependencySlipAffected = z.strictObject({
  initiativeId: uuid,
  initiativeCode: z.string(),
  ownerUserId: uuid.nullable(),
  forecastFinishBefore: businessDate.nullable(),
  forecastFinishAfter: businessDate.nullable(),
});

export const dependencySlip = z.strictObject({
  id: uuid,
  dependencyId: uuid,
  dependencyCode: z.string(),
  predecessorFinishBefore: businessDate,
  predecessorFinishAfter: businessDate,
  slipDays: z.number().int().min(1),
  neededBy: businessDate.nullable(),
  criticalReason: z.enum(["critical_path", "needed_by_breached"]),
  affected: z.array(dependencySlipAffected).max(200),
  createdAt: timestamp,
});

export const dependencySlipPage = z.strictObject({
  items: z.array(dependencySlip),
  nextCursor: z.string().nullable(),
});

export type DependencySlipAffected = z.infer<typeof dependencySlipAffected>;
export type DependencySlip = z.infer<typeof dependencySlip>;
export type DependencySlipPage = z.infer<typeof dependencySlipPage>;
