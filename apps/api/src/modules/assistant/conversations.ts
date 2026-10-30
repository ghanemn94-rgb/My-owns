// Assistant conversations and messages (ADR-0059 §9, §10; REQ-S17-007, REQ-S17-009, REQ-S17-010; T-DG6-BE-T).
//   GET  /api/v1/assistant/conversations                            listAssistantConversations  (own only; on or off)
//   POST /api/v1/assistant/conversations                            createAssistantConversation (422 when off)
//   GET  /api/v1/assistant/conversations/{conversationId}           getAssistantConversation    (own only; re-checked)
//   POST /api/v1/assistant/conversations/{conversationId}/messages  postAssistantMessage        (rate-limit class)
// The rules:
//  - assistant.use (every seeded role except AUD; AUD gets 403 on every route here, REQ-S10-001). Only the owner sees a
//    conversation: another user's id is 404, never 403, so ids cannot be probed. A focus transformation needs
//    transformation.read (else 404). assistant.use grants no record access: what is shown is re-checked below.
//  - Off means no call: postAssistantMessage reads the setting BEFORE anything else and answers 422 assistant.disabled
//    when providerFor returns null; createAssistantConversation refuses the same way. Reading works when off.
//  - postAssistantMessage (§9): transaction 1 appends the prompt (and, first, an `interrupted` reply for a turn that
//    never got one, when awaiting_since is older than request_timeout_ms + 60 s); then, OUTSIDE any transaction, the
//    answer seam (answer.ts: guardrails -> retrieval -> provider, BE-U; BE-T's stub answers no_sources); then
//    transaction 2 appends the reply and its suggestions. No remote I/O inside a transaction (§2 rule 4). Each
//    transaction re-checks assistant.use and ownership at commit time; each conversation version has one audit event.
//  - Read-time re-check (§9): every record citation is checked through ReadScope (transformation.read, the read
//    permission of every search record view, with the ADR-0051 §2 sensitivity clause) for the caller at read time. An
//    answer citing a record the caller can no longer read is returned with content null, contentWithheld true and that
//    citation readable false; its suggestions are withheld the same way. A record no longer in the search index is
//    treated as unreadable (fail closed).
//  - Logging (§9 rule 3): one line per post with ids, kinds, codes, counts and latency; never prompt, answer or record
//    text. Audit events carry ids, versions, kinds, codes and citation counts; never message text or a credential.
// The assistant writes only its own tables and their audit events; nothing here approves anything (G1-G6) or touches
// DG0-DG7.
import { freeText } from "@mth/shared/schemas";
import { sql, type DbOrTx, type Expression, type SqlBool, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import type { AssistantConversationTable, AssistantMessageTable, AssistantSuggestionTable } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record as audit } from "../audit/index.ts";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  holdsAnywhere,
  principalOf,
  readScopeFor,
  refreshPrincipal,
  type Principal,
  type ReadScopeColumns,
} from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  encodeCursor,
  etag,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  parse,
  parseBody,
  parseQuery,
  problems,
  rateLimitClass,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import { answer, type AnswerOutcome, type SuggestionDraft } from "./answer.ts";
import { assistantSecretProviders, CITABLE_RECORD_TYPES, providerFor, type Citation } from "./provider.ts";
import { loadSetting } from "./settings.ts";

export const USE: Permission = "assistant.use";
const READ_RECORDS: Permission = "transformation.read";
const JSON_BODY = ["application/json"] as const;

const LIST = "/api/v1/assistant/conversations";
const ITEM = "/api/v1/assistant/conversations/:conversationId";
const MESSAGES = "/api/v1/assistant/conversations/:conversationId/messages";

/** ADR-0059 §9: at most 100 messages; a post needs room for the prompt and its reply. */
export const MAX_MESSAGES = 100;
/** A reply awaited longer than request_timeout_ms + this is recovered as `interrupted` (§9 step 1). */
export const INTERRUPTED_GRACE_MS = 60_000;
/** History sent with a prompt: at most the last 6 prompts and answers (§5). */
export const HISTORY_LIMIT = 6;

