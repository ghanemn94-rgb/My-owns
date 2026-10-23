// qa-verifier DG5 clean re-gate round 1 (T-DG5-RG-QA-R1) — independent demo-stack probes, RENDERED, in chromium-en and
// chromium-ar, on e2e/support/with-demo-stack.sh (mth-db seed-demo, MTH_ENV=demo, AUTH_MODE=dev; the demo role users
// roaming.user.<role> sign in through the dev sign-in, D-165). Copied into the disposable clone's e2e/ for the run only.
//  D1 REQ-PB-090 (A01): "the traceability view shows 'Low activation -> Proposition + journey -> Pass redesign + digital
//     activation -> Attach rate / activation -> Revenue uplift'". The register notes disclose that the product test
//     asserts the API response, not the rendered screen. Here the demo TL opens the traceability SCREEN, focuses each
//     chain's diagnosed issue, downstream, and the probe reads the rendered columns: each of the five B0147 labels
//     (typed here from the playbook table, never read from the dataset) must be rendered, in chain order, one per
//     column (diagnostic finding -> TOM gap -> initiative -> outcome KPI -> benefit). All three B0147 chains.
//  D2 REQ-S21-001 (A28/A22): the disclosed gap "the label on an approval opened from the inbox is not asserted by an
//     e2e": the demo BO opens the seeded pending approval from My Work and the probe asserts the synthetic label
//     "Synthetic demonstration - approves nothing real" (ar: the catalogue text) and the demo banner on it.
// Everything is SYNTHETIC; nothing is decided or approved; nothing names DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, shot } from "../apps/web/e2e/support/ui.ts";
import { catalogue, demoApi, demoPage, expectBanner } from "./support/a02-demo.ts";

const ROAMING = "01995000-0000-7000-8000-000000000001";
const B0147 = [
  ["Low activation", "Proposition + journey", "Pass redesign + digital activation", "Attach rate / activation", "Revenue uplift"],
  ["High complaints", "Journey + service assurance", "Proactive comms + QoS monitoring", "Complaint rate", "CX + care cost"],
  ["Partner cost pressure", "Partner model + analytics", "Partner optimization", "Cost/MB, margin", "Margin improvement"],
] as const;
const COLUMNS = ["diagnostic_finding", "tom_gap", "initiative", "outcome_kpi", "benefit"] as const;

/** The rendered graph: for each column (data-node-type, in DOM order), the visible names of its record links. */
async function columns(page: Page): Promise<{ type: string; names: string[] }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-trace-graph] [data-node-type]")).map((s) => ({
      type: s.dataset["nodeType"] ?? "",
      names: Array.from(s.querySelectorAll<HTMLElement>("[data-node-link]")).map((a) => a.innerText.trim().replace(/\s+/g, " ")),
    })),
  );
}

test.setTimeout(240_000);

