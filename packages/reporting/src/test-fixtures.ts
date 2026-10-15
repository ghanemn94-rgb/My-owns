// Synthetic document-model fixtures for the renderer unit tests (not exported by the package entry). Every value is
// synthetic; nothing here is a real Mobily record.
import type { ReportDocument, ReportValue } from "@mth/shared/schemas";
import type { RenderOptions } from "./model.ts";

export const T_ID = "0190a000-0000-7000-8000-000000000001";
export const SNAPSHOT_ID = "0190a000-0000-7000-8000-0000000000aa";
const rid = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`;

export const text = (value: string | null, authored: "user" | "system" = "user"): ReportValue =>
  value === null
    ? { type: "text", value: null, authored, validation: "unknown", reason: "missing" }
    : { type: "text", value, authored, validation: "validated", reason: null };

export const money = (value: string | null, validation: "validated" | "provisional" = "validated"): ReportValue =>
  value === null
    ? {
        type: "decimal",
        value: null,
        unitKind: "currency",
        currency: "SAR",
        valueBasis: "planned",
        validation: "unknown",
        reason: "missing",
      }
    : {
        type: "decimal",
        value,
        unitKind: "currency",
        currency: "SAR",
        valueBasis: "planned",
        validation,
        reason: null,
      };

export const code = (value: string, prefix: string): ReportValue => ({
  type: "code",
  value,
  labelKey: `${prefix}.${value}`,
  validation: "validated",
  reason: null,
});

/** A register-like document: one table of RAID-like rows (description, amount) with a SUM total, and a fields section. */
export function sampleDocument(
  rows: { code: string; description: string | null; amount: string | null; provisional?: boolean }[],
  total: string | null,
): ReportDocument {
  return {
    schemaVersion: 1,
    definitionCode: "registers",
    transformation: { id: T_ID, code: "TR-001", name: "Synthetic roaming transformation" },
    subject: { type: "transformation", id: T_ID, code: "TR-001", label: "Synthetic roaming transformation" },
    period: null,
    asOf: "2026-10-15T10:00:00.000Z",
    methodology: { versionId: rid(900), key: "playbook", versionNo: 3 },
    approvalState: "not_applicable",
    sections: [
      {
        key: "register",
        titleKey: "report.registers.raid.title",
        kind: "table",
        sources: [],
        columns: [
          { key: "code", labelKey: "report.registers.raid.code", valueKind: "text", unitKind: null },
          { key: "type", labelKey: "report.registers.raid.type", valueKind: "code", unitKind: null },
          { key: "description", labelKey: "report.registers.raid.description", valueKind: "text", unitKind: null },
          { key: "amount", labelKey: "report.registers.raid.amount", valueKind: "decimal", unitKind: "currency" },
        ],
        rows: rows.map((r, i) => ({
          recordType: "raid_entry",
          recordId: rid(i + 1),
          recordVersion: 1,
          cells: [
            text(r.code, "system"),
            code("risk", "report.raid_type"),
            text(r.description),
            money(r.amount, r.provisional ? "provisional" : "validated"),
          ],
        })),
        totals: [{ columnKey: "amount", formula: "sum", value: money(total) }],
        emptyKey: "report.empty.no_records",
      },
      {
        key: "filters",
        titleKey: "report.registers.filters",
        kind: "fields",
        sources: [],
        fields: [
          { key: "status", labelKey: "report.registers.raid.status", value: code("open", "report.raid_status") },
        ],
      },
    ],
  };
}

export const options = (
  format: RenderOptions["format"],
  language: RenderOptions["language"] = "en",
): RenderOptions => ({
  format,
  language,
  title: language === "ar" ? "السجلات" : "Registers",
  branding: { productName: "Mobily Transformation Hub" },
  snapshot: { id: SNAPSHOT_ID, status: "generated", issueVersion: null },
  timeZone: "Asia/Riyadh",
});
