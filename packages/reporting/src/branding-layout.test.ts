// The branding read at generation time in the three paged formats (T-DG5-BE-R; ADR-0049 §8, ADR-0045 "every file
// carries ... slice I's provenance footer (B0004)"; REQ-S01-002, REQ-S15-004, REQ-PB-001). The worker passes the
// current branding version's product name, primary colour, report header and footer, and the verbatim B0004 statement;
// version 0 passes the product name only. Synthetic fixtures; nothing here approves anything.
import { describe, expect, it } from "vitest";
import { readOoxml, xmlTexts } from "./ooxml-read.ts";
import { lines, readPdf } from "./pdf/read.ts";
import { render } from "./render.ts";
import { options, sampleDocument } from "./test-fixtures.ts";

const B0004 =
  "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.";
const doc = () => sampleDocument([{ code: "RAID-001", description: "Synthetic risk", amount: "10.00" }], "10.00");
const configured = {
  productName: "Synthetic Hub",
  primaryColour: "#00FF00",
  reportHeader: "Synthetic header line",
  reportFooter: "Synthetic footer line",
  provenance: B0004,
};
const band = (scn: string) => new RegExp(`0 0 [0-9.]+ 10 re\\n/DeviceRGB cs\\n${scn} scn\\nf\\n`);
const streams = (bytes: Uint8Array) =>
  [...readPdf(bytes).objects.values()].map((o) => (o.stream === null ? "" : o.stream.toString("latin1")));

describe("PDF", () => {
  it("a configured branding: the name, a header band in the primary colour, the header and footer lines, B0004", async () => {
    const r = await render(doc(), { ...options("pdf", "en"), branding: configured });
    const text = lines(readPdf(r.bytes));
    for (const t of ["Synthetic Hub", "Synthetic header line", "Synthetic footer line"])
      expect(
        text.some((l) => l.includes(t)),
        t,
      ).toBe(true);
    expect(text.some((l) => l.includes("Practical synthesis inspired by PMI Organizational Transformation"))).toBe(
      true,
    );
    expect(streams(r.bytes).some((s) => band("0 1 0").test(s))).toBe(true);
  });

  it("version 0 (no colour): no band, and no header or footer line is invented", async () => {
    const r = await render(doc(), options("pdf", "en"));
    expect(streams(r.bytes).some((s) => /0 0 [0-9.]+ 10 re\n/.test(s))).toBe(false);
    const text = lines(readPdf(r.bytes));
    expect(text.some((l) => l.includes("Practical synthesis"))).toBe(false);
    expect(text.some((l) => l.includes("Mobily Transformation Hub"))).toBe(true);
  });

  it("an invalid colour is ignored (no band), never drawn", async () => {
    const r = await render(doc(), { ...options("pdf", "en"), branding: { ...configured, primaryColour: "red" } });
    expect(streams(r.bytes).some((s) => /0 0 [0-9.]+ 10 re\n/.test(s))).toBe(false);
  });
});

describe("DOCX and PPTX", () => {
  it("DOCX: the header line in the body, the footer line and B0004 in the page footer", async () => {
    const r = await render(doc(), { ...options("docx", "en"), branding: configured });
    const body = await readOoxml(r.bytes, /^word\/document\.xml$/);
    expect(xmlTexts([...body.parts.values()].join("")).join(" ")).toContain("Synthetic header line");
    const footer = await readOoxml(r.bytes, /^word\/footer\d*\.xml$/);
    const ft = xmlTexts([...footer.parts.values()].join("")).join(" ");
    expect(ft).toContain("Synthetic footer line");
    expect(ft).toContain("Practical synthesis inspired by PMI");
  });

  it("PPTX: the header, the footer and B0004 on the closing 'About this file' slide", async () => {
    const r = await render(doc(), { ...options("pptx", "en"), branding: configured });
    const slides = await readOoxml(r.bytes, /^ppt\/slides\/slide\d+\.xml$/);
    const all = xmlTexts([...slides.parts.values()].join("")).join(" ");
    for (const t of ["Synthetic Hub", "Synthetic header line", "Synthetic footer line", "Practical synthesis inspired"])
      expect(all, t).toContain(t);
  });
});
