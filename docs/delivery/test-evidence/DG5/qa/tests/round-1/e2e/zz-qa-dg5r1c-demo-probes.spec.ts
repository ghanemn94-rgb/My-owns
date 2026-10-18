// qa-verifier DG5 round 1 (T-DG5-REV-QA-R1C) independent probes on the DEMO stack (e2e/support/with-demo-stack.sh).
// NOT part of the candidate: copied into a disposable clone's e2e/ only for the run, then removed.
//  P-PB-090: the B0147 chains as RENDERED by the traceability screen (the candidate asserts the API response only).
//  P-S21-001: the synthetic approval label on an approval OPENED FROM THE INBOX (disclosed as not asserted by an e2e).
//  P-REFLOW: 390 px wide and 200 % text on the P5 screens: no page-level horizontal scroll; axe at 390 px.
// Everything is SYNTHETIC (an illustrative example, not Mobily actual performance; approves nothing real).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, shot, type Lang } from "../apps/web/e2e/support/ui.ts";
import { catalogue, demoApi, demoPage } from "./support/a02-demo.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ROAMING = "01995000-0000-7000-8000-000000000001";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r1c");
test.setTimeout(600_000);

const CHAINS = [
  ["Low activation", "Proposition + journey", "Pass redesign + digital activation", "Attach rate / activation", "Revenue uplift"],
  ["High complaints", "Journey + service assurance", "Proactive comms + QoS monitoring", "Complaint rate", "CX + care cost"],
  ["Partner cost pressure", "Partner model + analytics", "Partner optimization", "Cost/MB, margin", "Margin improvement"],
]; // verbatim from docs/source/playbook.md B0147 table

test("P-PB-090: the traceability screen renders each B0147 chain's five labels", async ({ browser }, info) => {
  const lang = langOf(info);
  const p = await demoPage(browser, lang, "tl");
  await p.goto(`/transformations/${ROAMING}/traceability`);
  await expect(p.locator("main#main h1")).toBeVisible();
  await p.waitForLoadState("networkidle");
  const text = (await p.locator("main#main").innerText()).replace(/\s+/g, " ");
  const missing: string[] = [];
  for (const chain of CHAINS) for (const label of chain) if (!text.includes(label)) missing.push(label);
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "traceability-main-text.txt"), text);
  await shot(p, lang, "r1c-traceability");
  console.info(`P-PB-090 ${lang}: missing labels on the rendered screen: ${JSON.stringify(missing)}`);
  expect(missing).toEqual([]);
  await p.context().close();
});

test("P-S21-001: an approval opened from the inbox shows the synthetic approval label", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const bo = await demoApi(playwright, "bo");
  const pending = await bo.call<Body>("GET", "/api/v1/approvals?role=assignee&status=pending&limit=100");
  console.info(`P-S21-001 ${lang}: pending approvals of roaming.user.bo: ${pending.items.length}`);
  expect(pending.items.length).toBeGreaterThan(0);
  const p = await demoPage(browser, lang, "bo");
  await p.goto("/my-work/approvals");
  await expect(p.locator("main#main h1")).toBeVisible();
  await p.locator(`a[href$='/my-work/approvals/${pending.items[0].id}']`).first().click();
  await expect(p).toHaveURL(new RegExp(`/my-work/approvals/${pending.items[0].id}$`));
  const label = p.locator("[data-state='synthetic-approval']");
  await expect(label.first()).toBeVisible();
  await expect(label.first()).toContainText(catalogue(lang, "playbookP5.demo.approvalLabel"));
  await shot(p, lang, "r1c-inbox-approval-label");
  await p.context().close();
});

