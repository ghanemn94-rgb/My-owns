// The escalation rules of slice D (ADR-0032 §8.1, §9, §11; T-DG4-BE-G) against a real PostgreSQL:
//  - listEscalationRules returns both kinds with the code defaults (`isDefault: true`: decision_sla ['SP'];
//    blocker_red 2 cycles, 10 working days, owner SP) until a rule is stored;
//  - createEscalationRule / updateEscalationRule (escalation_rule.configure: TL, TO): the shape rule (422
//    escalation_rule.shape), known parties (422 forum.party_unknown), one per kind (409 escalation_rule.exists),
//    If-Match 428/409, 404 for a kind without a stored rule, audited; AUD and SP 403, ADM-only and outside 404;
//  - the T16, escalation and blocker lines of the slice D database mapper (platform/db-errors.ts; the last lines).
// All data is SYNTHETIC; a rule escalates and never decides; nothing touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/index.ts";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
}, 120_000);
afterAll(() => api.close());

const R = () => `/api/v1/transformations/${x.transformationId}/escalation-rules`;

describe("escalation rules (ADR-0032 §8.1)", () => {
  it("defaults are listed with isDefault until a rule is stored", async () => {
    const res = await send("GET", R(), { session: x.auditor.session });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: null,
          ruleKind: "decision_sla",
          isDefault: true,
          enabled: true,
          escalationChain: ["SP"],
          redCycles: null,
          deadlineWorkingDays: null,
          ownerPartyCode: null,
          version: null,
          createdAt: null,
          updatedAt: null,
        },
        {
          id: null,
          ruleKind: "blocker_red",
          isDefault: true,
          enabled: true,
          escalationChain: null,
          redCycles: 2,
          deadlineWorkingDays: 10,
          ownerPartyCode: "SP",
          version: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      nextCursor: null,
    });
    expect((await send("GET", R(), { session: x.admin })).status).toBe(404);
  });

  it("the shape rule, known parties and one rule per kind; nothing written on a refusal", async () => {
    const shape = [
      { ruleKind: "decision_sla" },
      { ruleKind: "decision_sla", escalationChain: ["SP"], redCycles: 3 },
      { ruleKind: "blocker_red", redCycles: 3, deadlineWorkingDays: 5 },
      { ruleKind: "blocker_red", escalationChain: ["SP"], redCycles: 3, deadlineWorkingDays: 5, ownerPartyCode: "SP" },
    ];
    for (const body of shape) {
      const res = await send("POST", R(), { session: x.office.session, body });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "escalation_rule.shape",
        "A decision-SLA rule takes an escalation chain only; a blocker rule takes red cycles (2–12), a deadline in working days and an owner role.",
      ]);
    }
    const tooFew = await send("POST", R(), {
      session: x.office.session,
      body: { ruleKind: "blocker_red", redCycles: 1, deadlineWorkingDays: 5, ownerPartyCode: "SP" },
    });
    expect(tooFew.status).toBe(400);
    const party = await send("POST", R(), {
      session: x.office.session,
      body: { ruleKind: "decision_sla", escalationChain: ["SP", "NOPE"] },
    });
    expect([party.status, party.body.code, party.body.errors[0].pointer, party.body.detail]).toEqual([
      422,
      "forum.party_unknown",
      "/escalationChain/1",
      "NOPE is not a known governance role.",
    ]);
    const stored = await api.db
      .selectFrom("governance_escalation_rule")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .execute();
    expect(stored).toEqual([]);
  });

  it("TO stores a blocker rule (201, version 1, audited); a second of the kind is 409; TL updates it with If-Match", async () => {
    const created = await send("POST", R(), {
      session: x.office.session,
      body: { ruleKind: "blocker_red", redCycles: 3, deadlineWorkingDays: 5, ownerPartyCode: "BO" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect([created.headers.etag, created.headers.location]).toEqual(['"1"', `${R()}/blocker_red`]);
    expect([created.body.isDefault, created.body.redCycles, created.body.ownerPartyCode, created.body.version]).toEqual(
      [false, 3, "BO", 1],
    );
    const again = await send("POST", R(), {
      session: x.lead.session,
      body: { ruleKind: "blocker_red", redCycles: 4, deadlineWorkingDays: 5, ownerPartyCode: "SP" },
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      409,
      "escalation_rule.exists",
      "A rule of this kind already exists in this transformation; update it instead.",
    ]);
    const U = `${R()}/blocker_red`;
    expect((await send("PATCH", U, { session: x.lead.session, body: { redCycles: 4 } })).status).toBe(428);
    expect((await send("PATCH", U, { session: x.lead.session, headers: ifm(7), body: { redCycles: 4 } })).status).toBe(
      409,
    );
    const wrong = await send("PATCH", U, {
      session: x.lead.session,
      headers: ifm(1),
      body: { escalationChain: ["SP"] },
    });
    expect([wrong.status, wrong.body.code]).toEqual([422, "escalation_rule.shape"]);
    const ok = await send("PATCH", U, {
      session: x.lead.session,
      headers: ifm(1),
      body: { redCycles: 4, enabled: false },
    });
    expect([ok.status, ok.body.redCycles, ok.body.enabled, ok.body.version, ok.headers.etag]).toEqual([
      200,
      4,
      false,
      2,
      '"2"',
    ]);
    const missing = await send("PATCH", `${R()}/decision_sla`, {
      session: x.lead.session,
      headers: ifm(1),
      body: { enabled: false },
    });
    expect(missing.status).toBe(404);
    const listed = await send("GET", R(), { session: x.auditor.session });
    expect(listed.body.items.map((r: Body) => [r.ruleKind, r.isDefault])).toEqual([
      ["decision_sla", true],
      ["blocker_red", false],
    ]);
    expect((await auditOf(api.db, created.body.id)).map((e) => [e.action, e.actor_user_id])).toEqual([
      ["escalation_rule.create", x.office.id],
      ["escalation_rule.update", x.lead.id],
    ]);
  });

  it("negative: AUD and SP 403, ADM-only and another organization 404", async () => {
    const outsider = await signIn(api.app, w.officeB.subject);
    const body = { ruleKind: "decision_sla", escalationChain: ["SP"] };
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.sponsor.session, 403],
      [x.admin, 404],
      [outsider, 404],
    ] as const) {
      expect((await send("POST", R(), { session, body })).status).toBe(status);
      expect(
        (await send("PATCH", `${R()}/blocker_red`, { session, headers: ifm(2), body: { redCycles: 5 } })).status,
      ).toBe(status);
    }
  });
});