type ConversationRow = Selectable<AssistantConversationTable>;
type MessageRow = Selectable<AssistantMessageTable>;
type SuggestionRow = Selectable<AssistantSuggestionTable>;

// ------------------------------------------------------------------------------------------------ schemas (mirrors)

const uuidString = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const timestamp = z.string().min(1);

export const assistantConversationView = z.strictObject({
  id: uuidString,
  organizationId: uuidString,
  ownerUserId: uuidString,
  transformationId: uuidString.nullable(),
  title: z.string().min(1).max(200),
  messageCount: z.number().int().min(0).max(100),
  awaitingReply: z.boolean(),
  lastMessageAt: timestamp.nullable(),
  version: z.number().int().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const assistantConversationPage = z.strictObject({
  items: z.array(assistantConversationView),
  nextCursor: z.string().nullable(),
});
const recordCitationView = z.strictObject({
  source: z.literal("record"),
  recordType: z.enum(CITABLE_RECORD_TYPES),
  recordId: uuidString,
  recordVersion: z.number().int().min(1),
  readable: z.boolean(),
});
const playbookCitationView = z.strictObject({
  source: z.literal("playbook"),
  blockRef: z.string().regex(/^B0[0-9]{3}$/),
  playbookVersion: z.literal("1.0"),
});
export const assistantCitationView = z.union([recordCitationView, playbookCitationView]);
export const assistantMessageView = z.strictObject({
  id: uuidString,
  conversationId: uuidString,
  seq: z.number().int().min(1).max(100),
  author: z.enum(["user", "assistant"]),
  label: z.enum(["user_prompt", "assistant_suggestion"]),
  replyKind: z.enum(["answer", "refusal", "no_sources", "unavailable", "interrupted"]).nullable(),
  refusalCode: z
    .enum([
      "assistant.refused.approval",
      "assistant.refused.benefit_validation",
      "assistant.refused.value_change",
      "assistant.refused.evidence",
    ])
    .nullable(),
  errorCode: z
    .enum([
      "assistant.provider_timeout",
      "assistant.provider_unreachable",
      "assistant.provider_error",
      "assistant.provider_response_invalid",
    ])
    .nullable(),
  content: z.string().max(8000).nullable(),
  contentWithheld: z.boolean(),
  citations: z.array(assistantCitationView).max(20),
  providerKind: z.enum(["http_endpoint", "test_adapter"]).nullable(),
  modelName: z.string().nullable(),
  settingVersion: z.number().int().min(1).nullable(),
  latencyMs: z.number().int().min(0).nullable(),
  createdAt: timestamp,
});
export const assistantSuggestionView = z.strictObject({
  id: uuidString,
  conversationId: uuidString,
  messageId: uuidString,
  transformationId: uuidString,
  ordinal: z.number().int().min(1).max(5),
  kind: z.enum(["charter_draft", "decision_brief_draft", "recovery_action", "missing_evidence"]),
  label: z.literal("assistant_suggestion"),
  targetRecordType: z.enum(["charter", "T16"]).nullable(),
  fields: z.record(z.string(), z.string().min(1).max(4000)).nullable(),
  textContent: z.string().max(4000).nullable(),
  contentWithheld: z.boolean(),
  citations: z.array(assistantCitationView).min(1).max(20),
  status: z.enum(["proposed", "taken_to_draft"]),
  takenAt: timestamp.nullable(),
  version: z.number().int().min(1),
  createdAt: timestamp,
});
export const assistantConversationDetail = z.strictObject({
  conversation: assistantConversationView,
  messages: z.array(assistantMessageView).max(100),
  suggestions: z.array(assistantSuggestionView),
});
export const assistantMessagePostResult = z.strictObject({
  conversation: assistantConversationView,
  userMessage: assistantMessageView,
  reply: assistantMessageView,
  suggestions: z.array(assistantSuggestionView).max(5),
});
export type AssistantConversationView = z.infer<typeof assistantConversationView>;
export type AssistantMessageView = z.infer<typeof assistantMessageView>;
export type AssistantSuggestionView = z.infer<typeof assistantSuggestionView>;

const createBody = z.strictObject({ title: freeText(1, 200), transformationId: uuidString.nullable().optional() });
const messageBody = z.strictObject({ content: freeText(1, 4000) });
const idParams = z.strictObject({ conversationId: uuidString });
const listQuery = z.strictObject({ transformationId: uuidString.optional(), cursor: cursorSchema, limit: limitSchema });

// ------------------------------------------------------------------------------------------------ refusals (§10)

const rule = (code: string, detail: string) =>
  new HttpProblem({ status: 422, type: PROBLEM_TYPES.validation, code, title: "Business rule violated", detail });

/** The exact refusals of ADR-0059 §10 used by the conversation routes. */
export const assistantConversationRefusals = {
  disabled: () => rule("assistant.disabled", "The assistant is turned off. Every other feature works without it."),
  conversationFull: () =>
    rule("assistant.conversation_full", "This conversation has reached 100 messages. Start a new conversation."),
  replyPending: () =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "assistant.reply_pending",
      title: "Reply pending",
      detail:
        "The assistant is still answering your previous message. Wait for the answer, then send your next message.",
    }),
} as const;

