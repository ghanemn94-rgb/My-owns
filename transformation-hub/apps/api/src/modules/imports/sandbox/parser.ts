/**
 * Untrusted-file parser for imports (C-16, REQ-SEC-015, AT-25). ONE self-contained function: the sandbox runner passes its
 * source text to an isolated worker thread (`sandbox.ts`), so it must not reference anything outside its own body — no
 * imports, no module-level helpers or constants (types are erased and therefore allowed). It receives `zlib` from the
 * worker and touches nothing else: no file system, no network, no environment, no evaluation of anything it reads.
 *
 * What it does:
 *  - XLSX: a bounded ZIP reader (entry count, per-part and total uncompressed size, compression ratio enforced on the
 *    ACTUAL inflated bytes, no ZIP64, no encryption) → workbook, relationships (targets must stay inside the package:
 *    path traversal refused), shared strings, number formats (dates), sheets. Cells are VALUES: a formula cell keeps its
 *    cached value and the formula text (bounded) for display — nothing is evaluated. External links, data connections and
 *    hyperlinks are counted and kept inert. Any XML part with a DTD / entity declaration is refused (XXE / billion laughs).
 *  - CSV: strict UTF-8, delimiter detection (comma, semicolon, tab), RFC 4180 quoting; every value is text.
 *  - DOCX: paragraphs of word/document.xml (bounded number), external relationships counted.
 * Every limit violation throws `{ code, message }` — the file is refused, never truncated silently.
 */

export interface ParsedCell {
  v: string | number | boolean | null;
  f?: string;
  e?: true;
  d?: true;
}
export interface ParsedSheet {
  name: string;
  rows: (ParsedCell | null)[][];
}
export interface ParseFindings {
  formulaCells: number;
  harmfulFormulaCells: number;
  externalLinks: number;
  dataConnections: boolean;
  hyperlinks: number;
  paragraphs: number;
  truncatedParagraphs: boolean;
}
export interface ParseResult {
  sheets: ParsedSheet[];
  findings: ParseFindings;
}
export interface ParserLimits {
  maxSheets: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxCellChars: number;
  maxFormulaChars: number;
  maxZipEntries: number;
  maxUncompressedBytes: number;
  maxEntryBytes: number;
  maxRatio: number;
  maxParagraphs: number;
}
interface ZlibLike {
  inflateRawSync(buf: Uint8Array, opts?: { maxOutputLength?: number }): Uint8Array;
}

