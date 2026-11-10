// T-DG6-BE-Z14 (F-DG6-580, code-security observation 601; D-231; ADR-0051 §2): the rule editor (RulePage.tsx
// EditContent) always holds the content of one served version and saves with that version as If-Match. After a
// successful "Save the draft" it reloads its form from the saved version's response, so the next save carries that
// version's tokens. After a 409 or a 422 `automation_rule.restricted_token_stale` it reloads the current version (a 409
// says, in en and ar, that the rule changed and the draft must be re-applied; a stale-token 422 shows the problem text,
// T-DG6-FE-Z16 below). It never re-sends tokens of an earlier version. The server's answers are scripted as the real API returns them (issuer-bound tokens
// `[restricted:<tag>:<k>]`, T-DG6-BE-Z15, D-233: the tag is opaque to the web; the fixture gives each served version
// its own fixed tag). Before-fix reproduction: code-security round-9 probe zz-cs-r9-editor-stale-token.
// T-DG6-BE-Z15 (F-DG6-640) adds, in en and ar: a token pasted from another version (the published version, or another
// rule) is sent verbatim, the server's 422 `restricted_token_stale` is shown (as the problem text since Z16), the form
// reloads the current version and the pasted token is never re-sent; an issuer-bound token carries the restricted label.
// T-DG6-FE-Z16 (F-DG6-700, F-DG6-740; D-235): a 422 `restricted_token_stale` is NOT a concurrent change (If-Match
// matched, so the rule did not change). The editor still reloads the version as stored, but shows the problem's own
// en/ar text (problems.automation_rule__restricted_token_stale, corrected so that its instruction is true in this flow)
// and never the 409 text "This rule changed after you opened it". Cases, en and ar: a token pasted from another version
// of the same rule, a token pasted from another rule, a token in the retired pre-0127 form, and a 409 (which keeps
// "changed, re-apply"). Before-fix reproductions: domain round-11 probe dom-r11-editor-tokens (part C) and QA round-11
// probe zz-qa-dg6r11-restricted-mywork-automation (step F).
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
/** A token issued by another rule's draft at the same row version (the F-DG6-640 coincidence; QA round-11 step F). */
const OTHER_RULE = "[restricted:41d07be29ac3f560e18b2c7a:1]";
/** A token in the retired D-231 form `[restricted:<version>:<k>]`, issued before migration 0127 (D-233). */
const RETIRED = "[restricted:2:2]";
const staleRefusal = (index: number) =>
  problem(422, "automation_rule.restricted_token_stale", {
    errors: [
      {
        pointer: `/content/conditions/${index}/value`,
        code: "automation_rule.restricted_token_stale",
        message: "Restricted-record token not issued for this version as it now stands.",
      },
    ],
  });
