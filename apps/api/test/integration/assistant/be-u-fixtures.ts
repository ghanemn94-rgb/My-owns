// Fixtures of T-DG6-BE-U's assistant suites (retrieval, guardrails, injection, suggestions, no-write; ADR-0059 §4-§8).
// Each suite runs on its OWN scratch database of the run's disposable PostgreSQL (the assistant setting and the search
// index state are installation-wide): two transformations X and Y, each with one record of every indexed type
// (search-fixtures.ts, through the record types' own routes), the index built by the real worker jobs, the assistant
// enabled with the LOCAL TEST ADAPTER (no network), and the two injected retrieval ports registered as server.ts
// registers them. Every value is SYNTHETIC; nothing here grants a business approval (G1-G6) or touches DG0-DG7.
import { sql, type Db } from "@mth/db";
import { expect } from "vitest";
import { testAdapter } from "../../../src/modules/assistant/provider.ts";
import {
  registerAssistantEvidenceTextPort,
  registerAssistantPlaybookPassagePort,
  type PlaybookPassagePort,
} from "../../../src/modules/assistant/retrieval.ts";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { evidenceStoreFor } from "../../../src/modules/evidence/store.ts";
import { createEvidenceTextPort } from "../../../src/modules/evidence/text-excerpt.ts";
import { createPlaybookPassagePort } from "../../../src/modules/methodology/playbook-passages.ts";
import { call, seedWorld, signIn, type Session, type TestApi, type World } from "../../support/harness.ts";
import { seedTwelve, startSearchDb, type FixtureRecord, type SearchDb } from "../search/search-fixtures.ts";
import type { BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

export const S = "/api/v1/admin/assistant";
export const C = "/api/v1/assistant/conversations";
export const ifm = (v: number | string) => ({ "if-match": `"${v}"` });

export interface Side {
  readonly b: BenefitWorld;
  readonly records: FixtureRecord[];
  /** The transformation's lead (TL, scoped to this transformation only). */
  readonly tl: Session;
  readonly word: string;
}

export interface AssistantWorld {
  readonly s: SearchDb;
  readonly api: TestApi;
  readonly w: World;
  readonly admin: Session;
  readonly auditor: Session;
  readonly x: Side;
  readonly y: Side;
  /** How many times retrieval asked the playbook port (a refused prompt never retrieves). */
  passageCalls(): number;
  close(): Promise<void>;
}

/** Turns the assistant on with the local test adapter (installation-wide). */
export async function enableTestAdapter(api: TestApi, admin: Session, maxContextRecords = 8): Promise<void> {
  const current = await loadSetting(api.db);
  if (current?.enabled) {
    const off = await call<Body>(api.app, "POST", `${S}/disable`, {
      session: admin,
      body: { reason: "Synthetic: off" },
      headers: ifm(current.version),
    });
    expect(off.status).toBe(200);
  }
  const now = await loadSetting(api.db);
  const saved = await call<Body>(api.app, "PUT", S, {
    session: admin,
    body: {
      providerKind: "test_adapter",
      endpointUrl: null,
      apiStyle: null,
      modelName: null,
      credentialRef: null,
      authorizationReference: "IT-APPROVAL-SYNTHETIC-BE-U",
      requestTimeoutMs: 30000,
      maxOutputTokens: 1024,
      maxContextRecords,
      reason: "Synthetic: configure",
    },
    headers: ifm(now?.version ?? 0),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const on = await call<Body>(api.app, "POST", `${S}/enable`, {
    session: admin,
    body: { reason: "Synthetic: on" },
    headers: ifm(saved.body.version),
  });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
}

/** A scratch database with X and Y, the index built, the ports registered and the assistant on (test adapter). */
export async function startAssistantWorld(name: string, words: { x: string; y: string }): Promise<AssistantWorld> {
  const s = await startSearchDb(name);
  const api = s.api;
  const w = await seedWorld(api.db);
  const x = await seedTwelve(api, w, words.x);
  const y = await seedTwelve(api, w, words.y);
  await s.reindex();
  const admin = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  // The two injected ports, as the composition root registers them (server.ts; the D-197 precedent).
  let calls = 0;
  const playbook = createPlaybookPassagePort(api.db);
  const counting: PlaybookPassagePort = {
    find(terms, locale, limit) {
      calls += 1;
      return playbook.find(terms, locale, limit);
    },
  };
  const previousEvidence = registerAssistantEvidenceTextPort(
    createEvidenceTextPort(api.db, evidenceStoreFor(api.config.evidenceStorage)),
  );
  const previousPlaybook = registerAssistantPlaybookPassagePort(counting);
  await enableTestAdapter(api, admin);
  testAdapter.reset();
  return {
    s,
    api,
    w,
    admin,
    auditor,
    x: { ...x, tl: x.b.s.tl, word: words.x },
    y: { ...y, tl: y.b.s.tl, word: words.y },
    passageCalls: () => calls,
    async close() {
      registerAssistantEvidenceTextPort(previousEvidence);
      registerAssistantPlaybookPassagePort(previousPlaybook);
      await s.close();
    },
  };
}

/** Creates a conversation (optionally focused on a transformation) and returns its body. */
export async function newConversation(api: TestApi, session: Session, transformationId: string | null): Promise<Body> {
  const res = await call<Body>(api.app, "POST", C, {
    session,
    body: { title: "Synthetic BE-U conversation", ...(transformationId === null ? {} : { transformationId }) },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** Posts one message with the conversation's current version; returns the response. */
export async function ask(
  api: TestApi,
  session: Session,
  conversation: { id: string },
  content: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Body }> {
  const row = await api.db
    .selectFrom("assistant_conversation")
    .select("version")
    .where("id", "=", conversation.id)
    .executeTakeFirstOrThrow();
  return call<Body>(api.app, "POST", `${C}/${conversation.id}/messages`, {
    session,
    body: { content },
    headers: { ...ifm(row.version), ...headers },
  });
}

/** The tables the assistant may write: its own, and the audit trail. Authentication writes its session rows. */
export const ASSISTANT_WRITABLE = new Set([
  "assistant_conversation",
  "assistant_message",
  "assistant_suggestion",
  "audit_event",
]);

/** ADR-0059 §7 item 3: the tables whose full content is hashed (gate, benefit, KPI actual, evidence, decision). */
export const HASHED_TABLES = [
  "gate_instance",
  "gate_submission",
  "gate_submission_criterion",
  "gate_decision",
  "gate_dispensation",
  "benefit",
  "kpi_actual",
  "evidence",
  "evidence_content",
  "evidence_link",
  "decision",
  "form_draft",
  "charter",
] as const;

export interface Snapshot {
  readonly counts: Record<string, number>;
  readonly hashes: Record<string, string>;
}

/**
 * The before/after snapshot of ADR-0059 §7 item 3: the row count of EVERY base table of the public schema except the
 * assistant's own tables and the audit trail, and the md5 of the full content of the gate, benefit, KPI actual,
 * evidence and decision tables (and the form drafts and the charter, which a suggestion must not create or change).
 */
export async function snapshot(db: Db): Promise<Snapshot> {
  const tables = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`.execute(db);
  const counts: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    if (ASSISTANT_WRITABLE.has(table_name)) continue;
    const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(table_name)}`.execute(db);
    counts[table_name] = Number(r.rows[0]!.n);
  }
  const hashes: Record<string, string> = {};
  for (const t of HASHED_TABLES) {
    const r = await sql<{ h: string | null }>`
      SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${sql.table(t)} x`.execute(db);
    hashes[t] = r.rows[0]!.h ?? "";
  }
  return { counts, hashes };
}

/** The ids of a side's records (every indexed type). */
export const idsOf = (side: Side): Set<string> => new Set(side.records.map((r) => r.id));
