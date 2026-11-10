// T-DG6-FE-E (p6-work-split §2 rules 6, 12, 17; §D.3 "Consumes"): the assistant's texts are ADR-0059's, verbatim.
//  - every refusal code of the §10 table is translated in en (the ADR's English, exactly) and in ar (Arabic, different);
//  - the §8 refusal texts, the §4 item 5 `no_sources` text, the §8 `unavailable`/`interrupted` texts, the §1 label and
//    the §3 screen texts are the ADR's English exactly (read from the ADR file, so a change there fails here);
//  - the §1 Arabic label is the ADR's Arabic exactly;
//  - every Arabic text of the `assistant` namespace and of the assistant problem block is labelled provisional
//    (provisional-ar.ts);
//  - no text names an engineering delivery gate (DG0–DG7) or calls the model endpoint live.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogues, createI18n } from "../../i18n/index.ts";
import { problemText } from "../../lib/problem.ts";
import { ASSISTANT_PROVISIONAL_ARABIC } from "./provisional-ar.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}
function adr(): string {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith("ADR-0059-"));
  if (!file) throw new Error("ADR-0059 not found");
  return readFileSync(join(dir, file), "utf8");
}
const ADR = adr();
/** `| 4xx | \`code\` | "English" |` rows of §10, and `| \`code\` | "English" |` rows of §8. */
const STATUS_ROW = /^\|\s*4\d\d\s*\|\s*`([a-z_][a-z0-9_.]*)`\s*\|\s*"(.*?)"/;
const REFUSAL_ROW = /^\|\s*`(assistant\.refused\.[a-z_]+)`\s*\|\s*"(.*?)"\s*\|\s*$/;
const rows = (re: RegExp) =>
  ADR.split("\n")
    .map((l) => re.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1]!, m[2]!] as const);
const quoted = (after: string) => {
  const i = ADR.indexOf(after);
  if (i < 0) throw new Error(`not in ADR-0059: ${after}`);
  return /"([^"]+)"/.exec(ADR.slice(i + after.length))![1]!;
};

type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, prefix: string): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}.${k}`, v] as [string, string]] : flatten(v, `${prefix}.${k}`),
  );
const en = createI18n("en").t;
const ar = createI18n("ar").t;
const flat = (code: string) => code.replace(/\./g, "__");

describe("ADR-0059 texts (rule 17: exact)", () => {
  const status = rows(STATUS_ROW);
  const refusals = rows(REFUSAL_ROW);

  it("reads the ADR tables (14 status rows, 4 refusal rows)", () => {
    expect(status.map(([c]) => c)).toContain("assistant.disabled");
    expect(status).toHaveLength(14);
    expect(refusals).toHaveLength(4);
  });

  it("translates every §10 refusal code: the ADR's English, and Arabic in ar", () => {
    for (const [code, english] of status) {
      expect(problemText(en, code), code).toBe(english);
      const arabic = problemText(ar, code);
      expect(arabic, code).toMatch(/[؀-ۿ]/);
      expect(arabic, code).not.toBe(english);
    }
  });

  it("renders the §8 refusal texts and the other reply kinds with the ADR's English", () => {
    for (const [code, english] of refusals) expect(en(`assistant.reply.refusal.${flat(code)}`), code).toBe(english);
    expect(en("assistant.reply.noSources")).toBe(quoted("the reply is `no_sources` ("));
    expect(en("assistant.reply.unavailable", { code: "{code}" })).toBe(quoted("`unavailable`: "));
    expect(en("assistant.reply.interrupted")).toBe(quoted("`interrupted`: "));
  });

  it("uses the §1 label (en and the ADR's provisional Arabic) and the §3 screen texts", () => {
    expect(en("assistant.label")).toBe(quoted("rendered under the label "));
    expect(ar("assistant.label")).toBe(quoted("(Arabic, provisional: "));
    expect(en("assistant.admin.statusNotConfigured")).toBe(quoted("with no setting row the screen shows "));
    expect(en("assistant.admin.telemetry")).toBe(quoted("Administration > AI assistant shows "));
    expect(en("assistant.admin.authorizationLimit")).toBe(quoted("that limit is shown on the screen: "));
  });

  it("labels every Arabic text of the assistant provisional (provisional-ar.ts)", () => {
    const covered = (key: string) =>
      Object.keys(ASSISTANT_PROVISIONAL_ARABIC).some((p) => (p.endsWith(".") ? key.startsWith(p) : key === p));
    const arAssistant = flatten(catalogues.ar.assistant as unknown as Tree, "assistant");
    expect(arAssistant.length).toBeGreaterThan(100);
    for (const [key, value] of arAssistant) {
      expect(covered(key), key).toBe(true);
      expect(value, key).toMatch(/[؀-ۿ]/);
    }
    for (const [code] of status) {
      if (code === "admin.reason_required") continue; // ADR-0054 §4's, listed by FE-A (provisional-ar-p6.ts)
      expect(ASSISTANT_PROVISIONAL_ARABIC[`problems.${flat(code)}`], code).toBe("fe-e");
    }
    expect(ASSISTANT_PROVISIONAL_ARABIC["assistant.label"]).toBe("adr");
  });

  it("no assistant text names an engineering delivery gate or calls the endpoint live", () => {
    for (const locale of ["en", "ar"] as const) {
      const texts = [
        ...flatten(catalogues[locale].assistant as unknown as Tree, "assistant"),
        ...status.map(([c]) => [c, (catalogues[locale].problems as unknown as Record<string, string>)[flat(c)]!]),
      ];
      for (const [key, text] of texts) {
        expect(text, key).not.toMatch(/\bDG[0-7]\b/);
        expect(text, key).not.toMatch(/\blive\b|\bcertified\b|PMI/i);
      }
    }
  });
});
