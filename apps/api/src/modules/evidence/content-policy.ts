// P6 slice F (T-DG6-BE-D; ADR-0052 §1; REQ-S13-011 "Uploads are type- and size-checked"; D-195 Q4): the upload type
// allow-list by magic bytes plus extension, and the organization's effective upload policy.
//
// Detection never trusts the client's Content-Type and never the extension alone. It reads the bytes the store
// receives, in the same stream the store hashes and size-checks (ContentInspector, fed by `inspectedBody`), and
// decides only once the store has accepted the size: the first 8 KiB for the signatures and the SVG root element, the
// whole stream for strict UTF-8 and the NUL rule (csv, txt, svg), and for a ZIP the central directory, read from the
// retained tail of the stream (at most MAX_ZIP_ENTRIES entries; nothing is decompressed). The ZIP reader is new code
// here; no dependency is added (D-195). A file is accepted iff its detected type is in the closed set, its extension
// is one of that type's extensions, the type is in the effective policy and its size is at most the policy's maxBytes.
//
// The effective policy is the organization's `upload_policy` row, or the built-in default (all ten types, 26214400
// bytes) when no row exists (`0099`; a row can only narrow it). Files stored before P6 keep detected_type NULL and are
// never previewed. Nothing here approves anything.
import type { DbOrTx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { UPLOAD_POLICY_MAX_BYTES, UPLOAD_TYPES, type UploadType } from "@mth/shared/schemas";
import { HttpProblem } from "../platform/index.ts";
import type { EvidenceBody } from "./store.ts";

export { UPLOAD_TYPES, type UploadType };

/** The canonical media type of each type: equal to `p6_upload_media_type` (`0099`; probe EC01-EC07). */
export const UPLOAD_MEDIA_TYPES: Readonly<Record<UploadType, string>> = Object.freeze({
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
});

/** The extensions of each type (case-insensitive; ADR-0052 §1). */
export const UPLOAD_EXTENSIONS: Readonly<Record<UploadType, readonly string[]>> = Object.freeze({
  pdf: [".pdf"],
  docx: [".docx"],
  xlsx: [".xlsx"],
  pptx: [".pptx"],
  csv: [".csv"],
  txt: [".txt"],
  png: [".png"],
  jpeg: [".jpg", ".jpeg"],
  gif: [".gif"],
  svg: [".svg"],
});

const MEDIA_TYPES = new Map<string, string>(Object.entries(UPLOAD_MEDIA_TYPES));
const EXTENSIONS = new Map<string, readonly string[]>(Object.entries(UPLOAD_EXTENSIONS));

/** The canonical media type of a type of the closed set. */
export function mediaTypeOf(type: UploadType): string {
  return MEDIA_TYPES.get(type)!;
}

/** The extensions of a type of the closed set. */
export function extensionsOf(type: UploadType): readonly string[] {
  return EXTENSIONS.get(type)!;
}

/** The built-in default policy (no `upload_policy` row): every type, 25 MiB. */
export const DEFAULT_UPLOAD_POLICY: EffectiveUploadPolicy = Object.freeze({
  allowedTypes: UPLOAD_TYPES,
  maxBytes: UPLOAD_POLICY_MAX_BYTES,
  isDefault: true,
  reason: null,
  version: 0,
  updatedAt: null,
  id: null,
});

export interface EffectiveUploadPolicy {
  readonly allowedTypes: readonly UploadType[];
  readonly maxBytes: number;
  readonly isDefault: boolean;
  readonly reason: string | null;
  /** 0 when no row exists (ETag "0"). */
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly id: string | null;
}

/** The bytes inspected for signatures and the SVG root element. */
export const HEAD_BYTES = 8 * 1024;
/** ADR-0052 §1: an OOXML central directory is read only up to this many entries. */
export const MAX_ZIP_ENTRIES = 10_000;
/**
 * The tail of a ZIP stream retained to read its central directory (only for streams that start with a ZIP local
 * header). 10,000 entries of the 46-byte fixed header plus a name of up to ~300 bytes fit in 4 MiB; the end-of-central-
 * directory record and its comment add at most 65,557 bytes. A ZIP whose directory does not fit is not recognised.
 */
export const ZIP_TAIL_BYTES = 4 * 1024 * 1024 + 65_557;

/** The result of inspecting a stream: a type of the closed set, UTF-8 text (csv or txt), or nothing allowed. */
export type ContentKind = Exclude<UploadType, "csv" | "txt"> | "text" | "unknown";
export interface Detection {
  readonly kind: ContentKind;
  /** An OOXML package carrying a VBA project (`vbaProject.bin`): a macro-enabled file, never allowed. */
  readonly macro: boolean;
}

const SIG = {
  pdf: Buffer.from("%PDF-", "latin1"),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  gif87: Buffer.from("GIF87a", "latin1"),
  gif89: Buffer.from("GIF89a", "latin1"),
} as const;

const startsWith = (bytes: Uint8Array, sig: Buffer): boolean =>
  bytes.length >= sig.length && sig.equals(Buffer.from(bytes.buffer, bytes.byteOffset, sig.length));

/** True when `head` (the first bytes of a stored object) still carries the magic of a raster type (ADR-0052 §2). */
export function matchesRasterMagic(type: "png" | "jpeg" | "gif", head: Uint8Array): boolean {
  if (type === "png") return startsWith(head, SIG.png);
  if (type === "jpeg") return startsWith(head, SIG.jpeg);
  return startsWith(head, SIG.gif87) || startsWith(head, SIG.gif89);
}

/**
 * After an optional BOM, whitespace, the XML declaration and comments, the root element is `<svg` (ADR-0052 §1).
 * `head` is the decoded first 8 KiB; a prolog that does not end within it is not recognised.
 */
export function hasSvgRoot(head: string): boolean {
  let s = head.startsWith("﻿") ? head.slice(1) : head;
  for (;;) {
    s = s.replace(/^[\t\n\r ]+/, "");
    if (s.startsWith("<?xml")) {
      const end = s.indexOf("?>");
      if (end < 0) return false;
      s = s.slice(end + 2);
    } else if (s.startsWith("<!--")) {
      const end = s.indexOf("-->", 4);
      if (end < 0) return false;
      s = s.slice(end + 3);
    } else break;
  }
  return /^<svg[\t\n\r />]/.test(s);
}

/** The OOXML main part of each type (ADR-0052 §1 table). */
const OOXML_MAIN_PART = [
  ["docx", "word/document.xml"],
  ["xlsx", "xl/workbook.xml"],
  ["pptx", "ppt/presentation.xml"],
] as const;

/**
 * Reads the entry names of a ZIP central directory from the stream's retained tail (`tail` holds the stream's bytes
 * from absolute offset `tailStart` to its end). Returns null when the directory cannot be read: no end-of-central-
 * directory record, a multi-disk or ZIP64 archive, more than MAX_ZIP_ENTRIES entries, a directory outside the
 * retained tail, or a malformed entry. Only the directory headers are read; no entry is decompressed. Exported for
 * unit tests.
 */
export function zipEntryNames(tail: Buffer, tailStart: number): string[] | null {
  const EOCD = 0x06054b50;
  const minStart = Math.max(0, tail.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = tail.length - 22; i >= minStart; i--) {
    if (tail.readUInt32LE(i) === EOCD && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const disk = tail.readUInt16LE(eocd + 4);
  const cdDisk = tail.readUInt16LE(eocd + 6);
  const onDisk = tail.readUInt16LE(eocd + 8);
  const total = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) return null;
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null; // ZIP64: not read
  if (total > MAX_ZIP_ENTRIES) return null;
  const start = cdOffset - tailStart;
  if (start < 0 || start + cdSize > eocd) return null;
  const names: string[] = [];
  let p = start;
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || tail.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLength = tail.readUInt16LE(p + 28);
    const extraLength = tail.readUInt16LE(p + 30);
    const commentLength = tail.readUInt16LE(p + 32);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) return null;
    names.push(tail.toString("utf8", p + 46, p + 46 + nameLength));
    p = end;
  }
  return names;
}

