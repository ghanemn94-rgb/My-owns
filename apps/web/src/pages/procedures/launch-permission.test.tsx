// My procedures: the launch form is offered only to a user who may launch a procedure (T-DG5-FE-RG1, F-DG5-140;
// REQ-S06-002; ADR-0042 §4). The qa-verifier's reproduction (an Auditor opened /playbook/procedures and was offered an
// enabled "Launch a procedure" form that could only end in 403) as a screen test, EN (LTR) and AR (RTL):
//  L1  a user without procedure.launch anywhere (the Auditor's grants): a read-only note, no launch form, no Launch
//      button and no procedure choice; the rest of the page (my steps, the instances) still renders;
//  L2  a user who holds procedure.launch: the form with its enabled Launch button, as before.
// The server's check stays the backstop (instances.ts: procedure.launch and the procedure's launch roles); this only
// decides what the UI offers. SYNTHETIC data, scripted API. Nothing here is a business approval.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n } from "../../i18n/index.ts";
import { ORG_ID, makeMe, mockApi, renderApp, route } from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The Auditor's P5 read grants (no procedure.launch, no procedure.act). */
const AUDITOR: Permission[] = ["organization.read", "procedure.read", "transformation.read"];
const LAUNCHER: Permission[] = [...AUDITOR, "procedure.act", "procedure.launch"];

const definitions = {
  items: [
    {
      id: "01920000-0000-7000-b200-000000000001",
      code: "gate_review",
      nameEn: "Synthetic gate review",
      nameAr: "مراجعة البوابة (اصطناعي)",
      versionNo: 1,
      versionStatus: "published",
      removed: false,
      scope: { level: "transformation" },
      inputSchema: [],
      steps: [],
    },
  ],
  nextCursor: null,
};

function app(lang: "en" | "ar", permissions: Permission[]) {
  mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe([{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: true, permissions }], {
        preferredLocale: lang,
      }),
    })),
    route("GET", /\/api\/v1\/procedure-definitions(\?|$)/, () => ({ status: 200, body: definitions })),
    route("GET", /./, () => ({ status: 200, body: { items: [], nextCursor: null } })),
  );
  renderApp("/playbook/procedures", { i18n: createI18n(lang) });
}

describe.each(["en", "ar"] as const)("My procedures launch offer (%s)", (lang) => {
  const { t } = createI18n(lang);

  it(`L1 without procedure.launch: a read-only note, no launch form and no Launch button (${lang})`, async () => {
    app(lang, AUDITOR);
    const section = await waitFor(() => {
      const s = document.getElementById("launch");
      expect(s?.querySelector("[data-state='read-only']")).toBeTruthy();
      return s!;
    });
    expect(document.documentElement.dir).toBe(lang === "ar" ? "rtl" : "ltr");
    expect(within(section).getByRole("note").textContent).toContain(t("workflowsP5.procedures.launchReadOnly"));
    expect(document.querySelector("[data-form='launch-procedure']")).toBeNull();
    expect(within(section).queryByRole("button")).toBeNull();
    expect(within(section).queryByRole("combobox")).toBeNull();
    // The rest of the page is unchanged: my steps and the instances.
    expect(screen.getByRole("heading", { level: 2, name: t("workflowsP5.procedures.myStepsTitle") })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: t("workflowsP5.procedures.instancesTitle") })).toBeTruthy();
  });

  it(`L2 with procedure.launch: the launch form with an enabled Launch button (${lang})`, async () => {
    app(lang, LAUNCHER);
    const form = await waitFor(() => {
      const f = document.querySelector<HTMLFormElement>("[data-form='launch-procedure']");
      expect(f).toBeTruthy();
      return f!;
    });
    const launch = within(form).getByRole("button", { name: t("workflowsP5.procedures.launch") });
    expect((launch as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector("#launch [data-state='read-only']")).toBeNull();
  });
});
