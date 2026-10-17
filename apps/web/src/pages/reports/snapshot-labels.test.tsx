// T-DG5-FE-G2 (QA-C O1, Low): on the snapshot page the SHA-256 checksum is one LTR run that wraps inside its card in
// Arabic (the full value kept), and the source-records table shows translated section and record-type labels in en and
// ar instead of raw codes (`register`, `raid_entry`). SYNTHETIC values.
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { catalogues, createI18n } from "../../i18n/index.ts";
import { Checksum, CodeLabel } from "./SnapshotPage.tsx";

afterEach(cleanup);
const LANGS = ["en", "ar"] as const;
const inLang = (lang: "en" | "ar", ui: ReactNode) =>
  render(<I18nextProvider i18n={createI18n(lang)}>{ui}</I18nextProvider>);
const HASH = "0123456789abcdef".repeat(4);

describe("snapshot checksum (QA-C O1)", () => {
  for (const lang of LANGS) {
    it(`${lang}: the full SHA-256 is one LTR run that may wrap anywhere, with the full value as its title`, () => {
      const { container } = inLang(lang, <Checksum value={HASH} />);
      const el = container.querySelector("bdi")!;
      expect(el.getAttribute("dir")).toBe("ltr");
      expect(el.textContent).toBe(HASH);
      expect(el.getAttribute("title")).toBe(HASH);
      expect(el.getAttribute("data-sha256")).toBe(HASH);
      expect(el.style.overflowWrap).toBe("anywhere");
      expect(el.style.wordBreak).toBe("break-all");
    });
  }
});

describe("snapshot source labels (QA-C O1)", () => {
  for (const lang of LANGS) {
    it(`${lang}: 'register' and 'raid_entry' are shown as translated labels, never as raw codes`, () => {
      const r = catalogues[lang].reportsP5 as unknown as {
        sourceSection: Record<string, string>;
        sourceRecordType: Record<string, string>;
      };
      const section = inLang(lang, <CodeLabel ns="sourceSection" code="register" />);
      expect(section.container.textContent).toBe(r.sourceSection["register"]);
      expect(section.container.textContent).not.toBe("register");
      cleanup();
      const type = inLang(lang, <CodeLabel ns="sourceRecordType" code="raid_entry" />);
      expect(type.container.textContent).toBe(r.sourceRecordType["raid_entry"]);
      expect(type.container.querySelector("bdi")).toBeNull();
    });

    it(`${lang}: a record type known to the evidence register uses its label; an unknown code stays the code, LTR`, () => {
      const ev = catalogues[lang].evidence as unknown as { recordTypes: Record<string, string> };
      const known = inLang(lang, <CodeLabel ns="sourceRecordType" code="tom_canvas_cell" />);
      expect(known.container.textContent).toBe(ev.recordTypes["tom_canvas_cell"]);
      cleanup();
      const unknown = inLang(lang, <CodeLabel ns="sourceRecordType" code="synthetic_unknown_type" />);
      const bdi = unknown.container.querySelector("bdi")!;
      expect(bdi.textContent).toBe("synthetic_unknown_type");
      expect(bdi.getAttribute("dir")).toBe("ltr");
    });
  }

  it("every section and record-type label exists in both languages with the same keys", () => {
    const of = (lang: "en" | "ar") =>
      catalogues[lang].reportsP5 as unknown as {
        sourceSection: Record<string, string>;
        sourceRecordType: Record<string, string>;
      };
    for (const ns of ["sourceSection", "sourceRecordType"] as const) {
      expect(Object.keys(of("ar")[ns]).sort()).toEqual(Object.keys(of("en")[ns]).sort());
      for (const v of [...Object.values(of("en")[ns]), ...Object.values(of("ar")[ns])]) expect(v.trim()).not.toBe("");
    }
  });
});
