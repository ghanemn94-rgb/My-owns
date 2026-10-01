import { inflateRawSync } from 'node:zlib';

/**
 * Independent OOXML checks for the export tests (AT-24, REQ-RPT-007/009/010): a minimal ZIP reader (central directory +
 * raw inflate, no library shared with the renderers) and an XML well-formedness check. Used to prove a file is a genuine
 * Office package — not renamed HTML — and to read what it really contains.
 */
export function unzip(buf: Buffer): Map<string, Buffer> {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a ZIP file (no local file header signature)');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : (() => { throw new Error(`unsupported compression ${method} for ${name}`); })());
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Throws unless `xml` is well-formed (balanced, properly nested elements; one root). Entities are not expanded. */
export function assertWellFormedXml(xml: string, name = 'xml') {
  const s = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const stack: string[] = [];
  let roots = 0;
  const re = /<\/?([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (s.slice(last, m.index).includes('<')) throw new Error(`${name}: stray markup near offset ${m.index}`);
    last = m.index + m[0].length;
    const tag = m[1]!;
    if (m[0].startsWith('</')) {
      if (stack.pop() !== tag) throw new Error(`${name}: unbalanced </${tag}>`);
    } else if (m[3] !== '/') {
      if (!stack.length) roots++;
      stack.push(tag);
    } else if (!stack.length) roots++;
  }
  if (stack.length) throw new Error(`${name}: unclosed <${stack[stack.length - 1]}>`);
  if (roots !== 1) throw new Error(`${name}: expected one root element, found ${roots}`);
}

/** Decode the XML text nodes of a part (entities &amp; &lt; &gt; &quot; &apos; and numeric references). */
export function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Opens a package and checks it is the expected OOXML document type; returns its parts. */
export function openOoxml(buf: Buffer, mainContentType: string): Map<string, Buffer> {
  const parts = unzip(buf);
  const ct = parts.get('[Content_Types].xml');
  if (!ct) throw new Error('no [Content_Types].xml: not an OOXML package');
  if (!ct.toString('utf8').includes(mainContentType)) throw new Error(`main part content type ${mainContentType} missing`);
  for (const [name, data] of parts) if (name.endsWith('.xml') || name.endsWith('.rels')) assertWellFormedXml(data.toString('utf8'), name);
  return parts;
}

export const SPREADSHEET_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
export const PRESENTATION_MAIN = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
export const WORD_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

/** All cell texts of a workbook (shared strings + inline strings), in sheet order, and every formula element found. */
export function workbookCells(parts: Map<string, Buffer>): { strings: string[]; numbers: number[]; formulas: string[]; rtlSheets: number; sheets: number } {
  const shared: string[] = [];
  const sst = parts.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push(xmlText(si).trim());
  const strings: string[] = [];
  const numbers: number[] = [];
  const formulas: string[] = [];
  let rtlSheets = 0;
  let sheets = 0;
  const names = [...parts.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  for (const n of names) {
    sheets++;
    const x = parts.get(n)!.toString('utf8');
    if (/<sheetView[^>]*rightToLeft="1"/.test(x)) rtlSheets++;
    for (const f of x.match(/<f[\s>][\s\S]*?<\/f>|<f\/>/g) ?? []) formulas.push(f);
    for (const c of x.match(/<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const t = c.match(/ t="(\w+)"/)?.[1];
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (t === 's' && v !== undefined) strings.push(shared[Number(v)] ?? '');
      else if (t === 'inlineStr') strings.push(xmlText(c).trim());
      else if (t === 'str' && v !== undefined) strings.push(xmlText(v));
      else if (v !== undefined) numbers.push(Number(v));
    }
  }
  return { strings, numbers, formulas, rtlSheets, sheets };
}