// ------------------------------------------------------------------------------------------------ views

export function toConversationView(row: ConversationRow): AssistantConversationView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    transformationId: row.transformation_id,
    title: row.title,
    messageCount: row.message_count,
    awaitingReply: row.awaiting_reply,
    lastMessageAt: isoOrNull(row.last_message_at),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const citationsOf = (value: unknown): Citation[] => (Array.isArray(value) ? (value as Citation[]) : []);
const recordKey = (c: { recordType: string; recordId: string }) => `${c.recordType}:${c.recordId}`;

type Readable = (c: Citation) => boolean;

function citationViews(citations: readonly Citation[], readable: Readable) {
  return citations.map((c) =>
    c.source === "record"
      ? {
          source: "record" as const,
          recordType: c.recordType,
          recordId: c.recordId,
          recordVersion: c.recordVersion,
          readable: readable(c),
        }
      : { source: "playbook" as const, blockRef: c.blockRef, playbookVersion: c.playbookVersion },
  );
}

const withheld = (citations: readonly Citation[], readable: Readable) => citations.some((c) => !readable(c));

export function toMessageView(row: MessageRow, readable: Readable): AssistantMessageView {
  const citations = citationsOf(row.citations);
  const hide = row.author === "assistant" && withheld(citations, readable);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    author: row.author as AssistantMessageView["author"],
    label: row.author === "user" ? "user_prompt" : "assistant_suggestion",
    replyKind: row.reply_kind as AssistantMessageView["replyKind"],
    refusalCode: row.refusal_code as AssistantMessageView["refusalCode"],
    errorCode: row.error_code as AssistantMessageView["errorCode"],
    content: hide ? null : row.content,
    contentWithheld: hide,
    citations: citationViews(citations, readable),
    providerKind: row.provider_kind as AssistantMessageView["providerKind"],
    modelName: row.model_name,
    settingVersion: row.setting_version,
    latencyMs: row.latency_ms,
    createdAt: iso(row.created_at),
  };
}

export function toSuggestionView(
  row: SuggestionRow,
  readable: Readable,
  messageWithheld: boolean,
): AssistantSuggestionView {
  const citations = citationsOf(row.citations);
  const hide = messageWithheld || withheld(citations, readable);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    transformationId: row.transformation_id,
    ordinal: row.ordinal,
    kind: row.kind as AssistantSuggestionView["kind"],
    label: "assistant_suggestion",
    targetRecordType: row.target_record_type as AssistantSuggestionView["targetRecordType"],
    fields: hide ? null : ((row.fields as Record<string, string> | null) ?? null),
    textContent: hide ? null : row.text_content,
    contentWithheld: hide,
    citations: citationViews(citations, readable),
    status: row.status as AssistantSuggestionView["status"],
    takenAt: isoOrNull(row.taken_at),
    version: row.version,
    createdAt: iso(row.created_at),
  };
}

// ------------------------------------------------------------------------------------------------ the read-time check

