// REQ-S13-009 (ADR-0046 §3): the bidirectional layout over the bundled fonts, measured with pdfkit/fontkit exactly as
// the PDF writer measures. Synthetic text only.
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { formatDecimal } from "../../../shared/src/value.ts";
import { fontBytes, fontStack, FONT_FACES } from "../fonts.ts";
import { createLabels, FRAME_LABELS } from "../labels.ts";
import { pdfShaper } from "../pdf/index.ts";
import { layoutText, markLtrStretches, visualText, type BaseDirection } from "./bidi.ts";
import { cellText, displayValue, formatNumber, PAGED_LABELS, withPagedLabels } from "./values.ts";

const LRM = String.fromCharCode(0x200e);
const rev = (s: string) => Array.from(s).reverse().join("");

function shaper() {
  const doc = new PDFDocument({ autoFirstPage: false });
  for (const f of FONT_FACES) doc.registerFont(f.name, fontBytes(f));
  return pdfShaper(doc);
}
const S = shaper();
const lay = (text: string, direction: BaseDirection, maxWidth = Infinity) =>
  layoutText(text, {
    direction,
    maxWidth,
    size: 10,
    faces: fontStack(direction === "rtl" ? "ar" : "en", 400).map((f) => f.name),
    shaper: S,
  });

describe("markLtrStretches", () => {
  it("marks identifiers, numbers and Latin text between Arabic as left-to-right runs (RTL paragraphs only)", () => {
    expect(markLtrStretches("خطر RAID-014 مفتوح", "rtl")).toBe(`خطر ${LRM}RAID-014${LRM} مفتوح`);
    expect(markLtrStretches("بقيمة -1,250.50 SAR", "rtl")).toBe(`بقيمة ${LRM}-1,250.50 SAR${LRM}`);
    expect(markLtrStretches("2026-10-15 13:45 (Asia/Riyadh)", "rtl")).toBe(
      `${LRM}2026-10-15 13:45 (Asia/Riyadh)${LRM}`,
    );
    // Brackets that belong to the Arabic stay outside (they mirror with it).
    expect(markLtrStretches("(مؤقت)", "rtl")).toBe("(مؤقت)");
    expect(markLtrStretches("RAID-014 (مؤقت)", "ltr")).toBe("RAID-014 (مؤقت)");
  });
});

describe("layoutText (bidi-js levels, visual order, fonts)", () => {
  it("Arabic base direction: identifiers and numbers keep their left-to-right order; Arabic reads right to left", () => {
    const lines = lay("مخاطرة RAID-014 بقيمة 1,250.50", "rtl");
    expect(lines).toHaveLength(1);
    // Left to right on the page: the number, the second Arabic word, the identifier, the first Arabic word.
    expect(visualText(lines[0]!)).toBe(`1,250.50 ${rev("بقيمة")} RAID-014 ${rev("مخاطرة")}`);
    const pieces = lines[0]!.pieces;
    const id = pieces.find((p) => p.visual.includes("RAID-014"))!;
    expect(id.level % 2).toBe(0);
    expect(id.face).toBe("PlexArabic-latin-400");
    const arabic = pieces.find((p) => p.visual.trim() === rev("مخاطرة"))!;
    expect([arabic.level % 2, arabic.face]).toEqual([1, "PlexArabic-arabic-400"]);
    // fontkit lays the Arabic run out right to left itself, so it receives it in logical order (joining forms).
    expect(arabic.draw.trim()).toBe("مخاطرة");
  });

  it("English base direction is left to right; an Arabic phrase inside it reads right to left", () => {
    const lines = lay("Risk RAID-014 costs SAR 1,250.50 مؤقت", "ltr");
    expect(visualText(lines[0]!)).toBe(`Risk RAID-014 costs SAR 1,250.50 ${rev("مؤقت")}`);
    expect(lines[0]!.pieces[0]!.face).toBe("PlexSans-latin-400");
    expect(lines[0]!.pieces.at(-1)!.face).toBe("PlexArabic-arabic-400");
  });

  it("a Latin-only paragraph in an Arabic document keeps its word order", () => {
    expect(visualText(lay("Mobily Transformation Hub", "rtl")[0]!)).toBe("Mobily Transformation Hub");
    expect(visualText(lay("RAID-014 Supplier delay", "rtl")[0]!)).toBe("RAID-014 Supplier delay");
  });

  it("brackets around Arabic are mirrored; a negative Arabic-formatted number keeps its sign in front", () => {
    expect(visualText(lay("(مؤقت)", "rtl")[0]!)).toBe(`(${rev("مؤقت")})`);
    const n = formatNumber("-1234.5", "ar", { currency: "SAR" });
    expect(visualText(lay(n, "rtl")[0]!)).toBe("-1,234.5 SAR");
  });

  it("direction marks and isolates are never drawn", () => {
    for (const line of lay(`${LRM}abc${LRM} مؤقت`, "rtl"))
      for (const p of line.pieces) expect(p.draw.includes(LRM)).toBe(false);
  });

  it("breaks lines at spaces within the width, in logical order (the first Arabic word on the first line)", () => {
    const text = "تأخر مورد التجوال في الربع الثالث يؤثر على إيرادات الشركاء RAID-014 ويحتاج إلى خطة تصحيحية";
    const lines = lay(text, "rtl", 120);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(120.01);
    expect(visualText(lines[0]!).endsWith(rev("تأخر"))).toBe(true);
    expect(lines.some((l) => visualText(l).includes("RAID-014"))).toBe(true);
    // A word wider than the line is broken between characters, never dropped.
    const long = lay("x".repeat(200), "ltr", 50);
    expect(long.map(visualText).join("")).toBe("x".repeat(200));
  });

  it("covers Latin, Latin-extended and Arabic text with the bundled faces (no missing glyphs)", () => {
    const faces = new Set(["PlexArabic-arabic-400", "PlexArabic-latin-400", "PlexArabic-latin-ext-400"]);
    for (const p of lay("Ünïcode — مرحبا «test» 50%", "rtl")[0]!.pieces) expect(faces.has(p.face)).toBe(true);
  });
});

