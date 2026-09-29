import { z } from 'zod';
import { CLASSIFICATIONS, VERIFICATION_STATUSES } from '@hub/domain';

export const Uuid = z.string().uuid();
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const IsoInstant = z.string().datetime({ offset: true });
export const DecimalString = z.string().regex(/^-?\d{1,16}(\.\d{1,4})?$/, 'Expected a decimal string (max 4 dp)');
export const Currency = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');
export const UnitScale = z.union([z.literal(1), z.literal(1000), z.literal(1000000)]);
export const ClassificationSchema = z.enum(CLASSIFICATIONS);
export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const ExpectedVersion = z.number().int().positive();
/** Short text inputs are trimmed and bounded to limit abuse. */
export const Text = (max = 2000) => z.string().trim().max(max);
export const RequiredText = (max = 2000) => z.string().trim().min(1).max(max);

export const MoneySchema = z.object({ amount: DecimalString, currency: Currency, unitScale: UnitScale });
export type MoneyDto = z.infer<typeof MoneySchema>;

export const ProjectParams = z.object({ projectId: Uuid });
export const idParams = <K extends string>(key: K) => ProjectParams.extend({ [key]: Uuid } as { [P in K]: typeof Uuid });

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(64).optional(),
});
export type PageQueryDto = z.infer<typeof PageQuery>;

export const paged = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() });

export const Ok = z.object({ ok: z.literal(true) });

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string(),
  correlationId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ProblemDto = z.infer<typeof Problem>;

/** Command body carrying optimistic concurrency + optional note. */
export const CommandBody = z.object({ expectedVersion: ExpectedVersion, note: Text(4000).optional() });

export const AuditRef = z.object({ createdAt: z.string(), createdBy: z.string().nullable().optional(), version: z.number().int() });

/** Bilingual label helper used by template-derived records. */
export const I18nTextSchema = z.object({ en: z.string(), ar: z.string() });
