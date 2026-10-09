// kpi module suite (REQ-S16-003 / A12 "the six modules exist with separate test suites"; P2 T-DG2-KBE). Unit level, no
// database: the module's mapping and boundary, its public interface (wiring hook + gate facts), the exact set of
// routes it registers against docs/api/openapi.yaml with their declared access, and the ADR-0019 §4 "never a float"
// source check over the module and the shared decimal helpers. Behaviour against PostgreSQL is covered by
// apps/api/test/integration/kpi/**.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  AST_TEST_TIMEOUT_MS,
  fileViolations,
  moduleFiles,
  moduleViolations,
  MODULES_DIR,
} from "../../architecture.testkit.ts";
import { API_MODULES, P1_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";

/** The 24 kpi operations of the P2 contract (T-DG2-ARCH-01B + D-061 activate; formerly apps/api/test/support/p2-pending-kpi.ts). */
const KPI_OPERATIONS = [
  "listKpiDefinitions",
  "createKpiDefinition",
  "getKpiDefinition",
  "updateKpiDefinition",
  "archiveKpiDefinition",
  "activateKpiDefinition",
  "listBaselines",
  "createBaseline",
  "getBaseline",
  "updateBaseline",
  "archiveBaseline",
  "listOutcomeKpis",
  "createOutcomeKpi",
  "getOutcomeKpi",
  "updateOutcomeKpi",
  "archiveOutcomeKpi",
  "listValuePools",
  "createValuePool",
  "getValuePool",
  "updateValuePool",
  "archiveValuePool",
  "validateBaseline",
  "validateValuePool",
  "approveOutcomeKpiTrajectory",
];
/** The 11 business-case operations of the P3 contract (T-DG3-KBE-B; ADR-0024 §1-§5). */
const KPI_P3_BUSINESS_CASE_OPERATIONS = [
  "listBusinessCases",
  "createBusinessCase",
  "getBusinessCase",
  "updateBusinessCase",
  "archiveBusinessCase",
  "getBusinessCaseTotals",
  "validateBusinessCaseBaseline",
  "listBusinessCaseLines",
  "createBusinessCaseLine",
  "updateBusinessCaseLine",
  "archiveBusinessCaseLine",
];

/** The 13 T09 benefit-formula operations of the P3 contract (T-DG3-KBE-C; ADR-0024 §5-§6). */
const KPI_P3_BENEFIT_FORMULA_OPERATIONS = [
  "listBenefitFormulaExamples",
  "checkBenefitFormula",
  "listBenefitFormulas",
  "createBenefitFormula",
  "getBenefitFormula",
  "updateBenefitFormula",
  "archiveBenefitFormula",
  "listBenefitFormulaVersions",
  "createBenefitFormulaVersion",
  "getBenefitFormulaVersion",
  "listBenefitCalculations",
  "createBenefitCalculation",
  "validateBenefitFormulaVersion",
];
/** The 18 P4 slice A operations of T-DG4-KBE-B (ADR-0027 §1-§5, §9; requestKpiVersionApproval is still pending). */
const KPI_P4_KBE_B_OPERATIONS = [
  "listKpiDictionary",
  "getKpiDictionaryEntry",
  "listKpiVersions",
  "createKpiVersion",
  "getKpiVersion",
  "updateKpiVersion",
  "activateKpiVersion",
  "withdrawKpiVersion",
  "listKpiRagThresholds",
  "createKpiRagThreshold",
  "listTargetTrajectories",
  "createTargetTrajectory",
  "getTargetTrajectory",
  "approveTargetTrajectory",
  "withdrawTargetTrajectory",
  "listDataQualityFindings",
  "getDataQualityFinding",
  "resolveDataQualityFinding",
];
/** The P4 slice A operations of T-DG4-KBE-C (ADR-0027 §2-§3, §6-§8, §10; requestKpiVersionApproval carried by D-095). */
const KPI_P4_KBE_C_OPERATIONS = [
  "requestKpiVersionApproval",
  "listReportingPeriods",
  "createReportingPeriod",
  "getReportingPeriod",
  "openReportingPeriod",
  "closeReportingPeriod",
  "listKpiActuals",
  "submitKpiActual",
  "getKpiActual",
  "addKpiActualValue",
  "submitKpiActualDraft",
  "acceptKpiActual",
  "rejectKpiActual",
  "listKpiActualReviewQueue",
  "listCalculationRuns",
  "getCalculationRun",
  "listKpiStatus",
  "getKpiStatus",
  "listRagOverrides",
  "createRagOverride",
  "revokeRagOverride",
];
/**
 * Routes whose permission the contract summary does not name in parentheses (T-DG3-KBE-C): the B0087 examples are a
 * global catalogue read with no 403 in the contract ("authenticated", like GET /dependency-types), and the formula
 * check writes nothing but declares 403, so it needs benefit_formula.edit held somewhere.
 */
const PERMISSION_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["listBenefitFormulaExamples", "authenticated"],
  ["checkBenefitFormula", "benefit_formula.edit"],
  // P4 reporting periods (T-DG4-KBE-C): organization-level records, read with organization.read (contract summary).
  ["listReportingPeriods", "organization.read"],
  ["getReportingPeriod", "organization.read"],
]);

