/**
 * Pre-scan of an uploaded import file (AT-25, C-14), before anything is stored as a document: names of a ZIP container's
 * parts (central directory only — nothing is decompressed here) for the type allowlist, and active content in a PDF.
 */

/** Part names of a ZIP container (bounded; null when it is not a well-formed, non-ZIP64 archive). */
export function zipEntryNames(buf: Buffer, maxEntries = 5000): string[] | null {
  if (buf.length < 22) return null;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || count > maxEntries || cdOffset + cdSize > buf.length) return null;
  const names: string[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const n = buf.readUInt16LE(p + 28);
    const e = buf.readUInt16LE(p + 30);
    const c = buf.readUInt16LE(p + 32);
    if (p + 46 + n > buf.length) return null;
    names.push(buf.subarray(p + 46, p + 46 + n).toString('utf8'));
    p += 46 + n + e + c;
  }
  return names;
}

/**
 * Active content in a PDF (JavaScript, launch actions, embedded files, rich media, XFA forms, form submission / data
 * import). Name tokens are compared after decoding `#xx` escapes (`/J#61vaScript` = `/JavaScript`). A hit quarantines the
 * import: the file is never parsed or served (REQ-INT-004 "malicious PDF quarantined").
 */
export function pdfActiveContent(buf: Buffer): string | null {
  const text = buf.toString('latin1').replace(/\/([A-Za-z0-9#]+)/g, (_m, name: string) => `/${name.replace(/#([0-9a-fA-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)))}`);
  const m = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData|GoToE)(?![A-Za-z0-9])/.exec(text);
  return m ? m[1]! : null;
}
