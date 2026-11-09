// qa-verifier DG6 round 9 (T-DG6-REV-QA-R9, run 7e2124db): round 8's standing probe zz-qa-dg6r8-exception-last-error.spec.ts re-used on candidate fe824c05 (source d974011f); changes: names r8 -> r9 only.
// qa-verifier DG6 round 8 (T-DG6-REV-QA-R9) on candidate 6cda8b33: copied from tests/round-7/zz-qa-dg6r7-exception-last-error.spec.ts; the only change is the rename of identifiers dg6r7 -> dg6r9 and QA-R7 -> QA-R9 (the comments below are the earlier rounds' text).
// qa-verifier DG6 round 7 (T-DG6-REV-QA-R9) on candidate b64b95ff: copied from tests/round-6/zz-qa-dg6r6-exception-last-error.spec.ts; the only change is the rename of identifiers dg6r6 -> dg6r9 and QA-R6 -> QA-R9 (the comments below are the round-6 text).
// qa-verifier DG6 round 6 (T-DG6-REV-QA-R9; copied unchanged from my round-5 probe except names): independent probe, NOT part of the frozen candidate. Copied into a
// disposable clone as e2e/zz-qa-dg6r9-exception-last-error.spec.ts and run LAST in the root acceptance run on
// apps/web/e2e/support/with-stack.sh (after a17-failing-connector-exception has made a KPI Stale and opened a connector
// exception, and a22-p6-operability has opened a heartbeat_missed exception, on the same stack).
// Verifies F-DG6-320 (round 4, Low): "Last error" on the operational exception page showed the raw code for
// kpi.stale and operations.heartbeat_missed. The round-4 reproduction (zz-qa-dg6r4-exception-last-error.spec.ts) only
// RECORDED the shown text; this version ASSERTS, for every distinct lastErrorCode on the stack, in en and ar:
//   - the value is a catalogue text ([data-error-text]), not the raw code;
//   - in ar it contains Arabic letters and is not the server's English lastErrorMessage.
// To get a REAL kpi.stale exception (no e2e of the candidate raises one), it starts the production worker and runs the
// scheduled job kpi.freshness_scan once through runJobNow (POST /api/v1/admin/jobs/kpi.freshness_scan/run, as
// dev.admin), then polls the exception list until the worker's raise (operations.exception_raise) has stored it.
// SYNTHETIC data only; nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { expect, test } from "@playwright/test";
import { apiSession, langOf, signIn, tr } from "../apps/web/e2e/support/ui.ts";
import { poll, psql, startProductionWorker, type ProductionWorker } from "./support/a13-a22-stack.ts";

test.describe.configure({ timeout: 300_000 });

type Body = Record<string, unknown>;
const ARABIC = /[؀-ۿ]/;
const MUST_HAVE = ["kpi.stale", "operations.heartbeat_missed"];

let worker: ProductionWorker | null = null;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  worker = await startProductionWorker();
});
test.afterAll(async () => {
  await worker?.stop();
});

test("operational exception 'Last error' is a catalogue text for every lastErrorCode, en and ar (F-DG6-320)", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const me = await admin.call<Body>("GET", "/api/v1/me");
  const orgId = String((me["organization"] as Body | undefined)?.["id"] ?? "");
  const list = async () =>
    (await admin.call<{ items: Body[] }>("GET", `/api/v1/admin/operations/exceptions?organizationId=${orgId}&limit=100`))
      .items;

  // A real stale-data exception: the scheduled freshness scan, run now, through the production worker.
  if (!(await list()).some((x) => x["lastErrorCode"] === "kpi.stale")) {
    const run = await admin.call<Body>("POST", "/api/v1/admin/jobs/kpi.freshness_scan/run");
    console.log(`QA-R5 RUN-NOW ${lang}: ${JSON.stringify(run)}`);
    // Needs a Stale KPI with a last value on the stack (a17-failing-connector-exception makes one); without it the
    // scan raises nothing, which the soft check below reports (round-5 a22-only repeat run).
    await poll(
      async () => (await list()).some((x) => x["lastErrorCode"] === "kpi.stale"),
      "a kpi.stale operational exception raised by the worker",
      150_000,
    ).catch((e: unknown) => console.log(`QA-R5 NO-STALE ${lang}: ${(e as Error).message}`));
  }
  const items = await list(); // the org-scoped list also returns the organization-less heartbeat exception (round 4)
  // Round-5 first run: after a22-p6-operability RESOLVES its heartbeat exception, the org-scoped list no longer returns
  // it (that exception has no organization). Its id is then read as the database owner (any status): the page shows
  // "Last error" for a resolved exception as well.
  if (!items.some((x) => x["lastErrorCode"] === "operations.heartbeat_missed")) {
    const ids = psql(
      "SELECT id FROM operational_exception WHERE failure_class = 'heartbeat_missed' ORDER BY last_occurred_at DESC LIMIT 1",
    );
    if (ids.length === 1)
      items.push(await admin.call<Body>("GET", `/api/v1/admin/operations/exceptions/${ids[0]}`));
  }
  const byCode = new Map<string, Body>();
  for (const x of items) if (!byCode.has(String(x["lastErrorCode"]))) byCode.set(String(x["lastErrorCode"]), x);
  console.log(`QA-R5 EXCEPTIONS ${lang}: ${items.length} rows; codes ${JSON.stringify([...byCode.keys()])}`);
  for (const c of MUST_HAVE)
    expect.soft(byCode.has(c), `an exception with lastErrorCode ${c} exists on this stack`).toBe(true);

  await signIn(page, lang, "dev.admin");
  const label = tr(lang, "adminP6.operations.lastError");
  for (const [code, x] of byCode) {
    await page.goto(`/admin/operations/exceptions/${String(x["id"])}`);
    await expect(page.locator("main#main h1")).toBeVisible();
    const dd = page.locator("main#main dt", { hasText: label }).first().locator("xpath=following-sibling::dd[1]");
    await expect(dd).toBeVisible();
    const shown = ((await dd.textContent()) ?? "").trim();
    const hasText = (await dd.locator(`[data-error-text="${code}"]`).count()) === 1;
    const dir = await page.locator("html").getAttribute("dir");
    console.log(
      `QA-R5 LAST-ERROR ${lang}: code=${code} failureClass=${String(x["failureClass"])} dir=${dir} ` +
        `shown=${JSON.stringify(shown)} catalogueText=${hasText} serverMessage=${JSON.stringify(String(x["lastErrorMessage"]))}`,
    );
    expect.soft(hasText, `${code}: catalogue text, not the raw code`).toBe(true);
    expect.soft(shown, `${code}: not the raw code`).not.toBe(code);
    if (lang === "ar") {
      expect.soft(shown, `${code}: Arabic text`).toMatch(ARABIC);
      expect.soft(shown, `${code}: never the server's English message`).not.toBe(String(x["lastErrorMessage"]));
      expect.soft(dir).toBe("rtl");
    } else expect.soft(dir).toBe("ltr");
    await page.screenshot({ path: `${process.env["E2E_SCREENSHOT_DIR"] ?? "."}/qa-r5-exception-${lang}-${code}.png` });
  }
});
