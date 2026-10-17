// Playbook Studio approval routes and provenance badges against the REAL API (apps/web/e2e/support/with-stack.sh;
// T-DG5-FE-G2, D-163; F-DG5-QA-A-3, ADR-0039 §2, ADR-0044 §4; REQ-PB-002):
//  - the methodology administrator (a SYNTHETIC ADM_METHOD grant to the seeded `dev.nobody`, made through the access API
//    by `dev.admin` and REVOKED at the end, as p5-studio.spec.ts does) adds an approver route to a methodology draft with
//    the ordered role list and the mode: a two-step SEQUENTIAL route, seen in the element view and in the preview (the
//    Preview check run on the current content and the side-by-side diff);
//  - the main refusal: an administrator role in the list is refused by the server (422
//    config_version.admin_approver_forbidden), shown by its translated code text;
//  - the seeded gates carry the "custom extension (playbook v1.0)" provenance badge; nothing is labelled a PMI standard.
// The draft is DISCARDED at the end (never published), so the shared stack's methodology is unchanged for later specs. A
// Studio version is configuration, never a business approval, and nothing here touches DG0-DG7.
import { expect, test } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";

interface Version {
  id: string;
  configKind: string;
  status: string;
  draftStage: string | null;
  isNewestPublished: boolean;
  version: number;
}

/** A SYNTHETIC ADM_METHOD grant for dev.nobody; returns the revoke to call in `finally`. */
async function grantMethodologyAdmin(admin: ApiSession): Promise<() => Promise<void>> {
  type Assignment = { id: string; roleCode: string; revokedAt: string | null; version: number };
  const active = async () =>
    (
      await admin.call<{ items: Assignment[] }>(
        "GET",
        `/api/v1/role-assignments?organizationId=${ORG}&userId=${NOBODY}`,
      )
    ).items.filter((a) => a.roleCode === "ADM_METHOD" && a.revokedAt === null);
  if ((await active()).length === 0)
    await admin.call("POST", "/api/v1/role-assignments", {
      userId: NOBODY,
      roleCode: "ADM_METHOD",
      scope: { type: "organization", id: ORG },
      reason: "Synthetic methodology administrator for the Studio routes journey",
    });
  return async () => {
    for (const a of await active())
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic Studio routes journey" },
        { ifMatch: a.version },
      );
  };
}

/** Discards the open methodology drafts (editing or preview) left by this spec or an earlier failed run. */
async function discardOpenMethodologyDrafts(adm: ApiSession): Promise<void> {
  const drafts = await adm.call<{ items: Version[] }>(
    "GET",
    "/api/v1/admin/methodology-versions?kind=methodology&status=draft",
  );
  for (const d of drafts.items)
    if (d.draftStage === "editing" || d.draftStage === "preview")
      await adm.call("POST", `/api/v1/admin/methodology-versions/${d.id}/discard`, undefined, { ifMatch: d.version });
}

test("Studio routes: a two-step sequential approval route in a methodology draft, seen in the preview; an administrator approver is refused; gates carry the provenance badge", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  const adm = await apiSession(playwright, "dev.nobody");
  try {
    await discardOpenMethodologyDrafts(adm);
    const published = await adm.call<{ items: Version[] }>(
      "GET",
      "/api/v1/admin/methodology-versions?kind=methodology&status=published",
    );
    const base = published.items.find((v) => v.isNewestPublished)!;
    expect(base, "a published methodology version").toBeTruthy();
    const draft = await adm.call<Version>("POST", "/api/v1/admin/methodology-versions", {
      basedOnVersionId: base.id,
      changeSummary: `Synthetic (${lang}): a two-step sequential approval route`,
    });

    await signIn(page, lang, "dev.nobody");
    await page.goto(`/admin/studio/versions/${draft.id}`);
    await expect(page.locator("main [data-version-state='editing']")).toHaveText(tr(lang, "studio.state.editing"));

    // REQ-PB-002: the seeded gates carry the custom-extension badge (B0160); nothing says "PMI standard".
    // The type filter: its wrapping label's accessible name also carries the selected option, so it is found by place.
    const typeSelect = page.locator("section#elements .toolbar select").first();
    await typeSelect.selectOption("gate");
    const g3 = page.locator("[data-element-provenance='gate.G3']");
    await expect(g3).toContainText(tr(lang, "playbookP5.provenance.custom_extension"));
    await expect(page.locator("[data-table='elements']")).not.toContainText(/PMI standard|official PMI|certified/i);
    await expectAccessible(page, lang, "p5-studio-badges");
    await shot(page, lang, "p5-studio-element-badges");

    // Add an approver route: mode sequential, roles BO then SP (ordered with the list's buttons).
    const key = `approval.synthetic_${lang}_${Date.now()}`;
    await page.getByRole("button", { name: tr(lang, "studio.elements.add"), exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("[data-field='elementType']").selectOption("approver_route");
    await dialog.locator("[data-field='stableKey']").fill(key);
    await dialog.locator("[data-field='labelEn']").fill("Synthetic two-step approval");
    await dialog.locator("[data-field='labelAr']").fill("اعتماد اصطناعي بخطوتين");
    await dialog.locator("[data-field='mode']").selectOption("sequential");
    const list = dialog.getByRole("group", { name: tr(lang, "studio.elements.attr.approverRoleCodes"), exact: true });
    const addRole = list.getByRole("button", { name: tr(lang, "studio.elements.route.addRole"), exact: true });
    const step = (n: number) =>
      list.getByRole("textbox", { name: tr(lang, "studio.elements.route.stepRole", { n }), exact: true });
    // The main refusal first: an administrator role as an approver.
    await addRole.click();
    await step(1).fill("ADM_METHOD");
    await addRole.click();
    await step(2).fill("BO");
    await dialog.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      tr(lang, "problems.config_version__admin_approver_forbidden"),
    );
    await shot(page, lang, "p5-studio-route-refused");
    // Correct it: SP replaces ADM_METHOD, then BO moves up to be step 1 (keyboard-operable buttons).
    await step(1).fill("SP");
    await list.getByRole("button", { name: tr(lang, "studio.elements.route.moveUp", { n: 2 }), exact: true }).click();
    await expect(step(1)).toHaveValue("BO");
    await expect(step(2)).toHaveValue("SP");
    await expectAccessible(page, lang, "p5-studio-route-dialog");
    await shot(page, lang, "p5-studio-route-dialog");
    await dialog.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // The element view: the route, its mode and its ordered steps.
    await typeSelect.selectOption("approver_route");
    const row = page.locator(`[data-element='approver_route:${key}']`);
    const summary = row.locator("[data-route-summary='sequential']");
    await expect(summary).toContainText(tr(lang, "studio.elements.route.modeShort.sequential"));
    await expect(summary.locator("[data-route-step]")).toHaveText(["BO", "SP"]);

    // The preview: the Preview check on the current content, and the diff naming the route's roles and mode.
    await page.locator("[data-run-check='preview']").click();
    await expect(page.locator("[data-check-kind='preview'] [data-check]")).toHaveAttribute(
      "data-check",
      /^(pass|warn)$/,
    );
    const diff = page.locator("[data-table='diff']");
    await expect(diff).toContainText(key);
    await expect(diff).toContainText("BO · SP");
    await expect(diff).toContainText("sequential");
    await expectAccessible(page, lang, "p5-studio-route-preview");
    await shot(page, lang, "p5-studio-route-preview");
    await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
    expect(foreign).toEqual([]);
  } finally {
    await discardOpenMethodologyDrafts(adm);
    await revoke();
  }
});
