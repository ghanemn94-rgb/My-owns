// T-DG7-FE-C2, T-E23 and T-E24 (p7-work-split §E.4, §E.6): Administration > Retention in English LTR and Arabic RTL,
// against a scripted API (SYNTHETIC records only; no real IT reference: every reference text begins with TEST-ONLY).
// What is asserted:
//  - T-E23: a NULL period is "Not set (IT to agree)", never 0 or a default number; the reference field is labelled as
//    a reference ("IT approval reference" with its "does not approve anything" help), never as an approval.
//  - T-E24: the §E.6 texts exactly, in both catalogues; identical key sets; every Arabic leaf labelled provisional;
//    `<html dir>` rtl in Arabic and ltr in English.
//  - updateRetentionClass: PUT with If-Match from the class's version and the contract body; a 409 shows the conflict
//    panel (nothing saved) and "re-apply" sends the latest version; a 422 shows the E.5 problem text; client
//    validation of the period and reference; read-only for a holder of retention.read only; no form for a class that
//    is always kept.
//  - createRetentionDryRun / createRetentionRun: a reason is required; POST with an Idempotency-Key to the right path;
//    the request form is absent without retention.run.
//  - Runs, run actions, archived records and backup sets: a NULL count, checksum or size is "Unknown", never 0; a
//    record that was not purged is "Kept (read-only)"; the archived filters map to exactly the contract's query
//    parameters; the backup list is read-only (no form, no request other than GET); a 403 shows no-permission.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { catalogues, createI18n } from "../../../i18n/index.ts";
import { P7_RETENTION_PROVISIONAL_ARABIC } from "../../../i18n/provisional-ar-p7-retention.ts";
import { ORG_ID, makeMe, mockApi, problem, renderApp, route, type RecordedRequest } from "../../../test/fixtures.tsx";
import { archivedQuery, parsePeriod, parseReference } from "./RetentionPages.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCALES = ["en", "ar"] as const;
type Locale = (typeof LOCALES)[number];
type Tree = { [k: string]: string | Tree };
const tx = (locale: Locale, path: string): string => {
  let node: string | Tree = catalogues[locale] as unknown as Tree;
  for (const part of path.split(".")) node = (node as Tree)[part]!;
  return node as string;
};
const leaves = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));

/** Waits until the selector matches (waitFor alone accepts a null result). */
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`not yet: ${selector}`);
    return el as HTMLElement;
  });

const ADM_TECH: Permission[] = ["retention.read", "retention.configure", "retention.run", "backup.read"];
const AUD: Permission[] = ["retention.read", "backup.read"];
const meRoute = (permissions: Permission[], locale: Locale) =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe([{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions }], {
      preferredLocale: locale,
    }),
  }));

const SHA = "0123456789abcdef".repeat(4);
const RUN_ID = "01920000-0000-7000-9000-00000000e006";
const retentionClass = (code: string, overrides: Record<string, unknown> = {}) => ({
  id: "01930000-0000-7000-8000-000000143008",
  code,
  category: "operational",
  labelEn: `Synthetic class ${code}`,
  labelAr: `فئة تجريبية ${code}`,
  descriptionEn: "Synthetic description.",
  descriptionAr: "وصف تجريبي.",
  managedByJob: null,
  action: "retain",
  periodDays: null,
  itApprovalReference: null,
  tables: [{ tableName: "job_run", ageColumn: "finished_at", purgeEligible: true }],
  updatedAt: "2026-11-01T08:00:00Z",
  updatedBy: null,
  version: 3,
  ...overrides,
});
const run = (overrides: Record<string, unknown> = {}) => ({
  id: RUN_ID,
  mode: "dry_run",
  status: "queued",
  requestedVia: "api",
  asOf: "2026-11-14T08:00:00Z",
  candidateCount: null,
  archivedCount: null,
  purgedCount: null,
  skippedCount: null,
  archiveSetKey: null,
  archiveSetSha256: null,
  archiveSetBytes: null,
  failureReason: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-11-14T08:00:00Z",
  createdBy: null,
  version: 1,
  ...overrides,
});