describe("values (ADR-0046 §9; REQ-S13-008)", () => {
  const en = createLabels("en", withPagedLabels(undefined));
  const ar = createLabels("ar", withPagedLabels(undefined));

  it("formatNumber equals the shared display formatter (packages/shared/src/value.ts formatDecimal)", () => {
    for (const v of ["0", "1234.5", "-1234.555", "1000000.004", "0.125", "-0.004"])
      for (const locale of ["en", "ar"] as const)
        for (const currency of [null, "SAR"]) {
          expect(formatNumber(v, locale, { currency }), `${v} ${locale} ${currency}`).toBe(
            formatDecimal(v, { locale, currency }),
          );
        }
  });

  it("a provisional number prints its value and Provisional/مؤقت; Unknown and Stale print the label, never a number", () => {
    const base = { type: "decimal", unitKind: "currency", currency: "SAR", valueBasis: "submitted" } as const;
    const provisional = { ...base, value: "1250.5", validation: "provisional", reason: null } as const;
    expect(cellText(provisional, en)).toBe("SAR 1,250.5\nProvisional");
    expect(cellText(provisional, ar)).toBe(`${formatDecimal("1250.5", { locale: "ar", currency: "SAR" })}\nمؤقت`);
    const unknown = { ...base, value: null, validation: "unknown", reason: "missing" } as const;
    const stale = { ...base, value: null, validation: "stale", reason: "stale" } as const;
    expect([cellText(unknown, en), cellText(stale, en), cellText(unknown, ar)]).toEqual([
      "Unknown",
      "Stale",
      "غير معروف",
    ]);
    expect(displayValue(unknown, en).text).toBeNull();
    const pct = { type: "decimal", unitKind: "percentage", currency: null, valueBasis: null } as const;
    expect(cellText({ ...pct, value: "12.5", validation: "validated", reason: null }, en)).toBe("12.5%");
  });

  it("every paged label exists in English and Arabic, and no label names an engineering gate", () => {
    expect(Object.keys(PAGED_LABELS.ar).sort()).toEqual(Object.keys(PAGED_LABELS.en).sort());
    for (const t of [PAGED_LABELS, FRAME_LABELS])
      for (const lang of ["en", "ar"] as const)
        for (const text of Object.values(t[lang])) expect(/\bDG[0-7]\b/.test(text), text).toBe(false);
  });
});
