// T-DG6-FE-C (p6-work-split §2 rules 6, 16, 17; §B/A.9): the slice B and A texts and request paths.
//  - Every refusal code of ADR-0055 §9 and ADR-0056 §9, every row reason of ADR-0056 §5 and every actionable error of
//    ADR-0055 §4 (why and what to do) has an English text equal to the ADR's (read from the ADR files, so a new row cannot
//    go untranslated; "{x}" becomes "{{x}}") and an Arabic text that is Arabic and differs from the English.
//  - A text with placeholders has a `_noParams` variant where the server may omit the params.
//  - Every Arabic text of the B/A blocks is labelled provisional (provisional-ar.ts).
//  - The request paths of pages/integrations/api.ts, pages/imports/api.ts and the external-confirmation panel equal the
//    contract's, method included.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogues } from "../../i18n/index.ts";
import { confirmationPaths } from "../../components/external-confirmation/ExternalConfirmationPanel.tsx";
import { IMPORT_OPERATIONS, importPaths } from "../imports/api.ts";
import { ACTIONABLE_ERROR_CODES, INTEGRATION_OPERATIONS, integrationPaths } from "./api.ts";
import { provisionalSourceOf } from "./provisional-ar.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

function adrText(n: string): string {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
  if (!file) throw new Error(`ADR-${n} not found`);
  return readFileSync(join(dir, file), "utf8");
}

/** `"text"` (optionally followed by a parenthesised note) -> text with i18next placeholders; markdown `\"` -> `"`. */
const unquote = (s: string): string | null => {
  const m = /^"(.*)"(?:\s*\(.*\))?$/.exec(s.trim());
  return m ? m[1]!.replace(/\\"/g, '"').replace(/\{(\w+)\}/g, "{{$1}}") : null;
};

type Flat = Map<string, string>;
function flatten(obj: unknown, prefix: string, out: Flat): Flat {
  if (typeof obj === "string") out.set(prefix, obj);
  else if (obj && typeof obj === "object")
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}
const en = flatten(catalogues.en, "", new Map());
const ar = flatten(catalogues.ar, "", new Map());
const key = (code: string) => code.replace(/\./g, "__");

/** code -> English text of the `| \`code\` | 4xx | "text" |` rows of a section. */
function refusalRows(adr: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of adr.split("\n")) {
    const m = /^\|\s*`([a-z_]+\.[a-z0-9_.]+)`\s*\|\s*(\d{3})\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (m) out.set(m[1]!, unquote(m[3]!)!);
  }
  return out;
}