describe("the database last lines of the T16, escalation and blocker tables (platform/db-errors.ts)", () => {
  const map = (constraint: string, code = "23514") => mapDatabaseGuardError({ code, constraint, message: "x" });
  it("maps each refusal to its ADR-0032 §11 problem, and programming errors to 500", () => {
    expect([
      map("decision_one_open_blocker_ask", "23505")?.status,
      map("decision_one_open_blocker_ask", "23505")?.code,
    ]).toEqual([409, "executive_decision.blocker_ask_open"]);
    expect([map("decision_ask_complete")?.status, map("decision_ask_complete")?.code]).toEqual([
      400,
      "executive_decision.field_required",
    ]);
    expect([map("decision_ask_options")?.status, map("decision_ask_options")?.code]).toEqual([
      400,
      "executive_decision.options_too_few",
    ]);
    expect(map("decision_ask_outcome_recorded")?.errors?.[0]?.pointer).toBe("/outcomeText");
    expect([map("decision_code_key", "23505")?.status, map("decision_code_key", "23505")?.code]).toEqual([
      409,
      "version_conflict",
    ]);
    expect(map("governance_escalation_rule_kind_key", "23505")?.code).toBe("escalation_rule.exists");
    expect(map("governance_escalation_rule_shape")?.code).toBe("escalation_rule.shape");
    expect(map("governance_escalation_rule_red_cycles_check")?.code).toBe("escalation_rule.shape");
    expect([
      map("blocker_status_once_per_cycle", "23505")?.status,
      map("blocker_status_once_per_cycle", "23505")?.code,
    ]).toEqual([409, "blocker_status.exists"]);
    expect(map("blocker_status_meeting_in_session")?.code).toBe("meeting.not_in_session");
    expect(map("blocker_status_record_ref", "23503")?.code).toBe("blocker_status.record_not_found");
    expect(map("blocker_status_meeting_frozen")?.code).toBe("meeting.frozen");
    for (const c of [
      "decision_ask_executive_only",
      "decision_ask_columns",
      "decision_ask_source",
      "decision_ask_sla_known_or_reason",
      "decision_ask_origin_immutable",
      "decision_blocker_pair",
      "decision_blocker_ref",
      "decision_escalation_once",
      "decision_escalation_expired",
      "decision_escalation_target",
      "decision_escalation_party_error",
      "decision_escalation_open_ask",
      "decision_escalation_level_step",
      "blocker_status_cycle_of_meeting",
      "governance_escalation_rule_kind_immutable",
    ])
      expect([c, map(c)?.status]).toEqual([c, 500]);
  });
});
