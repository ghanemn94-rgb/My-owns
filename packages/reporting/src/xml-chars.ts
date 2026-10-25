// The XML 1.0 character rule every OOXML writer of this package shares (F-DG5-100; ADR-0046 §3; REQ-S13-005).
//
// XML 1.0 (§2.2, production Char) allows only #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF],
// raw or as a character reference. The API accepts user text with other C0 controls (U+0001-U+0008, U+000B, U+000C,
// U+000E-U+001F; U+000B is Word's manual line break on the clipboard), so every string that reaches an XML part is
// passed through `xmlSafe` first, which replaces each character XML 1.0 cannot carry (those C0 controls, lone
// surrogates, U+FFFE and U+FFFF) by U+FFFD. The XLSX writer (xlsx/sheet.ts `xmlText`) escapes after `xmlSafe`; the DOCX
// and PPTX writers hand only `xmlSafe` text to their libraries (docx, pptxgenjs), which escape & < > " themselves but
// write control characters raw. `assertWellFormedChars` then checks every XML part of the finished package, so a file
// that still holds such a character is a RenderError (the job fails with export.render_failed, nothing is stored) and
// never a succeeded export.
import JSZip from "jszip";
import { RenderError } from "./model.ts";

/** One character XML 1.0 cannot carry (global: use with replace; `INVALID_XML_CHAR_TEST` for a test). */
export const INVALID_XML_CHAR =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const INVALID_XML_CHAR_TEST = new RegExp(INVALID_XML_CHAR.source);
/** A character reference to a character XML 1.0 cannot carry (`&#11;`, `&#x1F;`, `&#xFFFE;`, `&#xD800;`, ...). */
const INVALID_XML_REF =
  /&#(?:x0*(?:[0-8bBcCeEfF]|1[0-9a-fA-F]|[dD][89a-fA-F][0-9a-fA-F]{2}|[fF]{3}[eEfF])|0*(?:[0-8]|1[124-9]|2\d|3[01]|5529[6-9]|55[3-9]\d{2}|56\d{3}|57[0-2]\d{2}|573[0-3]\d|5734[0-3]|6553[45]));/;

/** `s` with every character XML 1.0 cannot carry replaced by U+FFFD; any other text is returned unchanged. */
export function xmlSafe(s: string): string {
  return s.replace(INVALID_XML_CHAR, "\uFFFD");
}

/** True when `xml` holds a character, raw or as a character reference, that XML 1.0 forbids. */
export function hasInvalidXmlChar(xml: string): boolean {
  return INVALID_XML_CHAR_TEST.test(xml) || INVALID_XML_REF.test(xml);
}

/**
 * Throws a RenderError when any XML part (`*.xml`, `*.rels`) of the OOXML package `bytes` holds a character XML 1.0
 * forbids: a renderer never returns a package Word, PowerPoint or Excel would refuse or "repair".
 */
export async function assertWellFormedChars(bytes: Uint8Array): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files)) {
    if (!/\.(?:xml|rels)$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    if (hasInvalidXmlChar(xml)) throw new RenderError(`the package part ${name} is not well-formed XML 1.0`);
  }
}
