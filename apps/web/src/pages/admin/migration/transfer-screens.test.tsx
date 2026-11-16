// T-DG7-FE-B (p7-work-split §C.8, §D.2): the Data export, Migration status, Identity rebind and Configuration transfer
// screens, in English LTR and Arabic RTL, against a scripted API (SYNTHETIC data only). What is asserted:
//  - REQ-S19-014 / REQ-S19-016: an export is requested with a reason and an Idempotency-Key; a null count is
//    "Unknown", never 0; a demo source is labelled synthetic; the manifests are offered only after success; the import
//    side is read-only (no write request, no import or rebind control); a reconciliation shows each differing table and
//    every attachment difference, a missing object as "Not found", never 0.
//  - REQ-S19-008: a bundle is exported with the organization and the kinds in contract order; an upload sends the
//    file's own bytes with X-File-Name, and a file over 5 MiB is refused without a request; Validate and Commit send
//    If-Match; Commit is offered only for a validated import with no conflict or refused item, and the non-draft note
//    is always shown; the auditor (no transfer right) sees the no-permission state. The export form does not offer
//    automation_rule (ADR-0065 Amendment 1, A1.2) and its "not carried" note says why (T-DG7-FE-B2).
//  - The transfer namespace: identical key sets, every Arabic leaf labelled provisional, the work split's texts exact.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { UNPORTABLE_BUNDLE_KINDS } from "@mth/shared/transfer";
import { CONFIG_BUNDLE_KINDS, EXPORTABLE_CONFIG_BUNDLE_KINDS } from "../../../api/p7.ts";
import { catalogues, createI18n } from "../../../i18n/index.ts";
import { P7_TRANSFER_PROVISIONAL_ARABIC, TRANSFER_WORK_SPLIT_KEYS } from "../../../i18n/provisional-ar-p7-transfer.ts";
import { ORG_ID, makeMe, mockApi, problem, renderApp, route, type RecordedRequest } from "../../../test/fixtures.tsx";
import { BUNDLE_MAX_BYTES, isCommittable, itemProblemText } from "../config-transfer/ConfigTransferPages.tsx";
import { formatCount, headerSafeFileName } from "./ui.tsx";

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
const meRoute = (permissions: Permission[], locale: Locale) =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe([{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions }], {
      preferredLocale: locale,
    }),
  }));

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
const EXPORT_ID = "01920000-0000-7000-9000-0000000e0001";
const IMPORT_ID = "01920000-0000-7000-9000-0000000e0002";
const REC_ID = "01920000-0000-7000-9000-0000000e0003";
const BUNDLE_EXPORT_ID = "01920000-0000-7000-9000-0000000e0004";
const BUNDLE_IMPORT_ID = "01920000-0000-7000-9000-0000000e0005";

const migrationExport = (overrides: Record<string, unknown> = {}) => ({
  id: EXPORT_ID,
  status: "queued",
  requestedVia: "api",
  schemaVersion: "mth-migration/1",
  sourceEnvironment: null,
  migrationLevel: null,
  tableCount: null,
  rowCount: null,
  attachmentCount: null,
  attachmentBytes: null,
  manifestSha256: null,
  attachmentManifestSha256: null,
  demoChecksum: null,
  failureReason: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-11-13T06:00:00Z",
  createdBy: null,
  version: 1,
  ...overrides,
});
const succeededExport = migrationExport({
  status: "succeeded",
  sourceEnvironment: "demo",
  migrationLevel: "0163_p7_example",
  tableCount: 120,
  rowCount: "12345",
  attachmentCount: 3,
  attachmentBytes: "2048",
  manifestSha256: SHA,
  attachmentManifestSha256: SHA2,
  demoChecksum: SHA,
  startedAt: "2026-11-13T06:00:05Z",
  finishedAt: "2026-11-13T06:01:00Z",
  version: 3,
});

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: REC_ID,
  runKind: "import",
  result: "mismatched",
  tablesChecked: 120,
  tablesMismatched: 1,
  rowsExpected: "12345",
  rowsActual: "12344",
  attachmentsChecked: 3,
  attachmentsMismatched: 1,
  operatorName: "Synthetic IT operator",
  runAt: "2026-11-13T07:00:00Z",
  ...overrides,
});
const migrationImport = {
  id: IMPORT_ID,
  schemaVersion: "mth-migration/1",
  sourceEnvironment: "demo",
  sourceExportReference: EXPORT_ID,
  migrationLevel: "0163_p7_example",
  manifestSha256: SHA,
  attachmentManifestSha256: SHA2,
  demoChecksum: SHA,
  tableCount: 120,
  rowCount: "12345",
  attachmentCount: 3,
  attachmentBytes: "2048",
  operatorName: "Synthetic IT operator",
  startedAt: "2026-11-13T06:59:00Z",
  importedAt: "2026-11-13T07:00:00Z",
  latestReconciliation: summary(),
  identities: { unbound: 2, rebound: 1, retained: 0 },
};