async function overflowOf(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** Diagnostic: the deepest elements that stick out of the viewport (for the finding's reproduction). */
async function offenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("main#main *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || (r.right <= w + 1 && r.left >= -1)) continue;
      // keep only elements none of whose children also stick out (the innermost cause)
      const kids = Array.from(el.children).some((c) => {
        const k = c.getBoundingClientRect();
        return k.width > 0 && (k.right > w + 1 || k.left < -1);
      });
      if (kids) continue;
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 2).join(".");
      const attrs = Array.from(el.attributes)
        .filter((a) => a.name.startsWith("data-") || a.name === "name" || a.name === "type")
        .map((a) => `[${a.name}=${a.value.slice(0, 30)}]`)
        .join("");
      out.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${attrs} left=${Math.round(r.left)} right=${Math.round(r.right)} w=${Math.round(r.width)} "${(el.textContent ?? "").trim().slice(0, 40)}"`);
      if (out.length >= 8) break;
    }
    return out;
  });
}

const P5_SCREENS: Array<[string, string]> = [
  ["tl", "/playbook/reader"],
  ["tl", "/playbook/reader/B0031"],
  ["tl", "/playbook/procedures"],
  ["tl", "/playbook/launch-plan"],
  ["tl", "/playbook/health-check"],
  ["tl", `/transformations/${ROAMING}/launch-plan`],
  ["tl", `/transformations/${ROAMING}/day-90-test`],
  ["tl", `/transformations/${ROAMING}/health-check`],
  ["tl", `/transformations/${ROAMING}/reports`],
  ["tl", `/transformations/${ROAMING}/exports`],
  ["tl", `/transformations/${ROAMING}/presentation`],
  ["tl", `/transformations/${ROAMING}/owner-updates`],
  ["tl", `/transformations/${ROAMING}/evidence-register`],
  ["tl", `/transformations/${ROAMING}/financial-metrics`],
  ["tl", `/transformations/${ROAMING}/gate-conditions`],
  ["tl", `/transformations/${ROAMING}/config-pins`],
  ["tl", `/transformations/${ROAMING}/traceability`],
  ["tl", "/walkthrough"],
  ["tl", "/my-work/notification-preferences"],
  ["to", "/admin/studio"],
  ["to", "/admin/studio/scoring-defaults"],
  ["to", "/admin/forms"],
  ["to", "/admin/procedures"],
  ["to", "/admin/automation"],
  ["to", "/admin/automation/failures"],
  ["to", "/admin/jobs/operations"],
  ["to", "/admin/approval-routes"],
  ["to", "/admin/source-coverage"],
  ["to", "/admin/health-schemes"],
  ["adm_access", "/admin/branding"],
  ["adm_access", "/admin/demo"],
];

test("P-REFLOW: P5 screens at 390 px and with 200 % text have no page-level horizontal scroll; axe at 390 px", async ({ browser }, info) => {
  const lang: Lang = langOf(info);
  const results: Array<Record<string, unknown>> = [];
  const pages = new Map<string, Page>();
  for (const [role, url] of P5_SCREENS) {
    let p = pages.get(role);
    if (!p) {
      p = await demoPage(browser, lang, role as never);
      pages.set(role, p);
    }
    const name = url.replace(ROAMING, "T").replace(/[^a-zA-Z0-9]+/g, "_");
    const row: Record<string, unknown> = { role, url: url.replace(ROAMING, "<roaming>") };
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(url);
    await expect(p.locator("main#main h1")).toBeVisible();
    await p.waitForLoadState("networkidle");
    row["h1"] = (await p.locator("main#main h1").innerText()).slice(0, 80);
    row["overflow390"] = await overflowOf(p);
    if ((row["overflow390"] as number) > 1) row["offenders390"] = await offenders(p);
    // REQ-S18-001: the persistent synthetic banner on every demo screen, with its catalogue text in the language.
    const banner = p.locator("[data-state='demo-synthetic']");
    row["banner"] =
      (await banner.count()) === 1 && (await banner.innerText()).trim() === catalogue(lang, "playbookP5.demo.banner").trim();
    await shot(p, lang, `r1c-390-${name}`);
    try {
      await expectAccessible(p, lang, `r1c-390-${name}`);
      row["axe390"] = "no serious/critical";
    } catch (e) {
      row["axe390"] = String(e).slice(0, 600);
    }
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.goto(url);
    await expect(p.locator("main#main h1")).toBeVisible();
    await p.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await p.waitForLoadState("networkidle");
    row["overflow200pct"] = await overflowOf(p);
    if ((row["overflow200pct"] as number) > 1) row["offenders200pct"] = await offenders(p);
    await shot(p, lang, `r1c-200pct-${name}`);
    results.push(row);
  }
  for (const p of pages.values()) await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "reflow-results.json"), JSON.stringify(results, null, 1));
  console.info(`P-REFLOW ${lang}: ${JSON.stringify(results)}`);
  const bad = results.filter(
    (r) =>
      (r["overflow390"] as number) > 1 ||
      (r["overflow200pct"] as number) > 1 ||
      r["axe390"] !== "no serious/critical" ||
      r["banner"] !== true,
  );
  expect(bad).toEqual([]);
});
