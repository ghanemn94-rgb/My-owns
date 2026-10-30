// T-DG6-FE-E (p6-work-split §D.3; ADR-0059 §1, §3, §6, §8–§11): the assistant panel and Administration > AI assistant,
// in English LTR and Arabic RTL, against a scripted API (SYNTHETIC data).
//  - the panel is hidden unless the setting read answers enabled: true (off, no row, 403, and AUD without
//    assistant.use, for whom the setting is not even requested by the panel);
//  - every assistant output is inside the labelled container, never in a record's field area; answers are plain text
//    (no HTML, no link made from the content); withheld content shows its notice; the non-answer replies render the
//    ADR §8 texts at read time;
//  - "Take to draft" calls takeAssistantSuggestionToDraft (If-Match = the suggestion) and then the human's own
//    createFormDraft with the returned body, and shows "Draft - not submitted";
//  - Administration > AI assistant: "Off (not configured)", the telemetry and authorization-reference statements, the
//    read-only view for operations.read holders, the If-Match "0" create, the enable dialog, one form-level alert.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, makeMe, mockApi, problem, renderApp, route, type Handler } from "../../test/fixtures.tsx";
import { availabilityOf, citationHref, type AssistantSetting } from "./api.ts";
import { focusFromPath } from "./AssistantPanel.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCALES = ["en", "ar"] as const;
const grants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: true, permissions },
];
const USER: Permission[] = [
  "assistant.use",
  "operations.read",
  "organization.read",
  "charter.edit",
  "transformation.read",
];
const AUD: Permission[] = ["operations.read", "organization.read", "audit_event.read"];
const ADM_TECH: Permission[] = ["assistant.configure", "assistant.use", "operations.read", "organization.read"];
/** The synthetic user; its preferred language follows the test's locale (the app switches to it after sign-in). */
let userLocale: "en" | "ar" = "en";
const meRoute = (permissions: Permission[]): Handler =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(grants(permissions), { preferredLocale: userLocale }),
  }));
const i18nFor = (locale: "en" | "ar") => {
  userLocale = locale;
  return createI18n(locale);
};

const CONV_ID = "01920000-0000-7000-b000-000000000001";
const MSG_USER = "01920000-0000-7000-b000-000000000011";
const MSG_ANSWER = "01920000-0000-7000-b000-000000000012";
const MSG_REFUSAL = "01920000-0000-7000-b000-000000000014";
const MSG_WITHHELD = "01920000-0000-7000-b000-000000000016";
const MSG_NOSRC = "01920000-0000-7000-b000-000000000018";
const SUG_CHARTER = "01920000-0000-7000-b000-000000000021";
const SUG_ADVICE = "01920000-0000-7000-b000-000000000022";
const INIT_ID = "01920000-0000-7000-b000-000000000031";
const DRAFT_ID = "01920000-0000-7000-b000-000000000041";

export function setting(over: Partial<AssistantSetting> = {}): AssistantSetting {
  return {
    configured: false,
    enabled: false,
    providerKind: null,
    endpointUrl: null,
    apiStyle: null,
    modelName: null,
    credentialRef: null,
    authorizationReference: null,
    requestTimeoutMs: 30000,
    maxOutputTokens: 1024,
    maxContextRecords: 8,
    enabledAt: null,
    enabledBy: null,
    telemetryEnabled: false,
    reason: null,
    version: 0,
    updatedAt: null,
    ...over,
  };
}
const ON = setting({
  configured: true,
  enabled: true,
  providerKind: "test_adapter",
  authorizationReference: "IT-TICKET-0001 (synthetic)",
  enabledAt: "2026-10-30T09:00:00Z",
  enabledBy: "01920000-0000-7000-9000-000000000201",
  reason: "Synthetic test enable",
  version: 2,
  updatedAt: "2026-10-30T09:00:00Z",
});
const settingRoute = (body: AssistantSetting | null, status = 200): Handler =>
  route("GET", /\/api\/v1\/admin\/assistant$/, () =>
    body ? { status, body, headers: { ETag: `"${body.version}"` } } : problem(status, "forbidden"),
  );