/**
 * The record citations among `citations` that `principal` may read NOW (ADR-0059 §9): the search document of the
 * record passes ReadScope.predicate for transformation.read, with the ADR-0051 §2 sensitivity clause and the named
 * parties of the LIVE source row (the search query's own rule, ADR-0057 §3). Returns the readable keys.
 */
export async function readableRecordKeys(
  db: DbOrTx,
  principal: Principal,
  citations: readonly Citation[],
): Promise<Set<string>> {
  const refs = new Map<string, { recordType: string; recordId: string }>();
  for (const c of citations) if (c.source === "record") refs.set(recordKey(c), c);
  if (refs.size === 0) return new Set();
  const scope = await readScopeFor(db, principal, READ_RECORDS);
  const ref = (c: string) => sql.ref(c) as Expression<string | null>;
  const base: Omit<ReadScopeColumns, "recordType" | "partyUserIds"> = {
    recordId: sql.ref("d.record_id"),
    organizationId: sql.ref("d.organization_id"),
    businessUnitId: sql.ref("t.business_unit_id"),
    transformationId: sql.ref("d.transformation_id"),
  };
  const allowed = sql<SqlBool>`(
    (d.record_type NOT IN ('benefit', 'business_case', 'evidence') AND ${scope.predicate({ ...base, recordType: null })})
    OR (d.record_type = 'benefit' AND ${scope.predicate({
      ...base,
      recordType: "benefit",
      partyUserIds: [ref("sb.owner_user_id"), ref("sb.finance_validator_user_id"), ref("sb.created_by")],
    })})
    OR (d.record_type = 'business_case' AND ${scope.predicate({
      ...base,
      recordType: "business_case",
      partyUserIds: [
        ref("sc.benefit_owner_user_id"),
        ref("sc.initiative_owner_user_id"),
        ref("sc.finance_validator_user_id"),
        ref("sc.created_by"),
      ],
    })})
    OR (d.record_type = 'evidence' AND ${scope.predicate({
      ...base,
      recordType: "evidence",
      partyUserIds: [ref("se.owner_user_id"), ref("se.created_by")],
    })}))`;
  const pairs = [...refs.values()].map((r) => sql`(${r.recordType}::text, ${r.recordId}::uuid)`);
  const rows = await db
    .selectFrom("search_document as d")
    .innerJoin("transformation as t", "t.id", "d.transformation_id")
    .leftJoin("benefit as sb", (j) => j.onRef("sb.id", "=", "d.record_id").on("d.record_type", "=", "benefit"))
    .leftJoin("business_case as sc", (j) =>
      j.onRef("sc.id", "=", "d.record_id").on("d.record_type", "=", "business_case"),
    )
    .leftJoin("evidence as se", (j) => j.onRef("se.id", "=", "d.record_id").on("d.record_type", "=", "evidence"))
    .select(["d.record_type", "d.record_id"])
    .where(sql<SqlBool>`(d.record_type, d.record_id) IN (${sql.join(pairs)})`)
    .where(allowed)
    .execute();
  return new Set(rows.map((r) => `${r.record_type}:${r.record_id}`));
}

/** The `readable` predicate of a set of messages and suggestions, loaded once. */
async function readabilityOf(
  db: DbOrTx,
  principal: Principal,
  rows: readonly { citations: unknown }[],
): Promise<Readable> {
  const keys = await readableRecordKeys(
    db,
    principal,
    rows.flatMap((r) => citationsOf(r.citations)),
  );
  return (c) => c.source !== "record" || keys.has(recordKey(c));
}

// ------------------------------------------------------------------------------------------------ helpers

function requireUse(principal: Principal): void {
  if (principal.userId === null || !holdsAnywhere(principal, USE)) throw problems.forbidden();
}

