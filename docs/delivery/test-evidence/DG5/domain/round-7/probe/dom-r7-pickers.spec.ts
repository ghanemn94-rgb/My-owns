// T-DG5-REV-DOM-R7C: adopted unchanged from the stopped round-7 domain run (round-7-r7-orphaned/probe), re-read and re-run here.
// domain-reviewer DG5 round-7 probe (D-181 / D-182): every transformation picker offers EVERY transformation the
// signed-in user may see — no more, no fewer — when there are more than 100 (PAGINATION.maxLimit), in EN and AR.
// Production-initialized stack (apps/web/e2e/support/with-stack.sh, AUTH_MODE=dev) unless PROBE_STACK=demo, where
// only the demo-only walkthrough picker is probed. Run from a disposable clone (copied to <clone>/probe/).
// SYNTHETIC data only. Nothing here approves anything real; product gates G1-G6 never relate to DG0-DG7.
//
// Method: through the API, make sure the lead (TL) sees more than 100 transformations, then add one more (the newest,
// last in code order). For every screen: collect every transformation id the screen offers (option values and link
// hrefs anywhere in the page, the dashboard chooser across all its client-side pages), intersect with the
// organization-wide set (dev.office) and compare with the set the API lists for the signed-in user in all pages.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SYN_RETAIL, apiSession, langOf, signIn, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const STACK = process.env["PROBE_STACK"] ?? "prod";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
type Tr = { id: string; code: string; name: string };
type TrPage = { items: Tr[]; nextCursor: string | null };

const shot = async (page: Page, lang: string, name: string) => {
  mkdirSync(join(OUT, "shots", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "shots", lang, `${name}.png`), fullPage: false });
};
const record = (lang: string, name: string, data: unknown) => {
  mkdirSync(join(OUT, "pickers"), { recursive: true });
  writeFileSync(join(OUT, "pickers", `${lang}-${name}.json`), JSON.stringify(data, null, 1));
};

async function listAll(s: { call: <T>(m: string, p: string, b?: unknown) => Promise<T> }, extra = "") {
  const all: Tr[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ sort: "code:asc", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const p: TrPage = await s.call<TrPage>("GET", `/api/v1/transformations?${q.toString()}${extra}`);
    all.push(...p.items);
    cursor = p.nextCursor;
  } while (cursor);
  return all;
}

/** Every transformation id the page offers: option values and link hrefs, anywhere in the document body. */
async function offeredIds(page: Page): Promise<string[]> {
  return page.evaluate((re) => {
    const out = new Set<string>();
    const rx = new RegExp(re, "g");
    document.querySelectorAll("option[value]").forEach((o) => {
      for (const m of (o as HTMLOptionElement).value.matchAll(rx)) out.add(m[0]);
    });
    document.querySelectorAll("a[href]").forEach((a) => {
      for (const m of (a.getAttribute("href") ?? "").matchAll(rx)) out.add(m[0]);
    });
    return [...out];
  }, UUID.source);
}

let ctx: { lang?: Lang; lead: Tr[]; office: Tr[]; newestLead: Tr; universe: Set<string> } | null = null;

