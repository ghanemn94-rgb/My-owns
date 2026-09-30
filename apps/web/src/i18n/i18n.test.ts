// i18n key parity (REQ-S15-007, ADR-0009 §2): every key exists in BOTH Arabic and English, no value is empty,
// interpolation variables match, every key the source code uses exists, and the default is Arabic RTL.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCALES,
  PHASES,
  SCOPE_TYPES,
  STANDALONE_DELIVERABLE_TYPES,
  TRANSFORMATION_MODES,
  TRANSFORMATION_STATUSES,
} from "@mth/shared";
import { NAV_AREAS } from "../app/nav.ts";
import { applyDocumentLocale, catalogues, createI18n, directionOf } from "./index.ts";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const ar = flatten(catalogues.ar as unknown as Tree);
const en = flatten(catalogues.en as unknown as Tree);
const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

const SRC = join(import.meta.dirname, "..");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith(".")) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("catalogue parity", () => {
  it("has the same namespace files for ar and en", () => {
    expect(Object.keys(catalogues.ar).sort()).toEqual(Object.keys(catalogues.en).sort());
    // The files on disk are exactly the imported namespaces (a new file cannot be forgotten in index.ts).
    for (const locale of LOCALES) {
      const files = readdirSync(join(SRC, "i18n", locale))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();
      expect(files).toEqual(Object.keys(catalogues[locale]).sort());
    }
  });

  it("every key in Arabic exists in English and vice versa", () => {
    const missingInEn = [...ar.keys()].filter((k) => !en.has(k));
    const missingInAr = [...en.keys()].filter((k) => !ar.has(k));
    expect({ missingInEn, missingInAr }).toEqual({ missingInEn: [], missingInAr: [] });
    expect(ar.size).toBeGreaterThan(300);
  });

  it("has no empty values and identical interpolation variables", () => {
    const problems: string[] = [];
    for (const [k, v] of en) {
      if (!v.trim()) problems.push(`en ${k} empty`);
      const a = ar.get(k) ?? "";
      if (!a.trim()) problems.push(`ar ${k} empty`);
      if (JSON.stringify(vars(v)) !== JSON.stringify(vars(a))) problems.push(`${k}: ${vars(v)} vs ${vars(a)}`);
    }
    expect(problems).toEqual([]);
  });

  it("Arabic values are actually Arabic (not copied English)", () => {
    const latinOnly = [...ar.entries()].filter(([, v]) => !/[؀-ۿ]/.test(v));
    expect(latinOnly).toEqual([]);
  });

  it("contains every key literally used in the source code", () => {
    const used = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bt\(\s*"([a-zA-Z][\w]*(?:\.[\w]+)+)"/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(150);
    expect([...used].filter((k) => !en.has(k))).toEqual([]);
  });

  it("covers every value of the enumerations rendered with template keys", () => {
    const expected = [
      ...PHASES.map((p) => `transformations.phase.${p}`),
      ...TRANSFORMATION_STATUSES.map((s) => `transformations.status.${s}`),
      "transformations.status.archived",
      ...TRANSFORMATION_MODES.map((m) => `transformations.mode.${m}`),
      ...TRANSFORMATION_MODES.map((m) => `transformations.form.modeHelp.${m}`),
      ...STANDALONE_DELIVERABLE_TYPES.map((d) => `transformations.deliverable.${d}`),
      ...SCOPE_TYPES.map((s) => `admin.scopeType.${s}`),
      ...NAV_AREAS.flatMap((a) => ["label", "summary", "contents"].map((f) => `nav.areas.${a.id}.${f}`)),
      ...LOCALES.map((l) => `common.language.name.${l}`),
      ...["on_track", "at_risk", "off_track", "unknown", "stale"].map((s) => `common.status.${s}`),
      ...["active", "scheduled", "expired", "revoked"].map((s) => `admin.assignments.state.${s}`),
      ...["source", "implementation", "technical_admin"].map((k) => `admin.roleKind.${k}`),
      ...["400", "401", "403", "404", "409", "422", "428", "429", "5xx", "other"].map((s) => `problems.status.${s}`),
    ];
    expect(expected.filter((k) => !en.has(k) || !ar.has(k))).toEqual([]);
  });

  it("translates every problem code the P1 API can return", () => {
    const codes = [
      "validation",
      "unauthenticated",
      "auth.login_failed",
      "forbidden",
      "csrf",
      "not_found",
      "version_conflict",
      "precondition_required",
      "invalid_transition",
      "rate_limited",
      "unavailable",
      "internal",
      "duplicate",
      "duplicate.code",
      "duplicate.email",
      "duplicate.identity",
      "sod.admin_approver",
      "access.self_grant",
      "access.already_revoked",
      "access.duplicate_assignment",
      "access.scope_not_found",
      "access.user_disabled",
      "user.cannot_disable_self",
      "business_unit.cycle",
      "business_unit.parent_invalid",
      "business_unit.depth_exceeded",
      "transformation.archived",
      "transformation.already_archived",
      "idempotency.key_reused",
      "validation.effective_range",
      "validation.constraint",
      "validation.reference",
      "validation.cursor",
    ];
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    expect(codes.filter((c) => !en.has(key(c)) || !ar.has(key(c)))).toEqual([]);
  });
});

describe("direction and default language", () => {
  it("defaults to Arabic RTL", () => {
    localStorage.clear();
    const i18n = createI18n();
    expect(i18n.language).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("switches <html lang dir> to English LTR and back", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    await i18n.changeLanguage("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("uses the stored language hint before sign-in", () => {
    localStorage.setItem("mth.locale", "en");
    expect(createI18n().language).toBe("en");
    localStorage.clear();
  });

  it("maps directions", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
    const doc = document.implementation.createHTMLDocument("x");
    applyDocumentLocale("en", doc);
    expect(doc.documentElement.dir).toBe("ltr");
  });
});