/** The §E.6 table of p7-work-split, cell by cell (the Arabic provisional). */
const E6: readonly [string, string, string][] = [
  ["title", "Retention", "الاحتفاظ بالبيانات"],
  [
    "intro",
    'Each record class has a retention action. Every class starts as "Keep". Business records, audit and snapshots are always kept. Periods must be agreed with Mobily IT.',
    'لكل فئة سجلات إجراء احتفاظ. تبدأ كل فئة بإجراء "الاحتفاظ". تُحفظ سجلات الأعمال وسجل التدقيق واللقطات دائماً. يجب الاتفاق على المدد مع تقنية المعلومات في موبايلي.',
  ],
  ["action.retain", "Keep", "الاحتفاظ"],
  ["action.archive", "Archive", "الأرشفة"],
  ["action.archive_then_purge", "Archive, then delete", "الأرشفة ثم الحذف"],
  ["period.notSet", "Not set (IT to agree)", "غير محددة (يُتفق عليها مع تقنية المعلومات)"],
  ["period.days", "{{count}} days", "{{count}} يوماً"],
  ["reference.label", "IT approval reference", "مرجع موافقة تقنية المعلومات"],
  [
    "reference.help",
    "Record the reference of the approval Mobily IT gave outside this platform, for example a change ticket. Saving it does not approve anything.",
    "سجّل مرجع الموافقة التي منحتها تقنية المعلومات في موبايلي خارج هذه المنصة، مثل رقم طلب التغيير. حفظه لا يعني الموافقة على أي شيء.",
  ],
  ["managedByJob", "Removed automatically when expired", "تُزال تلقائياً عند انتهاء صلاحيتها"],
  [
    "effect.inbox",
    'Archived read notifications can no longer be marked unread. With "Archive, then delete" they disappear from the inbox.',
    'لا يمكن إعادة الإشعارات المقروءة المؤرشفة إلى غير مقروءة. ومع "الأرشفة ثم الحذف" تختفي من صندوق الوارد.',
  ],
  ["run.dryRun", "Dry run", "تشغيل تجريبي"],
  ["run.run", "Run now", "تشغيل الآن"],
  [
    "run.dryRunHelp",
    "Shows what a run would archive or delete. Nothing is changed.",
    "يعرض ما ستؤرشفه العملية أو تحذفه دون تغيير أي شيء.",
  ],
  ["run.status.queued", "Queued", "في الانتظار"],
  ["run.status.running", "Running", "قيد التنفيذ"],
  ["run.status.succeeded", "Succeeded", "نجحت"],
  ["run.status.failed", "Failed", "فشلت"],
  ["actions.title", "Actions in this run", "إجراءات هذه العملية"],
  ["archived.title", "Archived records", "السجلات المؤرشفة"],
  ["archived.kept", "Kept (read-only)", "محفوظ (للقراءة فقط)"],
  ["backups.title", "Backup sets", "مجموعات النسخ الاحتياطي"],
  [
    "backups.readOnly",
    "Backups and restores are run by IT with the backup scripts. This list is read-only.",
    "تنفّذ تقنية المعلومات النسخ الاحتياطي والاستعادة باستخدام نصوص النسخ. هذه القائمة للقراءة فقط.",
  ],
  ["backups.none", "No backup set has been reported yet.", "لم يُبلَّغ عن أي مجموعة نسخ احتياطي بعد."],
];