async function setup(playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"], lang: Lang) {
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const before = await listAll(lead);
  for (let i = before.length; i <= 100; i++) {
    await lead.call("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic DOM-R7 filler ${i + 1}`,
      mode: "end_to_end",
    });
  }
  const newestLead = await lead.call<Tr>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic DOM-R7 ${lang.toUpperCase()} newest`,
    mode: "end_to_end",
  });
  const L = await listAll(lead);
  const O = await listAll(office);
  const firstPage = await lead.call<TrPage>("GET", "/api/v1/transformations?sort=code:asc&limit=100");
  record(lang, "00-setup", {
    leadCount: L.length,
    officeCount: O.length,
    newestLead,
    newestInFirstCodePage: firstPage.items.some((x) => x.id === newestLead.id),
    leadNotInOffice: L.filter((x) => !O.some((o) => o.id === x.id)).length,
  });
  expect(L.length).toBeGreaterThan(100);
  expect(firstPage.items.map((x) => x.id)).not.toContain(newestLead.id);
  ctx = { lang, lead: L, office: O, newestLead, universe: new Set([...O, ...L].map((x) => x.id)) };
  return ctx;
}

async function compare(page: Page, lang: Lang, name: string, expected: Tr[], extraIds: string[] = []) {
  const c = ctx!;
  const got = new Set([...(await offeredIds(page)), ...extraIds].filter((id) => c.universe.has(id)));
  const want = new Set(expected.map((x) => x.id));
  const missing = expected.filter((x) => !got.has(x.id)).map((x) => x.code);
  const extra = [...got].filter((id) => !want.has(id));
  record(lang, name, { expected: want.size, offered: got.size, missing, extra, dir: await page.locator("html").getAttribute("dir") });
  await shot(page, lang, `r7-picker-${name}`);
  expect(await page.locator("html").getAttribute("dir")).toBe(lang === "ar" ? "rtl" : "ltr");
  expect({ name, missing, extra }).toEqual({ name, missing: [], extra: [] });
}

// Not serial: a failing screen must not hide the others. Each project (en, ar) sets up its own context once.
test.beforeEach(async ({ playwright }, info) => {
  if (STACK === "prod" && (!ctx || ctx.lang !== langOf(info))) await setup(playwright, langOf(info));
});

test("prod: setup — more than 100 transformations for the lead, plus the newest", async ({ playwright }, info) => {
  test.skip(STACK !== "prod");
  test.setTimeout(300_000);
  expect(ctx?.lang).toBe(langOf(info));
  void playwright;
});

const ENTRY_SCREENS: [string, string][] = [
  ["area-playbook", "/playbook"],
  ["launch-plan-entry", "/playbook/launch-plan"],
  ["health-check-entry", "/playbook/health-check"],
  ["reports-entry", "/evidence-reports/reports"],
  ["presentation-entry", "/evidence-reports/presentation"],
  ["evidence-register-entry", "/evidence-reports/evidence-register"],
  ["owner-updates-entry", "/initiatives-roadmaps/updates"],
];

test("prod: lead — entry lists (area landing, launch plan, health check, reports, presentation, evidence register, owner updates)", async ({ page }, info) => {
  test.skip(STACK !== "prod");
  test.setTimeout(300_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  for (const [name, path] of ENTRY_SCREENS) {
    await page.goto(path);
    await expect(page.locator(`a[href*="${ctx!.newestLead.id}"]`).first()).toBeAttached({ timeout: 30_000 });
    await compare(page, lang, name, ctx!.lead);
  }
});

test("prod: lead — My procedures launch picker and the reader's B0023 launch form", async ({ page, playwright }, info) => {
  test.skip(STACK !== "prod");
  test.setTimeout(240_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto("/playbook/procedures");
  const launch = page.locator("[data-form='launch-procedure']");
  await launch.getByLabel(tr(lang, "workflowsP5.procedures.procedure")).selectOption("baseline_validation");
  await expect(launch.locator(`option[value="${ctx!.newestLead.id}"]`)).toHaveCount(1, { timeout: 30_000 });
  await compare(page, lang, "my-procedures-launch", ctx!.lead);
  // As p5-reader-branding-demo.spec.ts: the launch is offered with a transformation context. The preset is the LAST
  // transformation of updatedAt:desc (the least recently updated), beyond any first page of the picker's order.
  const preset = await lastUpdated(playwright);
  await page.goto(`/playbook/reader/B0023?transformationId=${preset}`);
  await page.locator("[data-link='procedure:gate_review']").getByRole("button", { name: tr(lang, "playbookP5.links.launch"), exact: true }).click();
  const form = page.locator("form[data-form='launch-procedure']");
  await expect(form.locator(`option[value="${ctx!.newestLead.id}"]`)).toHaveCount(1, { timeout: 30_000 });
  await expect(form.locator("select").first()).toHaveValue(preset);
  await compare(page, lang, "reader-b0023-launch", ctx!.lead);
});

test("prod: lead — delegation create dialog and the transformation dashboard chooser (all client pages)", async ({ page }, info) => {
  test.skip(STACK !== "prod");
  test.setTimeout(300_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto("/my-work/delegations");
  await page.getByRole("button", { name: tr(lang, "delegations.create.action") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(`option[value="${ctx!.newestLead.id}"]`)).toHaveCount(1, { timeout: 30_000 });
  await compare(page, lang, "delegation-create", ctx!.lead);
  await page.goto("/dashboards/transformation");
  const pager = page.locator("nav.pager").first();
  await expect(pager).toBeVisible({ timeout: 30_000 });
  const seen: string[] = [];
  for (let i = 0; i < 50; i++) {
    seen.push(...(await offeredIds(page)));
    const next = pager.getByRole("button", { name: tr(lang, "common.table.next"), exact: true });
    if (await next.isDisabled()) break;
    await next.click();
  }
  await compare(page, lang, "dashboard-transformation-chooser", ctx!.lead, seen);
});

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";

async function lastUpdated(playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"]): Promise<string> {
  const lead = await apiSession(playwright, "dev.lead");
  let cursor: string | null = null;
  let last = "";
  do {
    const q = new URLSearchParams({ sort: "updatedAt:desc", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const p: TrPage = await lead.call<TrPage>("GET", `/api/v1/transformations?${q.toString()}`);
    if (p.items.length) last = p.items[p.items.length - 1]!.id;
    cursor = p.nextCursor;
  } while (cursor);
  return last;
}

/** SYNTHETIC grants for dev.nobody (as fed3-automation.spec.ts); returns a revoke-all. */
async function grant(admin: Awaited<ReturnType<typeof apiSession>>, roleCode: string, scope: { type: string; id: string }) {
  type A = { id: string; roleCode: string; revokedAt: string | null; version: number; scope?: { type: string; id: string } };
  const active = async () =>
    (await admin.call<{ items: A[] }>("GET", `/api/v1/role-assignments?organizationId=${ORG}&userId=${NOBODY}&limit=100`)).items.filter(
      (a) => a.roleCode === roleCode && a.revokedAt === null && (a.scope === undefined || a.scope.id === scope.id),
    );
  if ((await active()).length === 0)
    await admin.call("POST", "/api/v1/role-assignments", { userId: NOBODY, roleCode, scope, reason: "Synthetic grant for the DOM-R7 picker probe" });
  return async () => {
    for (const a of await active())
      await admin.call("POST", `/api/v1/role-assignments/${a.id}/revoke`, { reason: "End of the DOM-R7 picker probe" }, { ifMatch: a.version });
  };
}

test("prod: office — methodology migrations entry (all the office may see)", async ({ page }, info) => {
  test.skip(STACK !== "prod");
  const lang = langOf(info);
  await signIn(page, lang, "dev.office");
  await page.goto("/admin/methodology-migrations");
  await expect(page.locator(`a[href*="${ctx!.newestLead.id}"]`).first()).toBeAttached({ timeout: 30_000 });
  await compare(page, lang, "methodology-migrations-entry", ctx!.office);
});

test("prod: methodology + access admin who reads the organization (dev.nobody + ADM_METHOD, ADM_ACCESS, TO) — new rule scope and action target, rule edit, assignment grant", async ({ page, playwright }, info) => {
  test.skip(STACK !== "prod");
  test.setTimeout(300_000);
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const revokes = [
    await grant(admin, "ADM_METHOD", { type: "organization", id: ORG }),
    await grant(admin, "ADM_ACCESS", { type: "organization", id: ORG }),
    await grant(admin, "TO", { type: "organization", id: ORG }),
  ];
  try {
    const nobody = await apiSession(playwright, "dev.nobody");
    const visible = await listAll(nobody);
    record(lang, "nobody-org-setup", { visible: visible.length });
    expect(visible.length).toBeGreaterThan(100);
    await signIn(page, lang, "dev.nobody");
    await page.goto("/admin/automation");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.create"), exact: true }).click();
    const form = page.locator("[data-form='create-rule']");
    await expect(form.locator(`option[value="${ctx!.newestLead.id}"]`).first()).toBeAttached({ timeout: 30_000 });
    // Both selects in the form (scope transformation and the action's target) are counted together; each is checked too.
    await compare(page, lang, "automation-create-rule", visible);
    for (const sel of await form.locator("select:has(option[value='" + ctx!.newestLead.id + "'])").all())
      expect(await sel.locator("option").evaluateAll((os) => os.filter((o) => (o as HTMLOptionElement).value).length)).toBe(visible.length);
    await form.getByLabel(tr(lang, "workflowsP5.field.code")).fill(`synthetic.domr7.${lang}.${Date.now()}`);
    await form.getByLabel(`${tr(lang, "workflowsP5.builder.name")} (${tr(lang, "workflowsP5.lang.en")})`).fill("Synthetic DOM-R7 picker rule");
    await form.getByLabel(`${tr(lang, "workflowsP5.builder.name")} (${tr(lang, "workflowsP5.lang.ar")})`).fill("قاعدة اصطناعية للمراجعة");
    await form.getByLabel(tr(lang, "workflowsP5.rules.scope")).selectOption("organization");
    await form.locator("#create-trigger-gate\\.submitted").check();
    await form.locator("#create-action-role-0").fill("TO");
    await form.getByRole("button", { name: tr(lang, "workflowsP5.rules.createSubmit"), exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/automation\/rules\/[0-9a-f-]+$/, { timeout: 30_000 });
    await expect(page.locator(`option[value="${ctx!.newestLead.id}"]`).first()).toBeAttached({ timeout: 30_000 });
    await compare(page, lang, "automation-rule-edit", visible);

    await page.goto("/admin/assignments");
    await page.getByRole("button", { name: tr(lang, "admin.assignments.new"), exact: true }).click();
    // The grant form's own scope-type select (react-hook-form name), not the list filter's (probe v3 fix).
    const scopeSel = page.locator("select[name='scopeType']");
    await scopeSel.selectOption("transformation");
    await expect(page.locator(`option[value="${ctx!.newestLead.id}"]`).first()).toBeAttached({ timeout: 30_000 });
    await compare(page, lang, "assignments-grant", await listAll(nobody, `&organizationId=${ORG}`));
  } finally {
    for (const r of revokes) await r();
  }
});

test("prod: scoped user (dev.nobody + WL on ONE transformation, + ADM_METHOD) — the pickers offer exactly that one", async ({ page, playwright }, info) => {
  test.skip(STACK !== "prod");
  test.setTimeout(240_000);
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const one = ctx!.lead[Math.floor(ctx!.lead.length / 2)]!;
  const revokes = [
    await grant(admin, "WL", { type: "transformation", id: one.id }),
    await grant(admin, "ADM_METHOD", { type: "organization", id: ORG }),
  ];
  try {
    const nobody = await apiSession(playwright, "dev.nobody");
    const visible = await listAll(nobody);
    record(lang, "nobody-scoped-setup", { visible: visible.map((x) => x.code), one: one.code });
    await signIn(page, lang, "dev.nobody");
    await page.goto("/playbook/launch-plan");
    await expect(page.locator(`a[href*="${one.id}"]`).first()).toBeAttached({ timeout: 30_000 });
    await compare(page, lang, "scoped-launch-plan-entry", visible);
    await page.goto("/admin/automation");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.create"), exact: true }).click();
    await expect(page.locator(`[data-form='create-rule'] option[value="${one.id}"]`).first()).toBeAttached({ timeout: 30_000 });
    await compare(page, lang, "scoped-automation-create-rule", visible);
  } finally {
    for (const r of revokes) await r();
  }
});

test("demo: walkthrough picker offers every transformation the demo TL sees", async ({ page, playwright }, info) => {
  test.skip(STACK !== "demo");
  test.setTimeout(300_000);
  const lang = langOf(info);
  const tl = await apiSession(playwright, "roaming.user.tl");
  const all = await listAll(tl);
  ctx = { lead: all, office: all, newestLead: all[all.length - 1]!, universe: new Set(all.map((x) => x.id)) };
  record(lang, "demo-00-setup", { tlCount: all.length });
  await signIn(page, lang, "roaming.user.tl");
  await page.goto("/walkthrough");
  await expect(page.locator("[data-filter='walkthrough-transformation']")).toBeVisible({ timeout: 30_000 });
  await compare(page, lang, "demo-walkthrough", all);
});
