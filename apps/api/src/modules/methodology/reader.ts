// The playbook reader (OpenAPI tag "methodology-reader"; ADR-0049 §1, §10-§11; REQ-S03-010, REQ-S02-004;
// p5-work-split §I.1; T-DG5-BE-Q):
//   GET /methodology/blocks            listMethodologyBlocks (session)
//   GET /methodology/blocks/{blockRef} getMethodologyBlock   (session)
//
// The 165 blocks are the immutable catalogue `playbook_block` (0092): text_en VERBATIM docs/source/playbook.md,
// text_ar a provisional translation (arProvisional). The reader resolves a methodology version:
//  - without `transformationId`: the latest PUBLISHED version of kind `methodology`, key `playbook`;
//  - with `transformationId`: that transformation's pinned `methodology` version through the ConfigResolver, which
//    needs transformation.read there (else 404, never disclosing the transformation).
// The verbatim text is the same for every version; what a version adds, through Studio and its publish pipeline only,
// is the guidance beside a block (the `methodology_text` element `block.<Bxxxx>`, bodyEn/bodyAr) and its link
// additions/removals (source-links.ts). Read-only: nothing here writes, launches or approves anything.
import type { DbOrTx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead, type Principal, type ResolvedTarget } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import type { ConfigResolver, PinnedVersion } from "./config-resolver.ts";

// ------------------------------------------------------------------------------------------------ zod mirrors

export const PHASE_CODES = ["diagnose", "define", "design", "mobilize", "transform", "realize"] as const;
export type PhaseCode = (typeof PHASE_CODES)[number];
const BLOCK_REF = /^B0[0-9]{3}$/;

/** OpenAPI `MethodologyVersionRef`. */
export const methodologyVersionRef = z.strictObject({
  versionId: uuid,
  key: z.string(),
  versionNo: z.number().int(),
});
/** OpenAPI `MethodologyBlock`. */
export const methodologyBlock = z.strictObject({
  blockRef: z.string().regex(BLOCK_REF),
  ordinal: z.number().int(),
  blockKind: z.enum(["text", "table"]),
  isHeading: z.boolean(),
  sectionBlockRef: z.string().nullable(),
  phaseCode: z.enum(PHASE_CODES).nullable(),
  textEn: z.string(),
  textAr: z.string(),
  arProvisional: z.boolean(),
  guidanceEn: z.string().nullable(),
  guidanceAr: z.string().nullable(),
  linkCount: z.number().int().min(0),
  methodologyVersion: methodologyVersionRef,
});
/** OpenAPI `MethodologyBlockPage`. */
export const methodologyBlockPage = z.strictObject({
  items: z.array(methodologyBlock),
  nextCursor: z.string().nullable(),
});

export type MethodologyBlock = z.infer<typeof methodologyBlock>;

export const blockRefParam = z.strictObject({ blockRef: z.string().regex(BLOCK_REF, "validation.pattern") });

// ------------------------------------------------------------------------------------------------ refusals (ADR-0049 §11)

export function blockNotFound(): HttpProblem {
  return new HttpProblem({
    status: 404,
    type: PROBLEM_TYPES.notFound,
    code: "methodology_block.not_found",
    title: "Not found",
    detail: "This playbook block does not exist.",
  });
}

// ------------------------------------------------------------------------------------------------ the resolved version

/** What every reader route resolves first: the version, and the transformation it was read in (if any). */
export interface ReaderContext {
  readonly version: PinnedVersion;
  readonly transformationId: string | null;
  /** The transformation's resolved target when read with transformationId (transformation.read checked), else null. */
  readonly target: ResolvedTarget | null;
  /** The version's `block.<Bxxxx>` methodology_text elements (stable key -> attributes; removed ones excluded). */
  blockElements(db: DbOrTx): Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
}

/** The latest published `methodology`/`playbook` version, or 404 when none is published. */
async function latestPublishedPlaybook(db: DbOrTx): Promise<PinnedVersion> {
  const v = await db
    .selectFrom("methodology_version")
    .select(["id", "key", "version_no"])
    .where("config_kind", "=", "methodology")
    .where("key", "=", "playbook")
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .limit(1)
    .executeTakeFirst();
  if (v === undefined) throw problems.notFound();
  return { versionId: v.id, key: v.key, versionNo: v.version_no };
}

/**
 * Resolves the reader's version (see the header). With `transformationId` the caller needs transformation.read there
 * (404 otherwise, as for an unknown id); the pin comes from the ConfigResolver.
 */
