// Assistant retrieval and citations (ADR-0059 §4, §5, §9; REQ-S17-007 A12: "with a user scoped to X, an assistant
// query about Y returns no Y content; every answer lists cited record IDs and versions"; T-DG6-BE-U) against a real
// PostgreSQL. The model is the local test adapter (no network): `testAdapter.lastRequest()` is what a model would have
// been sent. All data is SYNTHETIC; nothing approves anything (G1-G6) or touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testAdapter, type QuotedItem } from "../../../src/modules/assistant/provider.ts";
import { queryTerms } from "../../../src/modules/assistant/retrieval.ts";
import { call, createUser, grant, signIn } from "../../support/harness.ts";
import { revokeAll } from "../calendar/session-lock.ts";
import {
  ask,
  C,
  idsOf,
  newConversation,
  startAssistantWorld,
  type AssistantWorld,
  type Body,
} from "./be-u-fixtures.ts";

let a: AssistantWorld;
const X_WORD = "Quorvexalpha";
const Y_WORD = "Zephyrquill";

beforeAll(async () => {
  a = await startAssistantWorld("mth_asst_retr", { x: X_WORD, y: Y_WORD });
}, 240_000);
afterAll(async () => {
  await a.close();
});

const recordItems = (data: readonly QuotedItem[]) => data.filter((d) => d.citation.source === "record");
const recordIdOf = (d: QuotedItem) => (d.citation.source === "record" ? d.citation.recordId : null);

describe("A12: a user scoped to X asking about Y gets no Y content (REQ-S17-007)", () => {
  it("the X lead asks about Y's unique title: no Y record is sent, cited or stored", async () => {
    const yTitle = a.y.records.find((r) => r.type === "initiative")!.title; // "Synthetic Zephyrquill initiative N"
    expect(yTitle).toContain(Y_WORD);
    const conv = await newConversation(a.api, a.x.tl, null);
    testAdapter.reset();
    const res = await ask(a.api, a.x.tl, conv, `Summarize ${yTitle} and the ${X_WORD} initiative`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.reply.replyKind).toBe("answer");

    // What the model would have been sent: X records only (Y filtered by ReadScope at query time).
    const sent = testAdapter.lastRequest()!;
    expect(sent).not.toBeNull();
    const yIds = idsOf(a.y);
    const xIds = idsOf(a.x);
    expect(recordItems(sent.data).length).toBeGreaterThan(0);
    for (const d of recordItems(sent.data)) {
      expect(yIds.has(recordIdOf(d)!)).toBe(false);
      expect(xIds.has(recordIdOf(d)!)).toBe(true);
      expect(d.title).not.toContain(Y_WORD);
      expect(d.text).not.toContain(Y_WORD);
    }
    // The reply's citations and the stored answer.
    for (const c of res.body.reply.citations) if (c.source === "record") expect(yIds.has(c.recordId)).toBe(false);
    expect(res.body.reply.content).not.toContain(Y_WORD);
    const stored = await a.api.db
      .selectFrom("assistant_message")
      .select(["content", "citations"])
      .where("id", "=", res.body.reply.id)
      .executeTakeFirstOrThrow();
    expect(stored.content).not.toContain(Y_WORD);
    expect(JSON.stringify(stored.citations)).not.toMatch(new RegExp([...yIds].join("|")));
  });

  it("control: the Y lead asking the same question does get Y records (the query matches them)", async () => {
    const yTitle = a.y.records.find((r) => r.type === "initiative")!.title;
    const conv = await newConversation(a.api, a.y.tl, null);
    testAdapter.reset();
    const res = await ask(a.api, a.y.tl, conv, `Summarize ${yTitle}`);
    expect(res.status).toBe(201);
    const ids = recordItems(testAdapter.lastRequest()!.data).map(recordIdOf);
    expect(ids).toContain(a.y.records.find((r) => r.type === "initiative")!.id);
    expect(ids.every((id) => idsOf(a.y).has(id!))).toBe(true);
  });

  it("a user with no read anywhere sends nothing to the model (no_sources unless the playbook matches)", async () => {
    // ADM_ACCESS holds assistant.use but no transformation.read: no record can be retrieved.
    const u = await createUser(a.api.db, a.w.orgA.id);
    await grant(a.api.db, a.w.grantor.id, u.id, "ADM_ACCESS", { type: "organization", id: a.w.orgA.id }, a.w.orgA.id);
    const session = await signIn(a.api.app, u.subject);
    const conv = await newConversation(a.api, session, null);
    testAdapter.reset();
    const res = await ask(a.api, session, conv, `Summarize ${Y_WORD} ${X_WORD}`);
    expect(res.status).toBe(201);
    expect(res.body.reply.replyKind).toBe("no_sources");
    expect(res.body.reply.content).toBeNull();
    expect(testAdapter.requestCount()).toBe(0);
  });

  it("a focused conversation retrieves only its transformation's records", async () => {
    const office = await signIn(a.api.app, a.w.office.subject); // TO: reads both X and Y
    const conv = await newConversation(a.api, office, a.x.b.transformationId);
    testAdapter.reset();
    const res = await ask(a.api, office, conv, `Synthetic ${X_WORD} ${Y_WORD} initiative`);
    expect(res.status).toBe(201);
    const ids = recordItems(testAdapter.lastRequest()!.data).map(recordIdOf);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => idsOf(a.x).has(id!))).toBe(true);
  });
});

