// The provenance statement, source foundations, custom extensions and the Realize note (OpenAPI tag
// "methodology-reader"; ADR-0049 §5, §10; REQ-PB-001, REQ-PB-077; p5-work-split §I.2; T-DG5-BE-Q2):
//   GET /methodology/provenance?transformationId=   getMethodologyProvenance (session)
//
// Every text is read from the immutable catalogues, VERBATIM from docs/source/playbook.md (0092) and B0156 (0089):
//   statement        B0004 "Practical synthesis inspired by PMI Organizational Transformation, …";
//   connectionNote   B0024 (the PMI/Brightline connection);
//   foundations      the three source_foundation rows (the B0156 table);
//   customExtensions B0157-B0162 ("Custom extensions in this playbook" and its five items);
//   realizeNote      B0124 ("This phase aligns with PMI Benefits Realization Management logic: …").
// The statement itself is never edited. A version may add only a note beside it, through Studio's publish pipeline:
// the `methodology_text` element `provenance.note` (bodyEn/bodyAr; the 0089 reader guard and the API refuse an
// official-PMI or certification claim and any engineering-gate name in it). The response never claims that the
// methodology or the product is an official PMI standard or certified (M0089). Read-only: nothing here writes.
import type { DbOrTx } from "@mth/db";
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import { parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import type { ConfigResolver } from "./config-resolver.ts";
import { methodologyVersionRef, readerContext } from "./reader.ts";

// ------------------------------------------------------------------------------------------------ zod mirrors

/** OpenAPI `SourceBlockText`. */
export const sourceBlockText = z.strictObject({
  blockRef: z.string().regex(/^B0[0-9]{3}$/),
  textEn: z.string(),
  textAr: z.string(),
  arProvisional: z.boolean(),
});
/** OpenAPI `SourceFoundation`. */
export const sourceFoundation = z.strictObject({
  code: z.string(),
  ordinal: z.number().int(),
  sourceEn: z.string(),
  sourceAr: z.string(),
  usedForEn: z.string(),
  usedForAr: z.string(),
  sourceRef: z.string(),
});
/** OpenAPI `ProvenanceNote`. */
export const provenanceNote = z.strictObject({ bodyEn: z.string().nullable(), bodyAr: z.string().nullable() });
/** OpenAPI `MethodologyProvenance`. */
export const methodologyProvenance = z.strictObject({
  statement: sourceBlockText,
  connectionNote: sourceBlockText,
  foundations: z.array(sourceFoundation).max(3),
  customExtensions: z.array(sourceBlockText).max(6),
  realizeNote: sourceBlockText,
  note: provenanceNote.nullable(),
  methodologyVersion: methodologyVersionRef,
});

export type MethodologyProvenance = z.infer<typeof methodologyProvenance>;

// ------------------------------------------------------------------------------------------------ the source blocks

/** The blocks this response quotes (ADR-0049 §5). */
export const PROVENANCE_BLOCKS = {
  statement: "B0004",
  connectionNote: "B0024",
  realizeNote: "B0124",
  customExtensions: ["B0157", "B0158", "B0159", "B0160", "B0161", "B0162"],
} as const;

/** The stable key of a version's provenance note (ADR-0049 §1, §5; the 0089 reader namespace). */
export const PROVENANCE_NOTE_KEY = "provenance.note";

type SourceBlockText = z.infer<typeof sourceBlockText>;

/** The quoted blocks, verbatim, by reference (a missing block is a programming error: the seed has all 165). */
async function quotedBlocks(db: DbOrTx): Promise<ReadonlyMap<string, SourceBlockText>> {
  const refs = [
    PROVENANCE_BLOCKS.statement,
    PROVENANCE_BLOCKS.connectionNote,
    PROVENANCE_BLOCKS.realizeNote,
    ...PROVENANCE_BLOCKS.customExtensions,
  ];
  const rows = await db
    .selectFrom("playbook_block")
    .select(["block_ref", "text_en", "text_ar", "ar_provisional"])
    .where("block_ref", "in", refs)
    .orderBy("ordinal")
    .execute();
  const out = new Map(
    rows.map((r) => [
      r.block_ref,
      { blockRef: r.block_ref, textEn: r.text_en, textAr: r.text_ar, arProvisional: r.ar_provisional },
    ]),
  );
  if (out.size !== refs.length) throw problems.internal();
  return out;
}

const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

// ------------------------------------------------------------------------------------------------ route

const PROVENANCE = "/api/v1/methodology/provenance";
const provenanceQuery = z.strictObject({ transformationId: uuid.optional() });

export function registerMethodologyProvenanceRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  resolver: ConfigResolver,
): string[] {
  app.get(PROVENANCE, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const query = parseQuery(provenanceQuery, request.query);
    const ctx = await readerContext(db, principalOf(request), resolver, query.transformationId);
    const [blocks, foundations, note] = await Promise.all([
      quotedBlocks(db),
      db.selectFrom("source_foundation").selectAll().orderBy("ordinal").execute(),
      resolver.element(db, ctx.version.versionId, "methodology_text", PROVENANCE_NOTE_KEY),
    ]);
    const block = (ref: string): SourceBlockText => {
      const b = blocks.get(ref);
      if (b === undefined) throw problems.internal();
      return b;
    };
    const attrs = new Map(Object.entries(note !== null && !note.removed ? note.attributes : {}));
    const bodyEn = textOrNull(attrs.get("bodyEn"));
    const bodyAr = textOrNull(attrs.get("bodyAr"));
    const body: MethodologyProvenance = {
      statement: block(PROVENANCE_BLOCKS.statement),
      connectionNote: block(PROVENANCE_BLOCKS.connectionNote),
      foundations: foundations.map((f) => ({
        code: f.code,
        ordinal: f.ordinal,
        sourceEn: f.source_en,
        sourceAr: f.source_ar,
        usedForEn: f.used_for_en,
        usedForAr: f.used_for_ar,
        sourceRef: f.source_ref,
      })),
      customExtensions: PROVENANCE_BLOCKS.customExtensions.map(block),
      realizeNote: block(PROVENANCE_BLOCKS.realizeNote),
      note: bodyEn === null && bodyAr === null ? null : { bodyEn, bodyAr },
      methodologyVersion: ctx.version,
    };
    return body;
  });
  return [`GET ${PROVENANCE}`];
}
