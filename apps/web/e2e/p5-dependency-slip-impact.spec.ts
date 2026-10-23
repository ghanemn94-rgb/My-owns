// A critical dependency slip's forecast impact reaches the screens (T-DG5-FE-RG1, F-DG5-120; REQ-S12-012 "notifications
// and forecast update", M0232; ADR-0044 §7; D-166 Rule B) on the REAL API, chromium-en and chromium-ar. Read-only
// screens over listDependencySlips (GET /transformations/{id}/dependency-slips; no contract change).
// Two stacks, one spec (no skipped test on either):
//  - the DEMO stack (e2e/support/with-demo-stack.sh; GET /environment answers `synthetic: true`): the domain reviewer's
//    reproduction (docs/delivery/test-evidence/DG5/domain/round-1/probe/zz-dom-r1-slip.spec.ts; read, not imported).
//    roaming.user.tl moves the forecast of INI-03's milestone "Partner usage feed live for digital activation" 5 days
//    later through the real API (DEP-01: INI-01 needs it by 2026-10-01); the production worker (apps/worker/dist,
//    started here) relays dependency.slipped and runs starter 9. The affected owner (found from the slip) then sees,
//    signed in through the dev sign-in form: on My Work the work item names DEP-01, the slip in days and INI-01 (not the
//    generic "open the record for details" label); on the Dependencies page (the work item's link) and on INI-01's
//    page, the slip with INI-01's forecast finish before -> after exactly as the API recorded it.
//  - the production-marked stack (apps/web/e2e/support/with-stack.sh): a SYNTHETIC transformation of dev.lead with
//    initiatives A -> B -> C (A's milestone forecast 2026-09-28; A -> B needed by 2026-10-01; C has no milestone, so
//    its forecast can be Unknown). dev.lead moves A's forecast to 2026-10-03: the API records the slip in the same
//    transaction (no worker is started here, so no other spec's queued events are touched). The Dependencies page and
//    B's page show it.
// On both: every forecast side the API reports as null is shown as Unknown (never blank or 0); a known side is the
// date in the reader's locale (formatted in the browser with the product's own Intl options). axe: no serious or
// critical issue; screenshots in both languages. SYNTHETIC data only; nothing here approves anything real, and nothing
// touches the engineering delivery gates DG0-DG7.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  langOf,
  shot,
  SHOTS,
  signIn,
  SYN_RETAIL,
  tr,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API bodies read loosely, as the reproduction did
type Body = any;
const ROAMING = "01995000-0000-7000-8000-000000000001";
const INI01 = "01995000-0000-7000-8000-000000000021";
const INI03 = "01995000-0000-7000-8000-000000000023";
const DEMO_ROLES = ["sp", "tl", "bo", "fin", "kds", "wl", "to", "cm"] as const;

interface Affected {
  initiativeId: string;
  initiativeCode: string;
  ownerUserId: string | null;
  forecastFinishBefore: string | null;
  forecastFinishAfter: string | null;
}
interface Slip {
  id: string;
  dependencyCode: string;
  slipDays: number;
  predecessorFinishBefore: string;
  predecessorFinishAfter: string;
  criticalReason: "critical_path" | "needed_by_breached";
  affected: Affected[];
}

