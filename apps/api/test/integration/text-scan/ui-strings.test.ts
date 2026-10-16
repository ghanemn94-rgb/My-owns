// Text scan (a) (ADR-0049 §7; T-DG5-BE-R2, p5-work-split §I.4): every string of apps/web/src/i18n/{en,ar}/*.json.
//  - REQ-PB-001: the claim scan of en+ar UI strings finds no "official PMI standard", "PMI certified" or equivalent;
//  - REQ-S21-001: the engineering-gate scan finds no DG0-DG7 in UI strings.
// A true disclaimer ("not an official PMI standard") is allowed (the About text common.methodBody is one).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { i18nDir, i18nStrings, scan, unreported } from "../../text-scan/scan.ts";

describe.each(["en", "ar"] as const)("UI strings (%s)", (lang) => {
  const texts = i18nStrings(lang);

  it("are read from every catalogue file", () => {
    expect(texts.length).toBeGreaterThan(5000);
    expect(new Set(texts.map((t) => t.where.split("#")[0]))).toContain(`apps/web/src/i18n/${lang}/problems.json`);
  });

  it("REQ-PB-001: no string claims official PMI status or certification", () => {
    expect(unreported(scan(texts).filter((v) => v.rule === "official_pmi_claim"))).toEqual([]);
  });

  it("REQ-S21-001: no string names an engineering delivery gate (DG0-DG7)", () => {
    expect(unreported(scan(texts).filter((v) => v.rule === "engineering_gate"))).toEqual([]);
  });

  it("the shipped disclaimer passes, and a planted claim or gate name in a catalogue string is caught", () => {
    const common = JSON.parse(readFileSync(join(i18nDir(lang), "common.json"), "utf8"));
    const about = common.about?.methodBody ?? common.methodBody;
    expect(typeof about).toBe("string");
    expect(scan([{ where: "common.json#methodBody", text: about }])).toEqual([]);
    const planted =
      lang === "en" ? ["A PMI certified product", "Released at DG7"] : ["منهجية معتمدة من PMI", "بوابة DG٧"];
    expect(scan(planted.map((text) => ({ where: "planted", text }))).map((v) => v.rule)).toEqual([
      "official_pmi_claim",
      "engineering_gate",
    ]);
  });
});
