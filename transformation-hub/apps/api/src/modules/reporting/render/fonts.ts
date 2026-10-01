import { readFileSync } from 'node:fs';

/**
 * Fonts bundled with the API (npm packages @fontsource/ibm-plex-sans and @fontsource/ibm-plex-sans-arabic, OFL-1.1 — the
 * same faces as the web UI). PDF exports embed them as data URLs: no CDN, no network access while rendering (AT-22).
 */
const FILES = {
  arabic400: '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2',
  arabic600: '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2',
  arabicLatin400: '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-400-normal.woff2',
  arabicLatin600: '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-600-normal.woff2',
  latin400: '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2',
  latin600: '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2',
} as const;

let cached: string | null = null;

/** `@font-face` rules for the report HTML ("Hub Sans" Latin, "Hub Sans Arabic" Arabic + its Latin subset). */
export function fontFaceCss(): string {
  if (cached) return cached;
  const url = (k: keyof typeof FILES) => `data:font/woff2;base64,${readFileSync(require.resolve(FILES[k])).toString('base64')}`;
  const face = (family: string, weight: number, k: keyof typeof FILES, range: string) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(${url(k)}) format('woff2');unicode-range:${range};}`;
  const ARABIC = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
  const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  cached = [
    face('Hub Sans', 400, 'latin400', LATIN),
    face('Hub Sans', 600, 'latin600', LATIN),
    face('Hub Sans Arabic', 400, 'arabic400', ARABIC),
    face('Hub Sans Arabic', 600, 'arabic600', ARABIC),
    face('Hub Sans Arabic', 400, 'arabicLatin400', LATIN),
    face('Hub Sans Arabic', 600, 'arabicLatin600', LATIN),
  ].join('\n');
  return cached;
}
