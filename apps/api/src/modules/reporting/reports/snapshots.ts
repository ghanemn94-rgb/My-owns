// Report snapshots: live assembly, generate, issue, discard, reissue and the snapshot reads (ADR-0045 §1-§5, §9-§12;
// REQ-S13-004, REQ-S13-007, REQ-S13-008, REQ-S13-010; p5-work-split §F.1, §F.11; T-DG5-KBE-C).
//
// Assembly: ONE read-only REPEATABLE READ transaction assembles the whole output, so every section reads the same
// database state; its transaction time is the snapshot's `as_of`. The methodology version is the transformation's
// `methodology` pin at that instant, read through ConfigResolver (ADR-0039). The document is validated by the Zod
// schema `reportDocument`, measured (5,000 rows per table, 10 MiB of canonical JSON; above either 422
// report.too_large) and hashed (SHA-256 of the canonical JSON: keys in code-point order, no insignificant whitespace,
// integers only) BEFORE anything is written. A live report stops there.
//
// Generate: then ONE write transaction (no remote I/O) re-authorizes at commit time, inserts the `report_snapshot`
// (status generated, version 1; `created_at` is the column default, the transaction time the 0080 child guard compares)
// and its captured children (sources, versions, evidence) and writes one audit event. A snapshot's content never changes
// after the INSERT; only its status moves (0080 `report_snapshot_guard`).
//
// Issue / discard / reissue (report.issue: TL, TO, SEC): If-Match on the snapshot (428 missing, 409 stale), lock class
// `reportSnapshotIssue` (ADVISORY_LOCK_CLASSES) on `<definitionCode>:<transformationId>:<subjectId>:<reportingPeriodId or ->`, one
// audit event per row written. Issuing a reissue supersedes the previous issue first (the one-issued-per-series index),
// then issues the reissue as the next issue version; a concurrent issue in the same series answers 409
// report_snapshot.series_changed. Issuing approves nothing: it freezes what the records said, and the approval state
// is a recorded fact of the sources. Product gates G1-G6 are business approvals; nothing here relates to DG0-DG7.
import { createHash } from "node:crypto";
import { readDeploymentEnvironment, type Db, type DbOrTx, type ReportSnapshotRow, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import {
  countReportValues,
  outboxPayloadSchema,
  REPORT_CONTENT_SCHEMA_VERSION,
  REPORT_MAX_CONTENT_BYTES,
  REPORT_MAX_PARAMETER_BYTES,
  REPORT_MAX_TABLE_ROWS,
  reportDocument,
  reportSnapshotIssuedV1,
  type ReportDefinitionCode,
  type ReportDocument,
  type ReportSnapshot,
  type ReportSnapshotSummary,
  type ReportSubjectType,
} from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  denialOf,
  principalOf,
  refreshPrincipal,
  type Principal,
  type ResolvedTarget,
} from "../../access/index.ts";
import { record } from "../../audit/index.ts";
import { createConfigResolver } from "../../methodology/index.ts";
import { ADVISORY_LOCK_CLASSES, iso, isoOrNull, problems } from "../../platform/index.ts";
import { assemblerOf, type AssembledOutput, type Assembler } from "./assembler.ts";
import { loadReportDefinition, reportRefusals } from "./definitions.ts";

export const REPORT_SNAPSHOT_ISSUED = "report_snapshot.issued";
const resolver = createConfigResolver();

/**
 * The environment read of report generation (D-163; ADR-0050 §2 (d); REQ-PB-089, REQ-S18-001): the `synthetic` member
 * of admin's `EnvironmentReadPort` (admin/environment.ts), which `environmentReadPort` satisfies as it is. ADR-0002
 * keeps `reporting` from importing `admin` (modules.ts), so this module reads the same source, the deployment marker
 * through `@mth/db` `readDeploymentEnvironment`, with the same rule: `synthetic` exactly in a `demo` database, and a
 * database without a marker is production (fail-safe). The integration test report-synthetic.test.ts proves both
 * ports answer alike on a demo and a production database.
 */
export interface ReportEnvironmentPort {
  read(db: DbOrTx): Promise<{ readonly synthetic: boolean }>;
}