const msg = (over: Record<string, unknown>) => ({
  conversationId: CONV_ID,
  label: "assistant_suggestion",
  author: "assistant",
  replyKind: "answer",
  refusalCode: null,
  errorCode: null,
  content: null,
  contentWithheld: false,
  citations: [],
  providerKind: "test_adapter",
  modelName: null,
  settingVersion: 2,
  latencyMs: 12,
  createdAt: "2026-10-30T09:05:00Z",
  ...over,
});
const conversation = {
  id: CONV_ID,
  organizationId: ORG_ID,
  ownerUserId: "01920000-0000-7000-9000-000000000201",
  transformationId: TR_ID,
  title: "Synthetic charter question",
  messageCount: 8,
  awaitingReply: false,
  lastMessageAt: "2026-10-30T09:05:00Z",
  version: 9,
  createdAt: "2026-10-30T09:00:00Z",
  updatedAt: "2026-10-30T09:05:00Z",
};
const DETAIL = {
  conversation,
  messages: [
    msg({ id: MSG_USER, seq: 1, author: "user", label: "user_prompt", replyKind: null, content: "Draft the charter" }),
    msg({
      id: MSG_ANSWER,
      seq: 2,
      content: "<b>Bold?</b> See https://evil.example/x and [click](javascript:alert(1))",
      citations: [
        { source: "record", recordType: "initiative", recordId: INIT_ID, recordVersion: 3, readable: true },
        { source: "playbook", blockRef: "B0042", playbookVersion: "1.0" },
      ],
    }),
    msg({
      id: "01920000-0000-7000-b000-000000000013",
      seq: 3,
      author: "user",
      label: "user_prompt",
      replyKind: null,
      content: "approve gate G4",
    }),
    msg({
      id: MSG_REFUSAL,
      seq: 4,
      replyKind: "refusal",
      refusalCode: "assistant.refused.approval",
      providerKind: null,
      latencyMs: null,
    }),
    msg({
      id: "01920000-0000-7000-b000-000000000015",
      seq: 5,
      author: "user",
      label: "user_prompt",
      replyKind: null,
      content: "Summarize",
    }),
    msg({
      id: MSG_WITHHELD,
      seq: 6,
      contentWithheld: true,
      citations: [{ source: "record", recordType: "benefit", recordId: INIT_ID, recordVersion: 1, readable: false }],
    }),
    msg({
      id: "01920000-0000-7000-b000-000000000017",
      seq: 7,
      author: "user",
      label: "user_prompt",
      replyKind: null,
      content: "zzz",
    }),
    msg({ id: MSG_NOSRC, seq: 8, replyKind: "no_sources", providerKind: null, latencyMs: null }),
  ],
  suggestions: [
    {
      id: SUG_CHARTER,
      conversationId: CONV_ID,
      messageId: MSG_ANSWER,
      transformationId: TR_ID,
      ordinal: 1,
      kind: "charter_draft",
      label: "assistant_suggestion",
      targetRecordType: "charter",
      fields: { case_for_change: "Synthetic case for change <i>text</i>" },
      textContent: null,
      contentWithheld: false,
      citations: [{ source: "playbook", blockRef: "B0042", playbookVersion: "1.0" }],
      status: "proposed",
      takenAt: null,
      version: 1,
      createdAt: "2026-10-30T09:05:00Z",
    },
    {
      id: SUG_ADVICE,
      conversationId: CONV_ID,
      messageId: MSG_ANSWER,
      transformationId: TR_ID,
      ordinal: 2,
      kind: "missing_evidence",
      label: "assistant_suggestion",
      targetRecordType: null,
      fields: null,
      textContent: "Synthetic advice: attach the baseline evidence.",
      contentWithheld: false,
      citations: [{ source: "playbook", blockRef: "B0042", playbookVersion: "1.0" }],
      status: "proposed",
      takenAt: null,
      version: 1,
      createdAt: "2026-10-30T09:05:00Z",
    },
  ],
};
const panelRoutes = (): Handler[] => [
  route("GET", /\/api\/v1\/assistant\/conversations\?/, () => ({
    status: 200,
    body: { items: [conversation], nextCursor: null },
  })),
  route("GET", new RegExp(`/api/v1/assistant/conversations/${CONV_ID}$`), () => ({ status: 200, body: DETAIL })),
];

