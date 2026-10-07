// domain-reviewer DG2 round 11 (T-DG2-REV-DOM-R11): browser walk of the P2 screens in EN (LTR) and AR (RTL). SYNTHETIC data.
// For one synthetic transformation it opens Diagnose, Define, Design, Gates, the G1 gate detail and Evidence in each
// language and checks: <html dir/lang>; the page renders (no not-found page); the gates page lists the B0023 gate names
// (EN) / the Arabic names (AR); no text claims PMI certification or official Mobily branding; nothing names DG0-DG7.
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const out = [];
const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const login = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "dev.lead" }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
const t = await (await fetch(`${BASE}/api/v1/transformations`, { method: "POST", headers: { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ businessUnitId: "01920000-0000-7000-9000-000000000102", name: "Synthetic R11 walk ‏تحول تجريبي", mode: "end_to_end" }) })).json();
const EN_GATES = ["G1 - Case for Change", "G2 - Direction", "G3 - Target State", "G4 - Mobilization", "G5 - Scale", "G6 - Sustain"];
const AR_GATES = ["مبررات التغيير", "التوجّه", "الحالة المستهدفة"];
const FORBIDDEN = /PMI[- ]certified|certified by PMI|official PMI|PMI standard|official Mobily|معتمد من PMI|\bDG[0-7]\b/i;
const b = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + "/login");
  const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter");
  await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(500);
  for (const page of ["diagnose", "define", "design", "gates", "gates/G1", "evidence"]) {
    await p.goto(`${BASE}/transformations/${t.id}/${page}`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(400);
    const dir = await p.locator("html").getAttribute("dir"), hl = await p.locator("html").getAttribute("lang");
    const text = await p.locator("body").innerText();
    const notFound = /There is no page at this address|لا توجد صفحة بهذا العنوان/.test(text);
    const expDir = lang === "ar" ? "rtl" : "ltr";
    rec(`WALK.${lang}.${page}.dir`, `lang=${lang} dir=${expDir}; page rendered`, `lang=${hl} dir=${dir}; notFound=${notFound}; chars=${text.length}`, hl === lang && dir === expDir && !notFound && text.length > 50);
    const bad = text.match(FORBIDDEN);
    rec(`WALK.${lang}.${page}.no-certification-claim`, "no PMI/Mobily certification claim; no DG0-DG7", bad ? `found '${bad[0]}'` : "none", !bad);
    if (page === "gates") {
      const want = lang === "en" ? EN_GATES : AR_GATES;
      const miss = want.filter((g) => !text.includes(g));
      rec(`WALK.${lang}.gates.names`, `gate names ${JSON.stringify(want)}`, `missing=${JSON.stringify(miss)}`, miss.length === 0);
      await p.screenshot({ path: `${OUT}/${lang}-r11-gates.png`, fullPage: true });
    }
    if (page === "design") await p.screenshot({ path: `${OUT}/${lang}-r11-design.png`, fullPage: true });
  }
  const brand = await p.locator("body").innerText();
  rec(`WALK.${lang}.brand-provisional`, "provisional wordmark text present", /provisional|مؤقت/i.test(brand) ? "present" : "absent", /provisional|مؤقت/i.test(brand));
  await ctx.close();
}
await b.close();
console.log(`SUMMARY ${out.filter(Boolean).length}/${out.length} PASS`);
process.exit(out.every(Boolean) ? 0 : 1);