/** Classifies a ZIP by its entry names: an OOXML type, macro-enabled (`vbaProject.bin`), or unknown. */
export function classifyZip(names: readonly string[] | null): Detection {
  if (names === null) return { kind: "unknown", macro: false };
  if (names.some((n) => /(^|\/)vbaproject\.bin$/i.test(n))) return { kind: "unknown", macro: true };
  if (!names.includes("[Content_Types].xml")) return { kind: "unknown", macro: false };
  const found = OOXML_MAIN_PART.filter(([, part]) => names.includes(part));
  return found.length === 1 ? { kind: found[0]![0], macro: false } : { kind: "unknown", macro: false };
}

/**
 * Streaming inspector: `push` every chunk of the stream in order, then `finish` once. Memory: the 8 KiB head, and for
 * a stream that starts with a ZIP local header the last ZIP_TAIL_BYTES. Strict UTF-8 is checked incrementally (a
 * fatal streaming decoder); a NUL byte anywhere disqualifies text.
 */
export class ContentInspector {
  private readonly headParts: Buffer[] = [];
  private headLength = 0;
  private head: Buffer | null = null;
  private size = 0;
  private text = true;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private zip: boolean | null = null;
  private readonly tail: Buffer[] = [];
  private tailLength = 0;

  push(chunk: Uint8Array | string): void {
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (bytes.length === 0) return;
    this.size += bytes.length;
    if (this.headLength < HEAD_BYTES) {
      const part = bytes.subarray(0, HEAD_BYTES - this.headLength);
      this.headParts.push(Buffer.from(part));
      this.headLength += part.length;
    }
    if (this.zip === null && this.headLength >= SIG.zip.length) this.zip = startsWith(this.headBuffer(), SIG.zip);
    if (this.text) {
      if (bytes.includes(0)) this.text = false;
      else {
        try {
          this.decoder.decode(bytes, { stream: true });
        } catch {
          this.text = false;
        }
      }
    }
    if (this.zip !== false) {
      this.tail.push(Buffer.from(bytes));
      this.tailLength += bytes.length;
      while (this.tail.length > 1 && this.tailLength - this.tail[0]!.length >= ZIP_TAIL_BYTES) {
        this.tailLength -= this.tail.shift()!.length;
      }
    }
  }

