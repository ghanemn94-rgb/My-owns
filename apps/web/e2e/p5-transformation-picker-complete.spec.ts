// T-DG5-FE-AB2 (D-181; REQ-S15 usability): a transformation picker offers EVERY transformation the user may see, not
// one page of them. Against the REAL API (apps/web/e2e/support/with-stack.sh), in EN and AR.
//  - Through the API, the lead (TL) makes sure more than 100 transformations exist (PAGINATION.maxLimit is 100, the
//    page size the old picker loaded once), then creates one more: the newest, whose code sorts last.
//  - The API itself shows the regression's precondition: the first page of `code:asc` (limit 100) does not contain
//    the newest one, so a one-page picker cannot offer it.
//  - On "My procedures", the launch form's transformation picker (shown once `baseline_validation`, a
//    transformation-scoped procedure, is chosen) offers the newest one and as many options as the API lists in all
//    of its pages. It is chosen; nothing is launched (the launch itself is covered by p5-procedure-outputs.spec.ts).
// All data is SYNTHETIC. Nothing here is a business approval, and nothing touches the engineering gates DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";

const h1 = (page: Page) => page.locator("main#main h1");
const PAGE_LIMIT = 100;

interface TrPage {
  items: { id: string; code: string }[];
  nextCursor: string | null;
}

test("Transformation picker: with more than 100 transformations, the launch-procedure picker offers the newest one", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(240_000);
  const lang: Lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");

  /** Every transformation the lead may see, through every page of the list operation. */
  const listAll = async () => {
    const all: { id: string; code: string }[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ sort: "code:asc", limit: String(PAGE_LIMIT) });
      if (cursor) query.set("cursor", cursor);
      const p: TrPage = await lead.call<TrPage>("GET", `/api/v1/transformations?${query.toString()}`);
      all.push(...p.items);
      cursor = p.nextCursor;
    } while (cursor);
    return all;
  };

  // 1. More than 100 transformations exist (the ones already in this database count), then the newest one.
  const before = await listAll();
  for (let i = before.length; i <= PAGE_LIMIT; i++) {
    await lead.call("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic FE-AB2 ${lang.toUpperCase()} filler ${i + 1}`,
      mode: "end_to_end",
    });
  }
  const newest = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-AB2 ${lang.toUpperCase()} newest`,
    mode: "end_to_end",
  });
  const all = await listAll();
  expect(all.length).toBeGreaterThan(PAGE_LIMIT);
  expect(all.map((x) => x.id)).toContain(newest.id);
  const firstPage = await lead.call<TrPage>("GET", `/api/v1/transformations?sort=code:asc&limit=${PAGE_LIMIT}`);
  expect(firstPage.nextCursor).not.toBeNull();
  expect(firstPage.items.map((x) => x.id)).not.toContain(newest.id);

  // 2. The launch-procedure picker offers the newest one, and every transformation the API lists.
  await signIn(page, lang, "dev.lead");
  await page.goto("/playbook/procedures");
  await expect(h1(page)).toHaveText(tr(lang, "nav.p5.myProcedures.title"));
  const launch = page.locator("[data-form='launch-procedure']");
  await launch.getByLabel(tr(lang, "workflowsP5.procedures.procedure")).selectOption("baseline_validation");
  const picker = launch.getByLabel(tr(lang, "workflowsP5.field.transformation"));
  await expect(picker.locator(`option[value="${newest.id}"]`)).toHaveCount(1);
  await expect(picker.locator("option:not([value=''])")).toHaveCount(all.length);
  await picker.selectOption(newest.id);
  await expect(picker).toHaveValue(newest.id);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await shot(page, lang, "fe-ab2-launch-picker-all-transformations");
  await expectAccessible(page, lang, "fe-ab2-launch-picker-all-transformations");
  expect(foreign).toEqual([]);
});
