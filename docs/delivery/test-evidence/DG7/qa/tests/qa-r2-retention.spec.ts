// qa-verifier, DG7 round 2 (T-DG7-REV-QA-R2): independent checks of the Administration > Retention screens that
// T-DG7-FE-C2 built for F-DG7-913 (REQ-S16-024), against the REAL API (apps/web/e2e/support/with-stack.sh), in
// chromium-en (LTR) and chromium-ar (RTL). Not part of the candidate (agent-protocol: a frozen-candidate review keeps its
// new tests under docs/delivery/test-evidence/<DGx>/qa/tests/). To run, copy it to <clone>/e2e/qa-r2/ (the import
// path below assumes that location). All data is SYNTHETIC; every reference written begins with TEST-ONLY.
//
// What the product spec (apps/web/e2e/p7-retention.spec.ts) does not drive end to end, and this file does:
//  Q1 optimistic concurrency through the screen: the form is opened, the same class is changed meanwhile through the
//     API, Save -> the 409 conflict panel; the server keeps the other change (nothing overwritten); "re-apply on the
//     latest version" then saves with the new If-Match.
//  Q2 server-side authorization: an AUD user's direct PUT (bypassing the screen, which shows no form) is 403 and the
//     class is unchanged; an ADM_TECH PUT without If-Match is refused (428) and with a stale If-Match is 409.
//  Q3 server-side validation through the screen: an out-of-range period (0) is refused in the form with focus on the
//     field and nothing posted; the API refuses periodDays 0 with 400/422 and keeps the class unchanged.
//  Q4 classes without a form: a business class and a job-managed class show no change form to ADM_TECH; through the
//     API a business class cannot leave `retain` (422 retention.class_retain_only, ADR-0067 §2), nothing changed.
//  Q5 every change of this file is audited: GET /api/v1/admin/retention/classes/<code> version increases by exactly the
//     number of accepted PUTs (the audit trail itself is covered by the API integration tests; checked here: no
//     refused request changed the version).
import { expect, test, type Page } from "@playwright/test";
import { apiSession, ensureLanguage, langOf, signIn, tr, type ApiSession, type Lang } from "../../apps/web/e2e/support/ui.ts";

test.setTimeout(120_000);

const ORG = "01920000-0000-7000-9000-000000000001";
const DEV_ISSUER = "urn:mth:dev-local";
/** Operational, archive-then-purge classes no job manages (migration 0143); not used by the product spec. */
const QA_CLASS: Record<Lang, string> = { en: "processed_message_log", ar: "worker_heartbeat_log" };

type ClassView = { code: string; version: number; periodDays: number | null; action: string; itApprovalReference: string | null };

