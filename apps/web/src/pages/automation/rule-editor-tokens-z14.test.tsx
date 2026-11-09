// T-DG6-BE-Z14 (F-DG6-580, code-security observation 601; D-231; ADR-0051 §2): the rule editor (RulePage.tsx
// EditContent) always holds the content of one served version and saves with that version as If-Match. After a
// successful "Save the draft" it reloads its form from the saved version's response, so the next save carries that
// version's tokens. After a 409 or a 422 `automation_rule.restricted_token_stale` it reloads the current version and
// shows, in en and ar, that the rule changed and the draft must be re-applied. It never re-sends tokens of an earlier
// version. The server's answers are scripted as the real API returns them (issuer-bound tokens
// `[restricted:<tag>:<k>]`, T-DG6-BE-Z15, D-233: the tag is opaque to the web; the fixture gives each served version
// its own fixed tag). Before-fix reproduction: code-security round-9 probe zz-cs-r9-editor-stale-token.
// T-DG6-BE-Z15 (F-DG6-640) adds, in en and ar: a token pasted from another version (the published version, or another
// rule) is sent verbatim, the server's 422 `restricted_token_stale` shows the "changed, re-apply" message, the form
// reloads the current version and the pasted token is never re-sent; an issuer-bound token carries the restricted label.
// All data SYNTHETIC; nothing here is a business approval (G1-G6) and nothing touches DG0-DG7.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n, catalogues } from "../../i18n/index.ts";
import {
  ORG_ID,
  TR_ID,
  USER_ID,
  makeMe,
  mockApi,
  makeTransformation,
  problem,
  renderApp,
  route,
  type RecordedRequest,
} from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

type Version = ReturnType<typeof versionAt>;
type Conditions = { field: string; op: string; value: unknown }[];
/** Fixed opaque issuer tags per served row version (the real tag is a keyed hash the web never computes, D-233). */
const TAGS = new Map<number, string>([
  [2, "3f9c0a7e51b2d48c6a0e9f17"],
  [3, "b80d42e6a1c9375f0e2b8d64"],
  [4, "5ce1a09b7d3f28e4c6b1a07d"],
  [5, "e27b9d0c43a8f6152d9c0b3e"],
]);
const tok = (version: number, k: number) => `[restricted:${TAGS.get(version)}:${k}]`;
/** A token issued by ANOTHER rule-version row (the published version 1, or another rule) at the same row version. */
const FOREIGN = "[restricted:9a41c7e2085fd36b1e70c4a9:2]";
/** Version 2 as the author reads it: [neq G1, neq <hidden> (token), eq approved]. */
const v2 = () =>
  versionAt(2, [
    { field: "gateCode", op: "neq", value: "G1" },
    { field: "gateCode", op: "neq", value: tok(2, 2) },
    { field: "outcome", op: "eq", value: "approved" },
  ]);
const patchesOf = (requests: RecordedRequest[]) => requests.filter((r) => r.method === "PATCH");
const sentConditions = (r: RecordedRequest) => (r.body as { content: { conditions: Conditions } }).content.conditions;
const valueInputs = () =>
  [...document.querySelectorAll("[data-condition-row] input")].map((x) => (x as HTMLInputElement).value);