describe("slice B and A texts (ADR-0055, ADR-0056)", () => {
  const adr55 = adrText("0055");
  const adr56 = adrText("0056");

  it("translates every refusal code of ADR-0055 §9 and ADR-0056 §9 with the ADR's English text", () => {
    const rows = new Map([...refusalRows(adr55), ...refusalRows(adr56)]);
    expect(rows.size).toBe(32);
    const problems: string[] = [];
    for (const [code, text] of rows) {
      const k = `problems.${key(code)}`;
      if (en.get(k) !== text) problems.push(`${code}: en "${en.get(k)}" != ADR "${text}"`);
      const a = ar.get(k) ?? "";
      if (!/[؀-ۿ]/.test(a) || a === text) problems.push(`${code}: ar missing or not Arabic`);
      if (/\{\{/.test(text) && !en.get(`${k}_noParams`)) problems.push(`${code}: no _noParams variant`);
    }
    expect(problems).toEqual([]);
  });

  it("renders every row reason of ADR-0056 §5 with the ADR's English text, in English and Arabic", () => {
    const rows = new Map<string, string>();
    for (const line of adr56.split("\n")) {
      const m = /^\|\s*`(import\.row\.[a-z_]+)`\s*\|\s*(".*")\s*\|\s*$/.exec(line);
      if (m) rows.set(m[1]!, unquote(m[2]!)!);
    }
    expect(rows.size).toBe(18);
    const problems: string[] = [];
    for (const [code, text] of rows) {
      const k = `imports.reason.${key(code)}`;
      if (en.get(k) !== text) problems.push(`${code}: en "${en.get(k)}" != ADR "${text}"`);
      if (!/[؀-ۿ]/.test(ar.get(k) ?? "")) problems.push(`${code}: ar missing`);
    }
    // The codes the targets send beyond the table (proposed in the BE-M and KBE-A handbacks) are rendered too.
    for (const extra of ["text_length", "reviewer_unavailable", "source_record_id_too_long"])
      if (!en.has(`imports.reason.import__row__${extra}`)) problems.push(`${extra}: missing`);
    expect(problems).toEqual([]);
  });

  it("gives every actionable error of ADR-0055 §4 its why and what-to-do texts verbatim", () => {
    const rows = new Map<string, [string, string]>();
    for (const line of adr55.split("\n")) {
      const m = /^\|\s*`(connector\.[a-z_]+)`\s*\|\s*(".*?")\s*\|\s*(".*?")\s*\|\s*$/.exec(line);
      if (m) rows.set(m[1]!, [unquote(m[2]!)!, unquote(m[3]!)!]);
    }
    expect([...rows.keys()].sort()).toEqual([...ACTIONABLE_ERROR_CODES].sort());
    for (const [code, [why, todo]] of rows) {
      const stem = `integrations.actionable.${key(code)}`;
      expect(en.get(`${stem}.why`), code).toBe(why);
      expect(en.get(`${stem}.todo`), code).toBe(todo);
      expect(ar.get(`${stem}.why`), code).toMatch(/[؀-ۿ]/);
      expect(ar.get(`${stem}.todo`), code).toMatch(/[؀-ۿ]/);
      if (/\{\{/.test(why)) expect(en.get(`${stem}.why_noParams`), code).toBeTruthy();
      if (/\{\{/.test(todo)) expect(en.get(`${stem}.todo_noParams`), code).toBeTruthy();
    }
  });

  it("labels every Arabic text of the B/A blocks provisional", () => {
    const keys = [...ar.keys()].filter(
      (k) =>
        k.startsWith("integrations.") ||
        k.startsWith("imports.") ||
        k.startsWith("externalChange.") ||
        /^problems\.(connector|integration_run|outbound_write|external_change|import|webhook)__/.test(k) ||
        k === "nav.sub.integrations" ||
        k === "nav.sub.imports",
    );
    expect(keys.length).toBeGreaterThan(450);
    expect(keys.filter((k) => provisionalSourceOf(k) === undefined)).toEqual([]);
    expect(provisionalSourceOf("imports.reason.import__row__required_missing")).toBe("kbe-a");
    expect(provisionalSourceOf("integrations.actionable.connector__stopped.why")).toBe("be-o");
  });

  it("never calls a connector live or connected to Mobily, and never names an engineering gate", () => {
    const texts = [...en.entries()].filter(([k]) => /^(integrations|imports|externalChange)\./.test(k));
    const bad = texts.filter(
      ([, v]) =>
        /\blive\b|connected to Mobily|\bDG[0-7]\b|certified/i.test(v) && !/No connector here is connected/.test(v),
    );
    expect(bad).toEqual([]);
  });
});

describe("slice B and A request paths equal the contract", () => {
  function contractOperations(): Map<string, [string, string]> {
    const text = readFileSync(join(repoRoot(), "docs", "api", "openapi.yaml"), "utf8");
    const out = new Map<string, [string, string]>();
    let path = "";
    let method = "";
    for (const line of text.split("\n")) {
      const p = /^ {2}(\/api\/v1\/\S+):\s*$/.exec(line);
      if (p) path = p[1]!;
      const m = /^ {4}(get|put|post|patch|delete):\s*$/.exec(line);
      if (m) method = m[1]!.toUpperCase();
      const op = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
      if (op && path) out.set(op[1]!, [method, path]);
    }
    return out;
  }
  const ops = contractOperations();
  const fill = (template: string) => template.replace(/\{(\w+)\}/g, (_, name: string) => `:${name}`);

  it("lists each operation with the contract's method and path", () => {
    for (const [id, method, path] of [...INTEGRATION_OPERATIONS, ...IMPORT_OPERATIONS])
      expect(ops.get(id), id).toEqual([method, path]);
    expect(ops.get("getDeliverableConfirmation")).toEqual(["GET", "/api/v1/deliverables/{deliverableId}/confirmation"]);
    expect(ops.get("confirmDeliverableExternalChange")).toEqual([
      "POST",
      "/api/v1/deliverables/{deliverableId}/confirmation",
    ]);
    expect(ops.get("putDeliverableExternalChange")).toEqual([
      "PUT",
      "/api/v1/deliverables/{deliverableId}/external-change",
    ]);
  });

  it("builds every listed template from the path helpers", () => {
    const built = [
      integrationPaths.connectors,
      integrationPaths.connector(":connectorId"),
      integrationPaths.enable(":connectorId"),
      integrationPaths.disable(":connectorId"),
      integrationPaths.test(":connectorId"),
      integrationPaths.mappings(":connectorId"),
      integrationPaths.runs(":connectorId"),
      integrationPaths.run(":connectorId", ":runId"),
      integrationPaths.retry(":connectorId", ":runId"),
      integrationPaths.webhooks,
      integrationPaths.webhook(":webhookId"),
      integrationPaths.rotateWebhookSecret(":webhookId"),
      integrationPaths.disableWebhook(":webhookId"),
      integrationPaths.outboundWrites(":transformationId"),
      integrationPaths.outboundWrite(":transformationId", ":writeId"),
      integrationPaths.confirmOutboundWrite(":transformationId", ":writeId"),
      importPaths.imports(":transformationId"),
      importPaths.import(":transformationId", ":importId"),
      importPaths.rows(":transformationId", ":importId"),
      importPaths.commit(":transformationId", ":importId"),
      importPaths.cancel(":transformationId", ":importId"),
      importPaths.templates,
      confirmationPaths.confirmation(":deliverableId"),
      confirmationPaths.externalChange(":deliverableId"),
    ].map((p) => decodeURIComponent(p));
    const templates = new Set([...INTEGRATION_OPERATIONS, ...IMPORT_OPERATIONS].map(([, , p]) => fill(p)));
    templates.add(fill("/api/v1/deliverables/{deliverableId}/confirmation"));
    templates.add(fill("/api/v1/deliverables/{deliverableId}/external-change"));
    templates.delete(fill("/api/v1/import-templates/{templateVersion}/download"));
    expect(new Set(built)).toEqual(templates);
    expect(importPaths.templateDownload("kpi_actual.v1", "xlsx", "t1")).toBe(
      "/api/v1/import-templates/kpi_actual.v1/download?format=xlsx&transformationId=t1",
    );
  });
});