async function qaUser(admin: ApiSession, lang: Lang, roleCode: "ADM_TECH" | "AUD") {
  const username = `syn.qa-r2.${roleCode.toLowerCase()}.${lang}.${Date.now()}`;
  const user = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic QA r2 ${roleCode} (${lang})`,
    preferredLocale: lang,
    identity: { issuer: DEV_ISSUER, subject: username },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: user.id,
    roleCode,
    scope: { type: "organization", id: ORG },
    reason: "Synthetic user for the qa-verifier DG7 round-2 retention check (approves nothing real)",
  });
  return { id: user.id, username };
}

async function load(page: Page, lang: Lang, path: string) {
  await page.goto(path);
  await expect(page.locator("[data-state='loading']")).toHaveCount(0);
  await ensureLanguage(page, lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

async function raw(s: ApiSession, method: string, path: string, data?: unknown, ifMatch?: number | null) {
  const me = (await (await s.req.get("/api/v1/me")).json()) as { csrfToken: string };
  const headers: Record<string, string> = { "X-CSRF-Token": me.csrfToken };
  if (ifMatch !== undefined && ifMatch !== null) headers["If-Match"] = `"${ifMatch}"`;
  const res = await s.req.fetch(path, { method, headers, ...(data !== undefined ? { data } : {}) });
  const text = await res.text();
  return { status: res.status(), body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const classPath = (code: string) => `/api/v1/admin/retention/classes/${code}`;

test("QA-R2 retention: 409 through the screen, re-apply, server-side 403/428/409/422, no form on protected classes", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const code = QA_CLASS[lang];
  const admin = await apiSession(playwright, "dev.admin");
  const tech = await qaUser(admin, lang, "ADM_TECH");
  const aud = await qaUser(admin, lang, "AUD");
  const techApi = await apiSession(playwright, tech.username);
  const audApi = await apiSession(playwright, aud.username);
  try {
    const v0 = await techApi.call<ClassView>("GET", classPath(code));
    console.log(`[qa-r2 ${lang}] ${code} v0 version=${v0.version} periodDays=${v0.periodDays} action=${v0.action}`);

    // Q2 server-side: AUD PUT -> 403; no If-Match -> 428; stale If-Match -> 409; periodDays 0 -> 400/422.
    const body = (days: number | null, ref: string) => ({
      action: "retain",
      periodDays: days,
      itApprovalReference: ref,
      reason: "Synthetic qa-verifier check of the retention class rules",
    });
    const audPut = await raw(audApi, "PUT", classPath(code), body(30, "TEST-ONLY QA-AUD"), v0.version);
    const noMatch = await raw(techApi, "PUT", classPath(code), body(30, "TEST-ONLY QA-NOMATCH"), null);
    const stale = await raw(techApi, "PUT", classPath(code), body(30, "TEST-ONLY QA-STALE"), v0.version + 7);
    const zero = await raw(techApi, "PUT", classPath(code), body(0, "TEST-ONLY QA-ZERO"), v0.version);
    console.log(`[qa-r2 ${lang}] AUD PUT ${audPut.status}; no If-Match ${noMatch.status}; stale ${stale.status}; periodDays 0 ${zero.status}`);
    expect(audPut.status, JSON.stringify(audPut.body)).toBe(403);
    expect(noMatch.status, JSON.stringify(noMatch.body)).toBe(428);
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect([400, 422], JSON.stringify(zero.body)).toContain(zero.status);
    const v1 = await techApi.call<ClassView>("GET", classPath(code));
    expect(v1.version, "no refused request changed the class").toBe(v0.version);

    // Q3 through the screen: period 0 refused in the form, focus on the field, nothing posted.
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/v1/admin/retention")) writes.push(`${r.method()} ${r.url()}`);
    });
    await signIn(page, lang, tech.username);
    await load(page, lang, `/admin/retention/classes/${code}`);
    const form = page.locator("[data-form='update-retention-class']");
    await expect(form).toBeVisible();
    await page.locator("#retention-period").fill("0");
    await page.locator("#retention-class-reason").fill("Synthetic qa-verifier check of the period rule");
    await page.locator("[data-action='save-class']").click();
    await expect(page.locator("#retention-period")).toBeFocused();
    await expect(page.getByText(tr(lang, "retention.class.periodInvalid"))).toBeVisible();
    expect(writes, "an invalid period posts nothing").toEqual([]);

    // Q1: the form is open on v0; the class changes meanwhile through the API; Save -> 409 conflict panel.
    const other = await techApi.call<ClassView>("PUT", classPath(code), body(111, "TEST-ONLY QA-OTHER"), {
      ifMatch: v0.version,
    });
    expect(other.version).toBe(v0.version + 1);
    await load(page, lang, `/admin/retention/classes/${code}`); // the form now opens on v0+1
    // The stale situation: change the class once more behind the open form's back.
    const behind = await techApi.call<ClassView>("PUT", classPath(code), body(222, "TEST-ONLY QA-BEHIND"), {
      ifMatch: other.version,
    });
    expect(behind.version).toBe(other.version + 1);
    await expect(form).toHaveAttribute("data-base-version", String(other.version));
    await page.locator("#retention-period").fill("333");
    await page.locator("#retention-reference").fill(`TEST-ONLY QA-SCREEN-${lang}`);
    await page.locator("#retention-class-reason").fill("Synthetic qa-verifier check of the conflict panel");
    await page.locator("[data-action='save-class']").click();
    const panel = page.locator("[data-state='conflict']");
    await expect(panel).toBeVisible();
    await page.screenshot({ path: info.outputPath(`qa-r2-retention-conflict-${lang}.png`), fullPage: true });
    const afterConflict = await techApi.call<ClassView>("GET", classPath(code));
    console.log(`[qa-r2 ${lang}] after 409: version=${afterConflict.version} periodDays=${afterConflict.periodDays} ref=${afterConflict.itApprovalReference}`);
    expect([afterConflict.version, afterConflict.periodDays, afterConflict.itApprovalReference], "nothing overwritten").toEqual([
      behind.version,
      222,
      "TEST-ONLY QA-BEHIND",
    ]);
    // Re-apply on the latest version: one more PUT with the current If-Match, which saves 333.
    const putsBefore = writes.filter((w) => w.startsWith("PUT ")).length;
    await panel.getByRole("button").first().click();
    await expect(page.locator("[data-state='saved']")).toBeVisible();
    const saved = await techApi.call<ClassView>("GET", classPath(code));
    console.log(`[qa-r2 ${lang}] after re-apply: version=${saved.version} periodDays=${saved.periodDays} ref=${saved.itApprovalReference}; screen PUTs ${writes.filter((w) => w.startsWith("PUT ")).length}`);
    expect([saved.version, saved.periodDays, saved.itApprovalReference]).toEqual([
      behind.version + 1,
      333,
      `TEST-ONLY QA-SCREEN-${lang}`,
    ]);
    expect(writes.filter((w) => w.startsWith("PUT ")).length - putsBefore, "re-apply sent one PUT").toBe(1);
    await page.screenshot({ path: info.outputPath(`qa-r2-retention-reapplied-${lang}.png`), fullPage: true });

    // Q4: no change form on a business class or on a job-managed class.
    for (const protectedCode of ["business_record", "expiring_credential"]) {
      await load(page, lang, `/admin/retention/classes/${protectedCode}`);
      await expect(page.locator(`[data-class='${protectedCode}']`)).toBeVisible();
      await expect(page.locator("[data-form='update-retention-class']"), `${protectedCode}: no form`).toHaveCount(0);
    }
    // ADR-0067 §2 (CHECK retention_class_retain_only): a business class can never LEAVE `retain`. (Recording a period
    // or reference while it stays `retain` is allowed by the ADR; attempt 1 of this spec wrongly expected a refusal of
    // that too, see 23-qa-r2-retention-spec-attempt1.log.) Archive and archive-then-purge must be 422 class_retain_only.
    const biz = await techApi.call<ClassView>("GET", classPath("business_record"));
    for (const action of ["archive", "archive_then_purge"]) {
      const bizPut = await raw(
        techApi,
        "PUT",
        classPath("business_record"),
        { ...body(30, "TEST-ONLY QA-BIZ"), action },
        biz.version,
      );
      console.log(`[qa-r2 ${lang}] ADM_TECH PUT business_record action=${action} (If-Match ${biz.version}) -> ${bizPut.status} ${String(bizPut.body.code)}`);
      expect(bizPut.status, JSON.stringify(bizPut.body)).toBe(422);
      expect(bizPut.body.code).toBe("retention.class_retain_only");
    }
    const bizAfter = await techApi.call<ClassView>("GET", classPath("business_record"));
    expect([bizAfter.version, bizAfter.action], "business class unchanged and still retain").toEqual([biz.version, "retain"]);
  } finally {
    await techApi.req.dispose();
    await audApi.req.dispose();
    await admin.req.dispose();
  }
});