  private headBuffer(): Buffer {
    if (this.head === null || this.head.length !== this.headLength) this.head = Buffer.concat(this.headParts);
    return this.head;
  }

  finish(): Detection {
    const head = this.headBuffer();
    if (startsWith(head, SIG.pdf)) return { kind: "pdf", macro: false };
    if (startsWith(head, SIG.zip)) {
      const tail = Buffer.concat(this.tail);
      return classifyZip(zipEntryNames(tail, this.size - tail.length));
    }
    if (startsWith(head, SIG.png)) return { kind: "png", macro: false };
    if (startsWith(head, SIG.jpeg)) return { kind: "jpeg", macro: false };
    if (startsWith(head, SIG.gif87) || startsWith(head, SIG.gif89)) return { kind: "gif", macro: false };
    if (this.text) {
      try {
        this.decoder.decode(); // flush: a truncated multi-byte sequence at the end is not UTF-8
      } catch {
        return { kind: "unknown", macro: false };
      }
      // The head may end inside a multi-byte sequence: decode it leniently for the root-element check only.
      if (hasSvgRoot(new TextDecoder("utf-8").decode(head))) return { kind: "svg", macro: false };
      return { kind: "text", macro: false };
    }
    return { kind: "unknown", macro: false };
  }
}

/** Inspects a whole byte buffer (unit tests and tools). */
export function detectContent(bytes: Uint8Array): Detection {
  const inspector = new ContentInspector();
  inspector.push(bytes);
  return inspector.finish();
}

