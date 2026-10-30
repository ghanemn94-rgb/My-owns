// Version comparison of one form record (OpenAPI tag "forms"; ADR-0057 §7, §10, §11; REQ-S15-010 "record comparison";
// REQ-S16-026; p6-work-split §H/G.4, T-DG6-BE-Q2). Route file created as a stub by T-DG6-BE-A with its registration line:
//   GET /transformations/{t}/form-records/{recordType}/{recordId}/compare?fromVersion=&toVersion=
//                                                                            compareFormRecordVersions
// Read model only, from the existing audit trail (ADR-0004; no new table), like listFormRecordVersions (forms/history.ts):
// every audit event of the record (record_type = the register's table, record_id) whose `new_version` lies in
// (fromVersion, toVersion] is folded per column, keeping the first `from` and the last `to`. Only the fields the record's
// resolved form shows are returned (the form_schema version the transformation is pinned to; its protected source
// columns that are stored on the record's own table). Extension-field values live in `form_custom_value`, which has its
// own version and audit trail, and child records (deliverables, milestones, links) have theirs: neither steps the
// record's version, so neither is part of this comparison.
//
// Values (D-199 item 6, the `audit.read`-only variant of ADR-0057 §7): `from`/`to` are returned only to a caller who
// holds `audit.read` at the transformation's scope - the DG5 rule of forms/history.ts ("a reader of a form is not an
// auditor: `audit.read` stays the only way to see before/after values"). Every other reader, including an editor of the
// record type, gets `valuesWithheld: true` and field names only.
// Unknown, never guessed (ADR-0057 §11): a field whose column changed in a version step without a recorded `{from, to}`
// diff, or any shown field when a version step in the range recorded no diff object at all, is `recorded: false`
// with no values. A field whose folded first `from` equals its last `to` does not differ between the two versions and
// is not listed.
// Authorization: `transformation.read` in scope (404 outside it); an unknown or planned record type, or a record not in
// this transformation, is 404; a sensitive record (benefit, business case, evidence; ADR-0051 §2) the caller is not
// admitted to is 404, as its own GET. Then `toVersion` > `fromVersion` >= 1 and both <= the current version, else 422
// form_record.compare_versions_invalid. Read-only: nothing is written; no G1-G6 business approval is involved.
import { type DbOrTx, type FormRecordTypeRow } from "@mth/db";
import type { Permission } from "@mth/shared";
import { uuid, formRecordTypeCode } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authorize,
  loadSensitiveRecord,
  principalOf,
  requireSensitiveRead,
  SENSITIVE_RECORD_TYPE_LIST,
  type SensitiveRecordType,
} from "../access/index.ts";
import { createConfigResolver } from "../methodology/index.ts";
import { parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import { currentRecordVersion } from "./drafts.ts";
import { FORM_RECORD } from "./history.ts";
import { resolveForm, type ResolvedFormField } from "./provider.ts";
import { loadRecordType, recordExists, requireTransformationRead } from "./record-types.ts";

export const COMPARE = `${FORM_RECORD}/compare`;
const AUDIT_READ = "audit.read" as const satisfies Permission;
const MAX_INT = 2_147_483_647;
const resolver = createConfigResolver();

const params = z.strictObject({ transformationId: uuid, recordType: formRecordTypeCode, recordId: uuid });
// The contract's bounds (fromVersion >= 1, toVersion >= 2) are 400 validation; the order and the current-version rule
// are the 422 below (ADR-0057 §7).
export const compareQuery = z.strictObject({
  fromVersion: z.coerce.number().int().min(1).max(MAX_INT),
  toVersion: z.coerce.number().int().min(2).max(MAX_INT),
});

/** ADR-0057 §10, English verbatim. */
export const compareRefusals = {
  versionsInvalid: () =>
    problems.businessRule(
      "form_record.compare_versions_invalid",
      "Choose two different versions of this record, the older one first.",
    ),
};

/** One compared field (the contract's `FormRecordComparison.fields[]`). */
export interface ComparedField {
  fieldKey: string;
  labelEn: string;
  labelAr: string;
  recorded: boolean;
  from?: unknown;
  to?: unknown;
}

export interface FormRecordComparison {
  transformationId: string;
  recordType: string;
  recordId: string;
  fromVersion: number;
  toVersion: number;
  currentVersion: number;
  valuesWithheld: boolean;
  fields: ComparedField[];
}

const COLUMN_REF = /([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)/g;

/**
 * The columns of the record's own table that a source field is stored in: a `column` field's one column, a `composite`
 * field's columns of the same table (its references to other tables are child records, never in the record's diff), and
 * none for a computed or extension field.
 */
export function ownColumnsOf(field: Pick<ResolvedFormField, "origin" | "storageKind" | "storageRef">, table: string) {
  if (field.origin !== "source" || field.storageRef === null) return [];
  if (field.storageKind !== "column" && field.storageKind !== "composite") return [];
  const cols: string[] = [];
  for (const m of field.storageRef.matchAll(COLUMN_REF)) if (m[1] === table && !cols.includes(m[2]!)) cols.push(m[2]!);
  return cols;
}

/** One audit event of the record in the compared range, oldest first. */
export interface VersionStep {
  readonly changes: unknown;
}

interface Folded {
  from: unknown;
  to: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isDiff = (v: unknown): v is { from: unknown; to: unknown } => isPlainObject(v) && "from" in v && "to" in v;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Folds the version steps per field (ADR-0057 §7): per column the first `from` and the last `to`. Pure, so the rule is
 * unit-tested without a database. `fields` are in form order; the result keeps that order.
 */
export function foldComparison(
  fields: readonly Pick<ResolvedFormField, "key" | "labelEn" | "labelAr" | "origin" | "storageKind" | "storageRef">[],
  table: string,
  steps: readonly VersionStep[],
  withValues: boolean,
): ComparedField[] {
  const folded = new Map<string, Folded>();
  const unrecorded = new Set<string>();
  let unknownStep = false;
  for (const step of steps) {
    // A version step with no diff object at all: any shown field may have changed in it (Unknown).
    if (!isPlainObject(step.changes) || Object.keys(step.changes).length === 0) {
      unknownStep = true;
      continue;
    }
    for (const [col, entry] of Object.entries(step.changes)) {
      if (!isDiff(entry)) {
        unrecorded.add(col);
        continue;
      }
      const prior = folded.get(col);
      folded.set(col, { from: prior === undefined ? entry.from : prior.from, to: entry.to });
    }
  }
  const out: ComparedField[] = [];
  for (const f of fields) {
    const cols = ownColumnsOf(f, table);
    if (cols.length === 0) continue;
    const base = { fieldKey: f.key, labelEn: f.labelEn, labelAr: f.labelAr };
    if (unknownStep || cols.some((c) => unrecorded.has(c))) {
      out.push({ ...base, recorded: false });
      continue;
    }
    const changed = cols.filter((c) => {
      const x = folded.get(c);
      return x !== undefined && !same(x.from, x.to);
    });
    if (changed.length === 0) continue;
    const entry: ComparedField = { ...base, recorded: true };
    if (withValues) {
      if (f.storageKind === "column") {
        const x = folded.get(changed[0]!)!;
        entry.from = x.from ?? null;
        entry.to = x.to ?? null;
      } else {
        // A composite field: its changed columns, each with its own first `from` and last `to`.
        entry.from = Object.fromEntries(changed.map((c) => [c, folded.get(c)!.from ?? null]));
        entry.to = Object.fromEntries(changed.map((c) => [c, folded.get(c)!.to ?? null]));
      }
    }
    out.push(entry);
  }
  return out;
}

const sensitiveTypeOf = (rt: FormRecordTypeRow): SensitiveRecordType | null =>
  (SENSITIVE_RECORD_TYPE_LIST as readonly string[]).includes(rt.table_name ?? "")
    ? (rt.table_name as SensitiveRecordType)
    : null;

async function steps(db: DbOrTx, table: string, recordId: string, fromVersion: number, toVersion: number) {
  return (
    db
      .selectFrom("audit_event")
      .select(["changes"])
      // The table name comes from the read-only registry (0068 seed), never from input.
      .where("record_type", "=", table)
      .where("record_id", "=", recordId)
      .where("new_version", ">", fromVersion)
      .where("new_version", "<=", toVersion)
      .orderBy("seq", "asc")
      .execute()
  );
}

export function registerRecordCompareRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(COMPARE, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const p = parse(params, request.params, "params");
    const query = parseQuery(compareQuery, request.query);
    const principal = principalOf(request);
    // 404 outside the read scope, for an unknown or planned type and for a record not in this transformation.
    const target = await requireTransformationRead(db, request, p.transformationId);
    const rt = await loadRecordType(db, p.recordType);
    if (rt.table_name === null || !(await recordExists(db, rt, p.transformationId, p.recordId)))
      throw problems.notFound();
    const table = rt.table_name;
    // A sensitive record the caller is not admitted to: 404, as its own GET (ADR-0051 §1, §2).
    const sensitive = sensitiveTypeOf(rt);
    if (sensitive !== null) {
      const rec = await loadSensitiveRecord(db, sensitive, p.recordId, p.transformationId);
      if (rec === null) throw problems.notFound();
      await requireSensitiveRead(db, principal, sensitive, p.recordId, target, rec.partyUserIds);
    }
    const currentVersion = await currentRecordVersion(db, rt, p.transformationId, p.recordId);
    if (currentVersion === null) throw problems.notFound();
    if (query.toVersion <= query.fromVersion || query.toVersion > currentVersion)
      throw compareRefusals.versionsInvalid();
    const withValues = (await authorize(db, principal, AUDIT_READ, target)).allowed;
    const pinned = await resolver.pinnedVersion(db, p.transformationId, "form_schema");
    const form = await resolveForm(db, pinned.versionId, rt);
    const fields = [...form.fields].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
    const body: FormRecordComparison = {
      transformationId: p.transformationId,
      recordType: p.recordType,
      recordId: p.recordId,
      fromVersion: query.fromVersion,
      toVersion: query.toVersion,
      currentVersion,
      valuesWithheld: !withValues,
      fields: foldComparison(
        fields,
        table,
        await steps(db, table, p.recordId, query.fromVersion, query.toVersion),
        withValues,
      ),
    };
    return body;
  });
  return [`GET ${COMPARE}`];
}