/** The caller's own conversation, else 404 (another user's id is never revealed). */
async function ownConversation(db: DbOrTx, principal: Principal, id: string, lock = false) {
  let q = db
    .selectFrom("assistant_conversation")
    .selectAll()
    .where("id", "=", id)
    .where("owner_user_id", "=", principal.userId!);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** A focus transformation the caller can read, else 404 (ADR-0059 §10). */
async function requireFocus(db: DbOrTx, principal: Principal, transformationId: string): Promise<void> {
  const decision = await authorize(db, principal, READ_RECORDS, { type: "transformation", id: transformationId });
  if (!decision.allowed || decision.target === null) throw problems.notFound();
}

const microsOf = sql<string>`(extract(epoch from c.updated_at) * 1000000)::bigint::text`;

async function messagesOf(db: DbOrTx, conversationId: string): Promise<MessageRow[]> {
  return db
    .selectFrom("assistant_message")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .orderBy("seq")
    .execute();
}

/** The history of a prompt (§5): the last 6 user prompts and answers before `beforeSeq`; refusals and errors excluded. */
function historyOf(messages: readonly MessageRow[], beforeSeq: number) {
  return messages
    .filter(
      (m) =>
        m.seq < beforeSeq &&
        m.content !== null &&
        (m.author === "user" || (m.author === "assistant" && m.reply_kind === "answer")),
    )
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.author === "user" ? ("user" as const) : ("assistant" as const), content: m.content! }));
}

function localeOf(request: FastifyRequest): "en" | "ar" {
  const header = request.headers["accept-language"];
  return typeof header === "string" && /^\s*ar\b/i.test(header) ? "ar" : "en";
}

/** The reply columns of one outcome (0111 assistant_message_reply_shape). */
function replyColumns(
  outcome: AnswerOutcome | { kind: "interrupted" },
  setting: { version: number; providerKind: string | null; modelName: string | null },
) {
  const none = {
    refusal_code: null,
    error_code: null,
    content: null,
    citations: JSON.stringify([]),
    provider_kind: null,
    model_name: null,
    setting_version: null,
    latency_ms: null,
  };
  switch (outcome.kind) {
    case "interrupted":
      return { ...none, reply_kind: "interrupted" };
    case "refusal":
      return { ...none, reply_kind: "refusal", refusal_code: outcome.refusalCode };
    case "no_sources":
      return { ...none, reply_kind: "no_sources", setting_version: setting.version };
    case "unavailable":
      return {
        ...none,
        reply_kind: "unavailable",
        error_code: outcome.errorCode,
        provider_kind: setting.providerKind,
        model_name: setting.modelName,
        setting_version: setting.version,
        latency_ms: outcome.latencyMs,
      };
    case "answer":
      return {
        ...none,
        reply_kind: "answer",
        content: outcome.content,
        citations: JSON.stringify(outcome.citations),
        provider_kind: setting.providerKind,
        model_name: setting.modelName,
        setting_version: setting.version,
        latency_ms: outcome.latencyMs,
      };
  }
}

/**
 * Appends one message and steps the conversation (0111: every UPDATE appends exactly one message and flips
 * awaiting_reply), with its audit event. Runs inside the caller's transaction, after the row lock.
 */
