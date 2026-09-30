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

/**
 * Allow-listed list sorting (QA-P1-13, REQ-DAT-015). Every list route declares its sortable keys in its contract:
 * `?sort=<key>` sorts ascending, `?sort=-<key>` descending, and any other value is rejected with 400
 * (`validation_failed`). The API applies the order in SQL, inside the caller's scope (filters and RLS unchanged),
 * with NULLs last and the row id as deterministic tiebreaker. Omitting `sort` keeps the list's default order.
 * A list without a meaningful sort declares an empty list (`SortParam([])` / `NoSort`) and rejects every `sort`.
 */
export type SortValue<K extends string> = K | `-${K}`;
/** The ascending key of a sort value (`-dueDate` → `dueDate`). */
export type SortKeyOf<S extends string> = S extends `-${infer K}` ? K : S;

const DECLARED_SORT_KEYS = new WeakMap<z.ZodType, readonly string[]>();

/** `sort` for a list without a meaningful sort: any value (even empty) is a 400. */
export const NoSort = z.never({ error: 'This list does not support sorting' }).optional().describe('Not supported: this list has a fixed order.');
DECLARED_SORT_KEYS.set(NoSort, []);

/** `sort` accepting exactly the declared keys, ascending (`key`) or descending (`-key`). */
export function SortParam<const K extends string>(keys: readonly K[]): z.ZodOptional<z.ZodType<SortValue<K>, SortValue<K>>> {
  if (keys.length === 0) return NoSort as unknown as z.ZodOptional<z.ZodType<SortValue<K>, SortValue<K>>>;
  if (new Set(keys).size !== keys.length || keys.some((k) => !/^[a-z][A-Za-z0-9]*$/.test(k))) throw new Error(`Invalid sort keys: ${keys.join(', ')}`);
  const values = keys.flatMap((k) => [k, `-${k}`]) as [SortValue<K>, ...SortValue<K>[]];
  const schema = z
    .enum(values, { error: `Unknown sort key. Allowed: ${values.join(', ')}` })
    .optional()
    .describe(`Sort key: ${keys.join(', ')} (ascending) or with a leading "-" (descending). Ties are broken by id; NULLs sort last.`);
  DECLARED_SORT_KEYS.set(schema, keys);
  return schema as unknown as z.ZodOptional<z.ZodType<SortValue<K>, SortValue<K>>>;
}

/**
 * Sort keys declared by a list query schema (`[]` when the list rejects sorting) or `undefined` when the query has no
 * declared `sort` parameter (the registry test fails such list routes).
 */
export function declaredSortKeys(query: z.ZodTypeAny): readonly string[] | undefined {
  const shape = (query as unknown as { shape?: Record<string, z.ZodType> }).shape;
  const sort = shape?.['sort'];
  return sort ? DECLARED_SORT_KEYS.get(sort) : undefined;
}

/** Split a validated sort value into its key and direction (`undefined` when no sort was requested). */
export function parseSort<S extends string>(sort: S | undefined): { key: SortKeyOf<S>; desc: boolean } | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith('-');
  return { key: (desc ? sort.slice(1) : sort) as SortKeyOf<S>, desc };
}

/** Pagination + free-text query. `sort` is rejected unless the route declares keys with `.extend({ sort: SortParam([...]) })`. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  sort: NoSort,
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

/**
 * Bilingual server strings (QA-P1-14, REQ-UX-001/002; documented in docs/architecture/module-guide.md §2):
 *  - bilingual DATA (template-seeded names/titles, user-entered bilingual titles): `<field>` carries the English/primary
 *    text and `<field>Ar: string | null` the Arabic text — null when no Arabic source exists (the client then shows
 *    `<field>` as-is; nothing is machine-translated);
 *  - server-COMPUTED explanations: `<field>` keeps the English sentence (audit/AI/compatibility) and
 *    `<field>I18n: ServerMessage[]` carries the same content as codes + parameters that the client translates.
 */
export const ServerMessageSchema = z.object({ code: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])) });
export type ServerMessageDto = z.infer<typeof ServerMessageSchema>;