async function openConversation(locale: "en" | "ar") {
  const i18n = i18nFor(locale);
  renderApp("/about", { i18n });
  const t = i18n.t.bind(i18n);
  const launcher = await screen.findByRole("button", { name: new RegExp(t("assistant.panel.open")) });
  fireEvent.click(launcher);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(conversation.title) }));
  await screen.findByText("Draft the charter");
  return t;
}

describe("the assistant panel slot (ADR-0059 §3, §11: off means hidden)", () => {
  it.each([
    ["enabled false (configured)", setting({ configured: true, version: 1 })],
    ["no row (configured false, version 0)", setting()],
  ])("is hidden when the setting says %s", async (_label, body) => {
    const api = mockApi(meRoute(USER), settingRoute(body));
    renderApp("/about", { i18n: i18nFor("en") });
    await waitFor(() => expect(api.requests.some((r) => r.url.endsWith("/api/v1/admin/assistant"))).toBe(true));
    await screen.findByRole("navigation", { name: /primary|الرئيسي|Main/i }).catch(() => undefined);
    expect(document.querySelector("[data-assistant-launcher]")).toBeNull();
    expect(api.requests.some((r) => r.url.includes("/assistant/conversations"))).toBe(false);
  });

  it("is hidden when the setting cannot be read (403: unknown is never shown as on)", async () => {
    const api = mockApi(meRoute(USER), settingRoute(null, 403));
    renderApp("/about", { i18n: i18nFor("en") });
    await waitFor(() => expect(api.requests.some((r) => r.url.endsWith("/api/v1/admin/assistant"))).toBe(true));
    expect(document.querySelector("[data-assistant-launcher]")).toBeNull();
    expect(availabilityOf({ error: new Error("x") })).toBe("unknown");
    expect(availabilityOf({ data: setting() })).toBe("off");
    expect(availabilityOf({ data: ON })).toBe("on");
  });

  it("is never shown to AUD (no assistant.use): the panel does not even read the setting", async () => {
    const api = mockApi(meRoute(AUD), settingRoute(ON));
    renderApp("/about", { i18n: i18nFor("en") });
    await screen.findByText(/Synthetic Test User/);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector("[data-assistant-launcher]")).toBeNull();
    expect(api.requests.some((r) => r.url.endsWith("/api/v1/admin/assistant"))).toBe(false);
  });

  it.each(LOCALES)("is shown when enabled, and lists the caller's conversations (%s)", async (locale) => {
    mockApi(meRoute(USER), settingRoute(ON), ...panelRoutes());
    const i18n = i18nFor(locale);
    renderApp("/about", { i18n });
    const launcher = await screen.findByRole("button", { name: new RegExp(i18n.t("assistant.panel.open")) });
    expect(launcher!.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(launcher);
    expect(launcher!.getAttribute("aria-expanded")).toBe("true");
    const panel = document.querySelector("[data-assistant-panel]") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(within(panel).getByRole("heading", { level: 2 })!.textContent).toContain(i18n.t("assistant.panel.title"));
    expect(await within(panel).findByText(conversation.title)).toBeTruthy();
    // Escape closes the panel and focus returns to the launcher.
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(document.querySelector("[data-assistant-panel]")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });
});

describe("assistant output (ADR-0059 §1, §8, §9)", () => {
  it.each(LOCALES)("renders every reply inside the labelled container, as plain text (%s)", async (locale) => {
    mockApi(meRoute(USER), settingRoute(ON), ...panelRoutes());
    const t = await openConversation(locale);
    const outputs = [...document.querySelectorAll<HTMLElement>("[data-assistant-output]")];
    // Four assistant replies, each in a labelled container with the visible label.
    expect(outputs).toHaveLength(4);
    for (const o of outputs) {
      expect(o.getAttribute("aria-label")).toBe(t("assistant.label"));
      expect(o.querySelector(".assistant-output__label")!.textContent).toContain(t("assistant.label"));
    }
    // Every assistant message is inside a container; user prompts are not.
    for (const li of document.querySelectorAll('[data-author="assistant"]'))
      expect(li.querySelector("[data-assistant-output]")).not.toBeNull();
    for (const li of document.querySelectorAll('[data-author="user"]'))
      expect(li.querySelector("[data-assistant-output]")).toBeNull();
    // Plain text: the markup is shown as characters, no element is created, no link is made from the content.
    const answer = document.querySelector(`[data-message-seq="2"] [data-plain-text]`) as HTMLElement;
    expect(answer.textContent).toBe(DETAIL.messages[1]!.content);
    expect(answer.querySelector("b, a, i")).toBeNull();
    expect(document.querySelector('a[href^="https://evil"], a[href^="javascript"]')).toBeNull();
    const field = document.querySelector(".assistant-fields [data-plain-text]") as HTMLElement;
    expect(field.textContent).toBe("Synthetic case for change <i>text</i>");
    expect(field.querySelector("i")).toBeNull();
    // Citations link only to the cited record or playbook block.
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-citation]")].map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toContain(`/transformations/${TR_ID}/initiatives/${INIT_ID}`);
    expect(links).toContain("/playbook/reader/B0042");
    // The refusal and no-sources texts (ADR §4 item 5, §8), translated at read time.
    expect(document.querySelector('[data-message-seq="4"]')!.textContent).toContain(
      t("assistant.reply.refusal.assistant__refused__approval"),
    );
    expect(document.querySelector('[data-message-seq="8"]')!.textContent).toContain(t("assistant.reply.noSources"));
    // Withheld: the notice, never the text; the unreadable citation does not link.
    const withheld = document.querySelector('[data-message-seq="6"]') as HTMLElement;
    expect(within(withheld).getByText(t("assistant.reply.withheld"))).toBeTruthy();
    expect(withheld.querySelector("a[data-citation]")).toBeNull();
    expect(withheld.querySelector('[data-readable="false"]')).not.toBeNull();
    // Suggestions sit inside the reply's labelled container; advice offers no draft action.
    const advice = document.querySelector('[data-suggestion-kind="missing_evidence"]') as HTMLElement;
    expect(advice.closest("[data-assistant-output]")).not.toBeNull();
    expect(within(advice).queryByRole("button")).toBeNull();
    expect(advice!.textContent).toContain(t("assistant.suggestion.adviceNote"));
  });

  it("no assistant component sets inner HTML or makes links from content (source scan)", () => {
    const dirs = [import.meta.dirname, join(import.meta.dirname, "..", "..", "pages", "admin", "assistant")];
    for (const dir of dirs)
      for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !n.endsWith(".test.tsx"))) {
        const text = readFileSync(join(dir, f), "utf8");
        expect(text, f).not.toMatch(
          /dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML|from "marked"|markdown-it|DOMParser/,
        );
      }
  });

  it("maps citations to their screens, and never links an unreadable record or a nested record without focus", () => {
    const rec = (recordType: "initiative" | "transformation", readable = true) =>
      ({ source: "record", recordType, recordId: INIT_ID, recordVersion: 1, readable }) as const;
    expect(citationHref(rec("transformation"), null)).toBe(`/transformations/${INIT_ID}`);
    expect(citationHref(rec("initiative"), null)).toBeNull();
    expect(citationHref(rec("initiative", false), TR_ID)).toBeNull();
    expect(citationHref({ source: "playbook", blockRef: "B9", playbookVersion: "1.0" }, null)).toBeNull();
    expect(focusFromPath(`/transformations/${TR_ID}/charter`)).toBe(TR_ID);
    expect(focusFromPath("/about")).toBeNull();
  });
});

