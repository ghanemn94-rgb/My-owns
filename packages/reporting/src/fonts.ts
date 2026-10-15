// Bundled fonts (ADR-0046 §3, §7; REQ-S13-009): IBM Plex Sans Arabic (Arabic and Latin) and IBM Plex Sans (Latin),
// weights 400 and 700, loaded from the `.woff` files of `@fontsource/ibm-plex-sans-arabic@5.2.6` and
// `@fontsource/ibm-plex-sans@5.2.6` (SIL Open Font License 1.1; THIRD_PARTY_NOTICES.md). No font is fetched at run
// time and no system font is needed: the files are read from the installed packages once per process.
//
// Fontsource splits each family by Unicode range (`arabic`, `latin`, `latin-ext` files). A file is one "face"; the
// layout (layout/**) draws every run with the first face of the export language's stack that covers its characters:
//   - Arabic exports: IBM Plex Sans Arabic first (its arabic, latin and latin-ext files), so the document is set in
//     IBM Plex Sans Arabic; IBM Plex Sans latin-ext covers what the Arabic family lacks;
//   - English exports: IBM Plex Sans first (latin, latin-ext), then IBM Plex Sans Arabic for any Arabic text a user
//     wrote in an English export.
// The `.woff` files are TrueType-flavoured with the GSUB, GPOS and GDEF tables Arabic shaping needs (ARCH-04 evidence
// `font-tables.txt`).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ExportLanguage } from "./labels.ts";

export const FONT_FAMILIES = { latin: "IBM Plex Sans", arabic: "IBM Plex Sans Arabic" } as const;
export type FontWeight = 400 | 700;

export interface FontFace {
  /** A stable face name, e.g. `PlexArabic-arabic-400` (the PDF registers each face under this name). */
  readonly name: string;
  readonly family: (typeof FONT_FAMILIES)[keyof typeof FONT_FAMILIES];
  readonly weight: FontWeight;
  readonly subset: "arabic" | "latin" | "latin-ext";
  /** `<package>/files/<file>.woff`, resolved through the package's `exports`. */
  readonly specifier: string;
}

const face = (
  pkg: "ibm-plex-sans-arabic" | "ibm-plex-sans",
  subset: FontFace["subset"],
  weight: FontWeight,
): FontFace => ({
  name: `${pkg === "ibm-plex-sans" ? "PlexSans" : "PlexArabic"}-${subset}-${weight}`,
  family: pkg === "ibm-plex-sans" ? FONT_FAMILIES.latin : FONT_FAMILIES.arabic,
  weight,
  subset,
  specifier: `@fontsource/${pkg}/files/${pkg}-${subset}-${weight}-normal.woff`,
});

const WEIGHTS: readonly FontWeight[] = [400, 700];

/** Every bundled face (10 files: 5 per weight). */
export const FONT_FACES: readonly FontFace[] = WEIGHTS.flatMap((w) => [
  face("ibm-plex-sans-arabic", "arabic", w),
  face("ibm-plex-sans-arabic", "latin", w),
  face("ibm-plex-sans-arabic", "latin-ext", w),
  face("ibm-plex-sans", "latin", w),
  face("ibm-plex-sans", "latin-ext", w),
]);

/** The face stack of an export language and weight, in preference order (above). */
export function fontStack(language: ExportLanguage, weight: FontWeight): readonly FontFace[] {
  const by = (pkg: "PlexArabic" | "PlexSans", subset: FontFace["subset"]) =>
    FONT_FACES.find((f) => f.name === `${pkg}-${subset}-${weight}`)!;
  return language === "ar"
    ? [
        by("PlexArabic", "arabic"),
        by("PlexArabic", "latin"),
        by("PlexArabic", "latin-ext"),
        by("PlexSans", "latin-ext"),
      ]
    : [by("PlexSans", "latin"), by("PlexSans", "latin-ext"), by("PlexArabic", "arabic"), by("PlexArabic", "latin-ext")];
}

/** The family a document of this language is set in (DOCX/PPTX name it; the PDF embeds it). */
export const primaryFamily = (language: ExportLanguage): string =>
  language === "ar" ? FONT_FAMILIES.arabic : FONT_FAMILIES.latin;

const require = createRequire(import.meta.url);
const cache = new Map<string, Buffer>();

/** The bytes of one bundled face (read once per process from the installed font package). */
export function fontBytes(f: FontFace): Buffer {
  let bytes = cache.get(f.name);
  if (bytes === undefined) {
    bytes = readFileSync(require.resolve(f.specifier));
    cache.set(f.name, bytes);
  }
  return bytes;
}