export async function readerContext(
  db: DbOrTx,
  principal: Principal,
  resolver: ConfigResolver,
  transformationId: string | undefined,
): Promise<ReaderContext> {
  let target: ResolvedTarget | null = null;
  let version: PinnedVersion;
  if (transformationId !== undefined) {
    target = await requireTransformationRead(db, principal, transformationId);
    const pinned = await resolver.pinnedVersion(db, transformationId, "methodology");
    version = { versionId: pinned.versionId, key: pinned.key, versionNo: pinned.versionNo };
  } else {
    version = await latestPublishedPlaybook(db);
  }
  let cached: ReadonlyMap<string, Readonly<Record<string, unknown>>> | null = null;
  return {
    version,
    transformationId: transformationId ?? null,
    target,
    async blockElements(d) {
      if (cached !== null) return cached;
      const elements = await resolver.elements(d, version.versionId, "methodology_text");
      cached = new Map(
        elements.filter((e) => e.stableKey.startsWith("block.")).map((e) => [e.stableKey, e.attributes]),
      );
      return cached;
    },
  };
}

/** 404 methodology_block.not_found unless the block exists. */
export async function requireBlock(db: DbOrTx, blockRef: string): Promise<void> {
  const row = await db
    .selectFrom("playbook_block")
    .select("block_ref")
    .where("block_ref", "=", blockRef)
    .executeTakeFirst();
  if (row === undefined) throw blockNotFound();
}

// ------------------------------------------------------------------------------------------------ resolved links

export const LINK_TARGET_KINDS = ["template", "procedure", "requirement"] as const;
export type LinkTargetKind = (typeof LINK_TARGET_KINDS)[number];

/** The target-key shape of each kind (0089 playbook_block_link_target_shape and the reader guard). */
const LINK_KEY: ReadonlyMap<LinkTargetKind, RegExp> = new Map<LinkTargetKind, RegExp>([
  ["template", /^T(0[1-9]|1[0-6])$/],
  ["requirement", /^REQ-[A-Z0-9]+-[0-9]{3}$/],
  ["procedure", /^[a-z][a-z0-9_]{0,62}$/],
]);

export interface ResolvedLink {
  readonly targetKind: LinkTargetKind;
  readonly targetKey: string;
  readonly origin: "seed" | "version";
}

type LinkTarget = Pick<ResolvedLink, "targetKind" | "targetKey">;
const sameTarget = (a: LinkTarget, b: LinkTarget) => a.targetKind === b.targetKind && a.targetKey === b.targetKey;

/** The well-formed links of a `linksAdded`/`linksRemoved` attribute (the 0089 guard refuses others; defensive here). */
function linkList(value: unknown): LinkTarget[] {
  if (!Array.isArray(value)) return [];
  const out: LinkTarget[] = [];
  for (const item of value as unknown[]) {
    if (item === null || typeof item !== "object") continue;
    const entries = new Map(Object.entries(item as Record<string, unknown>));
    const kind = LINK_TARGET_KINDS.find((k) => k === entries.get("targetKind"));
    const key = entries.get("targetKey");
    if (kind === undefined || typeof key !== "string") continue;
    if (LINK_KEY.get(kind)?.test(key) === true) out.push({ targetKind: kind, targetKey: key });
  }
  return out;
}

/**
 * The resolved links of the given blocks (all blocks with links when `blockRefs` is omitted) for the version whose
 * `block.<ref>` elements are `elements`: the seeded links in their order, minus the version's `linksRemoved`, then its
 * `linksAdded` that are not already present (origin "version"). ADR-0049 §4.
 */
