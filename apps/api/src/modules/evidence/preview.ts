// P6 route-file stub (T-DG6-BE-A; p6-plan §5.1, p6-work-split §E/F.1): the safe inline preview of PNG, JPEG and GIF
// evidence content (slice F; ADR-0052 §2). Owned and filled by task BE-D. Until then it registers nothing; its
// registration line already exists in registerEvidenceModule (routes.ts), so the owning task edits only this file (and
// its own tests, pending list and contract exercises). Downloads stay application/octet-stream + attachment.
import type { Db } from "@mth/db";
import type { FastifyInstance } from "fastify";
import type { EvidenceStore } from "./store.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-D fills it). */
export function registerEvidencePreviewRoutes(_app: FastifyInstance, _db: Db, _store: EvidenceStore): string[] {
  return [];
}
