// Suggestions to a draft prefill (ADR-0059 §6, §10; REQ-S17-008 "drafts require a human to save and submit";
// T-DG6-BE-U).
//   POST /api/v1/assistant/suggestions/{suggestionId}/to-draft   takeAssistantSuggestionToDraft
// The rules:
//  - assistant.use (AUD and every caller without it: 403), the caller's OWN suggestion (another user's id: 404), and
//    transformation.read on the suggestion's transformation (else 404). Only a charter or decision-brief suggestion can
//    become a draft (422 assistant.suggestion_not_draftable); then the target's own write permission in that
//    transformation (charter.edit for `charter`, executive_decision.create for `T16`; else 403). A suggestion whose
//    citations the caller can no longer read is withheld (ADR-0059 §9) and is not handed out either (404). Taken once:
//    422 assistant.suggestion_already_taken. If-Match = the suggestion's version (428 missing, 409 stale).
//  - One transaction: the row lock, every check above re-done on the principal reloaded there (commit-time
//    authorization; a grant revoked meanwhile is 403 and nothing is written), `proposed -> taken_to_draft` (0111:
//    final, by the owner only, content immutable) and one audit event `assistant_suggestion.taken_to_draft` with the
//    prior and new version. No remote I/O.
//  - It WRITES NOTHING OUTSIDE assistant_suggestion (and its audit event). It returns a `FormDraftCreate` body: the web
//    client then calls the P5 createFormDraft with the user's own session, which applies the record type's validation
//    and permission, and a human edits, saves and submits the record in the normal editor. The assistant never creates
//    a draft, a record or an approval (ADR-0059 Alternatives 3); nothing here is a G1-G6 business approval.
//  - The draft payload has the P5 form-draft shape (ADR-0041 §5; FormFramework's `sourceFields`): the suggestion's §6
//    fields mapped by the pure table DRAFT_FIELD_MAP to the record's own write-request field names (charterWrite;
//    executiveDecisionCreate). recordId/baseRecordVersion name the transformation's charter when one exists (else
//    null: the charter is created by the human); a decision brief is always a new T16 decision (null).
import { sql, type DbOrTx, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { record as audit } from "../audit/index.ts";
import {
  auditContextOf,
  commitTimeDenial,
  holdsAnywhere,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireRead,
  type Principal,
} from "../access/index.ts";
import { etag, parse, problems, requireIfMatch, type ModuleDeps } from "../platform/index.ts";
import {
  assistantSuggestionView,
  readableRecordKeys,
  toSuggestionView,
  USE,
  type AssistantSuggestionView,
} from "./conversations.ts";
import type { Citation } from "./provider.ts";

const TO_DRAFT = "/api/v1/assistant/suggestions/:suggestionId/to-draft";

/** The record types a suggestion can become a draft of, and the write permission of each (ADR-0059 §6, §10). */
export const DRAFT_TARGET_PERMISSION: Readonly<Record<"charter" | "T16", Permission>> = {
  charter: "charter.edit",
  T16: "executive_decision.create",
};

/**
 * The pure field-mapping table (ADR-0059 §6): a suggestion's field key -> the record's write-request field name, which
 * is the P5 form-draft `sourceFields` key. Charter: `charterWrite` (packages/shared/src/schemas/charter.ts). T16: the
 * executive decision's create/update request (executive-decisions.ts), whose form columns (0068 `form_field`, T16) are
 * `decision`, `why_now`, `recommendation` and `impact_if_delayed`. No key is a money, rate, FTE, KPI, date, owner or
 * option field.
 */
export const DRAFT_FIELD_MAP: Readonly<Record<"charter" | "T16", Readonly<Record<string, string>>>> = {
  charter: {
    case_for_change: "caseForChange",
    in_scope: "inScope",
    out_of_scope: "outOfScope",
    governance_forum: "governanceForum",
    decision_rights: "decisionRights",
    success_definition: "successDefinition",
    thesis_change: "thesisChange",
    thesis_outcomes: "thesisOutcomes",
    thesis_benefits: "thesisBenefits",
    thesis_because: "thesisBecause",
  },
  T16: {
    decision: "title",
    why_now: "whyNow",
    recommendation: "recommendation",
    impact_if_delayed: "impactOfDelay",
  },
};

/** The P5 form-draft payload of a suggestion's fields (unknown keys cannot occur: 0111 checks them; they are skipped). */
export function draftPayloadOf(
  target: "charter" | "T16",
  fields: Readonly<Record<string, string>>,
): { sourceFields: Record<string, string> } {
  const map = new Map(Object.entries(target === "charter" ? DRAFT_FIELD_MAP.charter : DRAFT_FIELD_MAP.T16));
  const mapped: [string, string][] = [];
  for (const [key, value] of Object.entries(fields)) {
    const name = map.get(key);
    if (name !== undefined) mapped.push([name, value]);
  }
  return { sourceFields: Object.fromEntries(mapped) };
}

// ------------------------------------------------------------------------------------------------ schemas (mirrors)

const uuidString = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** Mirrors FormDraftCreate. */
const formDraftCreateView = z.strictObject({
  recordType: z.string().regex(/^(T(0[1-9]|1[0-6])|[a-z][a-z0-9_]{1,39})$/),
  recordId: uuidString.nullable().optional(),
  baseRecordVersion: z.number().int().min(1).nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
});
/** Mirrors AssistantTakeToDraftResult. */
export const assistantTakeToDraftResult = z.strictObject({
  suggestion: assistantSuggestionView,
  transformationId: uuidString,
  draft: formDraftCreateView,
});
export type AssistantTakeToDraftResult = z.infer<typeof assistantTakeToDraftResult>;

const idParams = z.strictObject({ suggestionId: uuidString });

// ------------------------------------------------------------------------------------------------ refusals (§10)

/** ADR-0059 §10, verbatim. */
export const assistantSuggestionRefusals = {
  notDraftable: () =>
    problems.businessRule(
      "assistant.suggestion_not_draftable",
      "This suggestion is advice. Only a charter or decision-brief suggestion can become a draft.",
    ),
  alreadyTaken: () =>
    problems.businessRule("assistant.suggestion_already_taken", "This suggestion was already turned into a draft."),
} as const;

// ------------------------------------------------------------------------------------------------ the checks

type SuggestionRow = Awaited<ReturnType<typeof loadOwn>>;

async function loadOwn(db: DbOrTx, principal: Principal, id: string, lock: boolean) {
  let q = db
    .selectFrom("assistant_suggestion")
    .selectAll()
    .where("id", "=", id)
    .where("owner_user_id", "=", principal.userId!);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

const citationsOf = (value: unknown): Citation[] => (Array.isArray(value) ? (value as Citation[]) : []);

/**
 * Every check of the operation for `principal`, in the order of the ADR-0059 §10 table: assistant.use (403), own
 * suggestion (404), transformation.read (404), readable citations (404, the read-time rule of §9), draftable (422),
 * the target's write permission (403), not yet taken (422). Returns the target.
 */
async function check(db: DbOrTx, principal: Principal, row: SuggestionRow): Promise<"charter" | "T16"> {
  const target = await requireRead(db, principal, "transformation.read", {
    type: "transformation",
    id: row.transformation_id,
  });
  const citations = citationsOf(row.citations);
  const readable = await readableRecordKeys(db, principal, citations);
  if (citations.some((c) => c.source === "record" && !readable.has(`${c.recordType}:${c.recordId}`)))
    throw problems.notFound();
  const kind = row.target_record_type;
  if (kind !== "charter" && kind !== "T16") throw assistantSuggestionRefusals.notDraftable();
  await requireAction(
    db,
    principal,
    kind === "charter" ? DRAFT_TARGET_PERMISSION.charter : DRAFT_TARGET_PERMISSION.T16,
    target,
  );
  if (row.status !== "proposed") throw assistantSuggestionRefusals.alreadyTaken();
  return kind;
}

function requireUse(principal: Principal): void {
  if (principal.userId === null || !holdsAnywhere(principal, USE)) throw problems.forbidden();
}

const allReadable = (): boolean => true;

// ------------------------------------------------------------------------------------------------ the route

/** Registers takeAssistantSuggestionToDraft and returns it as "METHOD /path". */
export function registerAssistantSuggestionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.post(TO_DRAFT, { config: { access: { permission: USE } } }, async (request: FastifyRequest, reply) => {
    const { suggestionId } = parse(idParams, request.params, "params");
    const principal = principalOf(request);
    requireUse(principal);
    const expected = requireIfMatch(request);
    // Request-start checks (so a refusal is answered before any lock is taken).
    await check(db, principal, await loadOwn(db, principal, suggestionId, false));

    const result = await db.transaction().execute(async (tx: Tx) => {
      const row = await loadOwn(tx, principal, suggestionId, true);
      const fresh = await refreshPrincipal(tx, request);
      let kind: "charter" | "T16";
      try {
        requireUse(fresh);
        if (fresh.userId !== row.owner_user_id) throw problems.notFound();
        kind = await check(tx, fresh, row);
      } catch (err) {
        // A grant revoked while the request waited: 403 with the denial, nothing written (commit-time authorization).
        throw commitTimeDenial(err);
      }
      if (row.version !== expected) throw problems.versionConflict(row.version);
      const me = fresh.userId!;
      const next = await tx
        .updateTable("assistant_suggestion")
        .set({
          status: "taken_to_draft",
          taken_at: sql<Date>`clock_timestamp()`,
          taken_by: me,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`clock_timestamp()`,
          updated_by: me,
        })
        .where("id", "=", row.id)
        .where("version", "=", row.version)
        .returningAll()
        .executeTakeFirst();
      if (!next) throw problems.versionConflict(row.version);
      await audit(tx, auditContextOf(request), {
        action: "assistant_suggestion.taken_to_draft",
        recordType: "assistant_suggestion",
        recordId: next.id,
        organizationId: next.organization_id,
        transformationId: next.transformation_id,
        priorVersion: row.version,
        newVersion: next.version,
        changes: {
          status: { from: row.status, to: next.status },
          target_record_type: { from: null, to: kind },
        },
      });
      // The charter the draft starts from, read in the same transaction (a charter is one per transformation).
      const charter =
        kind === "charter"
          ? await tx
              .selectFrom("charter")
              .select(["id", "version"])
              .where("transformation_id", "=", next.transformation_id)
              .executeTakeFirst()
          : undefined;
      return { next, kind, charter };
    });

    const { next, kind, charter } = result;
    const suggestion: AssistantSuggestionView = toSuggestionView(next, allReadable, false);
    reply.header("ETag", etag(next.version));
    return reply.code(200).send({
      suggestion,
      transformationId: next.transformation_id,
      draft: {
        recordType: kind,
        recordId: charter?.id ?? null,
        baseRecordVersion: charter?.version ?? null,
        payload: draftPayloadOf(kind, (next.fields as Record<string, string> | null) ?? {}),
      },
    });
  });
  return [`POST ${TO_DRAFT}`];
}