async function appendMessage(
  tx: Tx,
  request: FastifyRequest,
  conversation: ConversationRow,
  me: string,
  message: { author: "user"; content: string } | { author: "assistant"; columns: ReturnType<typeof replyColumns> },
): Promise<{ conversation: ConversationRow; message: MessageRow }> {
  const userTurn = message.author === "user";
  const next = await tx
    .updateTable("assistant_conversation")
    .set({
      message_count: sql<number>`message_count + 1`,
      awaiting_reply: userTurn,
      awaiting_since: userTurn ? sql<Date>`clock_timestamp()` : null,
      last_message_at: sql<Date>`clock_timestamp()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`clock_timestamp()`,
      updated_by: me,
    })
    .where("id", "=", conversation.id)
    .where("version", "=", conversation.version)
    .returningAll()
    .executeTakeFirst();
  if (!next) throw problems.versionConflict(conversation.version);
  const row = await tx
    .insertInto("assistant_message")
    .values({
      id: uuidv7(),
      conversation_id: conversation.id,
      organization_id: conversation.organization_id,
      seq: next.message_count,
      author: message.author,
      ...(message.author === "user" ? { content: message.content, reply_kind: null } : { ...message.columns }),
      created_by: me,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const citations = citationsOf(row.citations);
  await audit(tx, auditContextOf(request), {
    action: userTurn ? "assistant_conversation.message_posted" : "assistant_conversation.reply_recorded",
    recordType: "assistant_conversation",
    recordId: conversation.id,
    organizationId: conversation.organization_id,
    transformationId: conversation.transformation_id,
    priorVersion: conversation.version,
    newVersion: next.version,
    changes: {
      message_seq: { from: null, to: row.seq },
      ...(userTurn
        ? {}
        : {
            reply_kind: { from: null, to: row.reply_kind },
            code: { from: null, to: row.refusal_code ?? row.error_code },
            citation_count: { from: null, to: citations.length },
          }),
    },
  });
  return { conversation: next, message: row };
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers the conversation routes and returns them as "METHOD /path". */
export function registerAssistantConversationRoutes(app: FastifyInstance, { db, config }: ModuleDeps): string[] {
  const env = { nodeEnv: config.nodeEnv };
  const enabledProvider = async (tx: DbOrTx) => {
    const setting = await loadSetting(tx);
    return { setting, provider: providerFor(setting, assistantSecretProviders(), env) };
  };

  // listAssistantConversations: own only, updatedAt desc then id desc; works on or off.
  app.get(LIST, { config: { access: { permission: USE } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireUse(principal);
    const hash = filterHash({ transformationId: query.transformationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("assistant_conversation as c")
      .selectAll("c")
      .select(microsOf.as("updated_us"))
      .where("c.owner_user_id", "=", principal.userId!);
    if (query.transformationId !== undefined) q = q.where("c.transformation_id", "=", query.transformationId);
    if (after !== null) {
      const [us, id] = after;
      if (
        typeof us !== "string" ||
        !/^[0-9]{1,20}$/.test(us) ||
        typeof id !== "string" ||
        !uuidString.safeParse(id).success
      )
        throw problems.badRequest(
          "validation.cursor",
          "The cursor is invalid or belongs to other filters.",
          "/query/cursor",
        );
      q = q.where(sql<SqlBool>`(${microsOf}::bigint, c.id) < (${us}::bigint, ${id}::uuid)`);
    }
    const rows = await q
      .orderBy("c.updated_at", "desc")
      .orderBy("c.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(({ updated_us: _us, ...row }) => toConversationView(row)),
      nextCursor: rows.length > query.limit && last ? encodeCursor([last.updated_us, last.id], hash) : null,
    };
  });

  // createAssistantConversation: version 1, no message; 422 while the assistant is off.
  app.post(LIST, { config: { access: { permission: USE }, consumes: JSON_BODY } }, async (request, reply) => {
    const principal = principalOf(request);
    requireUse(principal);
    const body = parseBody(createBody, request.body);
    const focus = body.transformationId ?? null;
    if (focus !== null) await requireFocus(db, principal, focus);
    if ((await enabledProvider(db)).provider === null) throw assistantConversationRefusals.disabled();
    const view = await db.transaction().execute(async (tx) => {
      const fresh = await refreshPrincipal(tx, request);
      requireUse(fresh);
      try {
        if (focus !== null) await requireFocus(tx, fresh, focus);
      } catch (err) {
        throw commitTimeDenial(err);
      }
      if ((await enabledProvider(tx)).provider === null) throw assistantConversationRefusals.disabled();
      const me = fresh.userId!;
      const row = await tx
        .insertInto("assistant_conversation")
        .values({
          id: uuidv7(),
          organization_id: fresh.organizationId!,
          owner_user_id: me,
          transformation_id: focus,
          title: body.title,
          created_by: me,
          updated_by: me,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(tx, auditContextOf(request), {
        action: "assistant_conversation.created",
        recordType: "assistant_conversation",
        recordId: row.id,
        organizationId: row.organization_id,
        transformationId: row.transformation_id,
        priorVersion: null,
        newVersion: row.version,
        changes: { transformation_id: { from: null, to: row.transformation_id } },
      });
      return toConversationView(row);
    });
    reply.header("Location", `${LIST}/${view.id}`);
    reply.header("ETag", etag(view.version));
    return reply.code(201).send(view);
  });

  // getAssistantConversation: own only; every citation re-checked for the caller now.
  app.get(ITEM, { config: { access: { permission: USE } } }, async (request, reply) => {
    const { conversationId } = parse(idParams, request.params, "params");
    const principal = principalOf(request);
    requireUse(principal);
    const conversation = await ownConversation(db, principal, conversationId);
    const messages = await messagesOf(db, conversation.id);
    const suggestions = await db
      .selectFrom("assistant_suggestion")
      .selectAll()
      .where("conversation_id", "=", conversation.id)
      .orderBy("created_at")
      .orderBy("ordinal")
      .execute();
    const readable = await readabilityOf(db, principal, [...messages, ...suggestions]);
    const messageViews = messages.map((m) => toMessageView(m, readable));
    const hidden = new Set(messageViews.filter((m) => m.contentWithheld).map((m) => m.id));
    reply.header("ETag", etag(conversation.version));
    return {
      conversation: toConversationView(conversation),
      messages: messageViews,
      suggestions: suggestions.map((s) => toSuggestionView(s, readable, hidden.has(s.message_id))),
    };
  });

  // postAssistantMessage: transaction 1 (the prompt), the answer seam outside any transaction, transaction 2 (reply).
  app.post(
    MESSAGES,
    { config: { access: { permission: USE }, consumes: JSON_BODY, ...rateLimitClass("assistant") } },
    async (request, reply) => {
      const { conversationId } = parse(idParams, request.params, "params");
      const principal = principalOf(request);
      requireUse(principal);
      const body = parseBody(messageBody, request.body);
      const expected = requireIfMatch(request);
      await ownConversation(db, principal, conversationId);
      // Off means no call: the setting is read before anything else is done with the prompt.
      if ((await enabledProvider(db)).provider === null) throw assistantConversationRefusals.disabled();

      // Transaction 1: the prompt (and an `interrupted` reply first for a turn that never got one).
      const first = await db.transaction().execute(async (tx) => {
        let conversation = await ownConversation(tx, principal, conversationId, true);
        const fresh = await refreshPrincipal(tx, request);
        requireUse(fresh);
        if (fresh.userId !== conversation.owner_user_id) throw problems.notFound();
        if (conversation.version !== expected) throw problems.versionConflict(conversation.version);
        const { setting, provider } = await enabledProvider(tx);
        if (provider === null || setting === undefined) throw assistantConversationRefusals.disabled();
        let interrupt = false;
        if (conversation.awaiting_reply) {
          const since = conversation.awaiting_since?.getTime() ?? 0;
          if (Date.now() - since <= setting.request_timeout_ms + INTERRUPTED_GRACE_MS)
            throw assistantConversationRefusals.replyPending();
          interrupt = true;
        }
        if (conversation.message_count > MAX_MESSAGES - 2 - (interrupt ? 1 : 0))
          throw assistantConversationRefusals.conversationFull();
        const me = fresh.userId!;
        if (interrupt) {
          const settingCols = { version: setting.version, providerKind: null, modelName: null };
          conversation = (
            await appendMessage(tx, request, conversation, me, {
              author: "assistant",
              columns: replyColumns({ kind: "interrupted" }, settingCols),
            })
          ).conversation;
        }
        const posted = await appendMessage(tx, request, conversation, me, { author: "user", content: body.content });
        return { ...posted, fresh };
      });

      // Outside any transaction: the setting again (a disable that committed meanwhile stops the call), the history,
      // then the answer seam (guardrails -> retrieval -> provider; BE-U).
      const { setting, provider } = await enabledProvider(db);
      let outcome: AnswerOutcome | { kind: "interrupted"; dataItems: 0; droppedSuggestions: 0 };
      let failure: unknown = null;
      if (provider === null || setting === undefined) {
        outcome = { kind: "interrupted", dataItems: 0, droppedSuggestions: 0 };
      } else {
        const history = historyOf(await messagesOf(db, first.conversation.id), first.message.seq);
        try {
          outcome = await answer({
            db,
            principal: first.fresh,
            conversation: {
              id: first.conversation.id,
              organizationId: first.conversation.organization_id,
              transformationId: first.conversation.transformation_id,
            },
            prompt: body.content,
            history,
            setting,
            provider,
            locale: localeOf(request),
            signal: AbortSignal.timeout(setting.request_timeout_ms + 5_000),
          });
        } catch (err) {
          failure = err;
          outcome = { kind: "interrupted", dataItems: 0, droppedSuggestions: 0 };
        }
      }
      const settingCols = {
        version: setting?.version ?? 1,
        providerKind: provider?.kind ?? null,
        modelName: provider?.modelName ?? null,
      };
      // Suggestions belong to an answer of a conversation with a transformation focus (0111; §5).
      const suggestions: readonly SuggestionDraft[] =
        outcome.kind === "answer" && first.conversation.transformation_id !== null
          ? outcome.suggestions.slice(0, 5)
          : [];

      // Transaction 2: the reply and its suggestions.
      const second = await db.transaction().execute(async (tx) => {
        const conversation = await ownConversation(tx, principal, conversationId, true);
        const fresh = await refreshPrincipal(tx, request);
        requireUse(fresh);
        if (fresh.userId !== conversation.owner_user_id) throw problems.notFound();
        // Another request recovered this turn as interrupted meanwhile: this reply is stale.
        if (conversation.version !== first.conversation.version) throw problems.versionConflict(conversation.version);
        const me = fresh.userId!;
        const appended = await appendMessage(tx, request, conversation, me, {
          author: "assistant",
          columns: replyColumns(outcome, settingCols),
        });
        const stored: SuggestionRow[] = [];
        for (const [index, s] of suggestions.entries()) {
          const row = await tx
            .insertInto("assistant_suggestion")
            .values({
              id: uuidv7(),
              organization_id: conversation.organization_id,
              transformation_id: conversation.transformation_id!,
              conversation_id: conversation.id,
              message_id: appended.message.id,
              owner_user_id: me,
              ordinal: index + 1,
              kind: s.kind,
              target_record_type: s.targetRecordType,
              fields: s.fields === null ? null : JSON.stringify(s.fields),
              text_content: s.textContent,
              citations: JSON.stringify(s.citations),
              created_by: me,
              updated_by: me,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await audit(tx, auditContextOf(request), {
            action: "assistant_suggestion.created",
            recordType: "assistant_suggestion",
            recordId: row.id,
            organizationId: row.organization_id,
            transformationId: row.transformation_id,
            priorVersion: null,
            newVersion: row.version,
            changes: {
              kind: { from: null, to: row.kind },
              message_id: { from: null, to: row.message_id },
              citation_count: { from: null, to: s.citations.length },
            },
          });
          stored.push(row);
        }
        return { ...appended, suggestions: stored, fresh };
      });

      // §9 logging rule 3: ids, kinds, codes, counts and latency only.
      request.log.info(
        {
          assistant: {
            conversationId: second.conversation.id,
            messageSeq: second.message.seq,
            replyKind: second.message.reply_kind,
            providerKind: second.message.provider_kind,
            latencyMs: second.message.latency_ms,
            code: second.message.refusal_code ?? second.message.error_code,
            dataItems: outcome.dataItems,
            droppedSuggestions: outcome.droppedSuggestions,
          },
        },
        "assistant message",
      );
      if (failure !== null) throw failure;

      const readable = await readabilityOf(db, second.fresh, [second.message, ...second.suggestions]);
      const replyView = toMessageView(second.message, readable);
      reply.header("ETag", etag(second.conversation.version));
      return reply.code(201).send({
        conversation: toConversationView(second.conversation),
        userMessage: toMessageView(first.message, readable),
        reply: replyView,
        suggestions: second.suggestions.map((s) => toSuggestionView(s, readable, replyView.contentWithheld)),
      });
    },
  );

  return [`GET ${LIST}`, `POST ${LIST}`, `GET ${ITEM}`, `POST ${MESSAGES}`];
}
