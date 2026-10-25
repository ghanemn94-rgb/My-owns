// Scratch probe (T-DG5-FE-Y1, not a product test): containers that hold a table region, and whether any item overflows.
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { langOf, signIn } from "/home/user/wt/dg5-fe-y1/apps/web/e2e/support/ui.ts";
const T = "01995000-0000-7000-8000-000000000001";
const tr = ["", "diagnose","charter","define","design","decisions","gates","gates/G1","gates/G4","evidence","team","portfolio","readiness","dispensations","prioritization","roadmap","dependencies","capacity","business-cases","benefit-formulas","role-mappings","decision-rights","raci","transform-readiness","approval-decisions","kpis","kpi-review","data-quality","benefits","benefit-groups","benefit-overlaps","benefit-scenarios","benefit-valuation-methods","raid","raid-decision-log","actions","corrective-actions","corrective-action-rules","forums","meetings","executive-decisions","escalations","adoption","adoption-interventions","adoption-indicators","adoption-training","assessment-forms","bau","bau-handovers","bau-controls","bau-reviews","improvement","lessons","dashboard","traceability","modular-entry","workstreams","closure","change-requests","phases","finance-validations","methodology-migrations","config-pins","gate-conditions","reports","exports","presentation","owner-updates","evidence-register","launch-plan","day-90-test","health-check","financial-metrics"].map((p) => `/transformations/${T}${p ? "/" + p : ""}`);
const glob = ["/my-work","/my-work/approvals","/my-work/delegations","/admin/calendar","/admin/jobs","/governance/groups","/lessons","/executive-overview","/dashboards","/portfolios","/dashboards/rag-policy","/finance-validation","/transformations","/admin","/admin/organizations","/admin/users","/admin/assignments","/about","/admin/studio","/admin/studio/scoring-defaults","/admin/studio/review-policies","/admin/studio/revision-proposals","/admin/source-coverage","/admin/methodology-migrations","/admin/forms","/admin/procedures","/admin/coverage","/playbook/procedures","/admin/automation","/admin/automation/executions","/admin/automation/failures","/admin/jobs/operations","/admin/approval-routes","/my-work/notification-preferences","/evidence-reports/reports","/evidence-reports/exports","/evidence-reports/presentation","/evidence-reports/evidence-register","/initiatives-roadmaps/updates","/playbook/launch-plan","/playbook/health-check","/admin/health-schemes","/playbook/reader","/admin/branding","/admin/demo","/walkthrough"];
test.setTimeout(3_600_000);
test("sweep", async ({ browser }, info) => {
  const lang = langOf(info);
  const out: any = { diagnoseVariants: {}, screens: {}, containers: {} };
  const pages: Record<string, any> = {};
  for (const u of ["roaming.user.tl", "roaming.user.adm_access"]) {
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    const p = await ctx.newPage(); await signIn(p, lang, u); pages[u] = p;
  }
  const p = pages["roaming.user.tl"];
  // Diagnose variants: is item shrinkability alone enough, or is the track template needed?
  for (const [name, css] of [["fixed", ""], ["items-min0-auto-track", ".workstreams{grid-template-columns:none !important}"], ["track-only-items-auto", ".workstreams > .workstream{min-inline-size:auto !important}"], ["original", ".workstreams{grid-template-columns:none !important} .workstreams > .workstream{min-inline-size:auto !important}"]] as const) {
    await p.setViewportSize({ width: 390, height: 900 });
    await p.goto(`/transformations/${T}/diagnose`); await expect(p.locator("article.workstream").first()).toBeVisible(); await p.waitForLoadState("networkidle");
    out.diagnoseVariants[name] = await p.evaluate((c: string) => { const s = document.createElement("style"); s.textContent = c; document.head.appendChild(s); return { overflow: document.documentElement.scrollWidth - innerWidth, track: getComputedStyle(document.querySelector(".workstreams")!).gridTemplateColumns }; }, css);
  }
  for (const url of [...tr, ...glob]) {
    for (const [label, w, font] of [["390", 390, 0], ["200pct", 1280, 200]] as const) {
      let pg = p;
      await pg.setViewportSize({ width: w, height: 900 });
      await pg.goto(url);
      try { await expect(pg.locator("main#main h1")).toBeVisible({ timeout: 15000 }); } catch { out.screens[`${url} ${label}`] = "no h1"; continue; }
      if (font) await pg.evaluate((f: number) => (document.documentElement.style.fontSize = `${f}%`), font);
      await pg.waitForLoadState("networkidle"); await pg.waitForTimeout(300);
      if (await pg.locator("main [data-state='no-permission']").count()) {
        pg = pages["roaming.user.adm_access"]; await pg.setViewportSize({ width: w, height: 900 }); await pg.goto(url);
        try { await expect(pg.locator("main#main h1")).toBeVisible({ timeout: 15000 }); } catch { out.screens[`${url} ${label}`] = "no h1 (adm)"; continue; }
        if (font) await pg.evaluate((f: number) => (document.documentElement.style.fontSize = `${f}%`), font);
        await pg.waitForLoadState("networkidle"); await pg.waitForTimeout(300);
      }
      const r = await pg.evaluate(() => {
        const res: Record<string, { n: number; over: string[] }> = {};
        const main = document.querySelector("main#main")!;
        for (const el of [main, ...Array.from(main.querySelectorAll<HTMLElement>("*"))] as HTMLElement[]) {
          const d = getComputedStyle(el).display;
          if (!/grid|flex/.test(d) || !el.querySelector(".table-wrap")) continue;
          const key = `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").trim().split(/\s+/).join(".")} [${d}]`;
          const b = el.getBoundingClientRect();
          const over: string[] = [];
          for (const c of Array.from(el.children) as HTMLElement[]) {
            const k = c.getBoundingClientRect(); if (!k.width) continue;
            if (k.right > b.right + 1 || k.left < b.left - 1) over.push(`${c.tagName.toLowerCase()}.${(c.getAttribute("class") ?? "").split(/\s+/)[0]} [${Math.round(k.left)}..${Math.round(k.right)}] in [${Math.round(b.left)}..${Math.round(b.right)}]`);
          }
          res[key] ??= { n: 0, over: [] }; res[key].n++; res[key].over.push(...over);
        }
        return { overflow: document.documentElement.scrollWidth - innerWidth, regions: document.querySelectorAll("main .table-wrap").length, res };
      });
      out.screens[`${url} ${label}`] = { overflow: r.overflow, regions: r.regions };
      for (const [k, v] of Object.entries(r.res)) {
        out.containers[k] ??= { screens: 0, overflowing: [] as string[] }; out.containers[k].screens++;
        if (v.over.length) out.containers[k].overflowing.push(`${url} ${label}: ${v.over.slice(0, 2).join("; ")}`);
      }
    }
  }
  writeFileSync(`${process.env.TMPDIR}/sweep-${lang}.json`, JSON.stringify(out, null, 1));
});
