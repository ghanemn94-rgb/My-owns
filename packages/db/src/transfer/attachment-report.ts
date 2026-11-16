// The attachment verify report that the import and the recheck consume (ADR-0064 Amendment 1 §A1.8; p7-work-split
// §C.12; T-DG7-BE-R1). `transfer-attachments verify --from <dir> --out <file>` (BE-E) writes `mth-attachment-verify/1`:
// canonical JSON (keys in a fixed order, no insignificant whitespace, one final newline). This module reads it and
// refuses, with the A1.8 lines (exit 2 of the caller), a file that is not exactly that, that belongs to another
// package, or that checked another number of attachments. A package with attachments is never counted as 0 checked:
// the caller refuses it without a report (`requireAttachmentReport`).
//
// Nothing here approves anything (no G1-G6, Finance or IT approval) and nothing reads or writes DG0-DG7.
import { decodeStrictUtf8 } from "./manifest.ts";
import type { AttachmentMismatch } from "./reconcile.ts";

export const ATTACHMENT_VERIFY_SCHEMA_VERSION = "mth-attachment-verify/1";

export type ReportCommand = "import-migration" | "reconcile-migration";

/** A refusal of the report (exit 2); `message` is the A1.8 line. */
export class AttachmentReportRefused extends Error {
  readonly exitCode = 2 as const;
  constructor(line: string) {
    super(line);
    this.name = "AttachmentReportRefused";
  }
}

export interface ReportExpectation {
  /** The package's attachments.json SHA-256 (import) or migration_import.attachment_manifest_sha256 (recheck). */
  readonly attachmentManifestSha256: string;
  /** The number of attachments the package lists. */
  readonly count: number;
}

export interface ParsedAttachmentReport {
  readonly checked: number;
  readonly mismatches: readonly AttachmentMismatch[];
}

const TOP_KEYS = ["schemaVersion", "attachmentManifestSha256", "checked", "result", "mismatches"] as const;
const MISMATCH_KEYS = [
  "parentTable",
  "objectName",
  "problem",
  "expectedSize",
  "actualSize",
  "expectedSha256",
  "actualSha256",
] as const;
const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const TABLE = /^[a-z][a-z0-9_]{0,62}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function keysExactly(v: Record<string, unknown>, keys: readonly string[], where: string): void {
  const actual = Object.keys(v);
  if (actual.length !== keys.length || actual.some((k, i) => k !== keys[i]))
    throw new Error(`${where} must have exactly the keys ${keys.join(", ")} in this order`);
}

/** The mismatch entries of a well-formed report, or throws with the `<reason>`. */
function readReport(bytes: Uint8Array): { sha256: string; checked: number; mismatches: AttachmentMismatch[] } {
  let text: string;
  try {
    text = decodeStrictUtf8(bytes);
  } catch {
    throw new Error("not strict UTF-8");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("not JSON");
  }
  if (!isObject(value)) throw new Error("not a JSON object");
  if (value["schemaVersion"] !== ATTACHMENT_VERIFY_SCHEMA_VERSION)
    throw new Error(`schemaVersion is not ${ATTACHMENT_VERIFY_SCHEMA_VERSION}`);
  keysExactly(value, TOP_KEYS, "the report");
  const sha256 = value["attachmentManifestSha256"];
  if (typeof sha256 !== "string" || !HEX64.test(sha256))
    throw new Error("attachmentManifestSha256 is not 64 lowercase hex");
  const checked = value["checked"];
  if (typeof checked !== "number" || !Number.isSafeInteger(checked) || checked < 0)
    throw new Error("checked is not a non-negative integer");
  const list = value["mismatches"];
  if (!Array.isArray(list)) throw new Error("mismatches is not an array");
  const mismatches = list.map((m: unknown, i): AttachmentMismatch => {
    const where = `mismatches[${i}]`;
    if (!isObject(m)) throw new Error(`${where} is not an object`);
    keysExactly(m, MISMATCH_KEYS, where);
    const { parentTable, objectName, problem, expectedSize, actualSize, expectedSha256, actualSha256 } = m;
    if (typeof parentTable !== "string" || !TABLE.test(parentTable)) throw new Error(`${where}.parentTable is invalid`);
    if (typeof objectName !== "string" || objectName.length < 1 || objectName.length > 1024)
      throw new Error(`${where}.objectName is invalid`);
    if (problem !== "missing" && problem !== "size_mismatch" && problem !== "sha256_mismatch")
      throw new Error(`${where}.problem is invalid`);
    if (typeof expectedSize !== "string" || !DECIMAL.test(expectedSize))
      throw new Error(`${where}.expectedSize is not a decimal string`);
    if (typeof expectedSha256 !== "string" || !HEX64.test(expectedSha256))
      throw new Error(`${where}.expectedSha256 is not 64 lowercase hex`);
    if (problem === "missing") {
      if (actualSize !== null || actualSha256 !== null)
        throw new Error(`${where}: actualSize and actualSha256 must be null for missing`);
    } else {
      if (typeof actualSize !== "string" || !DECIMAL.test(actualSize))
        throw new Error(`${where}.actualSize is not a decimal string`);
      if (typeof actualSha256 !== "string" || !HEX64.test(actualSha256))
        throw new Error(`${where}.actualSha256 is not 64 lowercase hex`);
    }
    return {
      parentTable,
      objectName,
      problem,
      expectedSize,
      actualSize: actualSize as string | null,
      expectedSha256,
      actualSha256: actualSha256 as string | null,
    };
  });
  const result = value["result"];
  if (result !== (mismatches.length === 0 ? "matched" : "mismatched"))
    throw new Error("result does not agree with mismatches");
  // Canonical: exactly the bytes the writer produces (compact, key order as read, one final newline).
  if (text !== `${JSON.stringify(value)}\n`) throw new Error("not canonical JSON");
  return { sha256, checked, mismatches };
}

/**
 * `parseAttachmentReport(bytes, expected)`: the mismatches of a valid report for `expected`, or AttachmentReportRefused
 * with the A1.8 line for `cmd`.
 */
export function parseAttachmentReport(
  bytes: Uint8Array,
  expected: ReportExpectation,
  cmd: ReportCommand = "import-migration",
): ParsedAttachmentReport {
  let read: ReturnType<typeof readReport>;
  try {
    read = readReport(bytes);
  } catch (err) {
    throw new AttachmentReportRefused(`${cmd}: refused: invalid attachment report: ${(err as Error).message}`);
  }
  if (read.sha256 !== expected.attachmentManifestSha256)
    throw new AttachmentReportRefused(
      `${cmd}: refused: the attachment report belongs to another package (${read.sha256}, the import recorded ${expected.attachmentManifestSha256})`,
    );
  if (read.checked !== expected.count)
    throw new AttachmentReportRefused(
      `${cmd}: refused: the attachment report checked ${read.checked} of ${expected.count} attachments`,
    );
  return { checked: read.checked, mismatches: read.mismatches };
}

/** The A1.8 refusal of a package with attachments and no report. */
export function requireAttachmentReport(count: number, given: boolean, cmd: ReportCommand): void {
  if (count > 0 && !given)
    throw new AttachmentReportRefused(
      `${cmd}: refused: the package lists ${count} attachments; give --attachments-report <file> written by transfer-attachments verify`,
    );
}
