// Deterministic POSIX ustar/pax writer and a tar reader (ADR-0062 §3). Node built-ins only; no dependency.
//
// Writer rules (exact): entries sorted by the UTF-8 byte order of the full path (Buffer.compare, no locale); every
// directory gets an explicit entry before its contents; directories 0755, files 0644 or 0755; uid/gid 0, empty
// uname/gname, devmajor/devminor 0; one fixed mtime for every entry; a pax `x` header (exactly one `path` record) only
// when the path does not fit ustar's name/prefix split or is not ASCII; two zero blocks at the end, padded to a
// 10240-byte record. gzip: level 9, OS byte (offset 9) set to 255, mtime field 0.
import { gzipSync, gunzipSync } from "node:zlib";

export const DEFAULT_MTIME = 946684800; // 2000-01-01T00:00:00Z, a synthetic constant (ADR-0062 §3)
const BLOCK = 512;
const RECORD = 10240;

/** Throws `refused path <escaped>` for an absolute path, a `..` or empty segment, a control character or bad UTF-8. */
export function checkPath(path, raw) {
  const escaped = JSON.stringify(path);
  const bad =
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.includes("�") ||
    (raw !== undefined && !Buffer.from(path, "utf8").equals(raw)) ||
    path.split("/").some((s) => s === ".." || s === "." || s === "");
  if (bad) {
    const err = new Error(`refused path ${escaped}`);
    err.code = "REFUSED_PATH";
    throw err;
  }
}

function octal(value, length) {
  // length includes the terminating NUL
  const s = value.toString(8).padStart(length - 1, "0");
  if (s.length > length - 1) throw new Error(`tar: value ${value} does not fit ${length} bytes`);
  return s + "\0";
}

function header({ name, prefix, size, mode, type, mtime }) {
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, "utf8");
  h.write(octal(mode, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii"); // uid
  h.write(octal(0, 8), 116, "ascii"); // gid
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(mtime, 12), 136, "ascii");
  h.fill(0x20, 148, 156); // checksum placeholder: spaces
  h.write(type, 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  // uname (265..297) and gname (297..329) stay empty
  h.write(octal(0, 8), 329, "ascii"); // devmajor
  h.write(octal(0, 8), 337, "ascii"); // devminor
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

/** ustar name/prefix split, or null when the path needs a pax header. */
function splitUstar(path) {
  if (!/^[\x20-\x7e]*$/.test(path)) return null;
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== "/") continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (prefix.length <= 155 && name.length <= 100 && name.length > 0) return { name, prefix };
  }
  return null;
}

function pad(buf) {
  const rest = buf.length % BLOCK;
  return rest === 0 ? buf : Buffer.concat([buf, Buffer.alloc(BLOCK - rest, 0)]);
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body);
  let total = len + String(len).length;
  if (String(total).length !== String(len).length) total = len + String(total).length;
  return Buffer.from(`${total}${body}`, "utf8");
}

/** Sorted-by-bytes comparator for archive paths. */
export function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Builds a deterministic tar. `files` is [{ path, data: Buffer, mode: 0o644|0o755 }]; directory entries are derived.
 * @returns {Buffer}
 */
export function writeTar(files, { mtime = DEFAULT_MTIME } = {}) {
  const entries = new Map();
  for (const f of files) {
    checkPath(f.path);
    if (f.mode !== 0o644 && f.mode !== 0o755) throw new Error(`tar: mode ${f.mode.toString(8)} not allowed for ${f.path}`);
    if (entries.has(f.path)) throw new Error(`tar: duplicate path ${f.path}`);
    entries.set(f.path, { type: "0", data: f.data, mode: f.mode });
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = `${parts.slice(0, i).join("/")}/`;
      if (!entries.has(dir)) entries.set(dir, { type: "5", data: Buffer.alloc(0), mode: 0o755 });
    }
  }
  for (const p of entries.keys()) if (!p.endsWith("/") && entries.has(`${p}/`)) throw new Error(`tar: ${p} is both a file and a directory`);
  const chunks = [];
  for (const path of [...entries.keys()].sort(compareBytes)) {
    const e = entries.get(path);
    const split = splitUstar(path);
    if (!split) {
      const pax = paxRecord("path", path);
      chunks.push(header({ name: "PaxHeader", prefix: "", size: pax.length, mode: 0o644, type: "x", mtime }));
      chunks.push(pad(pax));
    }
    const { name, prefix } = split ?? { name: "pax-long-path", prefix: "" };
    chunks.push(header({ name, prefix, size: e.data.length, mode: e.mode, type: e.type, mtime }));
    if (e.data.length) chunks.push(pad(e.data));
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  let tar = Buffer.concat(chunks);
  const rest = tar.length % RECORD;
  if (rest) tar = Buffer.concat([tar, Buffer.alloc(RECORD - rest, 0)]);
  return tar;
}

/** gzip with level 9, gzip mtime 0 and OS byte 255 (ADR-0062 §3). */
export function gzipDeterministic(tar) {
  const gz = gzipSync(tar, { level: 9 });
  gz.writeUInt32LE(0, 4); // mtime (Node already writes 0; asserted by the test)
  gz[9] = 255;
  return gz;
}

function readString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? len : nul).toString("utf8");
}

function readOctal(buf, start, len) {
  const s = readString(buf, start, len).trim();
  return s === "" ? 0 : parseInt(s, 8);
}

/**
 * Parses an (uncompressed) tar buffer. Yields { path, type: "file"|"dir"|"other", typeflag, mode, uid, gid, uname,
 * gname, mtime, data, paxKeys }. Throws on a bad header checksum or a truncated archive.
 */
export function* readTar(buf) {
  let off = 0;
  let pax = null;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) return;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (sum !== readOctal(h, 148, 8)) throw new Error(`tar: bad header checksum at offset ${off}`);
    const size = readOctal(h, 124, 12);
    const typeflag = String.fromCharCode(h[156] || 0x30);
    const dataStart = off + BLOCK;
    if (dataStart + size > buf.length) throw new Error("tar: truncated archive");
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (typeflag === "x") {
      pax = {};
      let i = 0;
      while (i < data.length) {
        const sp = data.indexOf(0x20, i);
        const len = parseInt(data.subarray(i, sp).toString("ascii"), 10);
        if (!(len > 0) || sp === -1) throw new Error("tar: bad pax record");
        const kv = data.subarray(sp + 1, i + len - 1).toString("utf8");
        const eq = kv.indexOf("=");
        pax[kv.slice(0, eq)] = kv.slice(eq + 1);
        i += len;
      }
      continue;
    }
    const name = readString(h, 0, 100);
    const prefix = readString(h, 345, 155);
    let path = pax?.path ?? (prefix ? `${prefix}/${name}` : name);
    const paxKeys = pax ? Object.keys(pax) : [];
    pax = null;
    const type = typeflag === "5" ? "dir" : typeflag === "0" ? "file" : "other";
    if (type === "dir" && path.endsWith("/")) path = path.slice(0, -1);
    yield {
      path,
      type,
      typeflag,
      mode: readOctal(h, 100, 8),
      uid: readOctal(h, 108, 8),
      gid: readOctal(h, 116, 8),
      uname: readString(h, 265, 32),
      gname: readString(h, 297, 32),
      mtime: readOctal(h, 136, 12),
      data,
      paxKeys,
    };
  }
}

/** gunzip helper that reports a non-gzip input distinctly. */
export function gunzipArchive(bytes) {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    const err = new Error("not gzip");
    err.code = "NOT_GZIP";
    throw err;
  }
  return gunzipSync(bytes);
}