export function sandboxParse(input: Uint8Array, kind: 'xlsx' | 'csv' | 'docx', limits: ParserLimits, zlib: ZlibLike): ParseResult {
  const fail = (code: string, message: string): never => {
    throw { code, message };
  };
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const findings: ParseFindings = { formulaCells: 0, harmfulFormulaCells: 0, externalLinks: 0, dataConnections: false, hyperlinks: 0, paragraphs: 0, truncatedParagraphs: false };

  // ------------------------------------------------------------------------------------------------ XML helpers
  const decode = (s: string): string =>
    s
      .replace(/&#x([0-9a-f]{1,6});/gi, (_m, h: string) => cp(parseInt(h, 16)))
      .replace(/&#(\d{1,7});/g, (_m, d: string) => cp(parseInt(d, 10)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  function cp(n: number): string {
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  }
  const attrs = (tag: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]!] = decode(m[3] ?? m[4] ?? '');
    return out;
  };
  const guardXml = (xml: string, part: string) => {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('imports.parse.dtd_refused', `${part} declares a DTD or entities — refused`);
  };

  // ------------------------------------------------------------------------------------------------ bounded ZIP reader
  interface Entry {
    name: string;
    method: number;
    flags: number;
    csize: number;
    usize: number;
    offset: number;
  }
  let entries: Entry[] = [];
  let totalRead = 0;
  const openZip = () => {
    if (buf.length < 22) fail('imports.parse.zip_invalid', 'Not a valid Office Open XML package');
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) fail('imports.parse.zip_invalid', 'Not a valid Office Open XML package (no central directory)');
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) fail('imports.parse.zip_invalid', 'ZIP64 packages are not accepted');
    if (count > limits.maxZipEntries) fail('imports.parse.too_many_entries', `The package has more than ${limits.maxZipEntries} parts`);
    if (cdOffset + cdSize > buf.length) fail('imports.parse.zip_invalid', 'Truncated package');
    let p = cdOffset;
    const out: Entry[] = [];
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) fail('imports.parse.zip_invalid', 'Corrupt central directory');
      const flags = buf.readUInt16LE(p + 8);
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20);
      const usize = buf.readUInt32LE(p + 24);
      const n = buf.readUInt16LE(p + 28);
      const e = buf.readUInt16LE(p + 30);
      const c = buf.readUInt16LE(p + 32);
      const offset = buf.readUInt32LE(p + 42);
      if (p + 46 + n > buf.length) fail('imports.parse.zip_invalid', 'Corrupt central directory');
      const name = buf.subarray(p + 46, p + 46 + n).toString('utf8');
      if (flags & 0x1) fail('imports.parse.zip_invalid', 'Encrypted packages are not accepted');
      out.push({ name, method, flags, csize, usize, offset });
      p += 46 + n + e + c;
    }
    entries = out;
  };
  const has = (name: string) => entries.some((x) => x.name === name);
  const read = (name: string): string | null => {
    const e = entries.find((x) => x.name === name);
    if (!e) return null;
    if (e.usize > limits.maxEntryBytes) fail('imports.parse.zip_bomb', `Part ${name} exceeds the size limit`);
    if (e.csize > 0 && e.usize / e.csize > limits.maxRatio) fail('imports.parse.zip_bomb', `Part ${name} exceeds the compression-ratio limit`);
    const lh = e.offset;
    if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) fail('imports.parse.zip_invalid', 'Corrupt local header');
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const data = buf.subarray(start, start + e.csize);
    if (data.length !== e.csize) fail('imports.parse.zip_invalid', 'Truncated part');
    let out: Uint8Array;
    const budget = Math.min(limits.maxEntryBytes, limits.maxUncompressedBytes - totalRead);
    if (budget <= 0) fail('imports.parse.zip_bomb', 'The package exceeds the total uncompressed size limit');
    if (e.method === 0) out = data;
    else if (e.method === 8) {
      try {
        // The limit applies to the ACTUAL output, whatever the (attacker-controlled) declared size says.
        out = zlib.inflateRawSync(data, { maxOutputLength: budget });
      } catch (err) {
        const m = String((err as { code?: string; message?: string })?.code ?? (err as Error)?.message ?? '');
        if (/BUFFER_TOO_LARGE|maxOutputLength|larger than/i.test(m) || /larger than/i.test(String((err as Error)?.message ?? ''))) {
          fail('imports.parse.zip_bomb', `Part ${name} inflates beyond the size limit`);
        }
        fail('imports.parse.zip_invalid', `Part ${name} cannot be decompressed`);
      }
    } else fail('imports.parse.zip_invalid', `Unsupported compression method ${e.method}`);
    if (out!.length > budget) fail('imports.parse.zip_bomb', `Part ${name} inflates beyond the size limit`);
    if (data.length > 0 && out!.length / data.length > limits.maxRatio) fail('imports.parse.zip_bomb', `Part ${name} exceeds the compression-ratio limit`);
    totalRead += out!.length;
    const text = Buffer.from(out!.buffer, out!.byteOffset, out!.byteLength).toString('utf8');
    guardXml(text, name);
    return text;
  };
  /** Resolve a relationship target against a base folder; refuses anything that escapes the package root. */
  const resolveTarget = (base: string, target: string): string => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.includes('\\')) fail('imports.parse.path_traversal', `Relationship target ${target.slice(0, 80)} is not a package part`);
    const parts = (target.startsWith('/') ? target.slice(1) : `${base}/${target}`).split('/');
    const outParts: string[] = [];
    for (const seg of parts) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (outParts.length === 0) fail('imports.parse.path_traversal', `Relationship target ${target.slice(0, 80)} escapes the package`);
        outParts.pop();
      } else outParts.push(seg);
    }
    return outParts.join('/');
  };
  const relsOf = (xml: string | null) => {
    const out: { id: string; type: string; target: string; external: boolean }[] = [];
    if (!xml) return out;
    for (const m of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const a = attrs(m[0]);
      out.push({ id: a['Id'] ?? '', type: a['Type'] ?? '', target: a['Target'] ?? '', external: (a['TargetMode'] ?? '').toLowerCase() === 'external' });
    }
    return out;
  };

  const harmful = (f: string): boolean =>
    /\b(WEBSERVICE|FILTERXML|IMPORTXML|IMPORTDATA|IMPORTHTML|IMPORTFEED|IMPORTRANGE|HYPERLINK|CALL|REGISTER(?:\.ID)?|EXEC|RTD|DDE|DDEAUTO|INFO|CELL|GETPIVOTDATA)\s*\(/i.test(f) ||
    /^[=+\-@\s]*[A-Za-z0-9_.]+\|/.test(f) ||
    /\|\s*'/.test(f) ||
    /\[[^\]]*\]/.test(f) ||
    /(?:https?|ftp|file|smb):\/\//i.test(f) ||
    /\\\\[A-Za-z0-9._-]+\\/.test(f);

  const colIndex = (ref: string): number => {
    const m = /^([A-Z]{1,3})/.exec(ref);
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  let cellBudget = limits.maxCells;
  const checkText = (s: string) => {
    if (s.length > limits.maxCellChars) fail('imports.parse.cell_too_long', `A cell exceeds ${limits.maxCellChars} characters`);
    return s;
  };
  const trim = (rows: (ParsedCell | null)[][]) => {
    const empty = (c: ParsedCell | null) => !c || (c.f === undefined && !c.e && (c.v === null || c.v === ''));
    while (rows.length && rows[rows.length - 1]!.every(empty)) rows.pop();
    let width = 0;
    for (const r of rows) {
      let w = r.length;
      while (w > 0 && empty(r[w - 1] ?? null)) w--;
      width = Math.max(width, w);
    }
    return rows.map((r) => {
      const out = r.slice(0, width);
      while (out.length < width) out.push(null);
      return out;
    });
  };

  // ------------------------------------------------------------------------------------------------ XLSX
  const parseXlsx = (): ParseResult => {
    openZip();
    if (entries.some((e) => /vbaProject\.bin$/i.test(e.name))) fail('imports.parse.macro', 'Macro-enabled workbooks are not accepted');
    const wb = read('xl/workbook.xml');
    if (!wb) fail('imports.parse.zip_invalid', 'Not an Excel workbook (xl/workbook.xml missing)');
    const date1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*"(1|true)"/i.test(wb!);
    const rels = relsOf(read('xl/_rels/workbook.xml.rels'));
    findings.externalLinks = entries.filter((e) => /^xl\/externalLinks\/externalLink\d*\.xml$/i.test(e.name)).length;
    findings.dataConnections = has('xl/connections.xml');
    // shared strings
    const shared: string[] = [];
    const ss = read('xl/sharedStrings.xml');
    if (ss) {
      for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
        const body = m[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
        let t = '';
        for (const tm of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) t += tm[1] !== undefined ? decode(tm[1]) : '';
        shared.push(checkText(t));
      }
    }
    // number formats → which style indexes are dates
    const dateStyles = new Set<number>();
    const styles = read('xl/styles.xml');
    if (styles) {
      const custom = new Map<number, string>();
      for (const m of styles.matchAll(/<numFmt\b[^>]*\/?>/g)) {
        const a = attrs(m[0]);
        custom.set(Number(a['numFmtId']), a['formatCode'] ?? '');
      }
      const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
      let i = 0;
      for (const m of xfs.matchAll(/<xf\b[^>]*?(\/>|>)/g)) {
        const id = Number(attrs(m[0])['numFmtId'] ?? 0);
        const code = custom.get(id);
        const isDate = (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (code !== undefined && /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^(general|@)$/i.test(code));
        if (isDate) dateStyles.add(i);
        i++;
      }
    }
    const serialToIso = (n: number): string | null => {
      if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
      const days = Math.floor(n);
      const base = date1904 ? Date.UTC(1904, 0, 1) : days >= 61 ? Date.UTC(1899, 11, 30) : Date.UTC(1899, 11, 31);
      return new Date(base + days * 86400000).toISOString().slice(0, 10);
    };
    const sheetTags = [...wb!.matchAll(/<sheet\b[^>]*\/?>/g)].map((m) => attrs(m[0]));
    if (sheetTags.length > limits.maxSheets) fail('imports.parse.too_many_sheets', `The workbook has more than ${limits.maxSheets} sheets`);
    const sheets: ParsedSheet[] = [];
    for (const st of sheetTags) {
      const rid = st['r:id'] ?? Object.entries(st).find(([k]) => /(^|:)id$/.test(k) && k !== 'sheetId')?.[1] ?? '';
      const rel = rels.find((r) => r.id === rid);
      if (!rel) continue;
      if (rel.external) fail('imports.parse.path_traversal', 'A sheet points outside the workbook');
      if (!/\/worksheet$/.test(rel.type)) continue; // chart sheets, dialog sheets: not data
      const path = resolveTarget('xl', rel.target);
      if (!path.startsWith('xl/')) fail('imports.parse.path_traversal', 'A sheet points outside the workbook');
      const xml = read(path);
      if (xml === null) fail('imports.parse.zip_invalid', `Sheet part ${path} is missing`);
      // hyperlinks of the sheet are counted, never opened
      findings.hyperlinks += [...xml!.matchAll(/<hyperlink\b/g)].length;
      const sheetRelsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
      for (const r of relsOf(read(sheetRelsPath))) if (r.external && !/hyperlink$/.test(r.type)) findings.externalLinks++;
      const grid: (ParsedCell | null)[][] = [];
      const sharedFormula = new Map<string, string>();
      let nextRow = 0;
      for (const rm of xml!.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const ra = attrs(`<row ${rm[1] ?? ''}>`);
        const rowIdx = ra['r'] ? Number(ra['r']) - 1 : nextRow;
        nextRow = rowIdx + 1;
        if (!Number.isInteger(rowIdx) || rowIdx < 0) fail('imports.parse.malformed', 'Bad row reference');
        const body = rm[2] ?? '';
        if (!body) continue;
        if (rowIdx + 1 > limits.maxRows + 50) fail('imports.parse.too_many_rows', `A sheet has more than ${limits.maxRows} rows`);
        const row: (ParsedCell | null)[] = grid[rowIdx] ?? [];
        let nextCol = 0;
        for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ca = attrs(`<c ${cm[1] ?? ''}>`);
          const ci = ca['r'] ? colIndex(ca['r']) : nextCol;
          nextCol = ci + 1;
          if (ci < 0) fail('imports.parse.malformed', 'Bad cell reference');
          if (ci + 1 > limits.maxColumns) fail('imports.parse.too_many_columns', `A sheet has more than ${limits.maxColumns} columns`);
          const inner = cm[2] ?? '';
          const t = ca['t'] ?? 'n';
          const fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
          const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
          let cell: ParsedCell | null = null;
          if (t === 'inlineStr') {
            let s = '';
            for (const tm of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += decode(tm[1]!);
            cell = { v: checkText(s) };
          } else if (vm) {
            const raw = decode(vm[1]!);
            if (t === 's') cell = { v: shared[Number(raw)] ?? '' };
            else if (t === 'str') cell = { v: checkText(raw) };
            else if (t === 'b') cell = { v: raw === '1' || raw.toLowerCase() === 'true' };
            else if (t === 'e') cell = { v: raw.slice(0, 32), e: true };
            else if (t === 'd') cell = { v: raw.slice(0, 10), d: true };
            else {
              const n = Number(raw);
              if (!Number.isFinite(n)) cell = { v: checkText(raw) };
              else if (dateStyles.has(Number(ca['s'] ?? -1)) && serialToIso(n)) cell = { v: serialToIso(n), d: true };
              else cell = { v: n };
            }
          }
          if (fm) {
            const fa = attrs(`<f ${fm[1] ?? ''}>`);
            let ftext = decode(fm[2] ?? '');
            if (fa['t'] === 'shared' && fa['si'] !== undefined) {
              if (ftext) sharedFormula.set(fa['si'], ftext);
              else ftext = sharedFormula.get(fa['si']) ?? '';
            }
            cell = cell ?? { v: null };
            cell.f = ftext.slice(0, limits.maxFormulaChars);
            findings.formulaCells++;
            if (harmful(ftext)) findings.harmfulFormulaCells++;
          }
          if (cell) {
            if (--cellBudget < 0) fail('imports.parse.too_many_cells', `The workbook has more than ${limits.maxCells} cells`);
            while (row.length < ci) row.push(null);
            row[ci] = cell;
          }
        }
        grid[rowIdx] = row;
      }
      const dense: (ParsedCell | null)[][] = [];
      for (let i = 0; i < grid.length; i++) dense.push(grid[i] ?? []);
      const rows = trim(dense);
      if (rows.length > limits.maxRows + 1) fail('imports.parse.too_many_rows', `A sheet has more than ${limits.maxRows} rows`);
      sheets.push({ name: String(st['name'] ?? `Sheet${sheets.length + 1}`).slice(0, 200), rows });
    }
    if (sheets.length === 0) fail('imports.parse.no_sheet', 'The workbook has no worksheet');
    return { sheets, findings };
  };

  // ------------------------------------------------------------------------------------------------ CSV
  const parseCsv = (): ParseResult => {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return fail('imports.parse.encoding', 'The CSV file is not valid UTF-8');
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const firstLine = text.slice(0, Math.min(text.length, 4096)).split(/\r\n|\n|\r/)[0] ?? '';
    const count = (d: string) => {
      let n = 0;
      let q = false;
      for (const ch of firstLine) {
        if (ch === '"') q = !q;
        else if (!q && ch === d) n++;
      }
      return n;
    };
    const delim = [',', ';', '\t'].map((d) => ({ d, n: count(d) })).sort((a, b) => b.n - a.n)[0]!.d;
    const rows: (ParsedCell | null)[][] = [];
    let row: (ParsedCell | null)[] = [];
    let field = '';
    let quoted = false;
    let i = 0;
    const pushField = () => {
      if (row.length + 1 > limits.maxColumns) fail('imports.parse.too_many_columns', `A row has more than ${limits.maxColumns} columns`);
      if (--cellBudget < 0) fail('imports.parse.too_many_cells', `The file has more than ${limits.maxCells} cells`);
      row.push(field === '' ? null : { v: checkText(field) });
      field = '';
    };
    const pushRow = () => {
      pushField();
      rows.push(row);
      if (rows.length > limits.maxRows + 1) fail('imports.parse.too_many_rows', `The file has more than ${limits.maxRows} rows`);
      row = [];
    };
    while (i < text.length) {
      const ch = text[i]!;
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          quoted = false;
          i++;
          continue;
        }
        field += ch;
        if (field.length > limits.maxCellChars) fail('imports.parse.cell_too_long', `A value exceeds ${limits.maxCellChars} characters`);
        i++;
        continue;
      }
      if (ch === '"' && field === '') {
        quoted = true;
        i++;
        continue;
      }
      if (ch === delim) {
        pushField();
        i++;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        pushRow();
        i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += ch;
      if (field.length > limits.maxCellChars) fail('imports.parse.cell_too_long', `A value exceeds ${limits.maxCellChars} characters`);
      i++;
    }
    if (quoted) fail('imports.parse.malformed', 'Unterminated quoted value');
    if (field !== '' || row.length) pushRow();
    return { sheets: [{ name: 'CSV', rows: trim(rows) }], findings };
  };

  // ------------------------------------------------------------------------------------------------ DOCX
  const parseDocx = (): ParseResult => {
    openZip();
    if (entries.some((e) => /vbaProject\.bin$/i.test(e.name))) fail('imports.parse.macro', 'Macro-enabled documents are not accepted');
    const xml = read('word/document.xml');
    if (!xml) fail('imports.parse.zip_invalid', 'Not a Word document (word/document.xml missing)');
    for (const r of relsOf(read('word/_rels/document.xml.rels'))) {
      if (r.external) {
        if (/hyperlink$/.test(r.type)) findings.hyperlinks++;
        else findings.externalLinks++;
      }
    }
    const rows: (ParsedCell | null)[][] = [];
    for (const p of xml!.split(/<\/w:p>/)) {
      let raw = '';
      for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) raw += m[1] !== undefined ? m[1] : m[0].startsWith('<w:tab') ? '\t' : '\n';
      const text = decode(raw).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      findings.paragraphs++;
      if (rows.length >= limits.maxParagraphs) {
        findings.truncatedParagraphs = true;
        continue;
      }
      rows.push([{ v: text.slice(0, 2000) }]);
    }
    return { sheets: [{ name: 'Document', rows }], findings };
  };

  if (kind === 'xlsx') return parseXlsx();
  if (kind === 'csv') return parseCsv();
  return parseDocx();
}