export async function resolveBlockLinks(
  db: DbOrTx,
  elements: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  blockRefs?: readonly string[],
): Promise<Map<string, ResolvedLink[]>> {
  const out = new Map<string, ResolvedLink[]>();
  if (blockRefs !== undefined && blockRefs.length === 0) return out;
  let q = db
    .selectFrom("playbook_block_link")
    .select(["block_ref", "target_kind", "target_key"])
    .orderBy("block_ref")
    .orderBy("ordinal");
  if (blockRefs !== undefined) q = q.where("block_ref", "in", blockRefs);
  for (const ref of blockRefs ?? []) out.set(ref, []);
  for (const r of await q.execute()) {
    const kind = LINK_TARGET_KINDS.find((k) => k === r.target_kind);
    if (kind === undefined) continue;
    const list = out.get(r.block_ref) ?? [];
    list.push({ targetKind: kind, targetKey: r.target_key, origin: "seed" });
    out.set(r.block_ref, list);
  }
  for (const [stableKey, attributes] of elements) {
    const ref = stableKey.slice("block.".length);
    if (!stableKey.startsWith("block.") || (blockRefs !== undefined && !blockRefs.includes(ref))) continue;
    const a = new Map(Object.entries(attributes));
    const removed = linkList(a.get("linksRemoved"));
    const kept = (out.get(ref) ?? []).filter((l) => !removed.some((x) => sameTarget(x, l)));
    for (const added of linkList(a.get("linksAdded")))
      if (!kept.some((l) => sameTarget(l, added))) kept.push({ ...added, origin: "version" });
    out.set(ref, kept);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ presenter

interface BlockRow {
  readonly block_ref: string;
  readonly ordinal: number;
  readonly block_kind: string;
  readonly is_heading: boolean;
  readonly section_block_ref: string | null;
  readonly phase_code: string | null;
  readonly text_en: string;
  readonly text_ar: string;
  readonly ar_provisional: boolean;
}

const BLOCK_COLUMNS = [
  "block_ref",
  "ordinal",
  "block_kind",
  "is_heading",
  "section_block_ref",
  "phase_code",
  "text_en",
  "text_ar",
  "ar_provisional",
] as const;

const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function presentBlock(
  r: BlockRow,
  ctx: ReaderContext,
  elements: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  linkCount: number,
): MethodologyBlock {
  const guidance = new Map(Object.entries(elements.get(`block.${r.block_ref}`) ?? {}));
  return {
    blockRef: r.block_ref,
    ordinal: r.ordinal,
    blockKind: r.block_kind === "table" ? "table" : "text",
    isHeading: r.is_heading,
    sectionBlockRef: r.section_block_ref,
    phaseCode: PHASE_CODES.find((p) => p === r.phase_code) ?? null,
    textEn: r.text_en,
    textAr: r.text_ar,
    arProvisional: r.ar_provisional,
    guidanceEn: textOrNull(guidance.get("bodyEn")),
    guidanceAr: textOrNull(guidance.get("bodyAr")),
    linkCount,
    methodologyVersion: ctx.version,
  };
}

// ------------------------------------------------------------------------------------------------ routes

const BLOCKS = "/api/v1/methodology/blocks";
const BLOCK = `${BLOCKS}/:blockRef`;
const listQuery = z.strictObject({
  transformationId: uuid.optional(),
  phase: z.enum(PHASE_CODES).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const getQuery = z.strictObject({ transformationId: uuid.optional() });

export function registerMethodologyReaderRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  resolver: ConfigResolver,
): string[] {
  app.get(BLOCKS, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const ctx = await readerContext(db, principalOf(request), resolver, query.transformationId);
    const hash = filterHash({ ...query, versionId: ctx.version.versionId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("playbook_block")
      .select(BLOCK_COLUMNS)
      .orderBy("ordinal")
      .limit(query.limit + 1);
    if (query.phase !== undefined) q = q.where("phase_code", "=", query.phase);
    if (after !== null) q = q.where("ordinal", ">", Number(after[0]));
    const rows = await q.execute();
    const page = paginate(rows, query.limit, (r) => [r.ordinal], hash);
    const elements = await ctx.blockElements(db);
    const links = await resolveBlockLinks(
      db,
      elements,
      page.items.map((r) => r.block_ref),
    );
    return {
      items: page.items.map((r) => presentBlock(r, ctx, elements, links.get(r.block_ref)?.length ?? 0)),
      nextCursor: page.nextCursor,
    };
  });

  app.get(BLOCK, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const { blockRef } = parse(blockRefParam, request.params, "params");
    const query = parseQuery(getQuery, request.query);
    const ctx = await readerContext(db, principalOf(request), resolver, query.transformationId);
    const row = await db
      .selectFrom("playbook_block")
      .select(BLOCK_COLUMNS)
      .where("block_ref", "=", blockRef)
      .executeTakeFirst();
    if (row === undefined) throw blockNotFound();
    const elements = await ctx.blockElements(db);
    const links = await resolveBlockLinks(db, elements, [blockRef]);
    return presentBlock(row, ctx, elements, links.get(blockRef)?.length ?? 0);
  });

  return [`GET ${BLOCKS}`, `GET ${BLOCK}`];
}