/** The form-level alert inside the rule editor's form (one per form, S-7). */
const formAlert = () => document.querySelector("form[data-form='edit-rule-content'] [role='alert']");
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

  it(`${locale}: after a 409 the form reloads the current version, says the rule changed (not the stale-token text), and never re-sends stale tokens`, async () => {
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
    // Z16: a 409 keeps "changed, re-apply"; the stale-token problem text is not shown for it.
    expect(document.body.textContent).not.toContain(
      catalogues[locale].problems.automation_rule__restricted_token_stale,
    );
    expect(document.querySelector("[data-problem='automation_rule.restricted_token_stale']")).toBeNull();
    await waitFor(() => expect(valueInputs()).toEqual([tok(3, 1), "approved"]));
    await save(locale, requests, 2);
    const p2 = patchesOf(requests)[1]!;
    expect(p2.headers["if-match"]).toBe('"3"');
    expect(JSON.stringify(sentConditions(p2))).not.toContain(tok(2, 2));
    expect(sentConditions(p2)[0]!.value).toBe(tok(3, 1));
    await waitFor(() => expect(document.querySelector("[data-state='rule-changed-reapply']")).toBeNull());
  });

  it(`${locale}: an issuer-bound token shows the restricted label (D-226, Z15)`, async () => {
    serve(locale, () => ({ status: 500 }));
    await screen.findByRole("button", { name: t.rules.removeCondition.replace("{{n}}", "1") });
    // The token's condition carries the label; the plain ones do not (the label follows the token, D-226).
    await waitFor(() =>
      expect(document.querySelector("[data-condition-row='1'] [data-restricted-records='true']")).not.toBeNull(),
    );
    expect(document.querySelector("[data-condition-row='0'] [data-restricted-records='true']")).toBeNull();
    expect(document.querySelector("[data-condition-row='2'] [data-restricted-records='true']")).toBeNull();
  });

  // T-DG6-FE-Z16: the three ways a stale-token 422 is reached from the editor. In each, the server refuses the token
  // and is unchanged (same row version, same conditions): the rule did NOT change.
  for (const [what, pasted] of [
    ["a token pasted from another version of the rule", FOREIGN],
    ["a token pasted from another rule", OTHER_RULE],
    ["a token in the retired pre-0127 form", RETIRED],
  ] as const) {
    it(`${locale}: ${what} gets the 422 problem text, not "this rule changed"; the form reloads the stored version (Z16)`, async () => {
      const { requests, state } = serve(locale, (n, req, s) => {
        if (n === 1) return staleRefusal(2);
        s.current = versionAt(s.current.version + 1, sentConditions(req));
        return { status: 200, body: s.current };
      });
      await screen.findByRole("button", { name: t.rules.removeCondition.replace("{{n}}", "1") });
      // The author pastes the token into condition 3's value and saves.
      const third = document.querySelectorAll("[data-condition-row] input")[2] as HTMLInputElement;
      fireEvent.change(third, { target: { value: pasted } });
      await save(locale, requests, 1);
      // Sent verbatim (the web never rewrites a token), with the served version as If-Match.
      const p1 = patchesOf(requests)[0]!;
      expect(p1.headers["if-match"]).toBe('"2"');
      expect(sentConditions(p1).map((c) => c.value)).toEqual(["G1", tok(2, 2), pasted]);
      // The server did not change: same row version.
      expect(state.current.version).toBe(2);
      // The problem's own text, in the form's one alert; never the 409 "changed, re-apply" text.
      const text = catalogues[locale].problems.automation_rule__restricted_token_stale;
      await waitFor(() => expect(formAlert()?.textContent).toContain(text));
      expect(formAlert()?.getAttribute("data-problem")).toBe("automation_rule.restricted_token_stale");
      expect(document.querySelector("[data-state='rule-changed-reapply']")).toBeNull();
      expect(document.body.textContent).not.toContain(t.rules.changedReapply);
      // The page-level alert does not repeat it (one alert for this form, S-7).
      expect(document.querySelectorAll("[data-problem='automation_rule.restricted_token_stale']")).toHaveLength(1);
      // The form reloads the stored version: the pasted token is gone, the version's own token is back.
      await waitFor(() => expect(valueInputs()).toEqual(["G1", tok(2, 2), "approved"]));
      // The author re-applies the change with this version's own values only, as the text says: it saves.
      fireEvent.click(screen.getByRole("button", { name: t.rules.removeCondition.replace("{{n}}", "3") }));
      await save(locale, requests, 2);
      const p2 = patchesOf(requests)[1]!;
      expect(p2.headers["if-match"]).toBe('"2"');
      expect(JSON.stringify(sentConditions(p2))).not.toContain(pasted);
      expect(sentConditions(p2).map((c) => c.value)).toEqual(["G1", tok(2, 2)]);
      // A successful save clears the alert.
      await waitFor(() => expect(formAlert()).toBeNull());
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    });
  }

  it(`${locale}: the stale-token problem text is true in the editor flow (Z16)`, () => {
    const text = catalogues[locale].problems.automation_rule__restricted_token_stale;
    // It says nothing was saved and that the editor shows the stored version again; it no longer only says "reload the
    // version and re-apply your change" (re-applying a pasted token gives the same refusal).
    if (locale === "en") {
      expect(text).toContain("nothing was saved");
      expect(text).toContain("The rule editor shows the version as it is stored now");
      expect(text).not.toContain(": reload the version and re-apply your change.");
    } else {
      expect(text).toContain("لم يُحفظ أي شيء");
      expect(text).toContain("يعرض محرر القواعد الإصدار بحالته المحفوظة الآن");
      expect(text).not.toContain(": أعد تحميل الإصدار وأعد تطبيق تعديلك.");
    }
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
