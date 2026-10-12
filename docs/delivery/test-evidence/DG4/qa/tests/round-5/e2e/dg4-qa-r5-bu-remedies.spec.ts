// qa-verifier DG4 round 5 (T-DG4-REV-QA-R5): an adversarial re-verification of F-DG4-144 on the REAL stack
// (e2e/support/qa-stack.sh; no mocks, no request interception). This file lives OUTSIDE the frozen candidate and is
// copied into a disposable clone's e2e/ only to run, then removed.
//
// World (per language, a business unit of its own, so no other spec's data volume matters):
//   - the admin creates the unit; the transformation office (dev.office) creates 51 end-to-end transformations
//     (Diagnose, draft) and 3 modular ones entering at Design (draft); 2 of the end-to-end ones are moved draft -> active
//     through PATCH (the product's own status edit). 54 in the unit: Design = 3, active = 2, Realize = 0.
// On each of the THREE dashboards that share useOrgQuery (Executive Overview, Finance, adoption), as dev.office, every
// remedy the too_many note names is tried literally through the UI chips:
//   B0  the unit chip alone: too_many note (its text is the catalogue text), and no dashboard request carries the unit.
//   B1  "narrow by phase": phase = Design -> the note is gone and the dashboard request carries EXACTLY the 3 Design ids.
//   B2  "narrow by status": status = active (phase cleared) -> exactly the 2 active ids.
//   B3  narrowing to nothing (phase = Realize): the none_matching note, never too_many, no request.
//   B4  "choose transformations with the transformation filter": the chip select offers a transformation BEYOND the
//       unit's first 51 by code; choosing it sends a request with exactly that id.
//   B5  the transformation chip with a transformation of ANOTHER unit (SYN_RETAIL) under the unit chip: none_matching,
//       never the other unit's data (no request carries it).
//   B6  the unit chip AND phase = Diagnose (51 remain): still too_many (the limit is not bypassed by a phase chip).
//   B7  "open the transformations' own dashboards": /transformations/<id>/dashboard of a unit transformation renders.
//   B8  regression: phase = Design without the unit chip sends an organization-wide request (no transformationId).
// Every step: axe (wcag2a/aa, 21a/aa) 0 serious/critical, a screenshot; every observation is recorded in
// $QA_RESULTS_DIR/dg4-qa-r5-bu-<lang>.json, and the last test fails if any recorded check failed.
// SYNTHETIC data; no product gate (G1-G6) is decided, and none implies an engineering gate (DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn, SYN_RETAIL, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
const OUT = process.env["QA_RESULTS_DIR"] ?? join(process.cwd(), "qa-results");
const stamp = Date.now().toString(36);

interface Check {
  id: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(id: string, pass: boolean, detail: unknown): void {
  const d = typeof detail === "string" ? detail : String(JSON.stringify(detail) ?? "undefined");
  checks.push({ id, pass, detail: d.slice(0, 1500) });
  if (!pass) console.log(`QA-CHECK-FAIL ${id} ${d.slice(0, 600)}`);
}
test.afterAll(async ({}, info) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `dg4-qa-r5-bu-${langOf(info)}.json`), `${JSON.stringify(checks, null, 2)}\n`);
});

let unitId = "";
let all: { id: string; code: string }[] = [];
let design: string[] = [];
let active: string[] = [];
let otherUnitTr = "";

const SURFACES = [
  ["overview", "/executive-overview", "/api/v1/overview?"],
  ["finance", "/dashboards/finance", "/api/v1/dashboards/finance?"],
  ["adoption", "/dashboards/adoption", "/api/v1/dashboards/adoption?"],
] as const;

