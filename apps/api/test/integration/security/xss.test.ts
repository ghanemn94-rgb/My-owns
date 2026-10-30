// The security suite, clause "XSS in rich text" (T-DG6-BE-E2; ADR-0052 §3, §11; REQ-S16-030; p6-work-split §E/F.8)
// against a real PostgreSQL. The payload set is exactly ADR-0052 §3's six strings. Each is written into:
//   (a) a P5 `rich_text` form field (an extension field of T01, through putFormRecordCustomFields),
//   (b) the T03 `gap` text (createTomGap),
//   (c) an evidence note body (createEvidence, kind note),
//   (d) an inbox-visible title (a meeting action's title, which its owner's inbox shows as messageParams.title).
// For every payload and surface the API accepts it under the free-text rules (none of the six contains a character
// those rules refuse), and the accepted value round-trips BYTE-IDENTICAL in the JSON response of the read: the parsed
// value equals the payload, the raw body carries the payload's own JSON string encoding, and nothing is HTML-encoded
// (`&lt;`, `&gt;`, `&quot;`, `&#`) or stripped. The product stores and returns no HTML (ADR-0052 §3); the web renders
// these values as text nodes (the source scan apps/web/src/security-source-scan.test.ts; QA-D adds the e2e).
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { formsTransformation, seedFormsVersion } from "../../support/forms-fixtures.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "../governance/meeting-fixtures.ts";

/** ADR-0052 §3: the XSS payload set, exactly. */
const XSS_PAYLOADS: readonly string[] = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)>",
  '<a href="javascript:alert(1)">x</a>',
  '"><iframe srcdoc="<script>alert(1)</script>">',
  "{{constructor.constructor('alert(1)')()}}",
];

let api: TestApi;
let w: World;
let x: MeetingWorld;
let office: Session;
let formsT: string;
let t01: string;
let today: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = () => `/api/v1/transformations/${x.transformationId}`;
/** The surfaces whose test passed; the clause line prints only when all four did. */
const passed = new Set<string>();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  today = await businessToday(api);
  // (a) a synthetic published form_schema version with one rich_text extension field on T01, pinned to a fixture
  // transformation (as an approved migration would have left it).
  const v = await seedFormsVersion(api, [
    {
      elementType: "form_field",
      stableKey: "T01.xss_summary",
      attributes: { fieldType: "rich_text", labelEn: "Summary (synthetic)", labelAr: "ملخص (تجريبي)" },
    },
  ]);
  ({ transformationId: formsT, t01 } = await formsTransformation(api, w, w.office.id, v.id));
}, 120_000);
afterAll(() => api?.close());

/**
 * The read returned `payload` byte-identical: parsed equal, the raw JSON carries the payload's own JSON encoding (so
 * no character was escaped into an entity or dropped), and no HTML entity appears anywhere in the body.
 */
function expectVerbatim(res: Res<Body>, value: unknown, payload: string): void {
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
  expect(value).toBe(payload);
  expect(res.raw.body).toContain(JSON.stringify(payload));
  for (const entity of ["&lt;", "&gt;", "&quot;", "&#", "&amp;"]) expect(res.raw.body).not.toContain(entity);
}

describe("XSS in rich text (REQ-S16-030; ADR-0052 §3 payload set)", () => {
  it("(a) a P5 rich_text form field stores and returns each payload verbatim", async () => {
    const url = `/api/v1/transformations/${formsT}/form-records/T01/${t01}/custom-fields`;
    let version = 0;
    for (const payload of XSS_PAYLOADS) {
      const put = await send("PUT", url, {
        session: office,
        headers: ifm(version),
        body: { values: { xss_summary: payload } },
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      version = put.body.version as number;
      const got = await send("GET", url, { session: office });
      expectVerbatim(got, got.body.values.xss_summary, payload);
    }
    passed.add("a");
  });

  it("(b) the T03 gap text stores and returns each payload verbatim", async () => {
    for (const payload of XSS_PAYLOADS) {
      const created = await send("POST", `${T()}/tom-gaps`, {
        session: x.lead.session,
        body: { dimensionCode: "technology", gap: payload },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.gap).toBe(payload);
      const got = await send("GET", `${T()}/tom-gaps/${created.body.id}`, { session: x.auditor.session });
      expectVerbatim(got, got.body.gap, payload);
    }
    passed.add("b");
  });

  it("(c) an evidence note body stores and returns each payload verbatim", async () => {
    for (const [i, payload] of XSS_PAYLOADS.entries()) {
      const created = await send("POST", `${T()}/evidence`, {
        session: x.lead.session,
        body: { kind: "note", title: `Synthetic XSS note ${i + 1}`, noteBody: payload, ownerUserId: x.lead.id },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const got = await send("GET", `${T()}/evidence/${created.body.id}`, { session: x.lead.session });
      expectVerbatim(got, got.body.noteBody, payload);
    }
    passed.add("c");
  });

  it("(d) an inbox-visible title (a meeting action's) reaches its owner's inbox verbatim", async () => {
    const meeting = await send("POST", `${T()}/meetings`, {
      session: x.lead.session,
      body: {
        forumId: x.forums.workstream_review,
        scheduledDate: plusDays(today, 4),
        startTime: "08:30",
        durationMinutes: 45,
      },
    });
    expect(meeting.status, JSON.stringify(meeting.body)).toBe(201);
    for (const payload of XSS_PAYLOADS) {
      const action = await send("POST", `${T()}/meetings/${meeting.body.id}/actions`, {
        session: x.lead.session,
        body: { title: payload, ownerUserId: x.contributor.id, dueDate: plusDays(today, 9) },
      });
      expect(action.status, JSON.stringify(action.body)).toBe(201);
      const register = await send("GET", `${T()}/action-register/${action.body.actionItemId}`, {
        session: x.lead.session,
      });
      expectVerbatim(register, register.body.title, payload);
    }
    // The owner's inbox lists one notification per action, each with the payload as its title parameter.
    const inbox = await send("GET", "/api/v1/me/inbox?limit=50", { session: x.contributor.session });
    expect(inbox.status).toBe(200);
    const titles = (inbox.body.items as Body[])
      .filter((n) => n.messageKey !== "inbox.restricted")
      .map((n) => n.messageParams?.title as string | undefined)
      .filter((t): t is string => t !== undefined && XSS_PAYLOADS.includes(t));
    expect([...titles].sort()).toEqual([...XSS_PAYLOADS].sort());
    for (const payload of XSS_PAYLOADS) expect(inbox.raw.body).toContain(JSON.stringify(payload));
    for (const entity of ["&lt;", "&gt;", "&quot;", "&#"]) expect(inbox.raw.body).not.toContain(entity);
    passed.add("d");
  });

  it("clause summary: every surface passed", () => {
    expect([...passed].sort()).toEqual(["a", "b", "c", "d"]);
    console.log(
      `PASS REQ-S16-030 XSS in rich text: ${XSS_PAYLOADS.length} payloads x 4 surfaces round-trip byte-identical`,
    );
  });
});