/** The request body, re-yielded unchanged chunk by chunk while `inspector` sees every byte (the store's own stream). */
export function inspectedBody(body: EvidenceBody, inspector: ContentInspector): EvidenceBody {
  if (body instanceof Uint8Array) {
    inspector.push(body);
    return body;
  }
  return (async function* () {
    for await (const chunk of body) {
      inspector.push(chunk);
      yield chunk;
    }
  })();
}

/** The extension of a stored file name, lower-cased with its dot (`.pdf`), or "" when it has none. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 || dot === fileName.length - 1 ? "" : fileName.slice(dot).toLowerCase();
}

/** The type whose extensions include this file name's extension, or null. */
export function typeOfExtension(fileName: string): UploadType | null {
  const ext = extensionOf(fileName);
  if (ext === "") return null;
  return UPLOAD_TYPES.find((t) => extensionsOf(t).includes(ext)) ?? null;
}

// ------------------------------------------------------------------------------------------------ refusals (ADR-0052 §1)

/** 422 `evidence.type_not_allowed`, with `params.allowedTypes` (D-198: the placeholder of the translated text). */
export function typeNotAllowed(allowed: readonly UploadType[]): HttpProblem {
  const allowedTypes = allowed.join(", ");
  return new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code: "evidence.type_not_allowed",
    title: "Business rule violated",
    detail: `This file type is not allowed. Allowed types: ${allowedTypes}.`,
    params: { allowedTypes },
  });
}

/** 422 `evidence.type_mismatch`, with `params.extension`. */
export function typeMismatch(extension: string): HttpProblem {
  return new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code: "evidence.type_mismatch",
    title: "Business rule violated",
    detail: `The file's content does not match its extension ${extension}.`,
    params: { extension },
  });
}

/** 413 `evidence.too_large` (the DG2 code and text; `maxBytes` is now the policy's limit), with `params.maxBytes`. */
export function tooLarge(maxBytes: number): HttpProblem {
  return new HttpProblem({
    status: 413,
    type: PROBLEM_TYPES.validation,
    code: "evidence.too_large",
    title: "Content too large",
    detail: `Evidence content is limited to ${maxBytes} bytes per revision.`,
    params: { maxBytes: String(maxBytes) },
  });
}

/**
 * The ADR-0052 §1 decision for a received file. Order: the extension must name a type the policy allows (else
 * `type_not_allowed`, also for a macro-enabled package); then the content must be that type (else `type_mismatch`: an
 * `.exe` renamed `.pdf`). `size` is re-checked against the policy read at commit time. Returns the accepted type.
 */
export function decideUpload(
  fileName: string,
  detection: Detection,
  size: number,
  policy: Pick<EffectiveUploadPolicy, "allowedTypes" | "maxBytes">,
): UploadType {
  if (size > policy.maxBytes) throw tooLarge(policy.maxBytes);
  const claimed = typeOfExtension(fileName);
  if (claimed === null || !policy.allowedTypes.includes(claimed) || detection.macro)
    throw typeNotAllowed(policy.allowedTypes);
  const matches = detection.kind === claimed || (detection.kind === "text" && (claimed === "csv" || claimed === "txt"));
  if (!matches) throw typeMismatch(extensionOf(fileName));
  return claimed;
}

// ------------------------------------------------------------------------------------------------ the effective policy

/** The organization's policy row, or the default when none exists. `lock`: FOR UPDATE (the PUT). */
export async function effectiveUploadPolicy(
  db: DbOrTx,
  organizationId: string,
  lock = false,
): Promise<EffectiveUploadPolicy> {
  let q = db.selectFrom("upload_policy").selectAll().where("organization_id", "=", organizationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) return DEFAULT_UPLOAD_POLICY;
  const allowed = new Set(row.allowed_types);
  return {
    // Contract order, whatever order the row stores.
    allowedTypes: UPLOAD_TYPES.filter((t) => allowed.has(t)),
    maxBytes: Number(row.max_bytes),
    isDefault: false,
    reason: row.reason,
    version: row.version,
    updatedAt: row.updated_at,
    id: row.id,
  };
}
