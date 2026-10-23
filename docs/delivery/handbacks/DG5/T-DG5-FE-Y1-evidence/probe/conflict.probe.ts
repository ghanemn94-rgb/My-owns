// Scratch harness (T-DG5-FE-Y1, not a product test): the real built stylesheet, the conflict banner's markup
// (components/States.tsx ConflictPanel / RecordForm.tsx) inside .app-main > .page at 390 px and with 200 % text.
import { readFileSync, readdirSync } from "node:fs";
import { test } from "@playwright/test";
const dist = process.env.WEB_DIST!;
const css = readdirSync(`${dist}/assets`).filter((f) => f.endsWith(".css")).map((f) => readFileSync(`${dist}/assets/${f}`, "utf8")).join("\n");
const S = {
  en: { dir: "ltr", title: "Someone else changed this record", cap: "Your unsaved values compared with the current saved values", f: "Field", m: "Your value (not saved)", c: "Current saved value", row: "Statement" },
  ar: { dir: "rtl", title: "عدّل شخص آخر هذا السجل", cap: "قيمك غير المحفوظة مقارنةً بالقيم المحفوظة حاليًا", f: "الحقل", m: "قيمتك (غير محفوظة)", c: "القيمة المحفوظة حاليًا", row: "البيان" },
};
for (const lang of ["en", "ar"] as const)
  for (const [label, w, font, value] of [["390 short", 390, 100, "Synthetic value"], ["390 long-token", 390, 100, "https://evidence.example.invalid/synthetic/a-very-long-unbroken-reference-0123456789"], ["200pct short", 1280, 200, "Synthetic value"]] as const)
    test(`conflict ${lang} ${label}`, async ({ page }) => {
      const s = S[lang];
      await page.setViewportSize({ width: w, height: 900 });
      await page.setContent(`<!doctype html><html lang="${lang}" dir="${s.dir}" style="font-size:${font}%"><head><style>${css}</style></head><body>
<div class="app-body" style="display:block"><main id="main" class="app-main"><div class="page"><section class="card section"><div class="banner banner--warning conflict" role="alert" data-state="conflict">
<h2 class="conflict__title">${s.title}</h2><p>v3 / v4</p>
<table class="table table--compact"><caption>${s.cap}</caption><thead><tr><th scope="col">${s.f}</th><th scope="col">${s.m}</th><th scope="col">${s.c}</th></tr></thead>
<tbody><tr><th scope="row">${s.row}</th><td>${value}</td><td>Synthetic other value</td></tr></tbody></table>
<div class="form__actions"><button class="button button--primary">Re-apply</button></div></div></section></div></main></div></body></html>`);
      const r = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, banner: Math.round(document.querySelector(".conflict")!.getBoundingClientRect().width), table: Math.round(document.querySelector(".conflict table")!.getBoundingClientRect().width) }));
      console.info(`CONFLICT ${lang} ${label}: ${JSON.stringify(r)}`);
    });