describe("the retention namespace (T-E24)", () => {
  it("has the §E.6 texts exactly, identical key sets, and every Arabic leaf labelled provisional", () => {
    for (const [key, en, ar] of E6) {
      expect(tx("en", `retention.${key}`), key).toBe(en);
      expect(tx("ar", `retention.${key}`), key).toBe(ar);
    }
    const en = leaves(catalogues.en.retention as unknown as Tree).sort();
    const ar = leaves(catalogues.ar.retention as unknown as Tree).sort();
    expect(ar).toEqual(en);
    const labelled = Object.keys(P7_RETENTION_PROVISIONAL_ARABIC).sort();
    expect(labelled).toEqual(ar.map((k) => `retention.${k}`));
    const workSplit = Object.entries(P7_RETENTION_PROVISIONAL_ARABIC)
      .filter(([, source]) => source === "work-split")
      .map(([k]) => k.slice("retention.".length))
      .sort();
    expect(workSplit).toEqual(E6.map(([k]) => k).sort());
    for (const k of ar) expect(tx("ar", `retention.${k}`), k).toMatch(/[؀-ۿ]|^\{\{/);
  });

  it("names no gate and claims no approval, certification or conformity", () => {
    for (const locale of LOCALES) {
      const texts = JSON.stringify(catalogues[locale].retention);
      expect(texts).not.toMatch(/\bDG[0-7]\b|\bG[1-6]\b/);
      expect(texts).not.toMatch(/certif|complian|conform|is approved|approved by/i);
    }
  });

  it("parses the period, the reference and the archived filters strictly", () => {
    expect(parsePeriod("")).toBeNull();
    expect(parsePeriod(" 365 ")).toBe(365);
    for (const bad of ["0", "36501", "1.5", "-3", "abc", "1e3"]) expect(parsePeriod(bad), bad).toBeUndefined();
    expect(parseReference("  ")).toBeNull();
    expect(parseReference("ab")).toBeUndefined();
    expect(parseReference("TEST-ONLY CHG-1")).toBe("TEST-ONLY CHG-1");
    expect(
      archivedQuery(new URLSearchParams(`table=inbox_notification&retentionRunId=${RUN_ID.toUpperCase()}&x=1&limit=5`)),
    ).toEqual({ table: "inbox_notification", retentionRunId: RUN_ID });
    expect(archivedQuery(new URLSearchParams("table=Bad-Name&retentionRunId=nope"))).toEqual({});
  });
});

describe("Retention (T-E23)", () => {
  it.each(LOCALES)("%s: a NULL period is 'Not set (IT to agree)', never 0; the reference is a reference", async (l) => {
    const { requests } = mockApi(
      meRoute(AUD, l),
      route("GET", /\/api\/v1\/admin\/retention\/classes(\?|$)/, () => ({
        status: 200,
        body: {
          items: [
            retentionClass("job_history"),
            retentionClass("audit_log", { category: "audit" }),
            retentionClass("webhook_receipt_log", { periodDays: 400, itApprovalReference: "TEST-ONLY CHG-7" }),
          ],
          nextCursor: null,
        },
      })),
      route("GET", /\/api\/v1\/admin\/retention\/runs(\?|$)/, () => ({
        status: 200,
        body: { items: [run({ status: "succeeded", mode: "run", candidateCount: 0 })], nextCursor: null },
      })),
    );
    renderApp("/admin/retention", { i18n: createI18n(l) });
    expect(await screen.findByRole("heading", { level: 1, name: tx(l, "retention.title") })).toBeTruthy();
    expect(document.documentElement.dir).toBe(l === "ar" ? "rtl" : "ltr");
    expect(screen.getByText(tx(l, "retention.intro"))).toBeTruthy();
    const classes = await screen.findByRole("table", { name: tx(l, "retention.classes.title") });
    const rowOf = (code: string) =>
      within(classes)
        .getAllByRole("row")
        .find((r) => r.textContent!.includes(code))!;
    const notSet = within(rowOf("job_history")).getByText(tx(l, "retention.period.notSet"));
    expect(notSet.closest("[data-chip]") ?? notSet).toBeTruthy();
    expect(rowOf("job_history").querySelector("[data-period]")).toBeNull();
    expect(rowOf("webhook_receipt_log").querySelector("[data-period='400']")).not.toBeNull();
    expect(within(rowOf("webhook_receipt_log")).getByText("TEST-ONLY CHG-7")).toBeTruthy();
    expect(within(rowOf("audit_log")).getByText(tx(l, "retention.classes.alwaysKept"))).toBeTruthy();
    // The column is labelled as a reference, never as an approval.
    expect(within(classes).getByRole("columnheader", { name: new RegExp(tx(l, "retention.reference.label")) }));
    // Runs: a 0 count is shown as 0 because the server said 0; the auditor has no run form.
    expect(document.querySelector("[data-form='request-retention-run']")).toBeNull();
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it.each(LOCALES)("%s: an unfinished run's NULL counts are Unknown, never 0", async (l) => {
    mockApi(
      meRoute(AUD, l),
      route("GET", /\/api\/v1\/admin\/retention\/runs\/[^/]+$/, () => ({ status: 200, body: run() })),
      route("GET", /\/api\/v1\/admin\/retention\/runs\/[^/]+\/actions/, () => ({
        status: 200,
        body: {
          items: [
            {
              id: "01920000-0000-7000-9000-00000000a001",
              retentionRunId: RUN_ID,
              retentionClassCode: "inbox_read_item",
              tableName: "inbox_notification",
              recordKey: { id: "01920000-0000-7000-9000-00000000b001" },
              action: "would_archive",
              periodDays: 400,
              recordAgeAt: "2025-01-01T00:00:00Z",
              occurredAt: "2026-11-14T08:01:00Z",
            },
          ],
          nextCursor: null,
        },
      })),
    );
    renderApp(`/admin/retention/runs/${RUN_ID}`, { i18n: createI18n(l) });
    const facts = await found("[data-run]");
    expect(within(facts).getAllByText(tx(l, "retention.common.unknown")).length).toBe(4);
    expect(within(facts).queryByText("0")).toBeNull();
    expect(within(facts).getByText(tx(l, "retention.run.noArchiveSet"))).toBeTruthy();
    const actions = await screen.findByRole("table", { name: tx(l, "retention.actions.title") });
    expect(within(actions).getByText(tx(l, "retention.actions.kind.would_archive"))).toBeTruthy();
    expect(within(actions).getByText("id=01920000-0000-7000-9000-00000000b001")).toBeTruthy();
  });
});

describe("Retention class: updateRetentionClass (If-Match, 409, 422)", () => {
  const classUrl = /\/api\/v1\/admin\/retention\/classes\/job_history$/;

  it.each(LOCALES)("%s: saves with If-Match and the contract body; validates the fields first", async (l) => {
    let current: Record<string, unknown> = retentionClass("job_history");
    const { requests } = mockApi(
      meRoute(ADM_TECH, l),
      route("GET", classUrl, () => ({ status: 200, body: current })),
      route("PUT", classUrl, (req) => {
        const body = req.body as { action: string; periodDays: number | null; itApprovalReference: string | null };
        current = { ...current, ...body, version: (current["version"] as number) + 1 };
        return { status: 200, body: current };
      }),
    );
    renderApp("/admin/retention/classes/job_history", { i18n: createI18n(l) });
    await screen.findByRole("heading", { level: 1, name: tx(l, "nav.p7.retentionClass.title") });
    const form = await found("[data-form='update-retention-class']");
    // The reference field is labelled as a reference with its help text.
    const ref = within(form).getByLabelText(tx(l, "retention.reference.label")) as HTMLInputElement;
    expect(ref.getAttribute("aria-describedby")).toContain("retention-reference-hint");
    expect(within(form).getByText(tx(l, "retention.reference.help"))).toBeTruthy();
    // Invalid period and reference: nothing is sent.
    fireEvent.change(within(form).getByLabelText(tx(l, "retention.class.periodInput")), { target: { value: "0" } });
    fireEvent.change(ref, { target: { value: "ab" } });
    fireEvent.click(within(form).getByRole("button", { name: tx(l, "retention.class.save") }));
    expect(await within(form).findByText(tx(l, "retention.class.periodInvalid"))).toBeTruthy();
    expect(within(form).getByText(tx(l, "retention.class.referenceInvalid"))).toBeTruthy();
    expect(requests.filter((r) => r.method === "PUT")).toEqual([]);
    // Valid values.
    fireEvent.change(within(form).getByLabelText(tx(l, "retention.action.label")), { target: { value: "archive" } });
    fireEvent.change(within(form).getByLabelText(tx(l, "retention.class.periodInput")), { target: { value: "400" } });
    fireEvent.change(ref, { target: { value: "TEST-ONLY CHG-1" } });
    fireEvent.change(within(form).getByLabelText(new RegExp(tx(l, "retention.class.reason"))), {
      target: { value: "Synthetic test change" },
    });
    fireEvent.click(within(form).getByRole("button", { name: tx(l, "retention.class.save") }));
    expect(await screen.findByText(tx(l, "retention.class.saved"))).toBeTruthy();
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"3"');
    expect(put.body).toEqual({
      action: "archive",
      periodDays: 400,
      itApprovalReference: "TEST-ONLY CHG-1",
      reason: "Synthetic test change",
    });
    await waitFor(() => expect(document.querySelector("[data-class-action='archive']")).not.toBeNull());
    expect(document.querySelector("[data-period='400']")).not.toBeNull();
  });

  it("a 409 shows the conflict panel (nothing saved); re-apply sends the latest version", async () => {
    let served = retentionClass("job_history");
    let puts = 0;
    const { requests } = mockApi(
      meRoute(ADM_TECH, "en"),
      route("GET", classUrl, () => ({ status: 200, body: served })),
      route("PUT", classUrl, (req) => {
        puts += 1;
        if (puts === 1) {
          // Someone else saved version 4 meanwhile.
          served = retentionClass("job_history", { version: 4, periodDays: 30, itApprovalReference: "TEST-ONLY X" });
          return problem(409, "version_conflict", { currentVersion: 4 });
        }
        served = { ...served, ...(req.body as object), version: 5 };
        return { status: 200, body: served };
      }),
    );
    renderApp("/admin/retention/classes/job_history", { i18n: createI18n("en") });
    const form = await found("[data-form='update-retention-class']");
    fireEvent.change(within(form).getByLabelText(tx("en", "retention.class.periodInput")), { target: { value: "90" } });
    fireEvent.change(within(form).getByLabelText(/Reason for the change/), { target: { value: "Synthetic reason" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    const panel = await found("[data-state='conflict']");
    expect(within(panel).getByText("90 days")).toBeTruthy();
    await waitFor(() => expect(within(panel).getByText("30 days")).toBeTruthy());
    expect(screen.queryByText(tx("en", "retention.class.saved"))).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: tx("en", "common.conflict.reapply") }));
    expect(await screen.findByText(tx("en", "retention.class.saved"))).toBeTruthy();
    const ifMatches = requests.filter((r) => r.method === "PUT").map((r) => r.headers["if-match"]);
    expect(ifMatches).toEqual(['"3"', '"4"']);
  });

  it.each(LOCALES)("%s: a 422 shows the E.5 problem text", async (l) => {
    mockApi(
      meRoute(ADM_TECH, l),
      route("GET", classUrl, () => ({ status: 200, body: retentionClass("job_history") })),
      route("PUT", classUrl, () => problem(422, "retention.class_period_required")),
    );
    renderApp("/admin/retention/classes/job_history", { i18n: createI18n(l) });
    const form = await found("[data-form='update-retention-class']");
    fireEvent.change(within(form).getByLabelText(tx(l, "retention.action.label")), { target: { value: "archive" } });
    fireEvent.change(within(form).getByLabelText(new RegExp(tx(l, "retention.class.reason"))), {
      target: { value: "Synthetic reason" },
    });
    fireEvent.click(within(form).getByRole("button", { name: tx(l, "retention.class.save") }));
    expect(await screen.findByText(tx(l, "problems.retention__class_period_required"), { exact: false })).toBeTruthy();
  });

  it("read-only for retention.read alone; no form for a class that is always kept; inbox effect shown", async () => {
    mockApi(
      meRoute(AUD, "en"),
      route("GET", classUrl, () => ({ status: 200, body: retentionClass("job_history") })),
    );
    renderApp("/admin/retention/classes/job_history", { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "retention.class.readOnly"))).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
    cleanup();
    mockApi(
      meRoute(ADM_TECH, "en"),
      route("GET", /\/classes\/audit_log$/, () => ({
        status: 200,
        body: retentionClass("audit_log", { category: "audit" }),
      })),
      route("GET", /\/classes\/inbox_read_item$/, () => ({
        status: 200,
        body: retentionClass("inbox_read_item", {
          tables: [{ tableName: "inbox_notification", ageColumn: "read_at", purgeEligible: true }],
        }),
      })),
    );
    renderApp("/admin/retention/classes/audit_log", { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "retention.class.fixed"))).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
    cleanup();
    renderApp("/admin/retention/classes/inbox_read_item", { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "retention.effect.inbox"))).toBeTruthy();
  });
});

describe("Retention runs: createRetentionDryRun / createRetentionRun", () => {
  it.each(LOCALES)("%s: a reason is required; each button posts to its path with an Idempotency-Key", async (l) => {
    const { requests } = mockApi(
      meRoute(ADM_TECH, l),
      route("GET", /\/api\/v1\/admin\/retention\/classes(\?|$)/, () => ({
        status: 200,
        body: { items: [], nextCursor: null },
      })),
      route("GET", /\/api\/v1\/admin\/retention\/runs(\?|$)/, () => ({
        status: 200,
        body: { items: [], nextCursor: null },
      })),
      route("POST", /\/api\/v1\/admin\/retention\/dry-runs$/, () => ({ status: 202, body: run() })),
      route("POST", /\/api\/v1\/admin\/retention\/runs$/, () => problem(422, "retention.run_in_progress")),
    );
    renderApp("/admin/retention", { i18n: createI18n(l) });
    const form = await found("[data-form='request-retention-run']");
    expect(within(form).getByText(tx(l, "retention.run.dryRunHelp"))).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: tx(l, "retention.run.dryRun") }));
    expect(await within(form).findByText(tx(l, "adminP6.common.reasonInvalid"))).toBeTruthy();
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
    const reason = within(form).getByLabelText(new RegExp(tx(l, "retention.run.reason")));
    fireEvent.change(reason, { target: { value: "Synthetic dry run" } });
    fireEvent.click(within(form).getByRole("button", { name: tx(l, "retention.run.dryRun") }));
    expect(await within(form).findByText(tx(l, "retention.run.requested"), { exact: false })).toBeTruthy();
    const dry = requests.find((r) => r.method === "POST" && r.url.endsWith("/dry-runs"))!;
    expect(dry.body).toEqual({ reason: "Synthetic dry run" });
    expect(dry.headers["idempotency-key"]).toMatch(/.{8,}/);
    fireEvent.change(reason, { target: { value: "Synthetic run" } });
    fireEvent.click(within(form).getByRole("button", { name: tx(l, "retention.run.run") }));
    expect(await screen.findByText(tx(l, "problems.retention__run_in_progress"), { exact: false })).toBeTruthy();
    const real = requests.find((r) => r.method === "POST" && /\/runs$/.test(r.url))!;
    expect(real.headers["idempotency-key"]).toMatch(/.{8,}/);
    expect(real.headers["idempotency-key"]).not.toBe(dry.headers["idempotency-key"]);
  });
});

