// Static checks of the stylesheets and static assets (ADR-0009 §2/§4/§6):
//  - logical CSS properties only (no physical left/right), so RTL mirrors the layout;
//  - colours come from tokens (no hard-coded hex colours in app CSS);
//  - no remote URL in CSS, HTML or public assets (fonts and images are local).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(import.meta.dirname, "..", "..");
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith(".")) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" || name === "dist" ? [] : files(p, ext);
    return ext.test(name) ? [p] : [];
  });
}
const cssFiles = files(join(WEB, "src"), /\.css$/);

describe("stylesheets", () => {
  it("exist", () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it("use logical properties only (no physical left/right)", () => {
    const physical =
      /\b(margin|padding|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:|text-align\s*:\s*(left|right)|float\s*:\s*(left|right)|clear\s*:\s*(left|right)|border-(top|bottom)-(left|right)-radius/m;
    const offenders = cssFiles.filter((f) => physical.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));
    expect(offenders).toEqual([]);
  });

  it("take colours from design tokens, not hard-coded values", () => {
    const offenders = cssFiles.flatMap((f) =>
      [
        ...readFileSync(f, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g),
      ].map((m) => `${f}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it("never reference a remote URL", () => {
    const candidates = [...cssFiles, join(WEB, "index.html"), ...files(join(WEB, "public"), /\.(js|css|html|svg)$/)];
    const offenders = candidates.filter((f) =>
      /url\(\s*['"]?(https?:)?\/\/|<(link|script)[^>]+(src|href)=["'](https?:)?\/\//i.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the app imports only the bundled Plex font subsets it needs", () => {
    const main = readFileSync(join(WEB, "src", "main.tsx"), "utf8");
    const fonts = [...main.matchAll(/@fontsource\/([\w-]+)\/([\w-]+)\.css/g)].map((m) => `${m[1]}/${m[2]}`);
    expect(fonts.sort()).toEqual(
      [
        "ibm-plex-sans-arabic/arabic-400",
        "ibm-plex-sans-arabic/arabic-500",
        "ibm-plex-sans-arabic/arabic-600",
        "ibm-plex-sans/latin-400",
        "ibm-plex-sans/latin-500",
        "ibm-plex-sans/latin-600",
      ].sort(),
    );
  });

  it("contains no logo image (the wordmark is text; REQ-S15-006)", () => {
    const images = files(WEB, /\.(png|jpe?g|gif|svg|webp|ico)$/i).filter(
      (f) => !f.includes(`${join("e2e", "screenshots")}`),
    );
    expect(images).toEqual([]);
  });
});