const nonGet = (requests: RecordedRequest[]) => requests.filter((r) => r.method !== "GET");

describe("Administration > Data export (REQ-S19-014, REQ-S19-016)", () => {
  it.each(LOCALES)("%s: lists exports with Unknown counts, never 0, and requests one with a reason", async (locale) => {
    const { requests } = mockApi(
      meRoute(["migration.export", "migration_import.read"], locale),
      route("GET", /\/admin\/migration-exports(\?|$)/, () => ({
        status: 200,
        body: { items: [migrationExport()], nextCursor: null },
      })),
      route("POST", /\/admin\/migration-exports$/, () => ({ status: 202, body: migrationExport({ id: "x" }) })),
    );
    renderApp("/admin/migration/exports", { i18n: createI18n(locale) });
    const table = await screen.findByRole("table", { name: tx(locale, "transfer.export.listTitle") });
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(screen.getByRole("heading", { level: 1, name: tx(locale, "transfer.export.title") })).toBeTruthy();
    const row = within(table).getAllByRole("row")[1]!;
    // Status label + icon; the three null counts and the null environment are Unknown, never 0.
    expect(within(row).getByText(tx(locale, "transfer.export.status.queued"))).toBeTruthy();
    expect(within(row).getAllByText(tx(locale, "transfer.common.unknown")).length).toBe(4);
    expect(within(row).queryByText("0")).toBeNull();
    // An invalid reason sends nothing.
    fireEvent.click(screen.getByRole("button", { name: tx(locale, "transfer.export.request") }));
    expect(await screen.findByText(tx(locale, "adminP6.common.reasonInvalid"))).toBeTruthy();
    expect(nonGet(requests)).toEqual([]);
    fireEvent.change(screen.getByLabelText(new RegExp(tx(locale, "transfer.export.reason"))), {
      target: { value: "Synthetic transfer to the clean installation" },
    });
    fireEvent.click(screen.getByRole("button", { name: tx(locale, "transfer.export.request") }));
    expect(await screen.findByText(tx(locale, "transfer.export.requested"))).toBeTruthy();
    const post = nonGet(requests);
    expect(post).toHaveLength(1);
    expect(post[0]!.body).toEqual({ reason: "Synthetic transfer to the clean installation" });
    expect(post[0]!.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows the translated 422 migration.export_in_progress and keeps the reason", async () => {
    mockApi(
      meRoute(["migration.export"], "en"),
      route("GET", /\/admin\/migration-exports(\?|$)/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
      route("POST", /\/admin\/migration-exports$/, () => problem(422, "migration.export_in_progress")),
    );
    renderApp("/admin/migration/exports", { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "transfer.export.empty"))).toBeTruthy();
    const reason = screen.getByLabelText(/Reason/);
    fireEvent.change(reason, { target: { value: "Synthetic reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Request export" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(tx("en", "problems.migration__export_in_progress"));
    expect((reason as HTMLTextAreaElement).value).toBe("Synthetic reason");
  });

  it.each(LOCALES)(
    "%s: an export's manifests are offered only after success; a demo source is synthetic",
    async (locale) => {
      let current: Record<string, unknown> = migrationExport({ status: "running" });
      mockApi(
        meRoute(["migration.export"], locale),
        route("GET", new RegExp(`/admin/migration-exports/${EXPORT_ID}$`), () => ({ status: 200, body: current })),
      );
      const first = renderApp(`/admin/migration/exports/${EXPORT_ID}`, { i18n: createI18n(locale) });
      expect(await screen.findByText(tx(locale, "transfer.export.downloadsNotReady"))).toBeTruthy();
      expect(screen.queryByText(tx(locale, "transfer.export.downloadManifest"))).toBeNull();
      first.unmount?.();
      cleanup();
      current = succeededExport;
      renderApp(`/admin/migration/exports/${EXPORT_ID}`, { i18n: createI18n(locale) });
      const manifest = await screen.findByRole("link", { name: tx(locale, "transfer.export.downloadManifest") });
      expect(manifest.getAttribute("href")).toBe(`/api/v1/admin/migration-exports/${EXPORT_ID}/manifest`);
      expect(manifest.hasAttribute("download")).toBe(true);
      expect(
        screen.getByRole("link", { name: tx(locale, "transfer.export.downloadAttachments") }).getAttribute("href"),
      ).toBe(`/api/v1/admin/migration-exports/${EXPORT_ID}/attachment-manifest`);
      expect(screen.getAllByText(tx(locale, "transfer.export.environment.demo")).length).toBeGreaterThan(0);
      expect(screen.getByText(formatCount("12345", locale)!)).toBeTruthy();
      cleanup();
      current = migrationExport({ status: "failed", failureReason: "Synthetic storage failure" });
      renderApp(`/admin/migration/exports/${EXPORT_ID}`, { i18n: createI18n(locale) });
      expect(await screen.findByText(tx(locale, "transfer.export.downloadsFailed"))).toBeTruthy();
      expect(screen.getByText(/Synthetic storage failure/)).toBeTruthy();
      expect(screen.queryByRole("link", { name: tx(locale, "transfer.export.downloadManifest") })).toBeNull();
    },
  );
});

describe("Administration > Migration status (read-only; REQ-S19-014, REQ-S19-016)", () => {
  it.each(LOCALES)("%s: imports, rebinds and the read-only note; no control writes anything", async (locale) => {
    const { requests } = mockApi(
      meRoute(["migration_import.read"], locale),
      route("GET", /\/admin\/migration-imports(\?|$)/, () => ({
        status: 200,
        body: { items: [migrationImport], nextCursor: null },
      })),
      route("GET", /\/admin\/identity-rebinds/, (req) => ({
        status: 200,
        body: {
          items: [
            {
              id: "01920000-0000-7000-9000-0000000e0010",
              userId: "01920000-0000-7000-9000-0000000e0011",
              displayName: "Synthetic Moved User",
              migrationImportId: IMPORT_ID,
              state: req.url.includes("state=rebound") ? "rebound" : "unbound",
              issuer: "https://idp.source.example",
              subject: "sub-1",
              newIssuer: null,
              newSubject: null,
              operatorName: null,
              resolvedAt: null,
              version: 1,
            },
          ],
          nextCursor: null,
        },
      })),
    );
    renderApp("/admin/migration/imports", { i18n: createI18n(locale) });
    const imports = await screen.findByRole("table", { name: tx(locale, "transfer.import.listTitle") });
    expect(within(imports).getByText(tx(locale, "transfer.import.result.mismatched"))).toBeTruthy();
    expect(within(imports).getByText(tx(locale, "transfer.export.environment.demo"))).toBeTruthy();
    expect(screen.getByText(tx(locale, "transfer.import.cliOnly"))).toBeTruthy();
    const rebinds = await screen.findByRole("table", { name: tx(locale, "transfer.rebind.listTitle") });
    expect(within(rebinds).getByText(tx(locale, "transfer.rebind.state.unbound"))).toBeTruthy();
    // No import or rebind control: no form, and no button outside the tables' own sort headers names one.
    expect(document.querySelector("main form, [data-p7-screen] form")).toBeNull();
    const names = screen
      .queryAllByRole("button")
      .filter((b) => !b.closest("thead"))
      .map((b) => b.textContent ?? "");
    for (const n of names) expect(n).not.toMatch(/import|rebind|استيراد|ربط/i);
    fireEvent.change(screen.getByLabelText(tx(locale, "transfer.rebind.state.label")), {
      target: { value: "rebound" },
    });
    await waitFor(() => expect(requests.some((r) => r.url.includes("identity-rebinds?state=rebound"))).toBe(true));
    expect(nonGet(requests)).toEqual([]);
  });

  it.each(LOCALES)(
    "%s: a reconciliation lists each differing table and a missing attachment as Not found",
    async (locale) => {
      const { requests } = mockApi(
        meRoute(["migration_import.read"], locale),
        route("GET", new RegExp(`/reconciliations/${REC_ID}$`), () => ({
          status: 200,
          body: {
            summary: summary(),
            tables: [
              {
                tableName: "benefit",
                expectedRows: "10",
                actualRows: "10",
                expectedDigest: SHA,
                actualDigest: SHA,
                matched: true,
              },
              {
                tableName: "kpi_value",
                expectedRows: "5",
                actualRows: "4",
                expectedDigest: SHA,
                actualDigest: SHA2,
                matched: false,
              },
            ],
            attachmentMismatches: [
              {
                parentTable: "evidence_item",
                objectName: "evidence/synthetic-1.pdf",
                problem: "missing",
                expectedSize: "1024",
                actualSize: null,
                expectedSha256: SHA,
                actualSha256: null,
              },
            ],
          },
        })),
      );
      renderApp(`/admin/migration/imports/${IMPORT_ID}/reconciliations/${REC_ID}`, { i18n: createI18n(locale) });
      const tables = await screen.findByRole("table", { name: tx(locale, "transfer.import.tablesTitle") });
      const rows = within(tables).getAllByRole("row");
      // Differences sort first.
      expect(within(rows[1]!).getByText("kpi_value")).toBeTruthy();
      expect(within(rows[1]!).getByText(tx(locale, "transfer.import.tableMatched.false"))).toBeTruthy();
      const attachments = screen.getByRole("table", { name: tx(locale, "transfer.import.attachmentMismatchesTitle") });
      expect(within(attachments).getByText(tx(locale, "transfer.import.problem.missing"))).toBeTruthy();
      expect(within(attachments).getAllByText(tx(locale, "transfer.import.notFound")).length).toBe(2);
      expect(within(attachments).queryByText("0")).toBeNull();
      expect(nonGet(requests)).toEqual([]);
    },
  );
});

const bundleImport = (overrides: Record<string, unknown> = {}) => ({
  id: BUNDLE_IMPORT_ID,
  organizationId: ORG_ID,
  bundleSchemaVersion: "mth-config-bundle/1",
  sourceEnvironment: "demo",
  fileName: "synthetic-bundle.json",
  byteSize: "4096",
  sha256: SHA,
  itemCount: 2,
  status: "validated",
  validationNo: 1,
  counts: { createDraft: 1, newDraft: 0, identical: 0, conflict: 1, refused: 0 },
  items: [
    {
      id: "01920000-0000-7000-9000-0000000e0020",
      ordinal: 1,
      kind: "methodology",
      itemCode: "playbook",
      sourceVersionNo: 2,
      contentSha256: SHA,
      action: "conflict",
      problemCode: "config_bundle.open_draft_exists",
      targetRecordType: null,
      targetRecordId: null,
    },
    {
      id: "01920000-0000-7000-9000-0000000e0021",
      ordinal: 2,
      kind: "job_schedule",
      itemCode: "kpi.refresh",
      sourceVersionNo: null,
      contentSha256: SHA2,
      action: "create_draft",
      problemCode: null,
      targetRecordType: null,
      targetRecordId: null,
    },
  ],
  validatedAt: "2026-11-13T08:00:00Z",
  validatedBy: null,
  committedAt: null,
  committedBy: null,
  createdAt: "2026-11-13T07:55:00Z",
  createdBy: "01920000-0000-7000-9000-0000000e0030",
  version: 3,
  ...overrides,
});

describe("Administration > Configuration transfer (REQ-S19-008)", () => {
  it.each(LOCALES)(
    "%s: the auditor (no transfer right) gets the no-permission state and no request",
    async (locale) => {
      const { requests } = mockApi(meRoute(["audit_event.read", "migration_import.read"], locale));
      renderApp("/admin/config-transfer", { i18n: createI18n(locale) });
      expect(await screen.findByRole("heading", { level: 1, name: tx(locale, "transfer.bundle.title") })).toBeTruthy();
      expect(document.querySelector("[data-state='no-permission']")).not.toBeNull();
      expect(screen.getByText(tx(locale, "transfer.bundle.nonDraftNote"))).toBeTruthy();
      expect(document.querySelector("form")).toBeNull();
      expect(requests.filter((r) => r.url.includes("/config-bundles"))).toEqual([]);
    },
  );

  it.each(LOCALES)(
    "%s: exports kinds in contract order with the organization, and uploads the file's bytes",
    async (locale) => {
      const { requests } = mockApi(
        meRoute(["config_bundle.export", "config_bundle.import"], locale),
        route("GET", /\/config-bundles\/(exports|imports)\?/, () => ({
          status: 200,
          body: { items: [], nextCursor: null },
        })),
        route("POST", /\/config-bundles\/exports\?/, () => ({
          status: 201,
          body: {
            id: BUNDLE_EXPORT_ID,
            organizationId: ORG_ID,
            bundleSchemaVersion: "mth-config-bundle/1",
            sourceEnvironment: "demo",
            kinds: ["methodology", "branding"],
            itemCount: 2,
            byteSize: "100",
            sha256: SHA,
            createdAt: "2026-11-13T08:00:00Z",
            createdBy: ORG_ID,
          },
        })),
        route("POST", /\/config-bundles\/imports\?/, () => ({
          status: 201,
          body: bundleImport({ status: "uploaded" }),
        })),
        route("GET", new RegExp(`/config-bundles/imports/${BUNDLE_IMPORT_ID}$`), () => ({
          status: 200,
          body: bundleImport({ status: "uploaded", counts: null, items: [], validationNo: 0, validatedAt: null }),
        })),
      );
      renderApp("/admin/config-transfer", { i18n: createI18n(locale) });
      expect(await screen.findByText(tx(locale, "transfer.bundle.exportsEmpty"))).toBeTruthy();
      // Ticked out of order; sent in the contract's order.
      fireEvent.click(screen.getByLabelText(tx(locale, "transfer.bundle.kind.branding")));
      fireEvent.click(screen.getByLabelText(tx(locale, "transfer.bundle.kind.methodology")));
      fireEvent.change(screen.getByLabelText(new RegExp(tx(locale, "transfer.bundle.reason"))), {
        target: { value: "Synthetic bundle for the clean installation" },
      });
      fireEvent.click(screen.getByRole("button", { name: tx(locale, "transfer.bundle.export") }));
      expect(await screen.findByText(tx(locale, "transfer.bundle.exported"))).toBeTruthy();
      const exp = nonGet(requests).find((r) => r.url.includes("/exports"))!;
      expect(exp.url).toContain(`organizationId=${ORG_ID}`);
      expect(exp.body).toEqual({
        reason: "Synthetic bundle for the clean installation",
        kinds: ["methodology", "branding"],
      });
      // A file over 5 MiB is refused locally: nothing is sent.
      const input = screen.getByLabelText(new RegExp(tx(locale, "transfer.bundle.file").replace(/[()]/g, ".")));
      const big = new File(["x"], "big.json", { type: "application/json" });
      Object.defineProperty(big, "size", { value: BUNDLE_MAX_BYTES + 1 });
      fireEvent.change(input, { target: { files: [big] } });
      fireEvent.click(screen.getByRole("button", { name: tx(locale, "transfer.bundle.upload") }));
      expect(await screen.findByText(tx(locale, "problems.config_bundle__too_large"))).toBeTruthy();
      expect(nonGet(requests).filter((r) => r.url.includes("/imports"))).toEqual([]);
      // A valid file is sent as is, with its (header-safe) name and the organization; then its import opens.
      const good = new File(['{"bundleSchemaVersion":"mth-config-bundle/1"}'], "bündle.json", {
        type: "application/json",
      });
      fireEvent.change(input, { target: { files: [good] } });
      fireEvent.click(screen.getByRole("button", { name: tx(locale, "transfer.bundle.upload") }));
      expect(
        await screen.findByRole("heading", { level: 1, name: tx(locale, "nav.p7.configBundleImport.title") }),
      ).toBeTruthy();
      const up = nonGet(requests).find((r) => r.url.includes("/imports"))!;
      expect(up.url).toContain(`organizationId=${ORG_ID}`);
      expect(up.headers["x-file-name"]).toBe("b_ndle.json");
      expect(up.headers["content-type"]).toBe("application/json");
    },
  );

  // T-DG7-FE-B2 (ADR-0065 Amendment 1, A1.2; BE-F2 Q3): automation_rule is not carried in this release, so the export
  // form does not offer it (ticking it was a 422 unportable_reference), and the note where the kinds are listed says so.
  it.each(LOCALES)(
    "%s: the export form offers every kind except automation_rule, says why, and never sends it",
    async (locale) => {
      const created = {
        id: BUNDLE_EXPORT_ID,
        organizationId: ORG_ID,
        bundleSchemaVersion: "mth-config-bundle/1",
        sourceEnvironment: "demo",
        kinds: EXPORTABLE_CONFIG_BUNDLE_KINDS,
        itemCount: 11,
        byteSize: "100",
        sha256: SHA,
        createdAt: "2026-11-13T08:00:00Z",
        createdBy: ORG_ID,
      };
      const { requests } = mockApi(
        meRoute(["config_bundle.export", "config_bundle.import"], locale),
        route("GET", /\/config-bundles\/(exports|imports)\?/, () => ({
          status: 200,
          body: { items: [], nextCursor: null },
        })),
        route("POST", /\/config-bundles\/exports\?/, () => ({ status: 201, body: created })),
      );
      renderApp("/admin/config-transfer", { i18n: createI18n(locale) });
      expect(await screen.findByText(tx(locale, "transfer.bundle.exportsEmpty"))).toBeTruthy();
      const form = document.querySelector<HTMLFormElement>("form[data-form='export-config-bundle']")!;
      const fieldset = within(form).getByRole("group", { name: tx(locale, "transfer.bundle.kinds") });
      // The offered kinds: the contract's order, all 12 less UNPORTABLE_BUNDLE_KINDS (the shared list), labelled.
      const boxes = within(fieldset).getAllByRole("checkbox") as HTMLInputElement[];
      expect(boxes.map((b) => b.value)).toEqual(CONFIG_BUNDLE_KINDS.filter((k) => k !== "automation_rule"));
      expect(boxes.map((b) => b.value)).toEqual([...EXPORTABLE_CONFIG_BUNDLE_KINDS]);
      expect([...UNPORTABLE_BUNDLE_KINDS.keys()]).toEqual(["automation_rule"]);
      expect(within(fieldset).queryByLabelText(tx(locale, "transfer.bundle.kind.automation_rule"))).toBeNull();
      expect(within(fieldset).getByLabelText(tx(locale, "transfer.bundle.kind.automation_rule_set"))).toBeTruthy();
      // The note: visible where the kinds are listed, read with the group, and naming the kind it leaves out.
      const note = fieldset.querySelector<HTMLElement>("[data-state='not-carried-note']")!;
      expect(note.textContent?.trim()).toBe(tx(locale, "transfer.bundle.notCarriedNote"));
      expect(note.getAttribute("data-kinds")).toBe("automation_rule");
      expect(fieldset.getAttribute("aria-describedby")?.split(" ")).toContain(note.id);
      expect(document.getElementById(note.id)).toBe(note);
      // Every offered kind ticked (keyboard: Space toggles a focused checkbox; fireEvent.click is its DOM effect).
      for (const b of boxes) fireEvent.click(b);
      fireEvent.change(screen.getByLabelText(new RegExp(tx(locale, "transfer.bundle.reason"))), {
        target: { value: "Synthetic bundle for the clean installation" },
      });
      fireEvent.click(screen.getByRole("button", { name: tx(locale, "transfer.bundle.export") }));
      expect(await screen.findByText(tx(locale, "transfer.bundle.exported"))).toBeTruthy();
      const exp = nonGet(requests).find((r) => r.url.includes("/exports"))!;
      expect(exp.body).toEqual({
        reason: "Synthetic bundle for the clean installation",
        kinds: [...EXPORTABLE_CONFIG_BUNDLE_KINDS],
      });
      expect((exp.body as { kinds: string[] }).kinds).not.toContain("automation_rule");
      expect(within(form).queryByText(tx(locale, "problems.config_bundle__unportable_reference"))).toBeNull();
    },
  );

  it.each(LOCALES)(
    "%s: an imported automation_rule item is still labelled, and shown refused with its reason",
    async (locale) => {
      mockApi(
        meRoute(["config_bundle.import"], locale),
        route("GET", new RegExp(`/config-bundles/imports/${BUNDLE_IMPORT_ID}$`), () => ({
          status: 200,
          body: bundleImport({
            status: "invalid",
            counts: { createDraft: 0, newDraft: 0, identical: 0, conflict: 0, refused: 1 },
            items: [
              {
                id: REC_ID,
                ordinal: 1,
                kind: "automation_rule",
                itemCode: "overdue-reminder",
                sourceVersionNo: 1,
                contentSha256: SHA,
                action: "refused",
                problemCode: "config_bundle.kind_unavailable",
                targetRecordType: null,
                targetRecordId: null,
              },
            ],
          }),
        })),
      );
      renderApp(`/admin/config-transfer/imports/${BUNDLE_IMPORT_ID}`, { i18n: createI18n(locale) });
      const items = await screen.findByRole("table", { name: tx(locale, "transfer.bundle.itemsTitle") });
      expect(within(items).getByText(tx(locale, "transfer.bundle.kind.automation_rule"))).toBeTruthy();
      expect(within(items).getByText(tx(locale, "transfer.bundle.action.refused"))).toBeTruthy();
      expect(within(items).getByText(tx(locale, "problems.config_bundle__kind_unavailable"))).toBeTruthy();
      expect(screen.queryByRole("button", { name: tx(locale, "transfer.bundle.commit") })).toBeNull();
    },
  );

  it.each(LOCALES)(
    "%s: a conflict makes the import invalid: no Validate and no Commit; its reason is shown",
    async (locale) => {
      const { requests } = mockApi(
        meRoute(["config_bundle.import"], locale),
        route("GET", new RegExp(`/config-bundles/imports/${BUNDLE_IMPORT_ID}$`), () => ({
          status: 200,
          body: bundleImport({ status: "invalid" }),
        })),
      );
      renderApp(`/admin/config-transfer/imports/${BUNDLE_IMPORT_ID}`, { i18n: createI18n(locale) });
      const items = await screen.findByRole("table", { name: tx(locale, "transfer.bundle.itemsTitle") });
      expect(within(items).getByText(tx(locale, "transfer.bundle.action.conflict"))).toBeTruthy();
      expect(within(items).getByText(tx(locale, "problems.config_bundle__open_draft_exists"))).toBeTruthy();
      expect(screen.getByText(tx(locale, "transfer.bundle.invalidNote"))).toBeTruthy();
      expect(screen.getByText(tx(locale, "transfer.bundle.nonDraftNote"))).toBeTruthy();
      expect(screen.queryByRole("button", { name: tx(locale, "transfer.bundle.commit") })).toBeNull();
      expect(screen.queryByRole("button", { name: tx(locale, "transfer.bundle.validate") })).toBeNull();
      expect(nonGet(requests)).toEqual([]);
    },
  );

  it.each(LOCALES)("%s: Validate sends If-Match; a clean plan commits as drafts with If-Match", async (locale) => {
    let current: Record<string, unknown> = bundleImport({
      status: "uploaded",
      validationNo: 0,
      counts: null,
      items: [],
      validatedAt: null,
    });
    const { requests } = mockApi(
      meRoute(["config_bundle.import"], locale),
      route("GET", new RegExp(`/config-bundles/imports/${BUNDLE_IMPORT_ID}$`), () => ({ status: 200, body: current })),
      route("POST", /\/validate$/, () => {
        current = bundleImport({
          version: 4,
          validationNo: 1,
          counts: { createDraft: 2, newDraft: 0, identical: 0, conflict: 0, refused: 0 },
          items: (bundleImport().items as Record<string, unknown>[]).map((i) => ({
            ...i,
            action: "create_draft",
            problemCode: null,
          })),
        });
        return { status: 200, body: current };
      }),
      route("POST", /\/commit$/, () => {
        current = bundleImport({ ...current, status: "committed", version: 5, committedAt: "2026-11-13T09:00:00Z" });
        return { status: 200, body: current };
      }),
    );
    renderApp(`/admin/config-transfer/imports/${BUNDLE_IMPORT_ID}`, { i18n: createI18n(locale) });
    expect(await screen.findByText(tx(locale, "transfer.bundle.itemsEmpty"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: tx(locale, "transfer.bundle.commit") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: tx(locale, "transfer.bundle.validate") }));
    const commit = await screen.findByRole("button", { name: tx(locale, "transfer.bundle.commit") });
    expect(nonGet(requests)[0]!.headers["if-match"]).toBe('"3"');
    expect(screen.getByText(tx(locale, "transfer.bundle.validated"))).toBeTruthy();
    fireEvent.click(commit);
    expect(await screen.findByText(tx(locale, "transfer.bundle.committedNote"))).toBeTruthy();
    const posted = nonGet(requests);
    expect(posted.map((r) => r.url.replace(/.*\//, ""))).toEqual(["validate", "commit"]);
    expect(posted[1]!.headers["if-match"]).toBe('"4"');
    // Committed: no further action is offered.
    expect(screen.queryByRole("button", { name: tx(locale, "transfer.bundle.validate") })).toBeNull();
  });

  it("a 422 plan_changed on commit shows its text and reloads the import", async () => {
    let gets = 0;
    mockApi(
      meRoute(["config_bundle.import"], "en"),
      route("GET", new RegExp(`/config-bundles/imports/${BUNDLE_IMPORT_ID}$`), () => {
        gets += 1;
        return {
          status: 200,
          body: bundleImport({ counts: { createDraft: 2, newDraft: 0, identical: 0, conflict: 0, refused: 0 } }),
        };
      }),
      route("POST", /\/commit$/, () => problem(422, "config_bundle.plan_changed")),
    );
    renderApp(`/admin/config-transfer/imports/${BUNDLE_IMPORT_ID}`, { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: "Commit as drafts" }));
    expect((await screen.findByRole("alert")).textContent).toContain(tx("en", "problems.config_bundle__plan_changed"));
    await waitFor(() => expect(gets).toBeGreaterThan(1));
  });
});

describe("transfer helpers", () => {
  it("formats 64-bit counts exactly and never turns a missing value into 0", () => {
    expect(formatCount("9007199254740993", "en")).toBe("9,007,199,254,740,993");
    expect(formatCount(null, "en")).toBeNull();
    expect(formatCount("", "en")).toBeNull();
    expect(formatCount("-1", "en")).toBeNull();
    expect(formatCount(0, "en")).toBe("0");
  });
  it("commit is offered only for a validated plan without conflict or refused items", () => {
    const counts = { createDraft: 1, newDraft: 0, identical: 0, conflict: 0, refused: 0 };
    expect(isCommittable({ status: "validated", counts })).toBe(true);
    expect(isCommittable({ status: "validated", counts: { ...counts, refused: 1 } })).toBe(false);
    expect(isCommittable({ status: "validated", counts: null })).toBe(false);
    expect(isCommittable({ status: "uploaded", counts })).toBe(false);
    expect(isCommittable({ status: "committed", counts })).toBe(false);
  });
  it("header-safe file names and translated item problems", () => {
    expect(headerSafeFileName("نقل.json")).toBe("___.json");
    expect(headerSafeFileName("")).toBe("bundle.json");
    const i18n = createI18n("en");
    expect(itemProblemText(i18n.t.bind(i18n), "config_bundle.kind_not_permitted")).toBe(
      tx("en", "problems.config_bundle__kind_not_permitted"),
    );
    expect(itemProblemText(i18n.t.bind(i18n), null)).toBeNull();
  });
});

describe("the transfer namespace (p7-work-split §C.8, §D.2; D-243 Q7)", () => {
  const leaves = (node: Tree, prefix = ""): string[] =>
    Object.entries(node).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));
  const en = catalogues.en.transfer as unknown as Tree;
  const ar = catalogues.ar.transfer as unknown as Tree;
  const repoRoot = (): string => {
    for (let dir = process.cwd(); ; dir = dirname(dir)) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
      if (dirname(dir) === dir) throw new Error("repository root not found");
    }
  };
  const split = readFileSync(join(repoRoot(), "docs", "architecture", "p7-work-split.md"), "utf8");

  it("has identical key sets, and every Arabic leaf is Arabic and labelled provisional", () => {
    expect(leaves(ar).sort()).toEqual(leaves(en).sort());
    for (const k of leaves(ar)) {
      expect(P7_TRANSFER_PROVISIONAL_ARABIC[`transfer.${k}`], k).toBeDefined();
      const text = tx("ar", `transfer.${k}`);
      if (!/^\{\{\w+\}\}$/.test(text)) expect(text, k).toMatch(/[؀-ۿ]|SHA-256|JSON/);
    }
  });

  it("uses the work split's EN and AR texts exactly for the keys it gives", () => {
    // Every cell of the two screen-text tables, split on " / " where one row lists several keys.
    const rows = split
      .split("\n")
      .filter((l) => /^\| `(export|import|rebind|bundle)\./.test(l))
      .map((l) => l.split("|").map((c) => c.trim()));
    const pairs = new Map<string, [string, string]>();
    for (const [, keyCell, enCell, arCell] of rows) {
      const keys = keyCell!.replace(/`/g, "").split(" / ");
      const prefix = keys[0]!.replace(/\.[^.]+$/, "");
      const full = keys.map((k, i) => (i === 0 ? k : `${prefix}.${k}`));
      const ens = enCell!.split(" / ");
      const ars = arCell!.split(" / ");
      full.forEach((k, i) =>
        pairs.set(k, [ens.length === full.length ? ens[i]! : enCell!, ars.length === full.length ? ars[i]! : arCell!]),
      );
    }
    expect([...pairs.keys()].sort()).toEqual([...TRANSFER_WORK_SPLIT_KEYS].sort());
    for (const [k, [e, a]] of pairs) {
      expect(tx("en", `transfer.${k}`), k).toBe(e);
      expect(tx("ar", `transfer.${k}`), k).toBe(a);
      expect(P7_TRANSFER_PROVISIONAL_ARABIC[`transfer.${k}`]).toBe("work-split");
    }
  });

  it("names no delivery gate and claims no approval or conformity", () => {
    for (const locale of LOCALES) {
      const texts = JSON.stringify(catalogues[locale].transfer);
      expect(texts).not.toMatch(/\bDG[0-7]\b|\bG[1-6]\b/);
      expect(texts).not.toMatch(/certif|complian|conform|is approved/i);
    }
  });
});
