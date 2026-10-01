// Domain terms in the UI catalogues follow the approved DG0 glossary (F-DG1-003, REQ-PB-003).
// Source: docs/analysis/glossary.md (T-DG0-AN-01, revised T-DG0-AN-05). The test parses the glossary tables directly,
// so a catalogue string that drifts from the glossary, or a glossary revision the UI has not adopted, fails here.
// The glossary's Arabic terms are proposals that still need a Mobily Arabic-language owner's review.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASES } from "@mth/shared";
import { catalogues } from "./index.ts";

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
const get = (m: Map<string, string>, k: string) => {
  const v = m.get(k);
  if (v === undefined) throw new Error(`missing catalogue key ${k}`);
  return v;
};

const GLOSSARY_PATH = join(import.meta.dirname, "..", "..", "..", "..", "docs", "analysis", "glossary.md");

/** English term -> Arabic term, from every "| English term | Arabic term | Definition | Source |" table. */
function parseGlossary(markdown: string): Map<string, string> {
  const terms = new Map<string, string>();
  let inTermTable = false;
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      inTermTable = false;
      continue;
    }
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    if (cells[0] === "English term") {
      inTermTable = cells[1] === "Arabic term"; // skips the revision table ("Before | Now | Why")
      continue;
    }
    if (!inTermTable || /^-+$/.test(cells[0] ?? "")) continue;
    terms.set(cells[0]!, cells[1]!);
  }
  return terms;
}

const glossary = parseGlossary(readFileSync(GLOSSARY_PATH, "utf8"));
const term = (english: string) => {
  const v = glossary.get(english);
  if (!v) throw new Error(`glossary has no term "${english}"`);
  return v;
};

const PHASE_TERM: Record<(typeof PHASES)[number], string> = {
  diagnose: "Diagnose",
  define: "Define",
  design: "Design",
  mobilize: "Mobilize",
  transform: "Transform",
  realize: "Realize",
};

describe("glossary source", () => {
  it("parses the DG0 glossary with distinct Transformation and Initiative terms", () => {
    expect(glossary.size).toBeGreaterThan(100);
    expect(term("Transformation")).toBe("التحوّل");
    expect(term("Initiative")).toBe("مبادرة");
    expect(term("Transformation")).not.toBe(term("Initiative"));
  });
});

describe("Arabic catalogue follows the glossary", () => {
  it("names a Transformation with the glossary term everywhere it is the subject", () => {
    expect(get(ar, "transformations.detailTitle")).toBe(term("Transformation"));
    expect(get(ar, "admin.scopeType.transformation")).toBe(term("Transformation"));
    for (const key of [
      "transformations.listTitle",
      "transformations.createTitle",
      "transformations.editTitle",
      "transformations.form.create",
      "transformations.archive.confirm",
      "transformations.archive.readOnlyShort",
      "transformations.createdNotVisible.title",
      "nav.areas.transformations.label",
      "common.myWork.openTransformations",
      "problems.transformation__archived",
      "problems.transformation__already_archived",
    ]) {
      expect(get(ar, key), key).toMatch(/تحوّل/);
      expect(get(ar, key), key).not.toMatch(/مبادر/);
    }
  });

  it("never renders a Transformation as an Initiative (no 'مبادرة/مبادرات التحول' anywhere)", () => {
    const offenders = [...ar].filter(([, v]) => /مبادر(?:ة|ات)\s+(?:ال)?تحو/.test(v));
    expect(offenders).toEqual([]);
    // The two scope levels stay distinct, and neither label contains the other's glossary term.
    const tr = get(ar, "admin.scopeType.transformation");
    const ini = get(ar, "admin.scopeType.initiative");
    expect(tr).not.toBe(ini);
    expect(ini).toContain(term("Initiative"));
    expect(tr).not.toContain(term("Initiative"));
    expect(ini).not.toContain(term("Transformation"));
  });

  it("spells the Transformation term consistently (with shadda, as in the glossary)", () => {
    // "تحول" without the shadda is the same word written inconsistently; the glossary writes "تحوّل".
    expect([...ar].filter(([, v]) => /تحول/.test(v))).toEqual([]);
  });

  it("uses the glossary terms for the modes; never 'معياري' (reads as standard/normative)", () => {
    expect(get(ar, "transformations.mode.end_to_end")).toBe(term("End-to-End mode"));
    expect(get(ar, "transformations.mode.modular")).toBe(term("Modular mode"));
    expect([...ar].filter(([, v]) => /معياري/.test(v))).toEqual([]);
  });

  it("uses the glossary terms for the six phases; Phase 5 differs from the Transformation term", () => {
    for (const p of PHASES) expect(get(ar, `transformations.phase.${p}`), p).toBe(term(PHASE_TERM[p]));
    expect(get(ar, "transformations.phase.transform")).not.toBe(term("Transformation"));
  });

  it("uses the glossary role, record and methodology names", () => {
    expect(get(ar, "transformations.field.sponsor")).toBe(term("Executive Sponsor"));
    expect(get(ar, "transformations.field.lead")).toBe(term("Transformation Lead"));
    expect(get(ar, "transformations.audit.field.sponsor_user_id")).toBe(term("Executive Sponsor"));
    expect(get(ar, "transformations.audit.field.lead_user_id")).toBe(term("Transformation Lead"));
    expect(get(ar, "transformations.workspace.northStar")).toBe(term("North Star"));
    expect(get(ar, "transformations.deliverable.target_operating_model")).toBe(term("Target Operating Model (TOM)"));
    expect(get(ar, "transformations.deliverable.benefits_register")).toBe(term("Benefits Register (T14)"));
    expect(get(ar, "common.about.methodBody")).toContain(term("Business Transformation Playbook"));
    expect(get(ar, "nav.areas.bau.label")).toContain(term("BAU (business as usual)"));
  });
});

describe("English catalogue follows the glossary", () => {
  it("uses the glossary English names", () => {
    expect(get(en, "transformations.detailTitle")).toBe("Transformation");
    expect(get(en, "admin.scopeType.transformation")).toBe("Transformation");
    expect(get(en, "admin.scopeType.initiative")).toBe("Initiative");
    for (const p of PHASES) expect(get(en, `transformations.phase.${p}`)).toBe(PHASE_TERM[p]);
    expect(term("End-to-End mode")).toBeTruthy();
    expect(`${get(en, "transformations.mode.end_to_end")} mode`).toBe("End-to-End mode");
    expect(`${get(en, "transformations.mode.modular")} mode`).toBe("Modular mode");
    expect(get(en, "transformations.field.sponsor")).toBe("Executive Sponsor");
    expect(get(en, "transformations.field.lead")).toBe("Transformation Lead");
    expect(get(en, "transformations.workspace.northStar")).toBe("North Star");
    expect(get(en, "common.about.methodBody")).toContain("Business Transformation Playbook");
    // The English UI never calls a transformation an initiative either.
    expect([...en].filter(([, v]) => /transformation initiative/i.test(v))).toEqual([]);
  });
});
