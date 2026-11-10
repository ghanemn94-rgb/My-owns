// P6 slice F (T-DG6-BE-D; ADR-0052 §2; REQ-S13-011 "previews are rendered safely (no active content)"):
//   GET /api/v1/transformations/{transformationId}/evidence/{evidenceId}/preview   previewEvidenceContent
// The safe inline preview. 200 only when the current content's detected_type is png, jpeg or gif AND its first bytes
// still carry that type's magic (re-checked on every read); the bytes stream through the API (never an object-store
// URL, ADR-0010 §2) with exactly the ADR-0052 §2 headers: the canonical raster Content-Type, `inline` disposition,
// nosniff, a sandboxing CSP, same-origin CORP and no caching. Everything else is 422 evidence.preview_unavailable: SVG
// (always; an SVG may carry script), PDF, the OOXML types, CSV, TXT, a note or link item, an item without content and
// every file stored before P6 (detected_type NULL). Downloads are unchanged (application/octet-stream + attachment).
// Authorization is ADR-0051 §4 requireEvidenceRead, the same function as the download: 404 out of scope (D-196
// Option A), 403 evidence.parent_forbidden for an in-scope caller not admitted to a sensitive item or parent. A read;
// it changes and approves nothing.
import type { Db } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import { parse, problems } from "../platform/index.ts";
import { requireEvidenceRead } from "./access.ts";
import { matchesRasterMagic, mediaTypeOf } from "./content-policy.ts";
import { EvidenceStoreUnavailable, type EvidenceStore } from "./store.ts";

const PREVIEW = "/api/v1/transformations/:transformationId/evidence/:evidenceId/preview";
const params = z.strictObject({ transformationId: z.uuid(), evidenceId: z.uuid() });
const RASTER = ["png", "jpeg", "gif"] as const;
type Raster = (typeof RASTER)[number];
const isRaster = (t: string | null): t is Raster => t !== null && (RASTER as readonly string[]).includes(t);
/** The longest raster signature (PNG, 8 bytes). */
const MAGIC_BYTES = 8;

/** The exact ADR-0052 §2 preview CSP. */
export const PREVIEW_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";

export const previewUnavailable = () =>
  problems.businessRule("evidence.preview_unavailable", "No preview is available for this file. Download it instead.");

/** `inline; filename="<sanitised>"`: printable ASCII only, quotes and backslashes replaced (no header injection). */
export function inlineDisposition(fileName: string): string {
  return `inline; filename="${fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}"`;
}

/**
 * Reads the stream until it holds MAGIC_BYTES (or ends), and returns those bytes plus a stream that re-yields them
 * followed by the rest, unchanged. `close` releases the underlying stream when the preview is refused.
 */
async function peek(stream: AsyncIterable<Uint8Array>) {
  const reader = ReadableStream.from(stream).getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  let done = false;
  while (length < MAGIC_BYTES) {
    const next = await reader.read();
    if (next.done) {
      done = true;
      break;
    }
    parts.push(next.value);
    length += next.value.byteLength;
  }
  const head = Buffer.concat(parts);
  return {
    head,
    close: async () => {
      if (!done) await reader.cancel();
    },
    // A web ReadableStream (Fastify streams it; node:stream is not on the module allow-list, D-055).
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        if (head.length > 0) controller.enqueue(head);
        if (done) controller.close();
      },
      async pull(controller) {
        if (done) return;
        const next = await reader.read();
        if (next.done) {
          done = true;
          controller.close();
        } else controller.enqueue(next.value);
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    }),
  };
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerEvidencePreviewRoutes(app: FastifyInstance, db: Db, store: EvidenceStore): string[] {
  app.get(PREVIEW, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { transformationId, evidenceId } = parse(params, request.params, "params");
    await requireEvidenceRead(db, principalOf(request), transformationId, evidenceId);
    const content = await db
      .selectFrom("evidence as e")
      .innerJoin("evidence_content as c", (j) =>
        j.onRef("c.id", "=", "e.current_content_id").onRef("c.evidence_id", "=", "e.id"),
      )
      .select(["c.storage_key", "c.file_name", "c.detected_type", "c.content_type"])
      .where("e.id", "=", evidenceId)
      .where("e.transformation_id", "=", transformationId)
      .executeTakeFirst();
    // A note or link item, an item without content, a pre-P6 file (NULL) and every non-raster type: no preview.
    if (!content || !isRaster(content.detected_type)) throw previewUnavailable();
    const type = content.detected_type;
    if (content.content_type !== mediaTypeOf(type)) throw previewUnavailable();
    let stream: AsyncIterable<Uint8Array>;
    try {
      stream = await store.get(content.storage_key);
    } catch (err) {
      if (err instanceof EvidenceStoreUnavailable) throw problems.unavailable();
      throw problems.notFound();
    }
    const peeked = await peek(stream);
    // Re-checked on read: bytes that no longer carry the stored type's magic are never served inline.
    if (!matchesRasterMagic(type, peeked.head)) {
      await peeked.close();
      throw previewUnavailable();
    }
    return reply
      .code(200)
      .header("Content-Type", mediaTypeOf(type))
      .header("Content-Disposition", inlineDisposition(content.file_name))
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", PREVIEW_CSP)
      .header("Cross-Origin-Resource-Policy", "same-origin")
      .header("Cache-Control", "private, no-store")
      .send(peeked.body);
  });
  return ["GET /api/v1/transformations/:transformationId/evidence/:evidenceId/preview"];
}