export const reportEnvironmentPort: ReportEnvironmentPort = {
  async read(db) {
    return { synthetic: (await readDeploymentEnvironment(db)).synthetic };
  },
};

// ------------------------------------------------------------------------------------------------ authorization

/**
 * The scope check of a report operation (ADR-0045 §9): `permission` on the transformation. A caller who cannot see the
 * transformation gets 404 (existence never disclosed); one who can (e.g. AUD) but lacks the permission gets 403.
 */
export async function requireReportPermission(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
  permission: Permission,
): Promise<ResolvedTarget> {
  const d = await authorize(db, principal, permission, { type: "transformation", id: transformationId });
  if (d.target === null) throw problems.notFound();
  if (d.allowed) return d.target;
  const visible =
    permission !== "transformation.read" && (await authorize(db, principal, "transformation.read", d.target)).allowed;
  if (!visible) throw problems.notFound().withDenial(denialOf(permission, d.target));
  throw problems.forbidden().withDenial(denialOf(permission, d.target));
}

/** Commit-time authorization of a write: the grants are reloaded inside the write transaction (shared rule 4). */
async function requireWriteAtCommit(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: Permission,
): Promise<{ userId: string; target: ResolvedTarget }> {
  principalOf(request);
  const principal = await refreshPrincipal(tx, request);
  try {
    const target = await requireReportPermission(tx, principal, transformationId, permission);
    if (principal.userId === null) throw problems.forbidden();
    return { userId: principal.userId, target };
  } catch (err) {
    throw commitTimeDenial(err);
  }
}

// ------------------------------------------------------------------------------------------------ canonical JSON

/** Code-point order (not UTF-16 code units; they differ only above U+FFFF). */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const d = (x.at(i) ?? 0) - (y.at(i) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/**
 * Canonical JSON of the content (ADR-0045 §3, the ADR-0039 §1 rules): keys sorted by code point, no insignificant
 * whitespace, undefined members dropped; numbers must be integers (every decimal is a string in the document).
 */
export function canonicalReportJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("report content: numbers must be integers");
    return String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalReportJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareCodePoints(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalReportJson(v)}`).join(",")}}`;
  }
  throw new Error(`report content: unsupported value of type ${typeof value}`);
}

