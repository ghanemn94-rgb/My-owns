// REQ-S13-009, REQ-S13-008, REQ-S13-005 (ADR-0046 §2, §3): the DOCX writer, read back from the package's XML parts.
// Synthetic content only.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderDocx } from "./docx.ts";
import { options, sampleDocument, SNAPSHOT_ID } from "./test-fixtures.ts";

const doc = () =>
  sampleDocument(
    [
      { code: "RAID-014", description: "مخاطرة RAID-014 بقيمة 1,250.50", amount: "1250.50" },
      { code: "RAID-015", description: "Supplier delay", amount: "-200.25", provisional: true },
      { code: "RAID-016", description: null, amount: null },
    ],
    null,
  );

async function parts(language: "en" | "ar", status: "generated" | "issued" = "generated") {
  const r = await renderDocx(doc(), {
    ...options("docx", language),
    snapshot: { id: SNAPSHOT_ID, status, issueVersion: status === "issued" ? 1 : null },
  });
  const zip = await JSZip.loadAsync(r.bytes);
  const read = async (name: string) => (await zip.file(name)?.async("string")) ?? "";
  const footers = await Promise.all(
    Object.keys(zip.files)
      .filter((n) => /^word\/footer\d*\.xml$/.test(n))
      .map(read),
  );
  return { r, zip, document: await read("word/document.xml"), styles: await read("word/styles.xml"), footers };
}

/** The paragraphs of the body, each with its XML and its text. */
const paragraphs = (xml: string) =>
  [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>|<w:p [\s\S]*?<\/w:p>/g)].map((m) => ({
    xml: m[0],
    text: [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
  }));

describe("renderDocx", () => {
  it("Arabic paragraphs are bidi, Arabic runs are rtl with ar-SA, tables are visually right to left", async () => {
    const { document, r } = await parts("ar");
    expect(r.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const ps = paragraphs(document).filter((p) => p.text.length > 0);
    expect(ps.length).toBeGreaterThan(20);
    for (const p of ps) expect(p.xml, p.text).toContain("<w:bidi/>");
    expect(document).toContain("<w:bidiVisual/>");
    // The Arabic words are right-to-left runs; the identifier and the number are left-to-right runs, in order.
    const cell = ps.find((p) => p.text === "مخاطرة RAID-014 بقيمة 1,250.50")!;
    expect(cell).toBeDefined();
    const runs = [...cell.xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)].map((m) => ({
      rtl: m[1]!.includes("<w:rtl/>"),
      text: /<w:t[^>]*>([^<]*)<\/w:t>/.exec(m[1]!)![1],
    }));
    expect(runs).toEqual([
      { rtl: true, text: "مخاطرة" },
      { rtl: false, text: " RAID-014 " },
      { rtl: true, text: "بقيمة" },
      { rtl: false, text: " 1,250.50" },
    ]);
    expect(cell.xml).toMatch(/<w:lang [^>]*w:bidi="ar-SA"/);
    expect(cell.xml).toMatch(/<w:rFonts [^>]*w:cs="IBM Plex Sans Arabic"/);
  });

  it("names the bundled families and embeds none (the outcome stated in the file's About section)", async () => {
    const { zip, document, styles } = await parts("ar");
    expect(Object.keys(zip.files).filter((n) => n.startsWith("word/fonts/") || n.endsWith(".odttf"))).toEqual([]);
    expect(styles).toMatch(/w:ascii="IBM Plex Sans Arabic"/);
    expect(paragraphs(document).some((p) => p.text.startsWith("الخطوط: يسمّي هذا الملف"))).toBe(true);
    const en = await parts("en");
    expect(en.styles).toMatch(/w:ascii="IBM Plex Sans"/);
    expect(paragraphs(en.document).some((p) => p.text.includes("does not embed them"))).toBe(true);
  });

  it("English is left to right; every row, Provisional, Unknown (no number) and the Draft line are printed", async () => {
    const { document, footers } = await parts("en");
    expect(document).not.toContain("<w:bidi/>");
    expect(document).not.toContain("<w:bidiVisual/>");
    const texts = paragraphs(document).map((p) => p.text);
    for (const code of ["RAID-014", "RAID-015", "RAID-016"]) expect(texts).toContain(code);
    expect(texts).toContain("SAR -200.25");
    expect(texts).toContain("Provisional");
    expect(texts.filter((t) => t === "Unknown").length).toBeGreaterThanOrEqual(2);
    expect(texts).toContain("Draft — not an issued report");
    expect(footers.join("")).toContain("Draft — not an issued report");
    expect(footers.join("")).toMatch(/PAGE[\s\S]*NUMPAGES/);
    const issued = await parts("en", "issued");
    expect(paragraphs(issued.document).map((p) => p.text)).toContain("Issued report, version 1");
    expect(issued.document + issued.footers.join("")).not.toContain("Draft");
  });

  it("Arabic prints مؤقت and the Arabic Draft line", async () => {
    const { document, footers } = await parts("ar");
    const texts = paragraphs(document).map((p) => p.text);
    expect(texts).toContain("مؤقت");
    expect(texts).toContain("مسودة — ليس تقريراً صادراً");
    expect(footers.join("")).toContain("مسودة");
  });
});
