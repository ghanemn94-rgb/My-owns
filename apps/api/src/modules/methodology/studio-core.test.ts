// Unit tests of the P5 slice A core (T-DG5-BE-A; ADR-0039 §1-§3): the canonical content hash, the kind-provider
// registry and the per-element-type attribute schemas. Pure: no database (the resolver, drafts and pins are tested
// against PostgreSQL in test/integration/methodology/studio-drafts.test.ts).
import { createHash } from "node:crypto";
import { CONFIG_ELEMENT_TYPES, CONFIG_KINDS, configDraftUpdate } from "@mth/shared/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalContentJson, contentSha256 } from "./content-hash.ts";
import {
  configKindProvider,
  elementAttributeSchema,
  kindAcceptsElementType,
  registerConfigKindProvider,
  resetConfigKindProvidersForTest,
} from "./kinds.ts";

describe("content hash (ADR-0039 §1)", () => {
  it("is SHA-256 of the canonical JSON of {definition, titleEn, titleAr, elements}, keys in code-point order", () => {
    const content = {
      definition: { b: 1, a: [true, null, "x"] },
      titleEn: "T",
      titleAr: "ع",
      elements: [],
    };
    const text = '{"definition":{"a":[true,null,"x"],"b":1},"elements":[],"titleAr":"ع","titleEn":"T"}';
    expect(canonicalContentJson(content)).toBe(text);
    expect(contentSha256(content)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });

  it("sorts elements by (elementType, stableKey) and keeps only the hashed fields", () => {
    const e = (elementType: string, stableKey: string) => ({
      elementType,
      stableKey,
      origin: "source",
      removed: false,
      ordinal: null,
      attributes: { labelEn: stableKey },
    });
    const a = contentSha256({
      definition: {},
      titleEn: "t",
      titleAr: "t",
      elements: [e("phase", "b"), e("gate", "G2")],
    });
    const b = contentSha256({
      definition: {},
      titleEn: "t",
      titleAr: "t",
      elements: [e("gate", "G2"), e("phase", "b")],
    });
    expect(a).toBe(b);
    const c = contentSha256({
      definition: {},
      titleEn: "t",
      titleAr: "t",
      elements: [{ ...e("gate", "G2"), attributes: { labelEn: "changed" } }, e("phase", "b")],
    });
    expect(c).not.toBe(a);
  });

  it("orders keys by code point, not UTF-16 unit (an astral key sorts after U+FFFF)", () => {
    expect(canonicalContentJson({ "\u{1F600}": 1, "￿": 2 })).toBe('{"￿":2,"\u{1F600}":1}');
  });

  it("refuses non-integer numbers (decimals are strings) and the schemas refuse them first", () => {
    expect(() => canonicalContentJson({ w: 0.5 })).toThrow(/integers/);
    expect(configDraftUpdate.safeParse({ definition: { w: 0.5 } }).success).toBe(false);
    expect(configDraftUpdate.safeParse({ definition: { w: "0.5", n: 3 } }).success).toBe(true);
    expect(configDraftUpdate.safeParse({}).success).toBe(false);
  });
});

describe("ConfigKindProvider registry", () => {
  afterEach(() => resetConfigKindProvidersForTest());

  it("knows every kind; methodology, scoring_defaults and form_schema resolve to their default keys, the others to none yet", () => {
    expect(CONFIG_KINDS.map((k) => configKindProvider(k).defaultKey)).toEqual([
      "playbook",
      "scoring-defaults",
      "forms", // T-DG5-BE-D (ADR-0041 §2; 0068 seeds forms v1)
      null,
      null,
      null,
    ]);
    expect(kindAcceptsElementType("methodology", "gate")).toBe(true);
    expect(kindAcceptsElementType("methodology", "scoring_weight")).toBe(false);
    expect(kindAcceptsElementType("scoring_defaults", "scoring_rubric")).toBe(true);
    expect(kindAcceptsElementType("form_schema", "gate")).toBe(false);
  });

  it("a provider registers its hooks and default key; the element types stay the database's", async () => {
    registerConfigKindProvider("form_schema", {
      defaultKey: "forms",
      preview: async () => ({ result: "pass", report: {} }),
    });
    const p = configKindProvider("form_schema");
    expect(p.defaultKey).toBe("forms");
    expect(p.elementTypes).toEqual(["form", "form_field"]); // T-DG5-BE-D: the 0068 guard's list for form_schema
    expect(await p.preview?.({} as never, { versionId: "v", samples: null })).toEqual({ result: "pass", report: {} });
  });

  it("every element type has an attribute schema: labels and help text use the free-text rules", () => {
    for (const t of CONFIG_ELEMENT_TYPES) expect(elementAttributeSchema(t)).toBeDefined();
    const gate = elementAttributeSchema("gate");
    expect(gate.safeParse({ labelEn: "Gate 3 renamed", defaultApproverRoleCode: "SP" }).success).toBe(true);
    expect(gate.safeParse({ labelEn: "‏" }).success).toBe(false);
    expect(gate.safeParse({ labelEn: "a\u0000b" }).success).toBe(false);
    expect(gate.safeParse({ unknown: 1 }).success).toBe(false);
    const weight = elementAttributeSchema("scoring_weight");
    expect(weight.safeParse({ weightPercent: "30.00" }).success).toBe(true);
    for (const bad of ["0", "0.00", "100.01", "30.5.1", "101"])
      expect(weight.safeParse({ weightPercent: bad }).success, bad).toBe(false);
    expect(weight.safeParse({ weightPercent: 30 }).success).toBe(false);
    const route = elementAttributeSchema("approver_route");
    expect(route.safeParse({ approverRoleCode: "SP", mode: "any" }).success).toBe(true);
    expect(route.safeParse({ mode: "any" }).success).toBe(false);
  });
});