/** The API: `onPatch` answers each PATCH (n = 1, 2, …) and may move the server's current version. */
function serve(
  locale: "en" | "ar",
  onPatch: (n: number, req: RecordedRequest, state: { current: Version }) => { status: number; body?: unknown },
) {
  const state = { current: v2() };
  let n = 0;
  const mocked = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(
        [{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions: ADM_METHOD }],
        {
          preferredLocale: locale,
        },
      ),
    })),
    route("PATCH", /\/versions\/1$/, (req) => onPatch(++n, req, state)),
    route("GET", /\/admin\/automation-rules\/[^/]+\/versions\/1$/, () => ({ status: 200, body: state.current })),
    route("GET", /\/admin\/automation-rules\/[^/]+$/, () => ({ status: 200, body: rule })),
    route("GET", /\/admin\/automation-rules\/[^/]+\/versions(\?.*)?$/, () => ({
      status: 200,
      body: { items: [state.current], nextCursor: null },
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
  renderApp(`/admin/automation/rules/${RULE_ID}`, { i18n: createI18n(locale) });
  return { ...mocked, state };
}
const saveButton = (locale: "en" | "ar") =>
  screen.getByRole("button", { name: catalogues[locale].workflowsP5.rules.saveDraft }) as HTMLButtonElement;
async function save(locale: "en" | "ar", requests: RecordedRequest[], count: number) {
  await waitFor(() => expect(saveButton(locale).disabled).toBe(false));
  fireEvent.click(saveButton(locale));
  await waitFor(() => expect(patchesOf(requests)).toHaveLength(count));
  await waitFor(() => expect(saveButton(locale).disabled).toBe(false));
}

for (const locale of ["en", "ar"] as const) {
  const t = catalogues[locale].workflowsP5;

  it(`${locale}: after a save the form reloads from the saved version, so the second save sends its tokens`, async () => {
    const afterSave1 = [
      { field: "gateCode", op: "neq", value: tok(3, 1) },
      { field: "outcome", op: "eq", value: "approved" },
    ];
    const { requests } = serve(locale, (n, req, s) => {
      // The server keeps the conditions it was sent (resolved), and serves them with the new version's tokens.
      s.current = versionAt(
        s.current.version + 1,
        n === 1
          ? afterSave1
          : sentConditions(req).map((c, i) => (i === 0 ? { ...c, value: tok(s.current.version + 1, 1) } : c)),
      );
      return { status: 200, body: s.current };
    });
    fireEvent.click(await screen.findByRole("button", { name: t.rules.removeCondition.replace("{{n}}", "1") }));
    await save(locale, requests, 1);
    await waitFor(() => expect(valueInputs()[0]).toBe(tok(3, 1)));
    await save(locale, requests, 2);
    const [p1, p2] = patchesOf(requests);
    expect(p1!.headers["if-match"]).toBe('"2"');
    expect(sentConditions(p1!)[0]!.value).toBe(tok(2, 2));
    expect(p2!.headers["if-match"]).toBe('"3"');
    expect(sentConditions(p2!)[0]!.value).toBe(tok(3, 1));
    expect(sentConditions(p2!)).toHaveLength(2);
    expect(document.querySelector("[data-state='rule-changed-reapply']")).toBeNull();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });

  it(`${locale}: after a 409 the form reloads the current version, says the rule changed, and never re-sends stale tokens`, async () => {
    // Another tab removed condition 1: the server is at version 3 and shows the hidden literal as [restricted:3:1].
    const { requests } = serve(locale, (n, req, s) => {
      if (n === 1) {
        s.current = versionAt(3, [
          { field: "gateCode", op: "neq", value: tok(3, 1) },
          { field: "outcome", op: "eq", value: "approved" },
        ]);
        return problem(409, "version_conflict", { currentVersion: 3 });
      }
      s.current = versionAt(s.current.version + 1, sentConditions(req));
      return { status: 200, body: s.current };
    });
    await screen.findByRole("button", { name: t.rules.removeCondition.replace("{{n}}", "1") });
    await save(locale, requests, 1);
    const banner = await screen.findByText(t.rules.changedReapply);
    expect(banner.closest("[data-state='rule-changed-reapply']")?.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(valueInputs()).toEqual([tok(3, 1), "approved"]));
    await save(locale, requests, 2);
    const p2 = patchesOf(requests)[1]!;
    expect(p2.headers["if-match"]).toBe('"3"');
    expect(JSON.stringify(sentConditions(p2))).not.toContain(tok(2, 2));
    expect(sentConditions(p2)[0]!.value).toBe(tok(3, 1));
    await waitFor(() => expect(document.querySelector("[data-state='rule-changed-reapply']")).toBeNull());
  });

  it(`${locale}: after a stale-token 422 the form reloads the current version and says the rule changed`, async () => {
    const { requests } = serve(locale, (n, req, s) => {
      if (n === 1) {
        s.current = versionAt(4, [
          { field: "gateCode", op: "neq", value: tok(4, 1) },
          { field: "outcome", op: "eq", value: "approved" },
        ]);
        return problem(422, "automation_rule.restricted_token_stale", {
          errors: [
            {
              pointer: "/content/conditions/1/value",
              code: "automation_rule.restricted_token_stale",
              message: "stale",
            },
          ],
        });
      }
      s.current = versionAt(s.current.version + 1, sentConditions(req));
      return { status: 200, body: s.current };
    });
    await screen.findByRole("button", { name: t.rules.removeCondition.replace("{{n}}", "1") });
    await save(locale, requests, 1);
    expect(await screen.findByText(t.rules.changedReapply)).toBeTruthy();
    await waitFor(() => expect(valueInputs()).toEqual([tok(4, 1), "approved"]));
    await save(locale, requests, 2);
    const p2 = patchesOf(requests)[1]!;
    expect(p2.headers["if-match"]).toBe('"4"');
    expect(JSON.stringify(sentConditions(p2))).not.toContain(tok(2, 2));
  });

  it(`${locale}: an issuer-bound token shows the restricted label, and one pasted from another version gets the 422 "changed, re-apply" (Z15)`, async () => {
    const { requests } = serve(locale, (n, req, s) => {
      if (n === 1) {
        // The server refuses the token issued by another rule-version row (D-233) and is unchanged.
        return problem(422, "automation_rule.restricted_token_stale", {
          errors: [
            {
              pointer: "/content/conditions/2/value",
              code: "automation_rule.restricted_token_stale",
              message: "Restricted-record token not issued for this version as it now stands.",
            },
          ],
        });
      }
      s.current = versionAt(s.current.version + 1, sentConditions(req));
      return { status: 200, body: s.current };
    });
    await screen.findByRole("button", { name: t.rules.removeCondition.replace("{{n}}", "1") });
    // The token's condition carries the label; the plain ones do not (the label follows the token, D-226).
    await waitFor(() =>
      expect(document.querySelector("[data-condition-row='1'] [data-restricted-records='true']")).not.toBeNull(),
    );
    expect(document.querySelector("[data-condition-row='0'] [data-restricted-records='true']")).toBeNull();
    expect(document.querySelector("[data-condition-row='2'] [data-restricted-records='true']")).toBeNull();
    // The author pastes a token copied from the published version's page into condition 3's value.
    const third = document.querySelectorAll("[data-condition-row] input")[2] as HTMLInputElement;
    fireEvent.change(third, { target: { value: FOREIGN } });
    await save(locale, requests, 1);
    // Sent verbatim (the web never rewrites a token), with the served version as If-Match.
    const p1 = patchesOf(requests)[0]!;
    expect(p1.headers["if-match"]).toBe('"2"');
    expect(sentConditions(p1).map((c) => c.value)).toEqual(["G1", tok(2, 2), FOREIGN]);
    const banner = await screen.findByText(t.rules.changedReapply);
    expect(banner.closest("[data-state='rule-changed-reapply']")?.getAttribute("role")).toBe("alert");
    // The form reloads the current version: the pasted token is gone, the version's own token is back.
    await waitFor(() => expect(valueInputs()).toEqual(["G1", tok(2, 2), "approved"]));
    await save(locale, requests, 2);
    const p2 = patchesOf(requests)[1]!;
    expect(JSON.stringify(sentConditions(p2))).not.toContain(FOREIGN);
    expect(sentConditions(p2)[1]!.value).toBe(tok(2, 2));
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });
}

it("another 422 (not a stale token) keeps the author's draft and shows the problem text", async () => {
  const { requests } = serve("en", () => problem(422, "automation_rule.condition_invalid"));
  fireEvent.click(
    await screen.findByRole("button", { name: catalogues.en.workflowsP5.rules.removeCondition.replace("{{n}}", "1") }),
  );
  await save("en", requests, 1);
  expect(await screen.findByText(catalogues.en.problems.automation_rule__condition_invalid)).toBeTruthy();
  expect(document.querySelector("[data-state='rule-changed-reapply']")).toBeNull();
  expect(valueInputs()).toEqual([tok(2, 2), "approved"]);
});
