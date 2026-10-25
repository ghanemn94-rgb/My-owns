// A minimal reader of DOCX and PPTX packages for tests (like xlsx/read.ts and pdf/read.ts; not used by the
// renderers): the XML parts whose names match, in name order (slide2 before slide10), and their text runs.
import JSZip from "jszip";

export interface OoxmlParts {
  /** Part name -> XML, for every part whose name matches. */
  readonly parts: ReadonlyMap<string, string>;
  /** Every part name in the package. */
  readonly names: readonly string[];
}

const ordinal = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

export async function readOoxml(bytes: Uint8Array, match: RegExp): Promise<OoxmlParts> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const wanted = names.filter((n) => match.test(n)).sort((a, b) => ordinal(a) - ordinal(b) || a.localeCompare(b));
  const parts = new Map<string, string>();
  for (const n of wanted) parts.set(n, await zip.file(n)!.async("string"));
  return { parts, names };
}

const unescape = (t: string) =>
  t
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The text of every `<a:t>` (DrawingML) or `<w:t>` (WordprocessingML) element of `xml`, unescaped, in order. */
export const xmlTexts = (xml: string): string[] =>
  [...xml.matchAll(/<(?:a|w):t(?: [^>]*)?>([^<]*)<\/(?:a|w):t>/g)].map((m) => unescape(m[1]!));

// F-DG5-100: a strict, minimal XML 1.0 well-formedness check for tests (no parser library: none is a dependency of
// this package). It walks the document as an XML processor does and reports the first violation, or null: every
// character must match the Char production (§2.2), raw or as a character reference; tags must nest and match; an
// attribute value must be quoted and must not hold `<`; `&` must start a predefined entity or a character reference;
// there must be exactly one root element. DOCTYPE and CDATA are reported as violations (no OOXML part uses them).
const XML_CHAR = /^[\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]*$/u;
const NAME = /^[A-Za-z_][\w.\-:]*$/;
const charRefOk = (cp: number) =>
  cp === 0x9 ||
  cp === 0xa ||
  cp === 0xd ||
  (cp >= 0x20 && cp <= 0xd7ff) ||
  (cp >= 0xe000 && cp <= 0xfffd) ||
  (cp >= 0x10000 && cp <= 0x10ffff);

function referencesProblem(text: string, where: string): string | null {
  for (const m of text.matchAll(/&([^;]*);?/g)) {
    const body = m[1]!;
    if (!m[0].endsWith(";")) return `${where}: '&' does not start a reference`;
    if (/^(?:lt|gt|amp|apos|quot)$/.test(body)) continue;
    const ref = /^#x([0-9a-fA-F]+)$/.exec(body) ?? /^#(\d+)$/.exec(body);
    if (ref === null) return `${where}: unknown entity &${body};`;
    const cp = parseInt(ref[1]!, body.startsWith("#x") ? 16 : 10);
    if (!charRefOk(cp)) return `${where}: character reference &${body}; is not an XML 1.0 Char`;
  }
  return null;
}

export function xmlWellFormedProblem(xml: string): string | null {
  if (!XML_CHAR.test(xml)) {
    const i = [...xml].findIndex((c) => !XML_CHAR.test(c));
    const c = [...xml][i]!;
    return `character U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} is not an XML 1.0 Char`;
  }
  let at = 0;
  const s = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const stack: string[] = [];
  let roots = 0;
  while (at < s.length) {
    const lt = s.indexOf("<", at);
    const text = s.slice(at, lt < 0 ? s.length : lt);
    if (text.length > 0) {
      if (stack.length === 0 && text.trim().length > 0) return "text outside the root element";
      if (text.includes(">") && text.includes("]]>")) return "']]>' in text";
      const p = referencesProblem(text, "text");
      if (p !== null) return p;
    }
    if (lt < 0) break;
    if (s.startsWith("<?", lt)) {
      const end = s.indexOf("?>", lt);
      if (end < 0) return "unterminated processing instruction";
      at = end + 2;
      continue;
    }
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      if (end < 0) return "unterminated comment";
      at = end + 3;
      continue;
    }
    if (s.startsWith("<!", lt)) return "DOCTYPE or CDATA section";
    const gt = s.indexOf(">", lt);
    if (gt < 0) return "unterminated tag";
    let tag = s.slice(lt + 1, gt);
    // A '>' inside a quoted attribute value: extend to the real end of the tag.
    let end = gt;
    while ((tag.match(/"/g)?.length ?? 0) % 2 === 1 || (tag.match(/'/g)?.length ?? 0) % 2 === 1) {
      const next = s.indexOf(">", end + 1);
      if (next < 0) return "unterminated tag";
      end = next;
      tag = s.slice(lt + 1, end);
    }
    at = end + 1;
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      if (open !== name) return `end tag </${name}> does not match <${open ?? ""}>`;
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const inner = selfClosing ? tag.slice(0, -1) : tag;
    const name = /^\S+/.exec(inner)?.[0] ?? "";
    if (!NAME.test(name)) return `invalid element name '${name}'`;
    let rest = inner.slice(name.length);
    const seen = new Set<string>();
    while (rest.trim().length > 0) {
      const a = /^\s+([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(rest);
      if (a === null) return `malformed attribute in <${name}>`;
      if (!NAME.test(a[1]!)) return `invalid attribute name '${a[1]}' in <${name}>`;
      if (seen.has(a[1]!)) return `duplicate attribute '${a[1]}' in <${name}>`;
      seen.add(a[1]!);
      const value = a[3] ?? a[4] ?? "";
      if (value.includes("<")) return `'<' in the value of ${a[1]} in <${name}>`;
      const p = referencesProblem(value, `attribute ${a[1]} of <${name}>`);
      if (p !== null) return p;
      rest = rest.slice(a[0].length);
    }
    if (stack.length === 0) roots += 1;
    if (roots > 1) return "more than one root element";
    if (!selfClosing) stack.push(name);
  }
  if (stack.length > 0) return `unclosed element <${stack[stack.length - 1]}>`;
  if (roots !== 1) return "no root element";
  return null;
}

/** Every XML part (`*.xml`, `*.rels`) of an OOXML package that is not well-formed XML 1.0, with its first problem. */
export async function malformedParts(bytes: Uint8Array): Promise<string[]> {
  const { parts } = await readOoxml(bytes, /\.(?:xml|rels)$/);
  const out: string[] = [];
  for (const [name, xml] of parts) {
    const p = xmlWellFormedProblem(xml);
    if (p !== null) out.push(`${name}: ${p}`);
  }
  return out;
}