describe("Take to draft (ADR-0059 §6: a human saves)", () => {
  it.each(LOCALES)(
    "marks the suggestion taken, then creates the draft with the user's createFormDraft (%s)",
    async (locale) => {
      const draftBody = {
        recordType: "charter",
        recordId: null,
        baseRecordVersion: null,
        payload: { sourceFields: { caseForChange: "Synthetic case for change <i>text</i>" } },
      };
      const api = mockApi(
        meRoute(USER),
        settingRoute(ON),
        route("POST", new RegExp(`/api/v1/assistant/suggestions/${SUG_CHARTER}/to-draft$`), () => ({
          status: 200,
          body: {
            suggestion: { ...DETAIL.suggestions[0], status: "taken_to_draft", version: 2 },
            transformationId: TR_ID,
            draft: draftBody,
          },
        })),
        route("POST", new RegExp(`/api/v1/transformations/${TR_ID}/form-drafts$`), () => ({
          status: 201,
          body: { id: DRAFT_ID, recordType: "charter", recordId: null, version: 1 },
        })),
        ...panelRoutes(),
      );
      const t = await openConversation(locale);
      const card = document.querySelector('[data-suggestion-kind="charter_draft"]') as HTMLElement;
      expect(card!.textContent).toContain(t("assistant.suggestion.draftNote"));
      fireEvent.click(within(card).getByRole("button", { name: t("assistant.suggestion.takeToDraft") }));
      await within(card).findByText(t("assistant.suggestion.draftCreated"));
      expect(within(card).getByText(t("dashboards.myWork.draftLabel"))).toBeTruthy();
      const take = api.requests.find((r) => r.url.endsWith("/to-draft"))!;
      expect(take.headers["if-match"]).toBe('"1"');
      expect(take.headers["x-csrf-token"]).toBeTruthy();
      const create = api.requests.find((r) => r.method === "POST" && r.url.endsWith("/form-drafts"))!;
      expect(create.body).toEqual(draftBody);
      // The to-draft call came first; nothing else was written (no submit, no approval).
      const writes = api.requests.filter((r) => r.method !== "GET").map((r) => r.url.replace(/^.*\/api\/v1/, ""));
      expect(writes).toEqual([
        `/assistant/suggestions/${SUG_CHARTER}/to-draft`,
        `/transformations/${TR_ID}/form-drafts`,
      ]);
      expect(
        within(card)
          .getByRole("link", { name: t("assistant.suggestion.openEditor") })
          .getAttribute("href"),
      ).toBe(`/transformations/${TR_ID}/charter`);
    },
  );

  it("shows the server's refusal in one form-level alert and sends no draft", async () => {
    const api = mockApi(
      meRoute(USER),
      settingRoute(ON),
      route("POST", /\/to-draft$/, () => problem(422, "assistant.suggestion_already_taken")),
      ...panelRoutes(),
    );
    const t = await openConversation("en");
    const card = document.querySelector('[data-suggestion-kind="charter_draft"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: t("assistant.suggestion.takeToDraft") }));
    const alert = await within(card).findByRole("alert");
    expect(alert!.textContent).toContain("This suggestion was already turned into a draft.");
    expect(within(card).getAllByRole("alert")).toHaveLength(1);
    expect(api.requests.some((r) => r.url.endsWith("/form-drafts"))).toBe(false);
  });
});

describe("asking (postAssistantMessage)", () => {
  it("sends the prompt with If-Match of the conversation and shows a 409 reply_pending in one alert", async () => {
    const api = mockApi(
      meRoute(USER),
      settingRoute(ON),
      route("POST", /\/messages$/, () => problem(409, "assistant.reply_pending")),
      ...panelRoutes(),
    );
    const t = await openConversation("en");
    const box = screen.getByLabelText(new RegExp(t("assistant.panel.messageField")));
    fireEvent.change(box, { target: { value: "What does G2 need?" } });
    fireEvent.click(screen.getByRole("button", { name: t("assistant.panel.send") }));
    const form = box.closest("form") as HTMLElement;
    const alert = await within(form).findByRole("alert");
    expect(alert!.textContent).toContain(
      "The assistant is still answering your previous message. Wait for the answer, then send your next message.",
    );
    expect(within(form).getAllByRole("alert")).toHaveLength(1);
    const post = api.requests.find((r) => r.url.endsWith("/messages"))!;
    expect(post.headers["if-match"]).toBe(`"${conversation.version}"`);
    expect(post.body).toEqual({ content: "What does G2 need?" });
    // The typed text is kept.
    expect((box as HTMLTextAreaElement).value).toBe("What does G2 need?");
  });

  it("refuses a blank prompt inline and sends nothing", async () => {
    const api = mockApi(meRoute(USER), settingRoute(ON), ...panelRoutes());
    const t = await openConversation("en");
    const box = screen.getByLabelText(new RegExp(t("assistant.panel.messageField")));
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: t("assistant.panel.send") }));
    expect(await screen.findByText(t("problems.validation__blank"))).toBeTruthy();
    expect(api.requests.some((r) => r.url.endsWith("/messages"))).toBe(false);
  });
});

