// P4 slices I and C on the REAL stack (support/with-stack.sh; no mocks): T-DG4-FE-A (p4-work-split §I+C.5).
// Every record is SYNTHETIC demo data. The Sponsor's decisions are demo business approvals that approve nothing real,
// and no product gate (G1-G6) implies any engineering gate (DG0-DG7).
//  1. Role mapping: an unmapped governance role shows the visible routing error; the Lead maps the Sponsor.
//  2. Decision rights (T11, the four B0099 rows) and RACI (T12): the cell editor offers exactly A, R, C, I, A/R or empty;
//     a second accountable is refused by the server (422 raci.accountable_count), translated, nothing saved.
//  3. The Lead requests a business approval routed by the T11 "Business scope change" row (to the mapped Sponsor).
//  4. The Sponsor sees the task in My Work, opens it, cannot defer without a date, and approves with a rationale; the
//     Lead's inbox gets the outcome reminder.
//  5. A record changed after the request: the decision answers 409 "the record changed" with a link to its history.
//  6. Delegations: the Sponsor delegates to the Business Owner; the reverse delegation is refused as a loop.
//  7. The auditor sees the approval records ("B on behalf of A" when delegated) and a read-only RACI.
//  8. Administration > Calendar and Jobs (technical administrator), Governance > Groups (office), Transform readiness.
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { syntheticUser, type SyntheticUser } from "./support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

let tid = "";
let T = "";
let orgId = "";
let sponsor: SyntheticUser;
let owner: SyntheticUser;
let decisionA = "";
let decisionB = "";
let scopeRight = "";
let lead: ApiSession;
const stamp = Date.now().toString(36);

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

/** The dialog's submit button (its label is the dialog's own action). */
const submitOf = (dialog: Locator) => dialog.locator("[data-action='submit']");

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P4 governance ${lang.toUpperCase()} ${stamp}`,
    mode: "end_to_end",
  });
  tid = created.id;
  T = `/api/v1/transformations/${tid}`;
  orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  sponsor = await syntheticUser(
    admin,
    orgId,
    tid,
    `dev.p4.sp.${lang}.${stamp}`,
    `Synthetic Sponsor ${lang}`,
    "SP",
    lang,
  );
  owner = await syntheticUser(admin, orgId, tid, `dev.p4.bo.${lang}.${stamp}`, `Synthetic Owner ${lang}`, "BO", lang);
  const mk = async (title: string) =>
    (
      await lead.call<{ id: string }>("POST", "/api/v1/decisions", {
        transformationId: tid,
        title,
        ownerUserId: lead.userId,
        tomDimensionCode: "technology",
        options: [{ title: "Build" }, { title: "Buy" }],
      })
    ).id;
  decisionA = await mk(`Synthetic scope change A ${lang}`);
  decisionB = await mk(`Synthetic scope change B ${lang}`);
  const rights = await lead.call<{ items: { id: string; templateKey: string | null }[] }>(
    "GET",
    `${T}/decision-rights`,
  );
  scopeRight = rights.items.find((r) => r.templateKey === "business_scope_change")!.id;
});

test("role mapping: unmapped roles show the routing error; the Lead maps the Sponsor", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/role-mappings`);
  await expect(page.locator("[data-state='unmapped-roles']")).toBeVisible();
  const spRow = page.locator("tr", { has: page.locator("[data-party='SP']") });
  await expect(spRow.locator("[data-routing-error='party_unmapped']")).toContainText(
    tr(lang, "groups.roleMappings.unmapped"),
  );
  await shot(page, lang, "p4-01-role-mappings-unmapped");
  await expectAccessible(page, lang, "p4-role-mappings");
  await spRow.getByRole("button", { name: new RegExp(escape(tr(lang, "groups.roleMappings.map"))) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "groups.roleMappings.person")).selectOption(sponsor.id);
  await shot(page, lang, "p4-02-role-mapping-dialog");
  await expectAccessible(page, lang, "p4-role-mapping-dialog");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(spRow.locator("[data-mapped='true']")).toBeVisible();
  await shot(page, lang, "p4-03-role-mapped");
  expect(foreign).toEqual([]);
});