/** The built production worker (apps/worker/dist), as the a13/a22 acceptance specs start it; stopped in `finally`. */
async function startWorker() {
  const child = spawn(process.execPath, ["apps/worker/dist/main.js"], {
    env: { ...process.env, LOG_LEVEL: "warn" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout!.on("data", (b: Buffer) => (out += b.toString()));
  child.stderr!.on("data", (b: Buffer) => (out += b.toString()));
  const until = Date.now() + 60_000;
  while (!out.includes("mth-worker started")) {
    if (child.exitCode !== null) throw new Error(`the worker exited (${child.exitCode}) before it started: ${out}`);
    if (Date.now() > until) throw new Error(`the worker did not start within 60 s: ${out}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    output: () => out,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 25_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

async function poll<T>(probe: () => Promise<T | null | undefined>, what: string, ms: number): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const itemsOf = <T>(b: Body): T[] => (Array.isArray(b) ? b : (b?.items ?? [])) as T[];
const plusDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The product's business-date format (lib/format.ts formatBusinessDate), computed in the browser. */
async function businessDate(page: Page, lang: Lang, value: string): Promise<string> {
  return page.evaluate(
    ([v, l]) =>
      new Intl.DateTimeFormat(l === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(`${v}T00:00:00Z`)),
    [value, lang] as const,
  );
}

/**
 * On the current page, in the slips section: the row of `slip` x `a` shows the dependency, the slip in days, the
 * reason and the forecast finish before -> after (null = Unknown), exactly as the API recorded it.
 */
async function expectSlipShown(
  page: Page,
  lang: Lang,
  scope: "transformation" | "initiative",
  slip: Slip,
  a: Affected,
) {
  const section = page.locator(`[data-dependency-slips='${scope}']`);
  await expect(section).toBeVisible();
  const cell = section.locator(
    `[data-before-after='forecast-${a.initiativeCode}'][data-before='${a.forecastFinishBefore ?? ""}'][data-after='${a.forecastFinishAfter ?? ""}']`,
  );
  await expect(cell.first()).toBeVisible();
  const row = cell.first().locator("xpath=ancestor::tr[1]");
  await expect(row).toContainText(slip.dependencyCode);
  await expect(row.locator(`[data-slip-days='${slip.slipDays}']`)).toHaveText(String(slip.slipDays));
  await expect(row).toContainText(tr(lang, `dependencies.slips.reason.${slip.criticalReason}`));
  const unknown = tr(lang, "common.value.unknown");
  const sides = await cell.first().locator(":scope > span:not([aria-hidden]):not(.visually-hidden)").allInnerTexts();
  expect(sides).toHaveLength(2);
  for (const [i, v] of [a.forecastFinishBefore, a.forecastFinishAfter].entries())
    expect(sides[i]!.trim()).toBe(v === null ? unknown : await businessDate(page, lang, v));
  if (a.forecastFinishBefore !== null && a.forecastFinishAfter !== null) {
    const days = Math.round(
      (Date.parse(`${a.forecastFinishAfter}T00:00:00Z`) - Date.parse(`${a.forecastFinishBefore}T00:00:00Z`)) /
        86_400_000,
    );
    await expect(row.locator(`[data-change-days='${days}']`)).toHaveText(days > 0 ? `+${days}` : String(days));
  } else {
    await expect(row.locator("[data-change-days]")).toHaveCount(0);
  }
}

test("REQ-S12-012: the slip's forecast impact on My Work, the Dependencies page and the affected initiative's page", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(300_000);
  const lang = langOf(info);
  const probe = await apiSession(playwright, "dev.lead");
  const demo = (await probe.call<{ synthetic: boolean }>("GET", "/api/v1/environment")).synthetic === true;
  await probe.req.dispose();
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();

  if (demo) {
    // ---- the domain reviewer's reproduction on the demo dataset
    const tl = await apiSession(playwright, "roaming.user.tl");
    const worker = await startWorker();
    let slip: Slip;
    let ownerSession: ApiSession | null = null;
    let ownerName = "";
    try {
      const feed = itemsOf<Body>(await tl.call("GET", `/api/v1/initiatives/${INI03}/milestones`)).find((m) =>
        String(m.title ?? "").startsWith("Partner usage feed"),
      );
      expect(feed, "INI-03's 'Partner usage feed' milestone").toBeTruthy();
      const current = String(feed.forecastDate ?? feed.approvedDate).slice(0, 10);
      const before = itemsOf<Slip>(await tl.call("GET", `/api/v1/transformations/${ROAMING}/dependency-slips`));
      await tl.call(
        "PATCH",
        `/api/v1/milestones/${feed.id}`,
        { forecastDate: plusDays(current, 5) },
        {
          ifMatch: feed.version,
        },
      );
      slip = await poll(
        async () =>
          itemsOf<Slip>(await tl.call("GET", `/api/v1/transformations/${ROAMING}/dependency-slips`)).find(
            (s) => !before.some((b) => b.id === s.id) && s.dependencyCode === "DEP-01",
          ),
        "the DEP-01 slip",
        60_000,
      );
      expect(slip.slipDays).toBe(5);
      const ini01 = slip.affected.find((a) => a.initiativeId === INI01)!;
      expect(ini01, "INI-01 is affected").toBeTruthy();
      expect(ini01.ownerUserId, "INI-01 has an owner to notify").not.toBeNull();
      for (const role of DEMO_ROLES) {
        const s = await apiSession(playwright, `roaming.user.${role}`);
        if (s.userId === ini01.ownerUserId) {
          ownerSession = s;
          ownerName = `roaming.user.${role}`;
        } else await s.req.dispose();
      }
      expect(ownerName, "the owner is a demo role user").not.toBe("");
      // The worker notifies the owner once (starter 9): wait for this slip's work item.
      const item = await poll(
        async () =>
          itemsOf<Body>(await ownerSession!.call("GET", "/api/v1/me/work-items")).find(
            (w) => w.kind === "dependency_slip" && w.subjectId === slip.id,
          ),
        "the owner's dependency_slip work item",
        90_000,
      ).catch((e: Error) => {
        throw new Error(`${e.message}; worker: ${worker.output().slice(-800)}`);
      });
      expect(item.messageParams).toMatchObject({ dependencyCode: "DEP-01", slipDays: 5 });

      await signIn(page, lang, ownerName);
      // My Work: the message names the dependency, the days and the initiative; never the generic fallback.
      await page.goto("/my-work");
      await expect(page.locator("main#main h1")).toBeVisible();
      await expect(page.locator("main#main")).toContainText(tr(lang, "myWork.kind.dependency_slip"));
      await expect(page.locator("main#main")).not.toContainText(
        tr(lang, "myWork.message.fallback", { kind: tr(lang, "myWork.kind.dependency_slip") }),
      );
      const text = tr(lang, "myWork.message.portfolio__task__dependency_slip", {
        dependencyCode: "DEP-01",
        slipDays: 5,
        initiativeCodes: String(item.messageParams.initiativeCodes),
      });
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      // The inbox reminder of the same work item (same messageKey) is no longer "Task: open the record for details".
      await expect(page.locator("main#main")).not.toContainText(
        tr(lang, "myWork.message.fallback", { kind: tr(lang, "myWork.kind.other") }),
      );
      await shot(page, lang, "p5-rg1-slip-owner-my-work");
      // The work item's link opens the Dependencies page, which shows the slip and INI-01's forecast move.
      await page.goto(String(item.linkPath));
      await expect(page.locator("main#main h1")).toHaveText(tr(lang, "dependencies.title"));
      await expectSlipShown(page, lang, "transformation", slip, ini01);
      await expectAccessible(page, lang, "p5-rg1-slip-dependencies");
      await shot(page, lang, "p5-rg1-slip-owner-dependencies");
      await page
        .locator("#dependency-slips")
        .screenshot({ path: join(SHOTS, lang, "p5-rg1-slip-owner-dependencies-section.png") });
      // INI-01's page shows the slips that affect it.
      await page.goto(`/transformations/${ROAMING}/initiatives/${INI01}`);
      await expect(page.locator("#dependency-slips h2")).toHaveText(tr(lang, "dependencies.slips.initiativeTitle"));
      await expectSlipShown(page, lang, "initiative", slip, ini01);
      await expectAccessible(page, lang, "p5-rg1-slip-initiative");
      await shot(page, lang, "p5-rg1-slip-owner-initiative-INI-01");
      await page
        .locator("#dependency-slips")
        .screenshot({ path: join(SHOTS, lang, "p5-rg1-slip-owner-initiative-INI-01-section.png") });
    } finally {
      await worker.stop();
      await tl.req.dispose();
      await ownerSession?.req.dispose();
    }
  } else {
    // ---- a SYNTHETIC slip on the production-marked stack (recorded by the API in the PATCH's transaction)
    const lead = await apiSession(playwright, "dev.lead");
    const stamp = Date.now().toString(36);
    const tid = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic dependency slip ${lang.toUpperCase()} ${stamp}`,
        mode: "end_to_end",
      })
    ).id;
    const ini: Record<"A" | "B" | "C", { id: string; code: string }> = {} as never;
    for (const k of ["A", "B", "C"] as const)
      ini[k] = await lead.call<{ id: string; code: string }>("POST", "/api/v1/initiatives", {
        transformationId: tid,
        name: `Synthetic slip ${k} ${lang}`,
      });
    const feed = await lead.call<{ id: string; version: number }>(
      "POST",
      `/api/v1/initiatives/${ini.A.id}/milestones`,
      {
        title: `Synthetic partner feed live ${lang}`,
        forecastDate: "2026-09-28",
      },
    );
    await lead.call("POST", `/api/v1/initiatives/${ini.B.id}/milestones`, {
      title: `Synthetic activation live ${lang}`,
      forecastDate: "2026-10-02",
    });
    await lead.call("POST", "/api/v1/dependencies", {
      transformationId: tid,
      description: `Synthetic: A's feed before B's activation ${lang}`,
      from: { kind: "initiative", initiativeId: ini.A.id },
      toInitiativeId: ini.B.id,
      dependencyType: "data",
      neededBy: "2026-10-01",
    });
    await lead.call("POST", "/api/v1/dependencies", {
      transformationId: tid,
      description: `Synthetic: B before C ${lang}`,
      from: { kind: "initiative", initiativeId: ini.B.id },
      toInitiativeId: ini.C.id,
      dependencyType: "tech",
    });
    await lead.call(
      "PATCH",
      `/api/v1/milestones/${feed.id}`,
      { forecastDate: "2026-10-03" },
      { ifMatch: feed.version },
    );
    const slips = itemsOf<Slip>(await lead.call("GET", `/api/v1/transformations/${tid}/dependency-slips`));
    expect(slips, "the API recorded one critical slip").toHaveLength(1);
    const slip = slips[0]!;
    expect(slip.slipDays).toBe(5);
    expect(slip.affected.map((a) => a.initiativeCode).sort()).toEqual([ini.B.code, ini.C.code].sort());
    await signIn(page, lang, "dev.lead");
    await page.goto(`/transformations/${tid}/dependencies`);
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "dependencies.title"));
    for (const a of slip.affected) await expectSlipShown(page, lang, "transformation", slip, a);
    await expectAccessible(page, lang, "p5-rg1-slip-dependencies");
    await shot(page, lang, "p5-rg1-slip-dependencies");
    await page
      .locator("#dependency-slips")
      .screenshot({ path: join(SHOTS, lang, "p5-rg1-slip-dependencies-section.png") });
    await page.goto(`/transformations/${tid}/initiatives/${ini.B.id}`);
    await expect(page.locator("#dependency-slips h2")).toHaveText(tr(lang, "dependencies.slips.initiativeTitle"));
    await expectSlipShown(page, lang, "initiative", slip, slip.affected.find((a) => a.initiativeId === ini.B.id)!);
    // C is not on B's page: only the slips that affect B are listed there.
    await expect(
      page.locator(`[data-dependency-slips='initiative'] [data-before-after='forecast-${ini.C.code}']`),
    ).toHaveCount(0);
    await expectAccessible(page, lang, "p5-rg1-slip-initiative");
    await shot(page, lang, "p5-rg1-slip-initiative");
    await page
      .locator("#dependency-slips")
      .screenshot({ path: join(SHOTS, lang, "p5-rg1-slip-initiative-section.png") });
    await lead.req.dispose();
  }
  await context.close();
});