describe("Administration > AI assistant (ADR-0059 §3, §10)", () => {
  it.each(LOCALES)("with no row shows Off (not configured) and the fixed statements (%s)", async (locale) => {
    mockApi(meRoute(ADM_TECH), settingRoute(setting()));
    const i18n = i18nFor(locale);
    renderApp("/admin/assistant", { i18n });
    const t = i18n.t.bind(i18n);
    expect(await screen.findByText(t("assistant.admin.statusNotConfigured"))).toBeTruthy();
    expect(document.querySelector("[data-assistant-status]")!.getAttribute("data-assistant-status")).toBe(
      "not-configured",
    );
    expect(screen.getByText(t("assistant.admin.telemetry"))).toBeTruthy();
    expect(screen.getByText(t("assistant.admin.authorizationLimit"))).toBeTruthy();
    if (locale === "en") {
      expect(screen.getByText("Off (not configured)")).toBeTruthy();
      expect(
        screen.getByText("Telemetry and analytics: off. This installation contains no telemetry or analytics client."),
      ).toBeTruthy();
      expect(
        screen.getByText("The reference is recorded as entered; the product does not check it with IT."),
      ).toBeTruthy();
    }
    // No row: no turn-on control until a setting is saved.
    expect(screen.queryByRole("button", { name: t("assistant.admin.enable") })).toBeNull();
  });

  it("is read-only for an operations.read holder (AUD): no edit or toggle control", async () => {
    mockApi(meRoute(AUD), settingRoute(ON));
    const i18n = i18nFor("en");
    renderApp("/admin/assistant", { i18n });
    expect(await screen.findByText("On")).toBeTruthy();
    expect(document.querySelector("[data-read-only]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Edit settings|Turn on|Turn off/ })).toBeNull();
  });

  it("creates the setting with If-Match 0 (disabled) and shows the refusal of the server in one alert", async () => {
    let attempt = 0;
    const api = mockApi(
      meRoute(ADM_TECH),
      settingRoute(setting()),
      route("PUT", /\/api\/v1\/admin\/assistant$/, () =>
        ++attempt === 1
          ? problem(422, "assistant.endpoint_invalid")
          : { status: 200, body: setting({ configured: true, version: 1, providerKind: "test_adapter" }) },
      ),
    );
    renderApp("/admin/assistant", { i18n: i18nFor("en") });
    fireEvent.click(await screen.findByRole("button", { name: "Edit settings" }));
    fireEvent.change(screen.getByLabelText(/^Provider/), { target: { value: "test_adapter" } });
    fireEvent.change(screen.getByLabelText(/Company authorization reference/), {
      target: { value: "IT-TICKET-0001 (synthetic)" },
    });
    fireEvent.change(screen.getByLabelText(/Reason for the change/), { target: { value: "Synthetic setup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const form = document.querySelector(".assistant-admin__form") as HTMLElement;
    const alert = await within(form).findByRole("alert");
    expect(alert!.textContent).toContain(
      "Enter the endpoint as an http or https address without a user name, password, query or fragment.",
    );
    expect(within(form).getAllByRole("alert")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings saved. The assistant stays off until it is turned on.");
    const puts = api.requests.filter((r) => r.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0]!.headers["if-match"]).toBe('"0"');
    expect(puts[0]!.body).toEqual({
      providerKind: "test_adapter",
      endpointUrl: null,
      apiStyle: null,
      modelName: null,
      credentialRef: null,
      authorizationReference: "IT-TICKET-0001 (synthetic)",
      requestTimeoutMs: 30000,
      maxOutputTokens: 1024,
      maxContextRecords: 8,
      reason: "Synthetic setup",
    });
  });

  it("validates the limits and the credential pair before sending", async () => {
    const api = mockApi(meRoute(ADM_TECH), settingRoute(setting()));
    renderApp("/admin/assistant", { i18n: i18nFor("en") });
    fireEvent.click(await screen.findByRole("button", { name: "Edit settings" }));
    fireEvent.change(screen.getByLabelText(/Maximum records per question/), { target: { value: "21" } });
    fireEvent.change(screen.getByLabelText(/Credential reference: provider/), { target: { value: "env" } });
    fireEvent.change(screen.getByLabelText(/Reason for the change/), { target: { value: "Synthetic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(
      await screen.findByText("Enter both the provider and the name of the credential reference, or neither."),
    ).toBeTruthy();
    expect(screen.getAllByText("Enter a whole number from 1 to 20.").length).toBeGreaterThan(1);
    expect(api.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("turns the assistant on with a reason and If-Match of the row; while on, the locked fields are disabled", async () => {
    let current = setting({
      configured: true,
      version: 1,
      providerKind: "test_adapter",
      authorizationReference: "IT-1 (synthetic)",
    });
    const api = mockApi(
      meRoute(ADM_TECH),
      route("GET", /\/api\/v1\/admin\/assistant$/, () => ({ status: 200, body: current })),
      route("POST", /\/api\/v1\/admin\/assistant\/enable$/, () => {
        current = { ...current, enabled: true, version: 2, enabledAt: "2026-10-30T09:00:00Z" };
        return { status: 200, body: current };
      }),
    );
    renderApp("/admin/assistant", { i18n: i18nFor("en") });
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Synthetic IT approval" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
    await screen.findByText("The assistant is on.");
    const enable = api.requests.find((r) => r.url.endsWith("/enable"))!;
    expect(enable.headers["if-match"]).toBe('"1"');
    expect(enable.body).toEqual({ reason: "Synthetic IT approval" });
    expect(await screen.findByRole("button", { name: "Turn off" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit settings" }));
    expect((screen.getByLabelText(/^Provider/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Endpoint address/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Maximum records per question/) as HTMLInputElement).disabled).toBe(false);
  });

  it("shows the no-permission state when the setting cannot be read", async () => {
    mockApi(meRoute(["organization.read", "assistant.use"]), settingRoute(null, 403));
    renderApp("/admin/assistant", { i18n: i18nFor("en") });
    expect(await screen.findByText("You do not have access")).toBeTruthy();
    expect(screen.queryByText("On")).toBeNull();
    expect(screen.queryByText("Off (not configured)")).toBeNull();
  });
});