test("QA D1 REQ-PB-090: the traceability SCREEN renders each B0147 chain, label by label, in chain order", async ({ browser }, info) => {
  const lang = langOf(info);
  const tl = await demoPage(browser, lang, "tl");
  await tl.goto(`/transformations/${ROAMING}/traceability`);
  await expect(tl.locator("main#main h1")).toBeVisible();
  await expectBanner(tl, lang);
  await expect(tl.locator("[data-trace-graph]")).toBeVisible();
  const whole = await columns(tl);
  console.info(`QA-D1 ${lang} whole graph columns: ${JSON.stringify(whole.map((c) => `${c.type}(${c.names.length})`))}`);
  const problems: string[] = [];
  for (const chain of B0147) {
    await tl.goto(`/transformations/${ROAMING}/traceability`);
    await expect(tl.locator("[data-trace-graph]")).toBeVisible();
    const issue = tl.locator("[data-node-type='diagnostic_finding'] .trace-node").filter({
      has: tl.locator("[data-node-link]", { hasText: chain[0] }),
    });
    if ((await issue.count()) !== 1) {
      problems.push(`"${chain[0]}": ${await issue.count()} rendered diagnostic-finding nodes carry this label (expected 1)`);
      continue;
    }
    await issue.locator("[data-action='focus']").click();
    await expect(tl.locator("[data-root]")).toBeVisible();
    await tl.locator("#trace-direction").selectOption("downstream");
    await tl.locator("#trace-depth").selectOption("8");
    await tl.waitForLoadState("networkidle");
    await expect(tl.locator("[data-trace-graph]")).toBeVisible();
    const cols = await columns(tl);
    const line = chain.join(" -> ");
    console.info(`QA-D1 ${lang} focused "${chain[0]}" downstream: ${JSON.stringify(cols)}`);
    let lastIndex = -1;
    for (let i = 0; i < chain.length; i += 1) {
      const idx = cols.findIndex((c) => c.type === COLUMNS[i]);
      if (idx < 0) {
        problems.push(`${line}: column ${COLUMNS[i]} is not rendered`);
        continue;
      }
      if (idx <= lastIndex) problems.push(`${line}: column ${COLUMNS[i]} is out of chain order`);
      lastIndex = idx;
      if (!cols[idx]!.names.some((n) => n === chain[i] || n.endsWith(` ${chain[i]}`) || n.includes(chain[i]!)))
        problems.push(`${line}: "${chain[i]}" is not rendered in column ${COLUMNS[i]} (${JSON.stringify(cols[idx]!.names)})`);
    }
    await shot(tl, lang, `qa-d1-trace-${chain[0].replace(/[^a-zA-Z]+/g, "-").toLowerCase()}`);
  }
  await expectAccessible(tl, lang, "qa-d1-trace");
  await tl.context().close();
  console.info(`QA-D1 ${lang}: ${problems.length} problem(s)`);
  expect(problems).toEqual([]);
});

test("QA D2 REQ-S21-001: the seeded pending approval opened from the BO's My Work shows the synthetic approval label", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const approvalLabel = catalogue(lang, "playbookP5.demo.approvalLabel");
  expect(approvalLabel).toBe(
    lang === "en" ? "Synthetic demonstration - approves nothing real" : "عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي",
  );
  const boApi = await demoApi(playwright, "bo");
  const pending = await boApi.call<{ items: { id: string }[] }>("GET", "/api/v1/approvals?role=assignee&status=pending&limit=100");
  console.info(`QA-D2 ${lang}: roaming.user.bo has ${pending.items.length} pending approval(s) as assignee`);
  expect(pending.items.length).toBeGreaterThan(0);
  const bo = await demoPage(browser, lang, "bo");
  await bo.goto("/my-work");
  await expect(bo.locator("main#main h1")).toBeVisible();
  await bo.waitForLoadState("networkidle");
  // Open it the way a user does: the first link in My Work that points at the approval.
  const link = bo.locator(`main a[href$='/my-work/approvals/${pending.items[0]!.id}']`).first();
  const viaInbox = (await link.count()) > 0;
  console.info(`QA-D2 ${lang}: a My Work link to the approval is ${viaInbox ? "present (clicked)" : "ABSENT (opened by URL)"}`);
  if (viaInbox) await link.click();
  else await bo.goto(`/my-work/approvals/${pending.items[0]!.id}`);
  await expect(bo).toHaveURL(new RegExp(`/my-work/approvals/${pending.items[0]!.id}$`));
  await expect(bo.locator("main#main h1")).toBeVisible();
  await expectBanner(bo, lang);
  const labels = bo.locator("main [data-state='synthetic-approval']");
  await expect(labels.first()).toBeVisible();
  for (const text of await labels.allInnerTexts()) expect(text.trim()).toBe(approvalLabel);
  await expectAccessible(bo, lang, "qa-d2-inbox-approval");
  await shot(bo, lang, "qa-d2-inbox-approval");
  await bo.context().close();
  await boApi.req.dispose();
  expect(viaInbox, "the approval is reachable from the assignee's My Work").toBe(true);
});
