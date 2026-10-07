// domain-reviewer DG2 round 13 (T-DG2-REV-DOM-R13): is the redirect loop seen in r13-ui-withdrawn.mjs specific to the
// evidence upload, or does it follow ANY session end while the app is open? EN (LTR) and AR (RTL). SYNTHETIC data.
// (a) dev.lead is signed in on My work. The session is ended from outside the page (POST /api/v1/auth/logout with the
//     browser's own cookie, i.e. "signed out in another tab"). The user then clicks an in-app link (SPA navigation; no
//     upload, no mutation). Timeline sampled for 10 s: path, whether the page is blank, whether the sign-in form and the
//     localized session-ended message are visible, and how many /me requests the tab makes.
// (b) Control: the same, but the user reloads the page instead of clicking (React Query's cache is empty after a reload).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const I = (l, f) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/${f}.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const b = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const A = I(lang, "auth"); const msg = A.errors.session_expired;
  for (const variant of ["in-app-link", "reload-control"]) {
    const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    let me = 0; p.on("request", (r) => { if (new URL(r.url()).pathname === "/api/v1/me") me++; });
    await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter"); await p.waitForURL("**/my-work");
    if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
    await p.waitForTimeout(800);
    // end the session from outside the page ("another tab")
    const csrf = await p.evaluate(async () => (await (await fetch("/api/v1/me")).json()).csrfToken);
    const lo = await p.evaluate(async (c) => (await fetch("/api/v1/auth/logout", { method: "POST", headers: { "x-csrf-token": c, "content-type": "application/json" }, body: "{}" })).status, csrf);
    me = 0; const t0 = Date.now();
    if (variant === "in-app-link") await p.locator('a[href="/transformations"]').first().click();
    else await p.reload();
    const timeline = []; let last = ""; let settled = null;
    for (let i = 0; i < 40; i++) {
      const url = new URL(p.url()); const text = (await p.locator("body").innerText().catch(() => "")).trim();
      const form = await p.locator("input").count();
      const state = `${url.pathname}${url.searchParams.get("error") ? `?error=${url.searchParams.get("error")}` : ""} blank=${!text} signInForm=${form > 0} msg=${text.includes(msg)}`;
      if (state !== last) { timeline.push(`+${Date.now() - t0}ms ${state}`); last = state; }
      if (url.pathname === "/login" && form > 0 && settled === null) settled = Date.now() - t0;
      await p.waitForTimeout(250);
    }
    const final = { path: new URL(p.url()).pathname, form: (await p.locator("input").count()) > 0, msg: (await p.locator("body").innerText()).includes(msg), dir: await p.locator("html").getAttribute("dir") };
    await p.screenshot({ path: `${OUT}/${lang}-r13-session-end-${variant}.png`, fullPage: false });
    console.log(`TIMELINE ${lang} ${variant} (logout=${lo}; /me requests in 10 s: ${me})\n  ${timeline.slice(0, 12).join("\n  ")}${timeline.length > 12 ? `\n  … ${timeline.length - 12} more state changes` : ""}`);
    rec(`${lang}.${variant}`, `after the session ends, the user lands on the sign-in form (dir ${lang === "ar" ? "rtl" : "ltr"})${variant === "in-app-link" ? ` with '${msg}'` : ""}, with a bounded number of /me requests`, `logout=${lo}; final=${JSON.stringify(final)}; reached sign-in form at ${settled}ms; state changes=${timeline.length}; /me requests in 10 s=${me}`, lo === 200 && final.path === "/login" && final.form && (variant !== "in-app-link" || final.msg) && final.dir === (lang === "ar" ? "rtl" : "ltr") && me < 20);
    await ctx.close();
  }
}
await b.close();
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