test("decision rights and RACI: seeded rows; exact RACI values; a second accountable is refused", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/decision-rights`);
  for (const key of ["business_scope_change", "funding_reallocation", "target_state_design", "go_live_scale"])
    await expect(page.locator(`[data-decision-right='${key}']`)).toBeVisible();
  await expect(page.locator("[data-matrix='decision_rights']")).toBeVisible();
  await shot(page, lang, "p4-04-decision-rights");
  await expectAccessible(page, lang, "p4-decision-rights");

  await go(page, `/transformations/${tid}/raci`);
  const grid = page.locator("[data-table='raci']");
  await expect(grid).toBeVisible();
  const row = grid.locator("tbody tr[data-status='active']").first();
  const selects = row.locator("select");
  const options = await selects
    .first()
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(options).toEqual(["", "A", "R", "C", "I", "A/R"]);
  await shot(page, lang, "p4-05-raci");
  await expectAccessible(page, lang, "p4-raci");
  // Make a second accountable: every cell that is not A becomes A.
  const count = await selects.count();
  for (let i = 0; i < count; i++) {
    if ((await selects.nth(i).inputValue()) !== "A") {
      await selects.nth(i).selectOption("A");
      break;
    }
  }
  await expect(row.locator("[data-accountable-count='2']")).toBeVisible();
  await row.locator("[data-action='save-row']").click();
  const alert = grid.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "raci.accountable_count");
  await expect(alert).toContainText(tr(lang, "problems.raci__accountable_count"));
  await shot(page, lang, "p4-06-raci-two-accountables-refused");
  await expectAccessible(page, lang, "p4-raci-refused");
});

test("the Lead requests a business approval routed by the T11 row", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/decision-rights`);
  await page.locator("[data-action='request-approval']").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-state='business-approval']")).toBeVisible();
  await dialog.getByLabel(fieldLabel(lang, "decisionRights.field.decision")).selectOption(scopeRight);
  await dialog.getByLabel(fieldLabel(lang, "decisionRights.request.subject")).selectOption(decisionA);
  await dialog.getByLabel(fieldLabel(lang, "decisionRights.request.title")).fill(`Synthetic approval A ${lang}`);
  await shot(page, lang, "p4-07-request-approval");
  await expectAccessible(page, lang, "p4-request-approval");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const mine = await lead.call<{ items: { title: string; assignee: { partyCode: string; userId: string | null } }[] }>(
    "GET",
    "/api/v1/approvals?role=requester",
  );
  const a = mine.items.find((x) => x.title === `Synthetic approval A ${lang}`)!;
  expect(a.assignee).toMatchObject({ partyCode: "SP", userId: sponsor.id });
});

test("the Sponsor decides from My Work: defer needs a date, then approve with a rationale", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, sponsor.username);
  const task = page.locator("[data-work-item]", { hasText: `Synthetic approval A ${lang}` });
  await expect(task).toBeVisible();
  await shot(page, lang, "p4-08-sponsor-my-work");
  await expectAccessible(page, lang, "p4-my-work");
  await go(page, "/my-work/approvals");
  await shot(page, lang, "p4-09-approvals-list");
  await expectAccessible(page, lang, "p4-approvals-list");
  await page.getByRole("link", { name: `Synthetic approval A ${lang}` }).click();
  await expect(page.locator("[data-page='approval-detail'] h1")).toHaveText(`Synthetic approval A ${lang}`);
  await shot(page, lang, "p4-10-approval-detail");
  await expectAccessible(page, lang, "p4-approval-detail");
  await page.locator("[data-action='decide']").click();
  const dialog = page.getByRole("dialog");
  const outcome = dialog.getByLabel(fieldLabel(lang, "approvals.decide.outcome"));
  expect(
    await outcome.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean)),
  ).toEqual(["approve", "reject", "request_changes", "defer"]);
  await outcome.selectOption("defer");
  await dialog.getByLabel(fieldLabel(lang, "approvals.decide.rationale")).fill("Synthetic: wait for the pilot");
  await submitOf(dialog).click();
  await expect(dialog.getByLabel(fieldLabel(lang, "approvals.decide.deferUntil"))).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await shot(page, lang, "p4-11-defer-needs-date");
  await expectAccessible(page, lang, "p4-defer-needs-date");
  await outcome.selectOption("approve");
  await dialog
    .getByLabel(fieldLabel(lang, "approvals.decide.rationale"))
    .fill("Synthetic demo approval (approves nothing real)");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-approval-status='approved']").first()).toBeVisible();
  await expect(page.locator("[data-table='approval-history'] [data-decision]")).toHaveCount(1);
  await shot(page, lang, "p4-12-approved");
  // The requester's inbox has the outcome reminder.
  const inbox = await lead.call<{ items: { messageKey: string; messageParams: { title?: string } }[] }>(
    "GET",
    "/api/v1/me/inbox",
  );
  expect(
    inbox.items.some(
      (n) => n.messageKey === "approvals.task.outcome" && n.messageParams.title === `Synthetic approval A ${lang}`,
    ),
  ).toBe(true);
});

