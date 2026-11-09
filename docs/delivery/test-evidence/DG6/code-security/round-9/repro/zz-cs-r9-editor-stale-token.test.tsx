// code-security-reviewer, DG6 round 9 (T-DG6-REV-CS-R9). NOT part of the candidate: copied into a disposable clone's
// apps/web/src/pages/automation/ and removed afterwards. All data SYNTHETIC; nothing here is a business approval (G1-G6)
// and nothing touches DG0-DG7.
//
// Question: what does the SHIPPED rule editor (RulePage.tsx EditContent + ContentEditor.tsx) send on a second save,
// after a first save that shifted the literal positions of the draft? The server's answers are scripted exactly as the
// real API returned them in probe zz-cs-r9-token-stale.test.ts T1 (log 43): before the save the author is shown
// [neq G1, neq "[restricted:2]", eq approved] (version 2); after "remove condition 1" + save, the version is 3 and shows
// [neq "[restricted:1]", eq approved] (the hidden literal now sits at position 1).
// Asserted (the D-226 contract as the editor must honour it): the second save sends the token the server CURRENTLY
// shows for the hidden literal ("[restricted:1]"), or does not send stale content. EXPECTED TO FAIL on the defect.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n, catalogues } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, USER_ID, makeMe, makeTransformation, mockApi, renderApp, route } from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const en = catalogues.en.workflowsP5;
const RULE_ID = "01920000-0000-7000-b100-000000000001";
const summary = { en: "Synthetic summary", ar: "ملخص اصطناعي" };
const base = {
  triggerCodes: ["gate.decided"],
  actions: [{ type: "create_task", parameters: { assigneeRole: "TO", messageKey: "automation.message.follow_up" } }],
  runAs: "service",
  servicePermissionCodes: [],
  parameters: {},
};
const rule = {
  id: RULE_ID,
  code: "synthetic.follow_up",
  origin: "admin",
  sourceRef: null,
  nameEn: "Synthetic follow-up",
  nameAr: "متابعة اصطناعية",
  descriptionEn: null,
  descriptionAr: null,
  scopeLevel: "transformation",
  organizationId: ORG_ID,
  transformationId: TR_ID,
  ownerUserId: USER_ID,
  ownerRoleCode: null,
  enabled: false,
  disableAllowed: true,
  disabledReason: null,
  effectiveVersionId: null,
  effectiveVersionNo: null,
  openVersionNo: 1,
  summary,
  version: 3,
  updatedAt: "2026-10-16T08:00:00Z",
};
const versionAt = (version: number, conditions: unknown[]) => ({
  id: "01920000-0000-7000-b100-000000000101",
  ruleId: RULE_ID,
  versionNo: 1,
  status: "draft",
  content: { ...base, conditions },
  contentSha256: "c".repeat(64),
  changeSummary: null,
  lastDryRun: null,
  dryRunCurrent: false,
  authoredBy: USER_ID,
  submittedAt: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  publishedBy: null,
  publishedAt: null,
  supersededAt: null,
  discardedAt: null,
  summary,
  version,
  updatedAt: "2026-10-16T08:00:00Z",
  includesRestrictedRecords: true,
});
const catalogue = {
  triggers: [
    {
      code: "gate.decided",
      triggerKind: "event",
      ownerModule: "workflows",
      labelEn: "A gate is decided",
      labelAr: "البتّ في بوابة",
      conditionFields: ["gateCode", "outcome"],
      hasInitiatingUser: true,
      adminSelectable: true,
      sourceRef: "M0221",
    },
  ],
  actionTypes: [
    {
      code: "create_task",
      actionClass: "automatic",
      ownerModule: "tasks",
      labelEn: "Create a task",
      labelAr: "إنشاء مهمة",
      requiredPermissionCode: null,
      adminSelectable: true,
      parametersSchema: {},
    },
  ],
};
const ADM_METHOD: Permission[] = ["organization.read", "automation.read", "automation.configure", "methodology.read"];

