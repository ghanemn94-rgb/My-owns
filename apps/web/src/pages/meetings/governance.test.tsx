// Slice D screens (T-DG4-FE-D; p4-work-split §D.5) with stubbed responses, in English (LTR) and Arabic (RTL).
// SYNTHETIC data only.
//  - REQ-PB-060: the five layers with their verbatim B0093 source texts; the Arabic labelled provisional.
//  - REQ-S10-005: the series editor requires the "future meetings only" confirmation and lists the kept meetings.
//  - REQ-S10-011 / REQ-PB-068 / REQ-S10-012: the executive-ask brief lists its missing elements; quorum "not
//    configured" is never "met"; published minutes are read-only; the Outcome is labelled a business decision.
//  - REQ-PB-081: the T16 log's nine columns; Unknown for the columns an earlier record lacks; the overdue filter.
//  - REQ-S12-011: an escalation's routing error is a visible row; rules without a stored row are "Default".
//  - S-6/S-11: every ADR-0032 §11 code, its amendment's codes and the extra codes are translated in both languages.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import {
  DECISION_ID,
  FORUM_ID,
  MEETING_ID,
  PAST_MEETING_ID,
  SERIES_ID,
  agendaItem,
  earlierDecision,
  escalation,
  escalationRules,
  executiveDecision,
  fiveForums,
  forum,
  meeting,
  minutes,
  series,
} from "./governanceFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** ADR-0032 §11, its amendment A2, and the codes BE-F2/BE-G emit outside the tables (S-11). */
const SLICE_D_CODES = [
  "executive_decision.field_required",
  "executive_decision.options_too_few",
  "executive_decision.owner_not_executive",
  "executive_decision.required_date_past",
  "executive_decision.option_unknown",
  "executive_decision.closed",
  "executive_decision.defer_date_required",
  "executive_decision.not_owner",
  "executive_decision.blocker_ask_open",
  "agenda_item.executive_ask_incomplete",
  "agenda_item.executive_asks_only",
  "agenda_item.after_cutoff",
  "agenda_item.max_items",
  "agenda_item.not_draft",
  "agenda_item.final",
  "agenda_item.decision_not_linkable",
  "meeting.quorum_not_met",
  "meeting.not_in_session",
  "meeting.status_transition",
  "meeting.final",
  "meeting.agenda_empty",
  "meeting.agenda_has_drafts",
  "meeting.chair_unassigned",
  "meeting.not_chair",
  "meeting.frozen",
  "meeting_attendance.exists",
  "meeting_minutes.exists",
  "meeting_minutes.status_transition",
  "meeting_minutes.published",
  "meeting_minutes.approved_frozen",
  "meeting_minutes.meeting_not_held",
  "meeting_minutes.required_output_missing",
  "meeting_output.kind_not_in_forum",
  "meeting_output.record_required",
  "meeting_output.record_not_found",
  "forum.party_unknown",
  "forum.output_kind_invalid",
  "forum.publish_output_not_listed",
  "forum.archived",
  "forum_participant.exists",
  "forum_participant.removed",
  "meeting_series.rule_invalid",
  "meeting_series.exists",
  "meeting_series.ended",
  "blocker_status.exists",
  "blocker_status.record_not_found",
  "escalation_rule.exists",
  "escalation_rule.shape",
  // amendment A2
  "meeting.quorum_locked",
  "validation.user_unknown",
  "validation.group_unknown",
  "validation.forum_unknown",
  "validation.end_before_start",
  "validation.decision_right_unknown",
  "validation.blocker_pair",
  "validation.empty_patch",
  "validation.local_time",
  "validation.option_label",
  // emitted outside the tables (agenda.ts, attendance.ts, meeting-outputs.ts)
  "agenda_item.not_published",
  "agenda_item.ordinal_taken",
  "agenda_item.outcome_not_ask",
  "validation.agenda_ask_shape",
  "validation.evidence_unknown",
  "validation.agenda_item_unknown",
  "validation.attendance_proxy",
  "validation.record_pair",
];