test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(5 * 60_000);
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  unitId = (
    await admin.call<{ id: string }>("POST", `/api/v1/organizations/${orgId}/business-units`, {
      code: `SYN-QA5-${lang}-${stamp}`.toUpperCase(),
      nameEn: `Synthetic QA R5 unit ${lang} ${stamp}`,
      nameAr: `وحدة ضمان الجودة الاصطناعية ${lang} ${stamp}`,
    })
  ).id;
  for (let n = 0; n < 51; n++)
    await office.call("POST", "/api/v1/transformations", {
      businessUnitId: unitId,
      name: `Synthetic QA R5 BU ${lang} ${stamp} e2e ${n}`,
      mode: "end_to_end",
    });
  for (let n = 0; n < 3; n++)
    design.push(
      (
        await office.call<{ id: string }>("POST", "/api/v1/transformations", {
          businessUnitId: unitId,
          name: `Synthetic QA R5 BU ${lang} ${stamp} design ${n}`,
          mode: "modular",
          entryPhase: "design",
        })
      ).id,
    );
  const list = await office.call<{ items: { id: string; code: string; currentPhase: string }[] }>(
    "GET",
    `/api/v1/transformations?businessUnitId=${unitId}&sort=code:asc&limit=100`,
  );
  all = list.items.map((x) => ({ id: x.id, code: x.code }));
  for (const x of list.items.filter((i) => i.currentPhase === "diagnose").slice(0, 2)) {
    const cur = await office.call<{ version: number }>("GET", `/api/v1/transformations/${x.id}`);
    await office.call("PATCH", `/api/v1/transformations/${x.id}`, { status: "active" }, { ifMatch: cur.version });
    active.push(x.id);
  }
  const other = await office.call<{ items: { id: string }[] }>(
    "GET",
    `/api/v1/transformations?businessUnitId=${SYN_RETAIL}&limit=1`,
  );
  otherUnitTr = other.items[0]?.id ?? "";
  design = design.sort();
  active = active.sort();
  check("setup-world", all.length === 54 && design.length === 3 && active.length === 2 && otherUnitTr !== "", {
    inUnit: all.length,
    design: design.length,
    active: active.length,
    otherUnitTr,
  });
});

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}:${v.nodes.map((n) => n.target.join(" ")).join(",")}`);
}
async function shot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(OUT, "screens", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "screens", lang, `${name}.png`), fullPage: true });
}
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

for (const [surface, path, apiPrefix] of SURFACES) {
  test(`F-DG4-144 remedies on ${surface}: phase, status, transformation chip, own dashboards; none_matching; limit kept`, async ({
    page,
  }, info) => {
    test.setTimeout(6 * 60_000);
    const lang = langOf(info);
    const reqs: URL[] = [];
    page.on("request", (r) => {
      if (r.url().includes(apiPrefix)) reqs.push(new URL(r.url()));
    });
    await signIn(page, lang, "dev.office");
    await page.goto(path);
    await expect(page.locator("main#main h1")).toBeVisible({ timeout: 20_000 });
    const P = `${surface}-`;
    const ids = (u: URL) => u.searchParams.getAll("transformationId").sort();
    const settle = async () => {
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
    };
    const blocked = async () =>
      page.locator("[data-filter-blocked]").evaluateAll((els) => els.map((e) => e.getAttribute("data-filter-blocked")));
    const withUnit = (from: number) => reqs.slice(from).filter((u) => u.searchParams.has("transformationId"));

    // B0
    let mark = reqs.length;
    await page.locator("[data-filter='bu']").selectOption(unitId);
    const tooMany = page.locator("[data-filter-blocked='too_many']");
    await tooMany.waitFor({ timeout: 15_000 }).catch(() => undefined);
    await settle();
    const noteText = (await tooMany.count()) ? flat(await tooMany.innerText()) : "";
    check(`${P}B0-too-many-shown`, (await blocked()).join() === "too_many", await blocked());
    check(`${P}B0-note-text-is-catalogue`, noteText === flat(tr(lang, "dashboards.filter.blocked.too_many")), noteText);
    check(`${P}B0-no-request-with-unit`, withUnit(mark).length === 0, withUnit(mark).map((u) => u.search));
    check(`${P}B0-axe`, (await axe(page)).length === 0, await axe(page));
    await shot(page, lang, `R5-${surface}-B0-too-many`);

    // B1 phase = Design
    mark = reqs.length;
    await page.locator("[data-filter='phase']").selectOption("design");
    await settle();
    let w = withUnit(mark);
    check(`${P}B1-phase-lifts-block`, (await blocked()).length === 0, await blocked());
    check(`${P}B1-phase-request-exact-ids`, w.length > 0 && JSON.stringify(ids(w[w.length - 1]!)) === JSON.stringify(design), {
      sent: w.map((u) => ids(u)),
      expected: design,
      phaseParam: w[w.length - 1]?.searchParams.get("phase"),
    });
    check(`${P}B1-phase-param-kept`, w.length > 0 && w[w.length - 1]!.searchParams.get("phase") === "design", w.map((u) => u.search));
    check(`${P}B1-axe`, (await axe(page)).length === 0, await axe(page));
    await shot(page, lang, `R5-${surface}-B1-phase-design`);

    // B2 status = active, phase cleared
    await page.locator("[data-filter='phase']").selectOption("");
    await settle();
    check(`${P}B2-pre-phase-cleared-too-many-back`, (await blocked()).join() === "too_many", await blocked());
    mark = reqs.length;
    await page.locator("[data-filter='status']").selectOption("active");
    await settle();
    w = withUnit(mark);
    check(`${P}B2-status-lifts-block`, (await blocked()).length === 0, await blocked());
    check(`${P}B2-status-request-exact-ids`, w.length > 0 && JSON.stringify(ids(w[w.length - 1]!)) === JSON.stringify(active), {
      sent: w.map((u) => ids(u)),
      expected: active,
    });
    await shot(page, lang, `R5-${surface}-B2-status-active`);

    // B3 phase = Realize together with status = active: nothing matches
    mark = reqs.length;
    await page.locator("[data-filter='phase']").selectOption("realize");
    await settle();
    const nm = page.locator("[data-filter-blocked='none_matching']");
    const nmText = (await nm.count()) ? flat(await nm.innerText()) : "";
    check(`${P}B3-none-matching`, (await blocked()).join() === "none_matching", await blocked());
    check(`${P}B3-none-matching-text`, nmText === flat(tr(lang, "dashboards.filter.blocked.none_matching")), nmText);
    check(`${P}B3-no-request`, withUnit(mark).length === 0, withUnit(mark).map((u) => u.search));
    check(`${P}B3-axe`, (await axe(page)).length === 0, await axe(page));
    await shot(page, lang, `R5-${surface}-B3-none-matching`);

    // B6 phase = Diagnose: 49 drafts + 2 active = 51 remain (status cleared) -> the limit holds
    await page.locator("[data-filter='status']").selectOption("");
    mark = reqs.length;
    await page.locator("[data-filter='phase']").selectOption("diagnose");
    await settle();
    check(`${P}B6-diagnose-51-still-too-many`, (await blocked()).join() === "too_many", await blocked());
    check(`${P}B6-no-request`, withUnit(mark).length === 0, withUnit(mark).map((u) => u.search));
    await page.locator("[data-filter='phase']").selectOption("");
    await settle();

    // B4 the transformation chip with a transformation beyond the unit's first 51 by code
    const beyond = all[all.length - 1]!;
    const trSelect = page.locator("[data-filter='transformation']");
    const offered = await trSelect.locator(`option[value='${beyond.id}']`).count();
    check(`${P}B4-beyond-51-offered`, offered === 1, { offered, beyond });
    mark = reqs.length;
    if (offered === 1) await trSelect.selectOption(beyond.id);
    await settle();
    w = withUnit(mark);
    check(`${P}B4-chip-lifts-block`, (await blocked()).length === 0, await blocked());
    check(`${P}B4-chip-request-exact-id`, w.length > 0 && JSON.stringify(ids(w[w.length - 1]!)) === JSON.stringify([beyond.id]), {
      sent: w.map((u) => ids(u)),
    });
    check(`${P}B4-axe`, (await axe(page)).length === 0, await axe(page));
    await shot(page, lang, `R5-${surface}-B4-transformation-chip`);

    // B5 a transformation of another unit under this unit's chip
    await page.goto(`${path}?bu=${unitId}&tr=${otherUnitTr}`);
    await expect(page.locator("main#main h1")).toBeVisible({ timeout: 20_000 });
    mark = 0;
    await settle();
    const leaked = reqs.filter((u) => u.searchParams.getAll("transformationId").includes(otherUnitTr));
    check(`${P}B5-other-unit-none-matching`, (await blocked()).join() === "none_matching", await blocked());
    check(`${P}B5-other-unit-never-requested`, leaked.length === 0, leaked.map((u) => u.search));
    await shot(page, lang, `R5-${surface}-B5-other-unit-chip`);

    // B8 regression: phase without the unit chip is organization-wide
    mark = reqs.length;
    await page.goto(`${path}?phase=design`);
    await expect(page.locator("main#main h1")).toBeVisible({ timeout: 20_000 });
    await settle();
    const org = reqs.slice(mark);
    check(`${P}B8-org-wide-phase-request`, org.length > 0 && org.every((u) => !u.searchParams.has("transformationId")) && org.some((u) => u.searchParams.get("phase") === "design"), org.map((u) => u.search));
    check(`${P}B8-no-blocked-note`, (await blocked()).length === 0, await blocked());

    // B7 the transformations' own dashboards
    if (surface === "overview") {
      await page.goto(`/transformations/${beyond.id}/dashboard`);
      const ok = await page.locator("main#main h1").isVisible({ timeout: 20_000 }).catch(() => false);
      await page.locator("main#main h1").waitFor({ timeout: 20_000 }).catch(() => undefined);
      check(`B7-own-dashboard-renders`, await page.locator("main#main h1").isVisible(), { ok });
      await shot(page, lang, `R5-B7-own-dashboard`);
    }
  });
}

test("Z every recorded check passed", async () => {
  const failed = checks.filter((c) => !c.pass);
  expect(failed.map((c) => `${c.id} ${c.detail.slice(0, 300)}`)).toEqual([]);
});
