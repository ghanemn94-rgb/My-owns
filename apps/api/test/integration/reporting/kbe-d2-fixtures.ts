// Fixtures of the KBE-D2 assembler and export-label tests (T-DG5-KBE-D2; p5-work-split §F.4; D-157 a). Every record is
// created through the DG4 API on SYNTHETIC data: a Transformation Review meeting with attendance, a discussion item, an
// output, an action and approved minutes; an Executive SteerCo meeting with a published executive ask (a T16 decision)
// and a draft brief; a BAU handover with a control and an evidence item. Approving minutes or accepting a handover is
// an in-product record step on test data and approves nothing real; nothing here touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import { reportSnapshot } from "@mth/shared/schemas";
import { call, type Session, type TestApi } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { businessToday, plusDays, type MeetingWorld } from "../governance/meeting-fixtures.ts";
import {
  createArea,
  createNoteEvidence,
  fullContent,
  insertControl,
  type SustainmentWorld,
} from "../contract/p4-exercises-be-i.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

export const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

/** Generates a snapshot of `code` in transformation `t` and checks it against the API mirror. */
export async function generated(
  api: TestApi,
  t: string,
  code: string,
  session: Session,
  body: Record<string, unknown> = {},
): Promise<Body> {
  const s = ok(
    await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/reports/${code}/generate`, { session, body }),
    201,
    `generate ${code}`,
  );
  const parsed = reportSnapshot.safeParse(s);
  expect(parsed.success, JSON.stringify(parsed.error?.issues ?? []).slice(0, 2000)).toBe(true);
  expect(s.content.definitionCode).toBe(code);
  expect(s.content.transformation.id).toBe(t);
  return s;
}

export const section = (s: Body, key: string): Body => {
  const doc = s.content ?? s.document;
  const found = doc.sections.find((x: Body) => x.key === key);
  expect(found, `section ${key}`).toBeDefined();
  return found;
};
export const rowIds = (sec: Body): string[] => sec.rows.map((r: Body) => r.recordId);
export const cell = (sec: Body, row: Body, key: string): Body =>
  row.cells[sec.columns.findIndex((c: Body) => c.key === key)];
export const field = (sec: Body, key: string): Body => sec.fields.find((f: Body) => f.key === key)?.value;

export interface RichMeetings {
  /** Transformation Review meeting: held, attendance, a discussion item, an output, an action, approved minutes. */
  readonly review: { id: string; url: string; minutesId: string; agendaItemId: string; actionId: string };
  /** Executive SteerCo meeting: a published executive ask (linked T16 decision) and a draft brief. */
  readonly steerco: {
    id: string;
    url: string;
    askItemId: string;
    briefItemId: string;
    decisionId: string;
    actionId: string;
  };
}

/** The two synthetic meetings of a meeting world (setupMeetingWorld), created through the DG4 API. */
export async function richMeetings(api: TestApi, x: MeetingWorld): Promise<RichMeetings> {
  const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
  const T = `/api/v1/transformations/${x.transformationId}`;
  const today = await businessToday(api);

  // Transformation Review (chair: the TL lead).
  const r = ok(
    await send("POST", `${T}/meetings`, {
      session: x.lead.session,
      body: {
        forumId: x.forums.transformation_review,
        scheduledDate: plusDays(today, 7),
        startTime: "11:00",
        durationMinutes: 60,
        chairUserId: x.lead.id,
      },
    }),
    201,
    "create review meeting",
  );
  const rUrl = `${T}/meetings/${r.id}`;
  const item = ok(
    await send("POST", `${rUrl}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "discussion", title: "Synthetic: integrated status of the roaming workstream" },
    }),
    201,
    "discussion item",
  );
  ok(
    await send("POST", `${rUrl}/attendance`, {
      session: x.lead.session,
      body: { userId: x.lead.id, attendance: "present" },
    }),
    201,
    "attendance lead",
  );
  ok(
    await send("POST", `${rUrl}/attendance`, {
      session: x.lead.session,
      body: { userId: x.contributor.id, attendance: "apologies", note: "Synthetic: travelling" },
    }),
    201,
    "attendance contributor",
  );
  const action = ok(
    await send("POST", `${rUrl}/actions`, {
      session: x.lead.session,
      body: {
        title: "Synthetic: confirm the cut-over plan",
        ownerUserId: x.contributor.id,
        dueDate: plusDays(today, 20),
      },
    }),
    201,
    "meeting action",
  );
  ok(
    await send("POST", `${rUrl}/outputs`, {
      session: x.lead.session,
      body: { outputKind: "integrated_status", note: "Synthetic: amber, one dependency late" },
    }),
    201,
    "meeting output",
  );
  const started = ok(await send("POST", `${rUrl}/start`, { session: x.lead.session, headers: ifm(1) }), 200, "start");
  ok(await send("POST", `${rUrl}/close`, { session: x.lead.session, headers: ifm(started.version) }), 200, "close");
  const minutes = ok(
    await send("POST", `${rUrl}/minutes`, {
      session: x.lead.session,
      body: { body: "Synthetic minutes: the workstream is amber; one action agreed." },
    }),
    201,
    "draft minutes",
  );

  // Executive SteerCo (chair: the sponsor through the SP party).
  const s = ok(
    await send("POST", `${T}/meetings`, {
      session: x.lead.session,
      body: {
        forumId: x.forums.executive_steerco,
        scheduledDate: plusDays(today, 10),
        startTime: "09:00",
        durationMinutes: 60,
      },
    }),
    201,
    "create steerco meeting",
  );
  const sUrl = `${T}/meetings/${s.id}`;
  const brief = (extra: Record<string, unknown>) => ({
    decisionRequired: "Synthetic: choose the billing platform",
    whyNow: "Synthetic: the vendor's offer expires this month",
    options: ["Migrate now", "Wait for the next release"],
    recommendation: "A",
    ownerUserId: x.sponsor.id,
    requiredDate: plusDays(today, 15),
    ...extra,
  });
  const ask = ok(
    await send("POST", `${sUrl}/agenda-items`, {
      session: x.lead.session,
      body: {
        itemKind: "executive_ask",
        title: "Synthetic: billing platform",
        brief: brief({ impactOfDelay: "Synthetic: the discount is lost" }),
      },
    }),
    201,
    "ask item",
  );
  const published = ok(
    await send("POST", `${sUrl}/agenda-items/${ask.id}/publish`, { session: x.sponsor.session, headers: ifm(1) }),
    200,
    "publish ask",
  );
  const draftBrief = ok(
    await send("POST", `${sUrl}/agenda-items`, {
      session: x.lead.session,
      body: {
        itemKind: "executive_ask",
        title: "Synthetic: data-centre move",
        brief: brief({ options: ["Only one"] }),
      },
    }),
    201,
    "draft brief",
  );
  const sAction = ok(
    await send("POST", `${sUrl}/actions`, {
      session: x.lead.session,
      body: { title: "Synthetic: prepare the vendor comparison", ownerUserId: x.lead.id },
    }),
    201,
    "steerco action",
  );
  return {
    review: { id: r.id, url: rUrl, minutesId: minutes.id, agendaItemId: item.id, actionId: action.actionItemId },
    steerco: {
      id: s.id,
      url: sUrl,
      askItemId: ask.id,
      briefItemId: draftBrief.id,
      decisionId: published.decisionId,
      actionId: sAction.actionItemId,
    },
  };
}

/** A draft BAU handover with full content, an ownerless control and an evidence item (sustainment world). */
export async function draftHandover(api: TestApi, s: SustainmentWorld) {
  const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
  const area = await createArea(send, s);
  const controlId = await insertControl(api.db, s.b, area.id, null);
  const created = ok(
    await send("POST", s.handovers, {
      session: s.wl.session,
      body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id, ...fullContent(s.b.users.bo.id) },
    }),
    201,
    "create handover",
  );
  const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
  const ev = ok(
    await send("POST", `${s.handovers}/${created.id}/evidence`, {
      session: s.wl.session,
      headers: ifm(1),
      body: { evidenceId },
    }),
    201,
    "link evidence",
  );
  return {
    areaId: area.id as string,
    controlId,
    evidenceId,
    id: created.id as string,
    H: `${s.handovers}/${created.id}`,
    version: ev.version as number,
  };
}
