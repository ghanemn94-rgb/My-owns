// domain-reviewer probe (T-DG6-REV-DOM-RG-R2), NOT part of the candidate: disposable clone only (copied to e2e/).
// Demo-initialized stack (e2e/support/with-demo-stack.sh; SYNTHETIC International Roaming dataset; roaming.user.to signs
// in through the real dev sign-in). PURPOSE: the T-DG6-FE-RG1 wording of the assistant's withheld notices, rendered by
// the real built SPA in en and ar, which no in-repo e2e reaches (FE-RG1 handback §7).
// HONEST LABEL: the assistant is OFF on the demo stack, so the three assistant reads below are STUBBED in the browser
// with page.route (a withheld answer and a withheld suggestion, shaped like the getAssistantConversation response of
// docs/api/openapi.yaml). This shows the rendering of the served shape only; the server-side withholding itself is
// verified by the integration suites (context-recheck.test.ts) and the domain probes. Nothing approves anything.
/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { langOf, shot } from "../apps/web/e2e/support/ui.ts";
import { demoPage } from "./support/a02-demo.ts";

test.describe.configure({ timeout: 180_000 });

const EXPECTED = {
  en: {
    answer: "This answer was based on a record you can no longer read, so it is hidden.",
    suggestion: "This suggestion was based on a record you can no longer read, so it is hidden.",
  },
  ar: {
    answer: "استندت هذه الإجابة إلى سجل لم تعد تستطيع قراءته، لذلك هي مخفية.",
    suggestion: "استند هذا الاقتراح إلى سجل لم تعد تستطيع قراءته، لذلك هو مخفي.",
  },
} as const;

const CID = "01a1c6bf-0000-7000-8000-00000000c001";
const TID = "01a1c6bf-0000-7000-8000-00000000c0f1";
const RID = "01a1c6bf-0000-7000-8000-00000000c0a1";
const NOW = "2026-11-10T12:00:00.000Z";

test("DOM-R2-W1 the withheld answer and suggestion notices (stubbed assistant reads)", async ({ browser }, info) => {
  const lang = langOf(info);
  const page = await demoPage(browser, lang, "to");
  const me = await page.evaluate(async () => (await (await fetch("/api/v1/me")).json()) as { id?: string; userId?: string });
  const owner = (me.userId ?? me.id ?? "01a1c6bf-0000-7000-8000-00000000c0u1") as string;
  const conv = {
    id: CID,
    organizationId: "01995000-0000-7000-8000-000000000001",
    ownerUserId: owner,
    transformationId: null,
    title: "Synthetic withheld conversation",
    messageCount: 2,
    awaitingReply: false,
    lastMessageAt: NOW,
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const msg = (seq: number, author: "user" | "assistant") => ({
    id: `01a1c6bf-0000-7000-8000-00000000d00${seq}`,
    conversationId: CID,
    seq,
    author,
    label: author === "user" ? "user_prompt" : "assistant_suggestion",
    replyKind: author === "user" ? null : "answer",
    refusalCode: null,
    errorCode: null,
    content: author === "user" ? "Synthetic prompt" : null,
    contentWithheld: author === "assistant",
    citations:
      author === "user"
        ? []
        : [{ source: "record", recordType: "transformation", recordId: RID, recordVersion: 1, readable: true }],
    providerKind: author === "user" ? null : "http_endpoint",
    modelName: author === "user" ? null : "synthetic-model",
    settingVersion: author === "user" ? null : 3,
    latencyMs: author === "user" ? null : 12,
    createdAt: NOW,
  });
  const suggestion = {
    id: "01a1c6bf-0000-7000-8000-00000000e001",
    conversationId: CID,
    messageId: msg(2, "assistant").id,
    transformationId: TID,
    ordinal: 1,
    kind: "recovery_action",
    label: "assistant_suggestion",
    targetRecordType: null,
    fields: null,
    textContent: null,
    contentWithheld: true,
    citations: [{ source: "record", recordType: "transformation", recordId: RID, recordVersion: 1, readable: true }],
    status: "proposed",
    takenAt: null,
    version: 1,
    createdAt: NOW,
  };
  await page.route(/\/api\/v1\/assistant\/conversations(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, json: { items: [conv], nextCursor: null, assistantEnabled: true } }),
  );
  await page.route(new RegExp(`/api/v1/assistant/conversations/${CID}$`), (route) =>
    route.fulfill({
      status: 200,
      headers: { etag: '"3"' },
      json: { conversation: conv, messages: [msg(1, "user"), msg(2, "assistant")], suggestions: [suggestion] },
    }),
  );
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.locator("[data-assistant-launcher]").click();
  await page.locator(".assistant-list__item").first().click();
  const notices = page.locator("[data-withheld]");
  await expect(notices.first()).toBeVisible();
  const texts = (await notices.allTextContents()).map((s) => s.replace(/\s+/g, " ").trim());
  console.log(`DOM-R2-W1 ${lang} withheld notices: ${JSON.stringify(texts)}`);
  expect(texts).toContain(EXPECTED[lang].answer);
  expect(texts.join(" ")).not.toMatch(/cites a record|تستشهد|يستشهد/);
  const sugg = page.locator("text=" + EXPECTED[lang].suggestion);
  console.log(`DOM-R2-W1 ${lang} suggestion notice visible: ${(await sugg.count()) > 0}`);
  expect(await page.locator("html").getAttribute("dir")).toBe(lang === "ar" ? "rtl" : "ltr");
  await shot(page, lang, "dom-r2-w1-assistant-withheld");
});