export function reportContentSha256(document: ReportDocument): { sha256: string; bytes: number } {
  const text = canonicalReportJson(document);
  const buf = Buffer.from(text, "utf8");
  return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

// ------------------------------------------------------------------------------------------------ request resolution

export interface ReportRequest {
  readonly definitionCode: ReportDefinitionCode;
  readonly transformationId: string;
  readonly subjectId: string | undefined;
  readonly reportingPeriodId: string | undefined;
  /** The raw settings (an object), validated by the definition's assembler. */
  readonly parameters: unknown;
}

interface Resolved {
  readonly assembler: Assembler;
  readonly subjectType: ReportSubjectType;
  readonly subjectId: string;
  readonly organizationId: string;
  readonly transformation: { id: string; code: string; name: string };
  readonly period: { id: string; label: string; start: string; end: string } | null;
  readonly parameters: unknown;
  /** The parameters as stored (the parsed object; `{}` for outputs without settings). */
  readonly storedParameters: Record<string, unknown>;
}

const SUBJECT_TABLES = new Map<ReportSubjectType, "meeting" | "gate_instance" | "business_case" | "bau_handover">([
  ["meeting", "meeting"],
  ["gate_instance", "gate_instance"],
  ["business_case", "business_case"],
  ["bau_handover", "bau_handover"],
]);

/** Checks definition, subject, period and parameters (422 refusals of ADR-0045 §11); reads only. */
async function resolveRequest(db: DbOrTx, req: ReportRequest): Promise<Resolved> {
  const def = await loadReportDefinition(db, req.definitionCode);
  const t = await db
    .selectFrom("transformation")
    .select(["id", "organization_id", "code", "name"])
    .where("id", "=", req.transformationId)
    .executeTakeFirst();
  if (t === undefined) throw problems.notFound();
  const subjectType = def.subject_type as ReportSubjectType;
  let subjectId: string;
  if (subjectType === "transformation") {
    if (req.subjectId !== undefined && req.subjectId !== t.id) throw reportRefusals.subjectInvalid();
    subjectId = t.id;
  } else {
    const table = SUBJECT_TABLES.get(subjectType);
    if (req.subjectId === undefined || table === undefined) throw reportRefusals.subjectInvalid();
    const found = await db
      .selectFrom(table)
      .select("id")
      .where("id", "=", req.subjectId)
      .where("transformation_id", "=", t.id)
      .executeTakeFirst();
    if (found === undefined) throw reportRefusals.subjectInvalid();
    subjectId = req.subjectId;
  }
  let period: Resolved["period"] = null;
  if (def.needs_reporting_period) {
    if (req.reportingPeriodId === undefined) throw reportRefusals.periodRequired();
    const p = await db
      .selectFrom("reporting_period")
      .select(["id", "period_label", "period_start", "period_end"])
      .where("id", "=", req.reportingPeriodId)
      .where("organization_id", "=", t.organization_id)
      .executeTakeFirst();
    // A period of another organization, or none, is no reporting period of this output.
    if (p === undefined) throw reportRefusals.periodRequired();
    period = {
      id: p.id,
      label: p.period_label,
      start: String(p.period_start).slice(0, 10),
      end: String(p.period_end).slice(0, 10),
    };
  } else if (req.reportingPeriodId !== undefined) throw reportRefusals.periodNotAllowed();
  // A definition whose assembler has not merged yet (KBE-C2, KBE-D, KBE-D2) cannot be assembled: 404 (after the
  // subject and period checks, which the catalogue row alone decides).
  const assembler = assemblerOf(req.definitionCode);
  if (assembler === undefined) throw problems.notFound();
  const raw = req.parameters ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw reportRefusals.parametersInvalid();
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > REPORT_MAX_PARAMETER_BYTES)
    throw reportRefusals.parametersInvalid();
  const parameters = assembler.parseParameters(raw);
  return {
    assembler,
    subjectType,
    subjectId,
    organizationId: t.organization_id,
    transformation: { id: t.id, code: t.code, name: t.name },
    period,
    parameters,
    storedParameters: parameters as Record<string, unknown>,
  };
}

// ------------------------------------------------------------------------------------------------ assembly

export interface Assembly {
  readonly resolved: Resolved;
  readonly document: ReportDocument;
  readonly output: AssembledOutput;
  readonly asOf: string;
  readonly methodology: { versionId: string; key: string; versionNo: number };
  readonly sha256: string;
  readonly provisional: number;
  readonly unknown: number;
}

/**
 * Assembles one output in a read-only REPEATABLE READ transaction (no write, no lock). Throws the 422 refusals and
 * report.too_large before anything is written.
 */