it("CS-R9-EDITOR: the second save of the rule editor sends the server's current token, not a stale one", async () => {
  // The server's state, as the real API answered in log 43 T1.
  let current = versionAt(2, [
    { field: "gateCode", op: "neq", value: "G1" },
    { field: "gateCode", op: "neq", value: "[restricted:2]" },
    { field: "outcome", op: "eq", value: "approved" },
  ]);
  const afterSave1 = [
    { field: "gateCode", op: "neq", value: "[restricted:1]" },
    { field: "outcome", op: "eq", value: "approved" },
  ];
  let patches = 0;
  const { requests } = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe([{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions: ADM_METHOD }], {
        preferredLocale: "en",
      }),
    })),
    route("PATCH", /\/versions\/1$/, () => {
      patches += 1;
      current = versionAt(current.version + 1, patches === 1 ? afterSave1 : current.content.conditions);
      return { status: 200, body: current, headers: { ETag: `"${current.version}"` } };
    }),
    route("GET", /\/admin\/automation-rules\/[^/]+$/, () => ({ status: 200, body: rule })),
    route("GET", /\/admin\/automation-rules\/[^/]+\/versions(\?.*)?$/, () => ({
      status: 200,
      body: { items: [current], nextCursor: null },
    })),
    route("GET", /\/dry-runs(\?.*)?$/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
    route("GET", /\/admin\/automation-catalogue$/, () => ({ status: 200, body: catalogue })),
    route("GET", /\/admin\/automation-executions/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
    route("GET", /\/api\/v1\/transformations(\?.*)?$/, () => ({
      status: 200,
      body: { items: [makeTransformation()], nextCursor: null },
    })),
    route("GET", /\/api\/v1\/users\//, () => ({ status: 200, body: { id: USER_ID, displayName: "Synthetic Owner" } })),
  );
  renderApp(`/admin/automation/rules/${RULE_ID}`, { i18n: createI18n("en") });
  // Remove condition 1 and save.
  fireEvent.click(await screen.findByRole("button", { name: en.rules.removeCondition.replace("{{n}}", "1") }));
  fireEvent.click(screen.getByRole("button", { name: en.rules.saveDraft }));
  await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
  // Wait until the refreshed version (3) has been fetched (the GET after the PATCH).
  await waitFor(() => {
    const i = requests.findIndex((r) => r.method === "PATCH");
    expect(requests.slice(i + 1).some((r) => r.method === "GET" && /\/versions(\?.*)?$/.test(r.url))).toBe(true);
  });
  const valueInputs = () =>
    [...document.querySelectorAll("[data-condition-row] input")].map((x) => (x as HTMLInputElement).value);
  console.log("[CS-R9-EDITOR] editor values after save 1 (server now shows [restricted:1]):", JSON.stringify(valueInputs()));
  // Save again (e.g. after another change elsewhere).
  await waitFor(() => expect((screen.getByRole("button", { name: en.rules.saveDraft }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: en.rules.saveDraft }));
  await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
  const [p1, p2] = requests.filter((r) => r.method === "PATCH");
  console.log("[CS-R9-EDITOR] PATCH 1 If-Match", p1!.headers["if-match"], "conditions", JSON.stringify((p1!.body as { content: { conditions: unknown } }).content.conditions));
  console.log("[CS-R9-EDITOR] PATCH 2 If-Match", p2!.headers["if-match"], "conditions", JSON.stringify((p2!.body as { content: { conditions: unknown } }).content.conditions));
  expect(p1!.headers["if-match"]).toBe('"2"');
  expect(p2!.headers["if-match"]).toBe('"3"');
  // The contract: on version 3 the hidden literal is [restricted:1]; [restricted:2] names "approved".
  expect((p2!.body as { content: { conditions: { value: unknown }[] } }).content.conditions[0]!.value).toBe("[restricted:1]");
});
