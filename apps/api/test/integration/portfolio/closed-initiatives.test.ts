// Closed initiatives are read-only (ADR-0021 §2; p3-work-split §9 item 14; T-DG3-BE-E): once an initiative is
// cancelled (or completed), the writes of its dependent records - T06 scores (BE-D scores.ts), deliverables and
// milestones (BE-C deliverables.ts, milestones.ts) and resource demand (capacity.test.ts) - answer 422
// initiative.read_only after validation and If-Match, and write nothing. Control: the same writes succeed while the
// initiative is open. All data is SYNTHETIC; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";
import { createInitiative } from "../contract/p3-exercises-be-b.ts";
import { cancelInitiative } from "../contract/p3-exercises-be-d.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ok = (res: { status: number; body: Body }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 600)}`).toBe(status);
  return res.body;
};

describe("a cancelled initiative's scores, deliverables and milestones are read-only (422 initiative.read_only)", () => {
  it("every write is refused after cancellation and nothing is written; the same writes succeed while open", async () => {
    const p = await setupP2World(api, w);
    const lead = p.lead.session;
    const ini = await createInitiative(send, p);
    const I = `/api/v1/initiatives/${ini.id}`;
    // Open: the writes succeed (control).
    const score = ok(
      await send("POST", `${I}/scores`, { session: lead, body: { criterionCode: "strategic_fit", score: 4 } }),
      201,
      "score",
    );
    const deliverable = ok(
      await send("POST", `${I}/deliverables`, { session: lead, body: { title: "Synthetic deliverable" } }),
      201,
      "deliverable",
    );
    const milestone = ok(
      await send("POST", `${I}/milestones`, { session: lead, body: { title: "Synthetic milestone" } }),
      201,
      "milestone",
    );

    await cancelInitiative(api, ini.id, p.lead.id);
    const D = `/api/v1/deliverables/${deliverable.id}`;
    const M = `/api/v1/milestones/${milestone.id}`;
    // Sequential (thunks), so the attempts never contend with each other.
    const attempts: [string, () => Promise<{ status: number; body: Body; headers: Record<string, unknown> }>][] = [
      [
        "score create",
        () => send("POST", `${I}/scores`, { session: lead, body: { criterionCode: "financial_value", score: 3 } }),
      ],
      [
        "score update",
        () =>
          send("PATCH", `${I}/scores/strategic_fit`, {
            session: lead,
            headers: ifm(score.version),
            body: { score: 5 },
          }),
      ],
      [
        "deliverable create",
        () => send("POST", `${I}/deliverables`, { session: lead, body: { title: "Synthetic late deliverable" } }),
      ],
      ["deliverable update", () => send("PATCH", D, { session: lead, headers: ifm(1), body: { title: "Renamed" } })],
      ["deliverable submit", () => send("POST", `${D}/submit`, { session: lead, headers: ifm(1), body: {} })],
      [
        "deliverable acceptance",
        () =>
          send("POST", `${D}/acceptance`, {
            session: p.sponsor.session,
            headers: ifm(1),
            body: { result: "accepted" },
          }),
      ],
      [
        "milestone create",
        () => send("POST", `${I}/milestones`, { session: lead, body: { title: "Synthetic late milestone" } }),
      ],
      [
        "milestone update",
        () => send("PATCH", M, { session: lead, headers: ifm(1), body: { forecastDate: "2027-05-31" } }),
      ],
      [
        "milestone approve-date",
        () =>
          send("POST", `${M}/approve-date`, {
            session: lead,
            headers: ifm(1),
            body: { approvedDate: "2027-05-31", reason: "Synthetic." },
          }),
      ],
    ];
    for (const [what, attempt] of attempts) {
      const res = await attempt();
      expect([what, res.status, res.body.code, res.body.detail]).toEqual([
        what,
        422,
        "initiative.read_only",
        "A cancelled initiative is read-only; its card and links can no longer be changed.",
      ]);
      expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
    }
    expect((await send("GET", D, { session: lead })).body.version).toBe(1);
    expect((await send("GET", M, { session: lead })).body.version).toBe(1);
    // If-Match still comes first: a missing one is 428 even on a closed initiative.
    expect((await send("PATCH", M, { session: lead, body: { forecastDate: "2027-05-31" } })).status).toBe(428);
  });
});