export async function assembleReport(db: Db, req: ReportRequest): Promise<Assembly> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (tx) => {
      const resolved = await resolveRequest(tx, req);
      const clock = await sql<{ now: Date; today: string }>`
        SELECT now() AS now, p4_business_date(now(), coalesce(
          (SELECT c.timezone FROM business_calendar c
            WHERE c.organization_id = ${resolved.organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
          (SELECT o.default_timezone FROM organization o WHERE o.id = ${resolved.organizationId}::uuid)))::text AS today`.execute(
        tx,
      );
      const asOf = iso(clock.rows[0]!.now);
      const asOfDate = clock.rows[0]!.today;
      let pinned;
      try {
        pinned = await resolver.pinnedVersion(tx, resolved.transformation.id, "methodology");
      } catch {
        throw problems.internal();
      }
      const methodology = { versionId: pinned.versionId, key: pinned.key, versionNo: pinned.versionNo };
      // D-163 (ADR-0050 §2 (d); REQ-PB-089): the environment, read in this transaction (reportEnvironmentPort). In a
      // demo database the content records `synthetic: true`, and every export of it prints the illustrative label;
      // elsewhere the member is absent, so production content and its hash are unchanged.
      const environment = await reportEnvironmentPort.read(tx);
      const output = await resolved.assembler.assemble({
        db: tx,
        organizationId: resolved.organizationId,
        transformation: resolved.transformation,
        subject: { type: resolved.subjectType, id: resolved.subjectId },
        period: resolved.period,
        parameters: resolved.parameters,
        asOf,
        asOfDate,
      });
      for (const s of output.sections)
        if (s.kind === "table" && s.rows.length > REPORT_MAX_TABLE_ROWS) throw reportRefusals.tooLarge();
      const candidate: ReportDocument = {
        schemaVersion: REPORT_CONTENT_SCHEMA_VERSION,
        definitionCode: req.definitionCode,
        transformation: resolved.transformation,
        subject: {
          type: resolved.subjectType,
          id: resolved.subjectId,
          code: output.subject.code,
          label: output.subject.label,
        },
        period: resolved.period,
        asOf,
        methodology,
        approvalState: output.approvalState,
        sections: [...output.sections],
        ...(environment.synthetic ? { synthetic: true as const } : {}),
      };
      const parsed = reportDocument.safeParse(candidate);
      // A document that fails its own schema is a programming error of an assembler, never a user error.
      if (!parsed.success) throw problems.internal();
      const document = parsed.data;
      const { sha256, bytes } = reportContentSha256(document);
      if (bytes > REPORT_MAX_CONTENT_BYTES) throw reportRefusals.tooLarge();
      const counts = countReportValues(document.sections);
      return {
        resolved,
        document,
        output,
        asOf,
        methodology,
        sha256,
        provisional: counts.provisional,
        unknown: counts.unknown,
      };
    });
}

// ------------------------------------------------------------------------------------------------ presenter

export function toReportSnapshotSummary(r: ReportSnapshotRow): ReportSnapshotSummary {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    definitionCode: r.definition_code as ReportDefinitionCode,
    subjectType: r.subject_type as ReportSubjectType,
    subjectId: r.subject_id,
    reportingPeriodId: r.reporting_period_id,
    periodLabel: r.period_label,
    periodStart: r.period_start === null ? null : String(r.period_start).slice(0, 10),
    periodEnd: r.period_end === null ? null : String(r.period_end).slice(0, 10),
    asOf: iso(r.as_of),
    methodologyVersionId: r.methodology_version_id,
    approvalState: r.approval_state as ReportSnapshotSummary["approvalState"],
    provisionalValueCount: r.provisional_value_count,
    unknownValueCount: r.unknown_value_count,
    contentSha256: r.content_sha256.trim(),
    seriesId: r.series_id,
    reissueOfId: r.reissue_of_id,
    reissueReason: r.reissue_reason,
    status: r.status as ReportSnapshotSummary["status"],
    issueVersion: r.issue_version,
    issuedAt: isoOrNull(r.issued_at),
    issuedBy: r.issued_by,
    issueNote: r.issue_note,
    supersededAt: isoOrNull(r.superseded_at),
    supersededById: r.superseded_by_id,
    discardedAt: isoOrNull(r.discarded_at),
    discardedBy: r.discarded_by,
    discardReason: r.discard_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
  };
}

export function toReportSnapshot(r: ReportSnapshotRow): ReportSnapshot {
  return {
    ...toReportSnapshotSummary(r),
    parameters: r.parameters as Record<string, unknown>,
    content: r.content as ReportDocument,
  };
}

// ------------------------------------------------------------------------------------------------ writes

