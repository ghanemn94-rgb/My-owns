// Studio element edits in a draft (OpenAPI tag "studio"; ADR-0039 §1, §2, §4, §11, §13; REQ-S06-004, REQ-S06-006;
// p5-work-split §A.2; T-DG5-BE-B):
//   PUT  /admin/methodology-versions/{versionId}/elements/{elementType}/{stableKey}         putConfigElement
//   POST /admin/methodology-versions/{versionId}/elements/{elementType}/{stableKey}/remove  removeConfigElement
// Both need methodology.configure (ADM_METHOD) in the caller's organization, re-checked inside the write transaction
// (commit-time authorization); If-Match is the DRAFT's version (428 missing, 409 stale); lock class `configDraft` on
// "<kind>:<key>"; the invariants (invariants.ts) refuse first with the ADR-0039 §13 codes. Every write recomputes the
// version's content hash, steps the version row back to `editing`, and writes one audit event per row written (the
// element and the version), in the same transaction, with no remote I/O. The response is the draft (ConfigVersion).
// Removing a template or another non-fixed source element is RECORDED (removed = true); the source-coverage check
// then fails and blocks publish (ADR-0039 §2, §6). Removing a phase, gate or TOM dimension is refused.
// A Studio edit is configuration, not a business approval.
import { sql, type Tx } from "@mth/db";
import { configElementPut, configElementType, stableKey as stableKeySchema } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { recomputeContentSha256 } from "./content-hash.ts";
import {
  assertContentEditable,
  loadVersion,
  lockConfigDraft,
  requireStudioWrite,
  toConfigVersion,
  VERSIONS,
  type MethodologyVersionRow,
} from "./drafts.ts";
import { prepareElementPut, prepareElementRemove } from "./invariants.ts";
import { registerMethodologyKindProvider } from "./providers/methodology-kind.ts";

const JSON_BODY = ["application/json"] as const;
const ELEMENT = `${VERSIONS}/:versionId/elements/:elementType/:stableKey`;
const REMOVE = `${ELEMENT}/remove`;
const elementParams = z.strictObject({
  versionId: z.uuid(),
  elementType: configElementType,
  stableKey: stableKeySchema,
});

type ElementParams = z.infer<typeof elementParams>;
type Action = "put" | "remove";

/** Locks the draft, re-reads it for update and checks If-Match and editability (the BE-A order). */
async function lockedDraft(tx: Tx, versionId: string, expected: number): Promise<MethodologyVersionRow> {
  const probe = await loadVersion(tx, versionId);
  await lockConfigDraft(tx, probe.config_kind, probe.key);
  const current = await loadVersion(tx, versionId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  assertContentEditable(current);
  return current;
}

/** Recomputes the hash and steps the draft (stage back to `editing`), with its own audit event. */
async function stepDraft(
  tx: Tx,
  request: FastifyRequest,
  current: MethodologyVersionRow,
  actor: { userId: string; organizationId: string },
  action: Action,
  element: { type: string; stableKey: string },
): Promise<MethodologyVersionRow> {
  const hash = await recomputeContentSha256(tx, current.id);
  const updated = await tx
    .updateTable("methodology_version")
    .set({
      content_sha256: hash,
      // A content change in preview returns the draft to editing (ADR-0039 §1; the 0062 guard requires it).
      draft_stage: "editing",
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: action === "put" ? "methodology_version.element_put" : "methodology_version.element_remove",
    recordType: "methodology_version",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      content_sha256: { from: current.content_sha256, to: hash },
      ...(current.draft_stage !== "editing" ? { draft_stage: { from: current.draft_stage, to: "editing" } } : {}),
      element: { from: null, to: `${element.type}:${element.stableKey}` },
    },
  });
  return updated;
}