test("a record changed after the request: 409 'the record changed' with a link to its history", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const d = await lead.call<{ version: number }>("GET", `/api/v1/decisions/${decisionB}`);
  const approval = await lead.call<{ id: string }>("POST", `${T}/approvals`, {
    approvalType: "decision_request",
    subjectId: decisionB,
    subjectVersion: d.version,
    decisionRightId: scopeRight,
    title: `Synthetic approval B ${lang}`,
  });
  await lead.call(
    "PATCH",
    `/api/v1/decisions/${decisionB}`,
    { title: `Synthetic scope change B ${lang} (edited)` },
    { ifMatch: d.version },
  );
  await signIn(page, lang, sponsor.username);
  await go(page, `/my-work/approvals/${approval.id}`);
  await page.locator("[data-action='decide']").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "approvals.decide.outcome")).selectOption("approve");
  await dialog.getByLabel(fieldLabel(lang, "approvals.decide.rationale")).fill("Synthetic: looks fine");
  await submitOf(dialog).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "approval.stale_version");
  await expect(alert).toContainText(tr(lang, "problems.approval__stale_version"));
  await expect(alert.getByRole("link", { name: tr(lang, "approvals.stale.history") })).toHaveAttribute(
    "href",
    `/transformations/${tid}/approval-decisions`,
  );
  await shot(page, lang, "p4-13-stale-record-changed");
  await expectAccessible(page, lang, "p4-stale");
  const after = await lead.call<{ status: string; decisions: unknown[] }>("GET", `/api/v1/approvals/${approval.id}`);
  expect(after).toMatchObject({ status: "pending", decisions: [] });
});

test("delegations: the Sponsor delegates to the Business Owner; the reverse is refused as a loop", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const record = async (username: string, delegateId: string, name: string, expectLoop: boolean) => {
    const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    const page = await context.newPage();
    await signIn(page, lang, username);
    await go(page, "/my-work/delegations");
    await page.getByRole("button", { name: tr(lang, "delegations.create.action") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(fieldLabel(lang, "delegations.field.transformation")).selectOption(tid);
    await dialog.getByLabel(fieldLabel(lang, "delegations.field.delegate")).selectOption(delegateId);
    await dialog.getByLabel(fieldLabel(lang, "delegations.field.from")).fill(`${today}T00:00`);
    await dialog.getByLabel(fieldLabel(lang, "delegations.field.to")).fill(`${later}T00:00`);
    await shot(page, lang, `${name}-dialog`);
    await expectAccessible(page, lang, `${name}-dialog`);
    await submitOf(dialog).click();
    if (expectLoop) {
      const alert = dialog.getByRole("alert");
      await expect(alert).toHaveAttribute("data-problem", "delegation.loop");
      await expect(alert).toContainText(tr(lang, "problems.delegation__loop"));
    } else {
      await expect(dialog).toBeHidden();
      await expect(page.locator("tbody [data-status='active']").first()).toBeVisible();
    }
    await shot(page, lang, name);
    await expectAccessible(page, lang, name);
    await context.close();
  };
  await record(sponsor.username, owner.id, "p4-14-delegation-recorded", false);
  await record(owner.username, sponsor.id, "p4-15-delegation-loop-refused", true);
});

test("the auditor sees the approval records and a read-only RACI", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.auditor");
  await go(page, `/transformations/${tid}/approval-decisions`);
  await expect(page.locator("[data-outcome='approved']").first()).toBeVisible();
  await shot(page, lang, "p4-16-approval-records-auditor");
  await expectAccessible(page, lang, "p4-approval-records");
  await go(page, `/transformations/${tid}/raci`);
  await expect(page.locator("[data-table='raci']")).toBeVisible();
  await expect(page.locator("[data-table='raci'] select")).toHaveCount(0);
  await expect(page.locator("[data-action='save-row']")).toHaveCount(0);
  await shot(page, lang, "p4-17-raci-auditor-read-only");
  await expectAccessible(page, lang, "p4-raci-auditor");
});

