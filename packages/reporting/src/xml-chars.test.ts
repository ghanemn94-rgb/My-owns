// F-DG5-100 (REQ-S13-005; ADR-0046 §3): every DOCX, PPTX and XLSX part is well-formed XML 1.0 when accepted user text
// holds characters XML 1.0 cannot carry (C0 controls other than tab, LF and CR; lone surrogates; U+FFFE, U+FFFF).
// The renderer-level reproduction of the code-security reviewer (round 1, repro/ooxml-control-chars.mjs) is kept: one
// register row whose description is "Supplier\u0001delay\u000B(pasted)", rendered to docx, pptx and xlsx, every XML
// part parsed. Synthetic content only.
import { describe, expect, it } from "vitest";
import { renderDocx } from "./docx.ts";
import { malformedParts, readOoxml, xmlWellFormedProblem } from "./ooxml-read.ts";
import { renderPptx } from "./pptx.ts";
import { render } from "./render.ts";
import { options, sampleDocument } from "./test-fixtures.ts";
import { assertWellFormedChars, hasInvalidXmlChar, xmlSafe } from "./xml-chars.ts";
import { RenderError } from "./model.ts";
import { xmlText } from "./xlsx/sheet.ts";
import JSZip from "jszip";

const DESC = "Supplier\u0001delay\u000B(pasted)";
/** Every class XML 1.0 forbids: C0 controls, a lone high and a lone low surrogate, U+FFFE and U+FFFF. */
const HOSTILE = "A\u0001B\u0008C\u000BD\u000CE\u001FF\uD800G\uDC00H\uFFFEI\uFFFFJ\tK";

const hostileDoc = (description: string) => {
  const d = sampleDocument([{ code: "R-1", description, amount: "10.00" }], "10.00");
  return { ...d, transformation: { ...d.transformation, name: `Roaming${description}` } };
};

describe("xmlSafe (the one rule every OOXML writer shares)", () => {
  it("replaces each character XML 1.0 cannot carry by U+FFFD and keeps tab, LF, CR, Arabic and astral text", () => {
    expect(xmlSafe(HOSTILE)).toBe("A\uFFFDB\uFFFDC\uFFFDD\uFFFDE\uFFFDF\uFFFDG\uFFFDH\uFFFDI\uFFFDJ\tK");
    const fine = "مخاطرة\tline\nnext\r😀 1,250.50";
    expect(xmlSafe(fine)).toBe(fine);
  });

  it("is the rule of xlsx/sheet.ts xmlText (shared, not duplicated)", () => {
    expect(xmlText(HOSTILE)).toBe(xmlSafe(HOSTILE));
  });

  it("hasInvalidXmlChar sees raw characters and forbidden character references, not allowed ones", () => {
    expect(hasInvalidXmlChar("<a>x\u000By</a>")).toBe(true);
    for (const ref of ["&#11;", "&#x1F;", "&#xFFFE;", "&#65535;", "&#xD800;", "&#55296;", "&#57343;", "&#0;"])
      expect(hasInvalidXmlChar(`<a>${ref}</a>`), ref).toBe(true);
    for (const ref of ["&#9;", "&#xA;", "&#13;", "&#x20;", "&#55295;", "&#57344;", "&#xFFFD;", "&#x1F600;"])
      expect(hasInvalidXmlChar(`<a>${ref}</a>`), ref).toBe(false);
  });

  it("assertWellFormedChars refuses a package holding a forbidden character (a RenderError, never a stored file)", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document>bad\u000Bchar</w:document>");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(assertWellFormedChars(bytes)).rejects.toBeInstanceOf(RenderError);
  });
});

describe("the test XML checker itself", () => {
  it("accepts well-formed XML and reports each kind of violation", () => {
    expect(xmlWellFormedProblem('<?xml version="1.0"?><a x="1&amp;2"><b/>t&#13;</a>')).toBeNull();
    expect(xmlWellFormedProblem("<a>x\u000By</a>")).toMatch(/U\+000B/);
    expect(xmlWellFormedProblem("<a>&#11;</a>")).toMatch(/not an XML 1.0 Char/);
    expect(xmlWellFormedProblem("<a><b></a>")).toMatch(/does not match/);
    expect(xmlWellFormedProblem("<a>&nope;</a>")).toMatch(/unknown entity/);
    expect(xmlWellFormedProblem("<a/><b/>")).toMatch(/more than one root/);
  });
});

describe("F-DG5-100: DOCX, PPTX and XLSX parts parse as XML 1.0 with control characters in user text", () => {
  for (const format of ["docx", "pptx", "xlsx"] as const) {
    for (const language of ["en", "ar"] as const) {
      it(`${format} (${language}): every XML part is well-formed; the text is kept with U+FFFD in place`, async () => {
        const out = await render(hostileDoc(HOSTILE), options(format, language));
        expect(await malformedParts(out.bytes)).toEqual([]);
        const { parts } = await readOoxml(out.bytes, /\.xml$/);
        // The character data of every part (tags removed): the user text survives, each forbidden character replaced.
        const all = [...parts.values()].map((xml) => xml.replace(/<[^>]*>/g, "")).join("|");
        expect(all).toContain("A\uFFFDB\uFFFDC\uFFFDD\uFFFDE\uFFFDF\uFFFDG\uFFFDH\uFFFDI\uFFFDJ");
        expect(all).not.toMatch(/[\u0001\u0008\u000B\u000C\u001F\uFFFE\uFFFF]/);
      });
    }
  }

  it("the code-security reviewer's renderer reproduction: not-well-formed parts: none for docx, pptx and xlsx", async () => {
    const results: string[] = [];
    for (const format of ["docx", "pptx", "xlsx"] as const) {
      const out = await render(hostileDoc(DESC), options(format));
      const zip = await JSZip.loadAsync(out.bytes);
      const findings: string[] = [];
      for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".xml"))) {
        const xml = await zip.file(name)!.async("string");
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(xml)) findings.push(name);
      }
      results.push(`${format}: not-well-formed parts: ${findings.length === 0 ? "none" : findings.join(" | ")}`);
    }
    expect(results).toEqual([
      "docx: not-well-formed parts: none",
      "pptx: not-well-formed parts: none",
      "xlsx: not-well-formed parts: none",
    ]);
  });

  it("the DOCX and PPTX renderers keep the core properties (title, subject, creator) well-formed too", async () => {
    const o = { ...options("docx"), title: "Reg\u000Bisters", branding: { productName: "Hub\u0002" } };
    const d = await renderDocx(hostileDoc(DESC), o);
    const p = await renderPptx(hostileDoc(DESC), { ...o, format: "pptx" });
    for (const bytes of [d.bytes, p.bytes]) {
      const { parts } = await readOoxml(bytes, /docProps\/(core|app)\.xml$/);
      expect(parts.size).toBeGreaterThan(0);
      for (const [name, xml] of parts) expect(xmlWellFormedProblem(xml), name).toBeNull();
    }
  });
});
