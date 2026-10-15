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