test("administration: calendar and jobs; governance: groups and Transform readiness", async ({
  page,
  browser,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  await go(page, "/admin/calendar");
  // The technical administrator adds a calendar (Sunday-Thursday, Asia/Riyadh by default) through the screen. The
  // seeded development organization has none, so until then every working-day due date is Unknown, never guessed.
  const code = `SYN-${lang.toUpperCase()}-${stamp}`.toUpperCase().slice(0, 32);
  await page.getByRole("button", { name: tr(lang, "calendar.create.action") }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel(fieldLabel(lang, "calendar.field.code")).fill(code);
  await create.getByLabel(fieldLabel(lang, "calendar.field.nameEn")).fill(`Synthetic calendar ${lang}`);
  await create.getByLabel(fieldLabel(lang, "calendar.field.nameAr")).fill(`تقويم اصطناعي ${lang}`);
  await expect(create.getByLabel(fieldLabel(lang, "calendar.field.timezone"))).toHaveValue("Asia/Riyadh");
  await submitOf(create).click();
  await expect(create).toBeHidden();
  await page.locator(`[data-calendar='${code}']`).click();
  await expect(page.locator(`[data-calendar-detail='${code}']`)).toBeVisible();
  await expect(page.locator(`[data-calendar-detail='${code}'] [data-workweek='1,2,3,4,7']`)).toBeVisible();
  await expect(page.locator("[data-action='edit-calendar']")).toBeVisible();
  await page.getByLabel(tr(lang, "calendar.calc.from")).fill("2026-10-01");
  // Thursday 1 October 2026 + 5 working days (Sunday-Thursday): Thursday 8 October; Friday and Saturday skipped.
  await expect(page.locator("[data-state='working-days']")).toHaveAttribute("data-due", "2026-10-08");
  await shot(page, lang, "p4-18-calendar-admin");
  await expectAccessible(page, lang, "p4-calendar");
  await go(page, "/admin/jobs");
  await expect(page.locator("[data-action='edit-job']").first()).toBeVisible();
  await shot(page, lang, "p4-19-jobs-admin");
  await expectAccessible(page, lang, "p4-jobs");

  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const office = await context.newPage();
  await signIn(office, lang, "dev.office");
  await go(office, "/governance/groups");
  await office.getByRole("button", { name: tr(lang, "groups.create.action") }).click();
  const dialog = office.getByRole("dialog");
  await dialog
    .getByLabel(fieldLabel(lang, "groups.field.code"))
    .fill(`STEERCO-${lang.toUpperCase()}-${stamp}`.toUpperCase().slice(0, 32));
  await dialog.getByLabel(fieldLabel(lang, "groups.field.nameEn")).fill(`Synthetic SteerCo ${lang}`);
  await dialog.getByLabel(fieldLabel(lang, "groups.field.nameAr")).fill(`لجنة توجيه اصطناعية ${lang}`);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(office.locator("[data-group]").first()).toBeVisible();
  await shot(office, lang, "p4-20-groups");
  await expectAccessible(office, lang, "p4-groups");
  await go(office, `/transformations/${tid}/transform-readiness`);
  await expect(office.locator("[data-readiness]")).toBeVisible();
  await expect(office.locator("[data-check]")).toHaveCount(4);
  await shot(office, lang, "p4-21-transform-readiness");
  await expectAccessible(office, lang, "p4-transform-readiness");
  await go(office, `/transformations/${tid}/raid`);
  await expect(office.locator("[data-state='being-built']")).toBeVisible();
  await shot(office, lang, "p4-22-planned-route");
  await expectAccessible(office, lang, "p4-planned-route");
  await context.close();
});
