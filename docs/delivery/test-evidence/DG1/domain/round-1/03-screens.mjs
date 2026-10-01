import { chromium } from "@playwright/test";
const B = "http://localhost:3000", OUT = process.env.SHOTS;
const browser = await chromium.launch();
const log = (...a) => console.log(...a);
async function api(page, method, path, body, etag) {
  return page.evaluate(async ({ method, path, body, etag }) => {
    const me = await (await fetch("/api/v1/me")).json();
    const h = { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken };
    if (method === "POST") h["Idempotency-Key"] = "domrev-" + Math.random().toString(36).slice(2, 12);
    if (etag) h["If-Match"] = `"${etag}"`;
    const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { method, path, body, etag });
}
async function session(user, lang) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(B + "/login");
  const f = page.getByLabel(/Username|اسم المستخدم/);
  await f.fill(user); await f.press("Enter");
  await page.waitForURL("**/my-work");
  await page.getByTestId("wordmark").waitFor();
  await page.waitForTimeout(500);
  if ((await page.locator("html").getAttribute("lang")) !== lang) {
    await page.getByRole("button", { name: lang === "en" ? /English/ : /العربية/ }).click();
    await page.waitForTimeout(500);
  }
  log(user, lang, "html lang=", await page.locator("html").getAttribute("lang"), "dir=", await page.locator("html").getAttribute("dir"));
  return { ctx, page };
}
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
for (const lang of ["en", "ar"]) {
  const { ctx, page } = await session("dev.office", lang);
  await shot(page, `${lang}-01-my-work-office`);
  await page.goto(B + "/about"); await page.waitForTimeout(800); await shot(page, `${lang}-02-about`);
  log(lang, "about text has 'not an official PMI'/'ليس معيارًا رسميًا':", /not an official PMI|ليس معيارًا رسميًا/.test(await page.locator("main").innerText()));
  const c = await api(page, "POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic closure UI ${lang}`, mode: "end_to_end" });
  const id = c.body.id;
  await api(page, "PATCH", `/api/v1/transformations/${id}`, { status: "active" }, 1);
  await page.goto(B + `/transformations/${id}/edit`); await page.waitForTimeout(1000); await shot(page, `${lang}-03-edit-active-status-options`);
  const opts = await page.locator("select").evaluateAll(ss => ss.map(s => [...s.options].map(o => o.textContent)));
  log(lang, "edit form select options:", JSON.stringify(opts));
  const cl = await api(page, "PATCH", `/api/v1/transformations/${id}`, { status: "closed" }, 2);
  log(lang, "close status:", cl.status, cl.body?.status);
  await page.goto(B + `/transformations/${id}`); await page.waitForTimeout(1000); await shot(page, `${lang}-04-detail-closed`);
  await page.goto(B + "/transformations/new"); await page.waitForTimeout(1000); await shot(page, `${lang}-05-create-form`);
  await ctx.close();
  const L = await session("dev.lead", lang);
  const c2 = await api(L.page, "POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic TL create ${lang}`, mode: "end_to_end" });
  log(lang, "TL create:", c2.status);
  await L.page.goto(B + `/transformations/${c2.body.id}`); await L.page.waitForTimeout(1000); await shot(L.page, `${lang}-06-tl-after-create`);
  log(lang, "TL detail h1:", (await L.page.locator("main").innerText()).slice(0,200).replace(/\n/g," | "));
  await L.ctx.close();
}
await browser.close();