async function putElement(tx: Tx, request: FastifyRequest, p: ElementParams): Promise<MethodologyVersionRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.configure");
  const body = parseBody(configElementPut, request.body);
  const expected = requireIfMatch(request);
  const current = await lockedDraft(tx, p.versionId, expected);
  const prepared = await prepareElementPut(tx, current, p.elementType, p.stableKey, body);
  const audit = auditContextOf(request);
  const attributes = JSON.stringify(prepared.attributes);
  if (prepared.existing === undefined) {
    const id = uuidv7();
    await tx
      .insertInto("methodology_element")
      .values({
        id,
        methodology_version_id: current.id,
        element_type: p.elementType,
        stable_key: p.stableKey,
        origin: prepared.origin,
        removed: false,
        ordinal: prepared.ordinal,
        attributes,
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .execute();
    await record(tx, audit, {
      action: "methodology_element.put",
      recordType: "methodology_element",
      recordId: id,
      organizationId: actor.organizationId,
      newVersion: 1,
      changes: {
        element_type: { from: null, to: p.elementType },
        stable_key: { from: null, to: p.stableKey },
        origin: { from: null, to: prepared.origin },
        attributes: { from: null, to: prepared.attributes },
        ordinal: { from: null, to: prepared.ordinal },
      },
    });
  } else {
    const e = prepared.existing;
    const updated = await tx
      .updateTable("methodology_element")
      .set({
        attributes,
        ordinal: prepared.ordinal,
        removed: false, // a put restores an element an earlier edit of this draft removed
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: actor.userId,
      })
      .where("id", "=", e.id)
      .where("version", "=", e.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "methodology_element.put",
      recordType: "methodology_element",
      recordId: e.id,
      organizationId: actor.organizationId,
      priorVersion: e.version,
      newVersion: updated.version,
      changes: {
        attributes: { from: e.attributes, to: prepared.attributes },
        ...(e.ordinal !== prepared.ordinal ? { ordinal: { from: e.ordinal, to: prepared.ordinal } } : {}),
        ...(e.removed ? { removed: { from: true, to: false } } : {}),
      },
    });
  }
  return stepDraft(tx, request, current, actor, "put", { type: p.elementType, stableKey: p.stableKey });
}

async function removeElement(tx: Tx, request: FastifyRequest, p: ElementParams): Promise<MethodologyVersionRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.configure");
  const expected = requireIfMatch(request);
  const current = await lockedDraft(tx, p.versionId, expected);
  const prepared = await prepareElementRemove(tx, current, p.elementType, p.stableKey);
  const audit = auditContextOf(request);
  const e = prepared.existing;
  // Already removed in this draft: nothing changes and nothing is written (no version step, no audit event).
  if (e !== undefined && e.removed) return current;
  if (e === undefined) {
    // A source element without a row in this draft: a row records its removal; its attributes stay the catalogue's.
    const id = uuidv7();
    await tx
      .insertInto("methodology_element")
      .values({
        id,
        methodology_version_id: current.id,
        element_type: p.elementType,
        stable_key: p.stableKey,
        origin: prepared.origin,
        removed: true,
        ordinal: null,
        attributes: "{}",
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .execute();
    await record(tx, audit, {
      action: "methodology_element.remove",
      recordType: "methodology_element",
      recordId: id,
      organizationId: actor.organizationId,
      newVersion: 1,
      changes: {
        element_type: { from: null, to: p.elementType },
        stable_key: { from: null, to: p.stableKey },
        removed: { from: false, to: true },
      },
    });
  } else {
    const updated = await tx
      .updateTable("methodology_element")
      .set({
        removed: true,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: actor.userId,
      })
      .where("id", "=", e.id)
      .where("version", "=", e.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "methodology_element.remove",
      recordType: "methodology_element",
      recordId: e.id,
      organizationId: actor.organizationId,
      priorVersion: e.version,
      newVersion: updated.version,
      changes: { removed: { from: false, to: true } },
    });
  }
  return stepDraft(tx, request, current, actor, "remove", { type: p.elementType, stableKey: p.stableKey });
}

export function registerConfigElementRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // The methodology kind's provider hooks (ADR-0039 §2, §5; registered by BE-B, p5-work-split §A.1).
  registerMethodologyKindProvider();
  const configure = { access: { permission: "methodology.configure" as const } };

  app.put(ELEMENT, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const p = parse(elementParams, request.params, "params");
    const row = await db.transaction().execute((tx) => putElement(tx, request, p));
    return sendVersioned(reply, 200, await toConfigVersion(db, row));
  });

  app.post(REMOVE, { config: configure }, async (request, reply) => {
    const p = parse(elementParams, request.params, "params");
    const row = await db.transaction().execute((tx) => removeElement(tx, request, p));
    return sendVersioned(reply, 200, await toConfigVersion(db, row));
  });

  return [`PUT ${ELEMENT}`, `POST ${REMOVE}`];
}