describe("every answer lists cited record ids and versions (ADR-0059 §5)", () => {
  it("each record citation names a given item with its id and current version; playbook blocks at 1.0", async () => {
    const conv = await newConversation(a.api, a.x.tl, a.x.b.transformationId);
    testAdapter.reset();
    const res = await ask(a.api, a.x.tl, conv, `What is the case for change of the ${X_WORD} transformation?`);
    expect(res.status).toBe(201);
    const reply = res.body.reply;
    expect(reply.replyKind).toBe("answer");
    expect(reply.label).toBe("assistant_suggestion");
    expect(reply.citations.length).toBeGreaterThan(0);
    const sent = testAdapter.lastRequest()!;
    // The test adapter cites every ref; so the citations are exactly the items given, in order.
    expect(reply.citations.length).toBe(sent.data.length);
    expect(sent.data.length).toBeLessThanOrEqual(20);
    for (const c of reply.citations) {
      if (c.source === "record") {
        expect(c.recordId).toMatch(/^[0-9a-f-]{36}$/);
        const doc = await sql<{ record_version: number }>`
          SELECT record_version FROM search_document WHERE record_type = ${c.recordType} AND record_id = ${c.recordId}::uuid`.execute(
          a.api.db,
        );
        expect(c.recordVersion).toBe(doc.rows[0]!.record_version);
        expect(c.readable).toBe(true);
      } else {
        expect(c.blockRef).toMatch(/^B0[0-9]{3}$/);
        expect(c.playbookVersion).toBe("1.0");
      }
    }
    // The playbook explains "case for change": at least one passage was given.
    expect(sent.data.some((d) => d.citation.source === "playbook")).toBe(true);
  });

  it("at most max_context_records records and 3 playbook passages; the prompt's terms only (no operator survives)", async () => {
    expect(queryTerms('approve -gate "G4" OR <script> the of')).toBe("approve or gate or g4 or script");
    expect(queryTerms("the of is ?")).toBeNull();
    expect(queryTerms("x".repeat(500))).toBe("x".repeat(200));
    const conv = await newConversation(a.api, a.x.tl, null);
    testAdapter.reset();
    const res = await ask(a.api, a.x.tl, conv, `Synthetic ${X_WORD} case for change`);
    expect(res.status).toBe(201);
    const data = testAdapter.lastRequest()!.data;
    expect(recordItems(data).length).toBeLessThanOrEqual(8);
    expect(data.filter((d) => d.citation.source === "playbook").length).toBeLessThanOrEqual(3);
    expect(data.map((d) => d.ref)).toEqual(data.map((_, i) => i + 1));
  });

  it("a record item carries the search document's columns only: no money, rate, KPI or FTE value", async () => {
    const conv = await newConversation(a.api, a.x.tl, a.x.b.transformationId);
    testAdapter.reset();
    await ask(a.api, a.x.tl, conv, `${X_WORD} benefit`);
    const benefit = recordItems(testAdapter.lastRequest()!.data).find(
      (d) => d.citation.source === "record" && d.citation.recordType === "benefit",
    );
    expect(benefit).toBeDefined();
    expect(benefit!.text.split("\n").map((l) => l.split(":")[0])).toEqual(expect.arrayContaining(["title"]));
    for (const line of benefit!.text.split("\n"))
      expect(["code", "title", "status", "summary"]).toContain(line.split(":")[0]);
  });
});

describe("a revoked grant withholds an earlier answer (ADR-0059 §9)", () => {
  it("after the X grant is revoked, the stored answer citing X is returned with content null", async () => {
    // A user with TL on X only.
    const u = await createUser(a.api.db, a.w.orgA.id);
    await grant(
      a.api.db,
      a.w.grantor.id,
      u.id,
      "TL",
      { type: "transformation", id: a.x.b.transformationId },
      a.w.orgA.id,
    );
    const session = await signIn(a.api.app, u.subject);
    const conv = await newConversation(a.api, session, null);
    const res = await ask(a.api, session, conv, `Synthetic ${X_WORD} initiative`);
    expect(res.status).toBe(201);
    expect(res.body.reply.replyKind).toBe("answer");
    expect(res.body.reply.contentWithheld).toBe(false);
    // Revoke: end the assignment (as the access admin would); the next read re-checks every citation.
    await revokeAll(a.api, a.w.grantor.id, u.id);
    // The user keeps assistant.use through a role that reads nothing (ADM_METHOD at the organization).
    await grant(a.api.db, a.w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: a.w.orgA.id }, a.w.orgA.id);
    const again = await signIn(a.api.app, u.subject);
    const got = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session: again });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    const reply = got.body.messages.find((m: Body) => m.id === res.body.reply.id);
    expect(reply.content).toBeNull();
    expect(reply.contentWithheld).toBe(true);
    expect(reply.citations.some((c: Body) => c.source === "record" && c.readable === false)).toBe(true);
  });
});
