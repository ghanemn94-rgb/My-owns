// Module dependency-lint (ADR-0002), shared by architecture.test.ts and every module's own suite (D-048). Test-only:
// excluded from the build (tsconfig.build.json `*.testkit.ts`) and never imported by runtime code.
//
// It walks the TypeScript AST of each file (F-DG1-109: `ts.preProcessFile` saw only literal specifiers) and reports:
//  - every static import / export-from / `import x = require()` / type-only import specifier;
//  - every `import("...")` and `require("...")` with a string-literal specifier (template literal without
//    substitutions included) - checked like a static import;
//  - as violations in their own right: a computed `import(expr)` or `require(expr)` (the target cannot be checked),
//    any use of `createRequire` (it builds an unchecked `require`), and any import of `module` / `node:module`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { API_MODULES, type ApiModule } from "./modules.ts";

export const SRC = dirname(fileURLToPath(import.meta.url));
export const MODULES_DIR = join(SRC, "modules");

const apiPkg = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const THIRD_PARTY = new Set(Object.keys(apiPkg.dependencies).filter((d) => !d.startsWith("@mth/")));
const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db"]);
/** Built-ins that hand out an unchecked loader; a module never needs them. */
const LOADER_BUILTINS = new Set(["module", "node:module"]);
/** Composition-root files a module's OWN TEST may read: the declarative module map and this lint (D-048). */
const TEST_SUPPORT_FILES = new Set(["modules.ts", "architecture.testkit.ts"]);

export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

export function bareAllowed(spec: string): boolean {
  if (LOADER_BUILTINS.has(spec)) return false;
  if (spec.startsWith("node:")) return true;
  if (SHARED_ALLOWED.has(spec)) return true;
  const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
  return THIRD_PARTY.has(pkg);
}

export interface ScanResult {
  /** Specifiers the file loads (static, dynamic-literal, require-literal, re-export, type-only). */
  readonly specifiers: readonly string[];
  /** Constructs that evade the specifier check, described for the violation message. */
  readonly evasions: readonly string[];
}

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Parse `source` (as if it were `fileName`) and collect what it loads. */
export function scanSource(fileName: string, source: string): ScanResult {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const evasions: string[] = [];
  const at = (n: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const spec = literalText(node.moduleSpecifier);
      if (spec !== null) specifiers.push(spec);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const spec = literalText(node.moduleReference.expression);
      if (spec !== null) specifiers.push(spec);
      else evasions.push(`computed import-equals require (${at(node)})`);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const spec = literalText(node.argument.literal);
      if (spec !== null) specifiers.push(spec);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = literalText(node.arguments[0]);
        if (spec !== null) specifiers.push(spec);
        else evasions.push(`computed import() specifier (${at(node)})`);
      } else if (ts.isIdentifier(callee) && callee.text === "require") {
        const spec = literalText(node.arguments[0]);
        if (spec !== null) specifiers.push(spec);
        else evasions.push(`computed require() specifier (${at(node)})`);
      }
    }
    if (
      (ts.isIdentifier(node) && node.text === "createRequire") ||
      (ts.isPropertyAccessExpression(node) && node.name.text === "createRequire")
    ) {
      if (!(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node))
        evasions.push(`createRequire (${at(node)})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { specifiers, evasions: [...new Set(evasions)] };
}

/** Violations of `mod`'s declared boundary by one file (path inside src/modules/<mod>/), given its source text. */
export function fileViolations(mod: ApiModule, file: string, source: string): string[] {
  const violations: string[] = [];
  const where = relative(SRC, file);
  const isTest = file.endsWith(".test.ts");
  const allowedDeps = new Set<string>(API_MODULES[mod].dependsOn);
  const { specifiers, evasions } = scanSource(file, source);
  for (const e of evasions) violations.push(`${where}: ${e} bypasses the module-interface check`);
  for (const spec of specifiers) {
    if (spec.startsWith(".")) {
      const target = resolve(dirname(file), spec);
      const rel = relative(MODULES_DIR, target);
      if (rel.startsWith("..")) {
        if (isTest && TEST_SUPPORT_FILES.has(relative(SRC, target))) continue;
        violations.push(`${where}: imports ${spec} outside src/modules (composition root)`);
        continue;
      }
      const [targetMod, ...rest] = rel.split("/");
      if (targetMod === mod) continue;
      if (!allowedDeps.has(targetMod!)) violations.push(`${where}: module ${mod} may not import module ${targetMod}`);
      else if (rest.join("/") !== "index.ts")
        violations.push(`${where}: imports ${spec}; only ${targetMod}/index.ts is public`);
    } else if (!bareAllowed(spec) && !(spec === "vitest" && isTest)) {
      violations.push(`${where}: imports package ${spec}`);
    }
  }
  return violations;
}

/** Every violation of `mod`'s declared boundary across its directory. */
export function moduleViolations(mod: ApiModule): string[] {
  return walk(join(MODULES_DIR, mod)).flatMap((file) => fileViolations(mod, file, readFileSync(file, "utf8")));
}

/** Files of a module, for "exists with its own suite" checks. */
export function moduleFiles(mod: ApiModule): string[] {
  return walk(join(MODULES_DIR, mod)).map((f) => relative(join(MODULES_DIR, mod), f));
}

/** Specifiers of a file on disk (package-direction checks outside src/modules). */
export function importsOf(file: string): string[] {
  return [...scanSource(file, readFileSync(file, "utf8")).specifiers];
}
