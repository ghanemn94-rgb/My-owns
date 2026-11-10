// The EvidenceTextPort (ADR-0059 §4 item 2; REQ-S17-011; T-DG6-BE-U): the text of an uploaded evidence file, for the
// assistant's data block, read with the SAME authorization as its download (ADR-0051 §4, evidence/access.ts):
//   1. `transformation.read` on the evidence's transformation (else not read),
//   2. the item passes the ADR-0051 §2 sensitivity clause, and
//   3. every benefit or business case it is linked to passes the same clause.
// Only a `text/plain` or `text/csv` file of at most 256 KiB is read: the first 8,000 characters of its bytes decoded as
// STRICT UTF-8 (a decoding error skips the excerpt). P6 extracts no text from PDF, DOCX, XLSX, PPTX or images; such a
// file is reported as `file_type` and cited by title only. The bytes are read through EvidenceStore.get, the store the
// content row names (the API's SelectingEvidenceStore), with no database transaction open.
// The text is UNTRUSTED data: the assistant passes it to the model only as a quoted JSON string value (ADR-0059 §5).
// This module never logs, stores or audits the text (§9 logging rule 2). It is registered by the composition root
// (server.ts) with registerAssistantEvidenceTextPort, because `assistant` may not import `evidence`; the structural
// type below is the port `assistant/retrieval.ts` declares.
import { truncateText } from "@mth/shared/schemas";
import type { Db } from "@mth/db";
import type { Principal } from "../access/index.ts";
import { HttpProblem } from "../platform/index.ts";
import { evidenceReadDecision } from "./access.ts";
import type { EvidenceStore } from "./store.ts";

/** ADR-0059 §4 item 2: the file types whose text is read. */
export const EXCERPT_CONTENT_TYPES: readonly string[] = ["text/plain", "text/csv"];
/** ADR-0059 §4 item 2: at most 256 KiB. */
export const EXCERPT_MAX_BYTES = 256 * 1024;
/** ADR-0059 §4 item 2: the first 8,000 characters. */
export const EXCERPT_MAX_CHARS = 8000;

export type EvidenceExcerpt =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "not_read";
      readonly reason: "file_type" | "too_large" | "decoding" | "no_content" | "not_admitted";
    };

export interface EvidenceTextPort {
  excerpt(principal: Principal, evidenceId: string): Promise<EvidenceExcerpt>;
}

/** The media type without parameters, lower case ("text/plain; charset=utf-8" -> "text/plain"). */
const baseType = (contentType: string) => contentType.split(";")[0]!.trim().toLowerCase();

/** Reads at most `max` bytes; null when the object is longer. */
async function readAtMost(stream: AsyncIterable<Uint8Array>, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > max) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** The port over the API's database handle and evidence store. */
export function createEvidenceTextPort(db: Db, store: EvidenceStore): EvidenceTextPort {
  return {
    async excerpt(principal, evidenceId) {
      const notRead = (reason: Extract<EvidenceExcerpt, { kind: "not_read" }>["reason"]): EvidenceExcerpt => ({
        kind: "not_read",
        reason,
      });
      const located = await db
        .selectFrom("evidence")
        .select(["transformation_id"])
        .where("id", "=", evidenceId)
        .executeTakeFirst();
      if (!located) return notRead("no_content");
      // ADR-0051 §4, the download's decision: 404 (rule 1) is thrown; rules 2 and 3 come back as a refusal.
      try {
        const decision = await evidenceReadDecision(db, principal, located.transformation_id, evidenceId);
        if (decision.refusal !== null) return notRead("not_admitted");
      } catch (err) {
        if (err instanceof HttpProblem && (err.status === 404 || err.status === 403)) return notRead("not_admitted");
        throw err;
      }
      const content = await db
        .selectFrom("evidence as e")
        .innerJoin("evidence_content as c", (j) =>
          j.onRef("c.id", "=", "e.current_content_id").onRef("c.evidence_id", "=", "e.id"),
        )
        .select(["c.storage_key", "c.content_type", "c.size_bytes"])
        .where("e.id", "=", evidenceId)
        .executeTakeFirst();
      if (!content) return notRead("no_content");
      if (!EXCERPT_CONTENT_TYPES.includes(baseType(content.content_type))) return notRead("file_type");
      if (Number(content.size_bytes) > EXCERPT_MAX_BYTES) return notRead("too_large");
      let bytes: Buffer | null;
      try {
        bytes = await readAtMost(await store.get(content.storage_key), EXCERPT_MAX_BYTES);
      } catch {
        return notRead("no_content");
      }
      if (bytes === null) return notRead("too_large");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return notRead("decoding");
      }
      // U+0000 cannot be stored or sent as PostgreSQL text and is never meaningful in a text excerpt.
      return { kind: "text", text: truncateText(text.replace(/\u0000/g, ""), EXCERPT_MAX_CHARS) };
    },
  };
}