describe("Archived records and backup sets", () => {
  const archivedUrls = (requests: RecordedRequest[]) =>
    requests.filter((r) => /\/api\/v1\/admin\/retention\/archived/.test(r.url)).map((r) => new URL(r.url, "http://x"));

  it.each(LOCALES)("%s: filters map to the two query parameters; a kept record is 'Kept (read-only)'", async (l) => {
    const { requests } = mockApi(
      meRoute(AUD, l),
      route("GET", /\/api\/v1\/admin\/retention\/archived/, () => ({
        status: 200,
        body: {
          items: [
            {
              tableName: "inbox_notification",
              recordKey: { id: "01920000-0000-7000-9000-00000000b001" },
              retentionClassCode: "inbox_read_item",
              retentionRunId: RUN_ID,
              archiveSetKey: `retention/${RUN_ID}/manifest.json`,
              recordAgeAt: "2025-01-01T00:00:00Z",
              archivedAt: "2026-11-14T08:01:00Z",
              purgedAt: null,
              purgeRunId: null,
            },
          ],
          nextCursor: null,
        },
      })),
    );
    renderApp(`/admin/retention/archived?retentionRunId=${RUN_ID}&bogus=1`, { i18n: createI18n(l) });
    const table = await screen.findByRole("table", { name: tx(l, "retention.archived.title") });
    expect(within(table).getByText(tx(l, "retention.archived.kept"))).toBeTruthy();
    expect(Object.fromEntries(archivedUrls(requests)[0]!.searchParams)).toEqual({ retentionRunId: RUN_ID });
    // A malformed table name is refused in the form; a valid one is sent.
    const input = screen.getByLabelText(tx(l, "retention.archived.filterTable"));
    fireEvent.change(input, { target: { value: "Bad Name" } });
    fireEvent.click(screen.getByRole("button", { name: tx(l, "retention.archived.apply") }));
    expect(await screen.findByText(tx(l, "retention.archived.filterTableInvalid"))).toBeTruthy();
    fireEvent.change(input, { target: { value: "inbox_notification" } });
    fireEvent.click(screen.getByRole("button", { name: tx(l, "retention.archived.apply") }));
    await waitFor(() =>
      expect(archivedUrls(requests).some((u) => u.searchParams.get("table") === "inbox_notification")).toBe(true),
    );
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it.each(LOCALES)("%s: backup sets are read-only; NULL sizes and checksums are Unknown, never 0", async (l) => {
    const { requests } = mockApi(
      meRoute(AUD, l),
      route("GET", /\/api\/v1\/admin\/backups/, () => ({
        status: 200,
        body: {
          items: [
            {
              id: "01920000-0000-7000-9000-00000000c001",
              label: "synthetic-2026-11-14",
              status: "failed",
              manifestSchemaVersion: "mth-backup/1",
              startedAt: "2026-11-14T01:00:00Z",
              finishedAt: "2026-11-14T01:02:00Z",
              migrationLevel: null,
              serverMajor: null,
              dumpFormat: null,
              dumpBytes: null,
              dumpSha256: null,
              evidenceBackend: null,
              evidenceObjectCount: null,
              evidenceBytes: null,
              attachmentManifestSha256: null,
              configBundleSha256: null,
              manifestSha256: SHA,
              failureReason: "synthetic failure",
              operatorName: "Synthetic operator",
              recordedAt: "2026-11-14T01:02:01Z",
            },
          ],
          nextCursor: null,
        },
      })),
    );
    renderApp("/admin/retention/backups", { i18n: createI18n(l) });
    const table = await screen.findByRole("table", { name: tx(l, "retention.backups.title") });
    expect(screen.getAllByText(tx(l, "retention.backups.readOnly")).length).toBeGreaterThan(0);
    expect(within(table).getByText(tx(l, "retention.backups.status.failed"))).toBeTruthy();
    expect(within(table).getByText("synthetic failure", { exact: false })).toBeTruthy();
    expect(within(table).getAllByText(tx(l, "retention.common.unknown")).length).toBeGreaterThanOrEqual(5);
    expect(within(table).queryByText("0")).toBeNull();
    expect(document.querySelectorAll("main form").length).toBe(0);
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("an empty backup list says none was reported; a 403 shows no-permission", async () => {
    mockApi(
      meRoute(AUD, "en"),
      route("GET", /\/api\/v1\/admin\/backups/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
    );
    renderApp("/admin/retention/backups", { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "retention.backups.none"))).toBeTruthy();
    cleanup();
    mockApi(
      meRoute(["retention.read"], "en"),
      route("GET", /\/api\/v1\/admin\/backups/, () => problem(403, "forbidden")),
    );
    renderApp("/admin/retention/backups", { i18n: createI18n("en") });
    await waitFor(() => expect(document.querySelector("[data-state='no-permission']")).not.toBeNull());
  });
});