const openapi = parseYaml(
  readFileSync(fileURLToPath(new URL("../../../../../docs/api/openapi.yaml", import.meta.url)), "utf8"),
) as { paths: Record<string, Record<string, { operationId?: string; summary?: string }>> };

const contractOps = Object.entries(openapi.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([m]) => ["get", "post", "patch", "put", "delete"].includes(m))
    .map(([m, op]) => ({ key: `${m.toUpperCase()} ${path}`, operationId: op.operationId!, summary: op.summary ?? "" })),
);

async function registered() {
  const app = Fastify({ logger: false });
  const routes: { key: string; permission: unknown }[] = [];
  app.addHook("onRoute", (r) => {
    if (r.method === "HEAD") return;
    routes.push({
      key: `${String(r.method)} ${r.url.replace(/:([A-Za-z]+)/g, "{$1}")}`,
      permission: (r.config as { access?: { permission?: unknown } } | undefined)?.access?.permission,
    });
  });
  // Registration only declares routes; no query runs until a request arrives.
  const registration = mod.registerKpiModule(app, { db: {}, config: {} } as unknown as ModuleDeps);
  await app.ready();
  await app.close();
  return { routes, registration };
}

describe("kpi module (P2)", () => {
  it("is mapped with its declared dependency direction", () => {
    expect(P1_MODULES).toContain("kpi");
    // P4 (T-DG4-BE-A, modules.ts): + organization (business dates in the calendar timezone) and tasks (owner tasks).
    expect([...API_MODULES.kpi.dependsOn].sort()).toEqual([
      "access",
      "audit",
      "methodology",
      "organization",
      "platform",
      "tasks",
      "transformations",
    ]);
  });

  it("exposes exactly its wiring hook, the gate-facts loader, the freshness vocabulary and the P4 seams", () => {
    expect(moduleFiles("kpi")).toContain("index.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "VALUE_FRESHNESS",
      // P3 business cases (T-DG3-KBE-B): read helpers for KBE-C's G4 fact loader.
      "activeLinesOf",
      "baselineSha256",
      "baselineValidationState",
      // P3 T09 benefit formulas (T-DG3-KBE-C): the kpi half of the G4 GateFactsProvider.
      "buildKpiP3GateFacts",
      "computeTotals",
      "includedCaseIds",
      "loadCaseTotals",
      "loadKpiGateFacts",
      "loadKpiP3GateFacts",
      "missingSections",
      "presentCases",
      // P4 (T-DG4-KBE-C): slice B's downstream-impact seam (KBE-E registers its provider).
      "registerDownstreamImpactProvider",
      "registerKpiModule",
      "toBusinessCaseLine",
    ]);
    expect(typeof mod.loadKpiGateFacts).toBe("function");
    expect(mod.loadKpiGateFacts.length).toBe(2); // (db, transformationId)
    expect(mod.loadKpiP3GateFacts.length).toBe(2); // (db, transformationId): the GateFactsProvider `kpi` signature
  });

  it("models missing and outdated values as unknown / stale - never as zero or green", () => {
    expect(mod.VALUE_FRESHNESS).toEqual(["unknown", "stale", "current"]);
  });

  it("registers exactly the 24 P2 kpi operations, the 11 P3 business-case, the 13 T09, the 18 P4 KBE-B and the P4 KBE-C operations, and reports them", async () => {
    const { routes, registration } = await registered();
    const byKey = new Map(contractOps.map((o) => [o.key, o.operationId]));
    const ids = routes.map((r) => byKey.get(r.key));
    expect(ids.filter((id) => id === undefined)).toEqual([]);
    expect([...ids].sort()).toEqual(
      [
        ...KPI_OPERATIONS,
        ...KPI_P3_BUSINESS_CASE_OPERATIONS,
        ...KPI_P3_BENEFIT_FORMULA_OPERATIONS,
        ...KPI_P4_KBE_B_OPERATIONS,
        ...KPI_P4_KBE_C_OPERATIONS,
      ].sort(),
    );
    expect(registration.module).toBe("kpi");
    expect(registration.status).toBe("active");
    expect(registration.routes).toHaveLength(48 + KPI_P4_KBE_B_OPERATIONS.length + KPI_P4_KBE_C_OPERATIONS.length);
    expect(Object.isFrozen(registration)).toBe(true);
  });

  it("declares the contract's permission on every route: reads transformation.read, writes the named right", async () => {
    const { routes } = await registered();
    const byKey = new Map(contractOps.map((o) => [o.key, o]));
    for (const r of routes) {
      const op = byKey.get(r.key)!;
      if (PERMISSION_EXCEPTIONS.has(op.operationId)) {
        expect(r.permission, op.operationId).toBe(PERMISSION_EXCEPTIONS.get(op.operationId));
        continue;
      }
      if (r.key.startsWith("GET ")) {
        expect(r.permission, r.key).toBe("transformation.read");
        continue;
      }
      // The contract summary names the right in parentheses, e.g. "Create (baseline.edit)".
      const named = /\(([a-z_]+\.[a-z_]+)/.exec(op.summary)?.[1];
      expect(named, `${op.operationId} summary names a permission`).toBeDefined();
      expect(r.permission, op.operationId).toBe(named);
    }
    const writes = routes.filter((r) => !r.key.startsWith("GET ")).map((r) => r.permission);
    expect(new Set(writes)).toEqual(
      new Set([
        "kpi_definition.edit",
        "baseline.edit",
        "outcome.edit",
        "diagnostic.edit",
        "finance.validate",
        "kpi_target.approve",
        "business_case.edit",
        "benefit_formula.edit",
        // P4 slice A (T-DG4-KBE-B).
        "kpi_version.edit",
        "kpi_version.activate",
        "kpi_threshold.configure",
        "target_trajectory.edit",
        "data_quality.manage",
        // P4 slice A (T-DG4-KBE-C).
        "reporting_period.manage",
        "kpi_actual.submit",
        "kpi_actual.accept",
        "rag.override",
      ]),
    );
  });

  it(
    "its declared boundary holds, and a planted bypass or undeclared dependency would be caught",
    () => {
      expect(moduleViolations("kpi")).toEqual([]);
      const plant = (source: string) =>
        fileViolations("kpi", join(MODULES_DIR, "kpi", "planted.ts"), source).join("\n");
      expect(plant(`const r = createRequire(import.meta.url)("../transformations/routes.ts");`)).toMatch(
        /createRequire/, // a regex: the string literal "createRequire" is itself banned in module source (F-DG1-124)
      );
      expect(plant(`import { WORKFLOWS_MODULE } from "../workflows/index.ts";`)).toContain(
        "module kpi may not import module workflows",
      );
    },
    AST_TEST_TIMEOUT_MS,
  ); // F-DG2-143: AST walk of the module sources gets explicit headroom.
});

describe("never a float (ADR-0019 §4): no amount is converted to a JavaScript number", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const sources = [
    ...readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(dir, f)),
    fileURLToPath(new URL("../../../../../packages/shared/src/value.ts", import.meta.url)),
    fileURLToPath(new URL("../../../../../packages/shared/src/schemas/kpi.ts", import.meta.url)),
  ];
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");

  it.each(sources.map((f) => [f.split("/").slice(-2).join("/"), f]))("%s", (_name, file) => {
    const src = code(file);
    expect(src).not.toMatch(/parseFloat|toNumber\(|valueOf\(/);
    // Number(...) and unary plus on a value: only `Number.parseInt` of date parts (schemas/kpi.ts) is allowed.
    expect(src).not.toMatch(/(^|[^.\w])Number\(/);
    expect(src).not.toMatch(/[=(,:]\s*\+\s*[a-zA-Z_(]/);
    // Amount columns are never typed or coerced as numbers in a zod schema.
    expect(src).not.toMatch(/(amount|value|Amount|Value)\s*:\s*z\.(number|coerce)/);
  });
});