/** Lock class `reportSnapshotIssue` (ADVISORY_LOCK_CLASSES) on the output and subject (ADR-0045 §10). */
async function lockSeries(
  tx: Tx,
  s: Pick<ReportSnapshotRow, "definition_code" | "transformation_id" | "subject_id" | "reporting_period_id">,
) {
  const key = `${s.definition_code}:${s.transformation_id}:${s.subject_id}:${s.reporting_period_id ?? "-"}`;
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.reportSnapshotIssue}::int4, hashtext(${key}::text))`.execute(
    tx,
  );
}

/** Inserts a generated snapshot and its captured children; one audit event (the children are covered by it, RC01). */
async function insertSnapshot(
  tx: Tx,
  request: FastifyRequest,
  userId: string,
  a: Assembly,
  reissue: { readonly of: ReportSnapshotRow; readonly reason: string } | null,
): Promise<ReportSnapshotRow> {
  const id = uuidv7();
  const r = a.resolved;
  const row = await tx
    .insertInto("report_snapshot")
    .values({
      id,
      organization_id: r.organizationId,
      transformation_id: r.transformation.id,
      definition_code: a.document.definitionCode,
      subject_type: r.subjectType,
      subject_id: r.subjectId,
      reporting_period_id: r.period?.id ?? null,
      period_label: r.period?.label ?? null,
      period_start: r.period?.start ?? null,
      period_end: r.period?.end ?? null,
      parameters: JSON.stringify(r.storedParameters),
      as_of: a.asOf,
      content_schema_version: REPORT_CONTENT_SCHEMA_VERSION,
      content: JSON.stringify(a.document),
      content_sha256: a.sha256,
      methodology_version_id: a.methodology.versionId,
      approval_state: a.document.approvalState,
      provisional_value_count: a.provisional,
      unknown_value_count: a.unknown,
      series_id: reissue === null ? id : reissue.of.series_id,
      reissue_of_id: reissue === null ? null : reissue.of.id,
      reissue_reason: reissue === null ? null : reissue.reason,
      created_by: userId,
      updated_by: userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const base = { organization_id: r.organizationId, transformation_id: r.transformation.id, snapshot_id: id };
  // Sources: one row per record (UNIQUE per snapshot and record; a record used by two sections keeps its first).
  const seen = new Set<string>();
  for (const s of a.output.sources) {
    const k = `${s.recordType}:${s.recordId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await tx
      .insertInto("report_snapshot_source")
      .values({
        ...base,
        id: uuidv7(),
        section_key: s.sectionKey,
        record_type: s.recordType,
        record_id: s.recordId,
        record_version: s.recordVersion,
        record_updated_at:
          s.recordUpdatedAt === null
            ? null
            : s.recordUpdatedAt instanceof Date
              ? iso(s.recordUpdatedAt)
              : s.recordUpdatedAt,
        approval_state: s.approvalState,
        validation_state: s.validationState,
      })
      .execute();
  }
  // Versions: the methodology version always; then the assembler's configuration and calculation versions.
  const versions = [
    {
      versionKind: "methodology_version",
      referenceId: a.methodology.versionId,
      referenceKey: a.methodology.key,
      versionLabel: `v${a.methodology.versionNo}`,
    },
    ...a.output.versions,
  ];
  const seenVersion = new Set<string>();
  for (const v of versions) {
    const k = `${v.versionKind}:${v.referenceKey}`;
    if (seenVersion.has(k)) continue;
    seenVersion.add(k);
    await tx
      .insertInto("report_snapshot_version")
      .values({
        ...base,
        id: uuidv7(),
        version_kind: v.versionKind,
        reference_id: v.referenceId,
        reference_key: v.referenceKey,
        version_label: v.versionLabel,
      })
      .execute();
  }
  const seenEvidence = new Set<string>();
  for (const e of a.output.evidence) {
    const k = `${e.sectionKey}:${e.evidenceId}`;
    if (seenEvidence.has(k)) continue;
    seenEvidence.add(k);
    await tx
      .insertInto("report_snapshot_evidence")
      .values({
        ...base,
        id: uuidv7(),
        section_key: e.sectionKey,
        evidence_id: e.evidenceId,
        content_id: e.contentId,
        content_revision: e.contentRevision,
        content_sha256: e.contentSha256,
        review_status: e.reviewStatus,
      })
      .execute();
  }
  await record(tx, auditContextOf(request), {
    action: reissue === null ? "report_snapshot.generate" : "report_snapshot.reissue",
    recordType: "report_snapshot",
    recordId: id,
    organizationId: r.organizationId,
    transformationId: r.transformation.id,
    newVersion: 1,
    ...(reissue === null ? {} : { reason: reissue.reason }),
    changes: {
      definition_code: { from: null, to: a.document.definitionCode },
      subject_id: { from: null, to: r.subjectId },
      reporting_period_id: { from: null, to: r.period?.id ?? null },
      as_of: { from: null, to: a.asOf },
      content_sha256: { from: null, to: a.sha256 },
      methodology_version_id: { from: null, to: a.methodology.versionId },
      approval_state: { from: null, to: a.document.approvalState },
      provisional_value_count: { from: null, to: a.provisional },
      unknown_value_count: { from: null, to: a.unknown },
      series_id: { from: null, to: row.series_id },
      ...(reissue === null ? {} : { reissue_of_id: { from: null, to: reissue.of.id } }),
      status: { from: null, to: "generated" },
    },
  });
  return row;
}