const meetingRoutes = (m = meeting(), extra: Parameters<typeof mockApi> = []) => [
  route("GET", new RegExp(`${esc(TRP)}/meetings/${MEETING_ID}$`), () => json(m)),
  route("GET", new RegExp(`${esc(TRP)}/forums/${FORUM_ID}$`), () => json(forum(2))),
  route("GET", new RegExp(`${esc(TRP)}/meetings/${MEETING_ID}/agenda-items`), () => page([agendaItem()])),
  route("GET", new RegExp(`${esc(TRP)}/meetings/${MEETING_ID}/minutes$`), () => problem(404, "not_found")),
  ...extra,
];

describe.each(["en", "ar"] as const)("governance screens (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("translates every ADR-0032 §11 code, the amendment's codes and the extra codes", () => {
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    expect(SLICE_D_CODES.filter((c) => !t(key(c), { defaultValue: "" }))).toEqual([]);
    if (locale === "ar") for (const c of SLICE_D_CODES) expect(t(key(c)), c).toMatch(/[؀-ۿ]/);
  });

  it("forums: the five layers with their verbatim source cadence; Arabic labelled provisional", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", new RegExp(`${esc(TRP)}/forums\\?`), () => page(fiveForums()))]));
    renderApp(`/transformations/${TR_ID}/forums`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-forums='5']")).toBeTruthy());
    const cadences = [...document.querySelectorAll("[data-verbatim-en='cadence']")].map((e) => e.textContent);
    expect(cadences).toEqual(["Monthly", "Bi-weekly", "Weekly", "Daily / 2-3x week", "Monthly"]);
    const provisional = document.querySelectorAll("[data-provisional='true']");
    if (locale === "ar") expect(provisional).toHaveLength(5);
    else expect(provisional).toHaveLength(0);
    expect(document.querySelector("[data-quorum-min='none']")!.textContent).toBe(t("governanceP4.forums.quorumNone"));
  });

  it("series editor: 'future meetings only' must be confirmed; the result lists the kept meetings", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["forum.configure"],
        [
          route("GET", new RegExp(`${esc(TRP)}/forums/${FORUM_ID}$`), () => json(forum(2))),
          route("GET", new RegExp(`${esc(TRP)}/meeting-series\\?`), () => page([series()])),
          route("GET", new RegExp(`${esc(TRP)}/meetings\\?`), () =>
            page([meeting({ id: PAST_MEETING_ID, scheduledDate: "2026-10-04", status: "held" })]),
          ),
          route("PATCH", new RegExp(`${esc(TRP)}/meeting-series/${SERIES_ID}$`), () =>
            json({
              series: series({ intervalCount: 2, version: 4 }),
              createdMeetingIds: [],
              cancelledMeetingIds: [],
              keptMeetingIds: [PAST_MEETING_ID],
              generationUnknownReason: null,
            }),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/forums/${FORUM_ID}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("governanceP4.series.edit")) }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(t("governanceP4.series.futureOnly"));
    fireEvent.change(dialog.querySelector("[data-field='intervalCount']")!, { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("governanceP4.save") }));
    await waitFor(() =>
      expect(dialog.querySelector("[data-field='confirmFuture']")!.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
    fireEvent.change(dialog.querySelector("[data-field='confirmFuture']")!, { target: { value: "confirmed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("governanceP4.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"3"');
    expect(patch.body).toMatchObject({ frequency: "weekly", intervalCount: 2, weekdays: [7] });
    const result = await screen.findByRole("dialog", { name: t("governanceP4.series.resultTitle") });
    await waitFor(() => expect(result.querySelector("[data-series-result='kept'] a")).toBeTruthy());
    expect(result.querySelector("[data-series-result='kept'] a")!.getAttribute("href")).toBe(
      `/transformations/${TR_ID}/meetings/${PAST_MEETING_ID}`,
    );
  });

  it("meeting: the brief lists missing elements; quorum not configured is never 'met'; no engineering gate named", async () => {
    mockApi(...p4Handlers(locale, ["meeting.prepare", "meeting.chair"], meetingRoutes()));
    renderApp(`/transformations/${TR_ID}/meetings/${MEETING_ID}`, { i18n: createI18n(locale) });
    const missing = await waitFor(() => {
      const m = document.querySelector("[data-missing='impact_of_delay,required_date']");
      expect(m).toBeTruthy();
      return m!;
    });
    expect(missing.textContent).toContain(t("governanceP4.ask.impact_of_delay"));
    expect(missing.textContent).toContain(t("governanceP4.ask.required_date"));
    const quorum = document.querySelector("[data-quorum]")!;
    expect(quorum.getAttribute("data-quorum")).toBe("not_configured");
    expect(quorum.className).not.toContain("on-track");
    expect(document.querySelector("[data-due='unknown']")!.textContent).toContain(t("common.value.unknown"));
    expect(document.querySelector("[data-publish-item]")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("publishing an incomplete ask shows the server's 422 once, translated", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["meeting.prepare", "meeting.chair"],
        meetingRoutes(meeting(), [
          route("POST", /\/agenda-items\/.+\/publish$/, () =>
            problem(422, "agenda_item.executive_ask_incomplete", {
              errors: [{ pointer: "/brief/impactOfDelay", code: "validation.required", message: "Required" }],
            }),
          ),
        ]),
      ),
    );
    renderApp(`/transformations/${TR_ID}/meetings/${MEETING_ID}`, { i18n: createI18n(locale) });
    const publish = await waitFor(() => {
      const b = document.querySelector("[data-publish-item]");
      expect(b).toBeTruthy();
      return b as HTMLElement;
    });
    fireEvent.click(publish);
    const section = document.getElementById("meeting-agenda")!;
    const alert = await within(section).findByRole("alert");
    expect(alert.getAttribute("data-problem")).toBe("agenda_item.executive_ask_incomplete");
    expect(within(section).getAllByRole("alert")).toHaveLength(1);
  });

  it("published minutes are read-only and the meeting shows the frozen note", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["meeting.prepare", "meeting.chair"],
        [
          route("GET", new RegExp(`${esc(TRP)}/meetings/${MEETING_ID}/minutes$`), () => json(minutes())),
          ...meetingRoutes(meeting({ status: "minutes_published" })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/meetings/${MEETING_ID}`, { i18n: createI18n(locale) });
    const published = await waitFor(() => {
      const p = document.querySelector("[data-state='minutes-published']");
      expect(p).toBeTruthy();
      return p!;
    });
    expect(published.textContent).toContain(t("governanceP4.minutes.publishedNote"));
    expect(document.querySelector("[data-minutes-action]")).toBeNull();
    expect(screen.queryByRole("button", { name: t("governanceP4.minutes.edit") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("governanceP4.agenda.add") })).toBeNull();
    expect(document.querySelector("[data-publish-item]")).toBeNull();
  });

  it("T16 log: nine columns; an earlier record shows Unknown for what it lacks; the overdue filter asks the server", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["executive_decision.create"],
        [
          route("GET", new RegExp(`${esc(TRP)}/executive-decisions\\?`), (req) =>
            page(req.url.includes("overdue=true") ? [executiveDecision()] : [executiveDecision(), earlierDecision()]),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/executive-decisions`, { i18n: createI18n(locale) });
    const table = (await screen.findByRole("table", {
      name: t("governanceP4.decisions.tableTitle"),
    })) as HTMLTableElement;
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    for (const col of [
      "id",
      "decision",
      "whyNow",
      "options",
      "recommendation",
      "owner",
      "decisionDate",
      "impactOfDelay",
      "outcome",
    ])
      expect(
        headers.some((h) => h.includes(t(`governanceP4.decisions.col.${col}`))),
        col,
      ).toBe(true);
    const earlier = (await screen.findByText("Synthetic earlier funding decision")).closest("tr")!;
    expect(earlier.querySelectorAll("[data-t16='unknown']").length).toBeGreaterThanOrEqual(4);
    const open = screen.getByText("Synthetic fund the second wave?").closest("tr")!;
    expect(open.querySelector("[data-overdue='true']")!.textContent).toContain(t("governanceP4.overdue"));
    expect(open.querySelector("[data-options='2']")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-filter='overdue']")!);
    await waitFor(() => expect(api.requests.some((r) => r.url.includes("overdue=true"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("Synthetic earlier funding decision")).toBeNull());
  });

  it("raising an ask without 'why now': the server's 400 lands on its field", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["executive_decision.create"],
        [
          route("POST", new RegExp(`${esc(TRP)}/executive-decisions$`), () =>
            problem(400, "validation", {
              errors: [
                { pointer: "/whyNow", code: "executive_decision.field_required", message: "Why now is required." },
              ],
            }),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/executive-decisions`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("governanceP4.decisions.create") }));
    const dialog = await screen.findByRole("dialog");
    const fill = (f: string, v: string) =>
      fireEvent.change(dialog.querySelector(`[data-field='${f}']`)!, { target: { value: v } });
    fill("title", "Synthetic ask");
    fill("whyNow", "Synthetic reason");
    fill("options", "Option one\nOption two");
    fill("recommendation", "Option one");
    fill("impactOfDelay", "Synthetic slip");
    fill("requiredDate", "2026-12-01");
    fill("ownerUserId", USER_ID);
    fireEvent.click(within(dialog).getByRole("button", { name: t("governanceP4.decisions.createSubmit") }));
    await waitFor(() =>
      expect(dialog.querySelector("[data-field='whyNow']")!.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(dialog.textContent).toContain(t("problems.executive_decision__field_required"));
  });

  it("recording an Outcome is labelled a business decision and sends If-Match", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["executive_decision.decide"],
        [
          route("GET", new RegExp(`${esc(TRP)}/executive-decisions/${DECISION_ID}$`), () => json(executiveDecision())),
          route("GET", new RegExp(`${esc(TRP)}/escalations\\?`), () => page([escalation()])),
          route("POST", new RegExp(`${esc(TRP)}/executive-decisions/${DECISION_ID}/outcome$`), () =>
            json(executiveDecision({ status: "decided", chosenOptionLabel: "A", overdue: false })),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/executive-decisions/${DECISION_ID}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("governanceP4.decisions.recordOutcome") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-state='business-decision']")!.textContent).toContain(
      t("governanceP4.businessDecision"),
    );
    fireEvent.change(dialog.querySelector("[data-field='outcome']")!, { target: { value: "decided" } });
    fireEvent.change(dialog.querySelector("[data-field='chosenOptionLabel']")!, { target: { value: "A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("governanceP4.decisions.recordOutcome") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"2"');
    expect(post.body).toEqual({ outcome: "decided", chosenOptionLabel: "A" });
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("escalations: a routing error is a visible row; a rule without a stored row is labelled Default", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["escalation_rule.configure"],
        [
          route("GET", new RegExp(`${esc(TRP)}/escalations\\?`), () => page([escalation()])),
          route("GET", new RegExp(`${esc(TRP)}/escalation-rules`), () => page(escalationRules())),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/escalations`, { i18n: createI18n(locale) });
    const err = await waitFor(() => {
      const e = document.querySelector("[data-routing-error='party_unmapped']");
      expect(e).toBeTruthy();
      return e!;
    });
    expect(err.textContent).toContain(t("governanceP4.escalations.routingError.party_unmapped"));
    expect(err.closest("tr")!.textContent).toContain("Synthetic three-month slip");
    expect(document.querySelector("[data-rule='decision_sla'] [data-default='true']")).toBeTruthy();
    expect(document.querySelector("[data-rule='blocker_red'] [data-default]")).toBeNull();
  });
});