/** POST …/reports/{code}/generate: assembly (read-only), then the write transaction. */
export async function generateSnapshot(
  db: Db,
  request: FastifyRequest,
  req: ReportRequest,
): Promise<ReportSnapshotRow> {
  await requireReportPermission(db, principalOf(request), req.transformationId, "report.generate");
  const a = await assembleReport(db, req);
  return db.transaction().execute(async (tx) => {
    const actor = await requireWriteAtCommit(tx, request, req.transformationId, "report.generate");
    return insertSnapshot(tx, request, actor.userId, a, null);
  });
}

/** The snapshot of the transformation, locked, with its If-Match checked; 404 when it belongs to another one. */
async function lockedSnapshot(tx: Tx, transformationId: string, snapshotId: string): Promise<ReportSnapshotRow> {
  const row = await tx
    .selectFrom("report_snapshot")
    .selectAll()
    .where("id", "=", snapshotId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  await lockSeries(tx, row);
  return tx
    .selectFrom("report_snapshot")
    .selectAll()
    .where("id", "=", snapshotId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

/** The `report_snapshot.issued` event, written once its payload schema is registered with its queue (KBE-E). */
async function enqueueIssued(tx: Tx, s: ReportSnapshotRow): Promise<void> {
  if (outboxPayloadSchema(REPORT_SNAPSHOT_ISSUED, 1) === null) return;
  const payload = reportSnapshotIssuedV1.parse({
    snapshotId: s.id,
    definitionCode: s.definition_code,
    transformationId: s.transformation_id,
    seriesId: s.series_id,
    issueVersion: s.issue_version,
  });
  await tx
    .insertInto("outbox_event")
    .values({
      id: uuidv7(),
      organization_id: s.organization_id,
      aggregate_type: "report_snapshot",
      aggregate_id: s.id,
      event_type: REPORT_SNAPSHOT_ISSUED,
      schema_version: 1,
      payload: JSON.stringify(payload),
      idempotency_key: `${REPORT_SNAPSHOT_ISSUED}:${s.id}`,
    })
    .onConflict((oc) => oc.column("idempotency_key").doNothing())
    .execute();
}

/** POST …/report-snapshots/{id}/issue. */
export async function issueSnapshot(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  snapshotId: string,
  input: () => { expected: number; text: string | null },
): Promise<ReportSnapshotRow> {
  const actor = await requireWriteAtCommit(tx, request, transformationId, "report.issue");
  const { expected, text: note } = input();
  const s = await lockedSnapshot(tx, transformationId, snapshotId);
  if (s.version !== expected) throw problems.versionConflict(s.version);
  if (s.status !== "generated") throw reportRefusals.notGenerated();
  const audit = auditContextOf(request);
  let prev: ReportSnapshotRow | undefined;
  if (s.reissue_of_id !== null) {
    // The reissue continues the CURRENT issue of its series: if that one was superseded meanwhile, reload.
    prev = await tx
      .selectFrom("report_snapshot")
      .selectAll()
      .where("id", "=", s.reissue_of_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (prev.status !== "issued") throw reportRefusals.seriesChanged(s.version);
  } else {
    const issued = await tx
      .selectFrom("report_snapshot")
      .select("id")
      .where("series_id", "=", s.series_id)
      .where("issue_version", "is not", null)
      .executeTakeFirst();
    if (issued !== undefined) throw reportRefusals.seriesChanged(s.version);
  }
  const next =
    ((
      await tx
        .selectFrom("report_snapshot")
        .select((eb) => eb.fn.max("issue_version").as("v"))
        .where("series_id", "=", s.series_id)
        .executeTakeFirst()
    )?.v ?? 0) + 1;
  if (prev !== undefined) {
    const sup = await tx
      .updateTable("report_snapshot")
      .set({
        status: "superseded",
        superseded_at: sql<Date>`now()`,
        superseded_by_id: s.id,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: actor.userId,
      })
      .where("id", "=", prev.id)
      .where("version", "=", prev.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "report_snapshot.supersede",
      recordType: "report_snapshot",
      recordId: prev.id,
      organizationId: prev.organization_id,
      transformationId,
      priorVersion: prev.version,
      newVersion: sup.version,
      changes: { status: { from: "issued", to: "superseded" }, superseded_by_id: { from: null, to: s.id } },
    });
  }
  const issued = await tx
    .updateTable("report_snapshot")
    .set({
      status: "issued",
      issue_version: next,
      issued_at: sql<Date>`now()`,
      issued_by: actor.userId,
      issue_note: note,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", s.id)
    .where("version", "=", s.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "report_snapshot.issue",
    recordType: "report_snapshot",
    recordId: s.id,
    organizationId: s.organization_id,
    transformationId,
    priorVersion: s.version,
    newVersion: issued.version,
    changes: {
      status: { from: "generated", to: "issued" },
      issue_version: { from: null, to: next },
      ...(note === null ? {} : { issue_note: { from: null, to: note } }),
    },
  });
  await enqueueIssued(tx, issued);
  return issued;
}

/** POST …/report-snapshots/{id}/discard. */
export async function discardSnapshot(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  snapshotId: string,
  input: () => { expected: number; text: string },
): Promise<ReportSnapshotRow> {
  const actor = await requireWriteAtCommit(tx, request, transformationId, "report.issue");
  const { expected, text: reason } = input();
  const s = await lockedSnapshot(tx, transformationId, snapshotId);
  if (s.version !== expected) throw problems.versionConflict(s.version);
  if (s.status !== "generated") throw reportRefusals.notGenerated();
  const updated = await tx
    .updateTable("report_snapshot")
    .set({
      status: "discarded",
      discarded_at: sql<Date>`now()`,
      discarded_by: actor.userId,
      discard_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", s.id)
    .where("version", "=", s.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "report_snapshot.discard",
    recordType: "report_snapshot",
    recordId: s.id,
    organizationId: s.organization_id,
    transformationId,
    priorVersion: s.version,
    newVersion: updated.version,
    reason,
    changes: { status: { from: "generated", to: "discarded" } },
  });
  return updated;
}

/**
 * POST …/report-snapshots/{id}/reissue: the current issued snapshot is assembled again from the current records (same
 * definition, subject, period and parameters) and stored as a new generated snapshot of the same series. The issued
 * snapshot is not changed (its If-Match is checked, its version stays) until the reissue is issued.
 */
export async function reissueSnapshot(
  db: Db,
  request: FastifyRequest,
  transformationId: string,
  snapshotId: string,
  input: () => { expected: number; text: string },
): Promise<ReportSnapshotRow> {
  await requireReportPermission(db, principalOf(request), transformationId, "report.issue");
  const { expected, text: reason } = input();
  const current = await db
    .selectFrom("report_snapshot")
    .selectAll()
    .where("id", "=", snapshotId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (current === undefined) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "issued") throw reportRefusals.notIssued();
  const a = await assembleReport(db, {
    definitionCode: current.definition_code as ReportDefinitionCode,
    transformationId,
    subjectId: current.subject_type === "transformation" ? undefined : current.subject_id,
    reportingPeriodId: current.reporting_period_id ?? undefined,
    parameters: current.parameters,
  });
  return db.transaction().execute(async (tx) => {
    const actor = await requireWriteAtCommit(tx, request, transformationId, "report.issue");
    const s = await lockedSnapshot(tx, transformationId, snapshotId);
    if (s.version !== expected) throw problems.versionConflict(s.version);
    if (s.status !== "issued") throw reportRefusals.notIssued();
    return insertSnapshot(tx, request, actor.userId, a, { of: s, reason });
  });
}
