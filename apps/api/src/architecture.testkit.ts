// Module dependency-lint (ADR-0002), shared by architecture.test.ts and every module's own suite (D-048). Test-only:
// excluded from the build (tsconfig.build.json `*.testkit.ts`) and never imported by runtime code.
//
// It walks the TypeScript AST of each file (F-DG1-109: `ts.preProcessFile` saw only literal specifiers) and reports:
//  - every static import / export-from / `import x = require()` / type-only import specifier;
//  - every `import("...")` and `require("...")` with a string-literal specifier (template literal without
//    substitutions included) - checked like a static import;
//  - as violations in their own right: a computed `import(expr)` or `require(expr)` (the target cannot be checked),
//    any use of `createRequire` (it builds an unchecked `require`), and any import of `module` / `node:module`.
//  - F-DG1-117, obfuscated loaders (still a purely static check; nothing is executed):
//     - the loader names `createRequire`, `getBuiltinModule`, `mainModule`, `_load` as identifiers, property names or
//       string member keys (so `x["getBuiltinModule"]` is caught too);
//     - a computed member of the runtime roots `process`, `globalThis`, `global` (`process["get" + "BuiltinModule"]`);
//     - a runtime root used other than as `root.member` (aliased, passed, destructured: `const p = process`), and
//       `globalThis.process` / `.Function` / `.eval` / `.require`;
//     - code evaluation: `Function` / `eval` in any value position (`new Function("return import(s)")`), and
//       `.constructor(...)` / `new x.constructor(...)` / `x["constructor"]` (e.g. the AsyncFunction constructor);
//     - F-DG1-121, the same constructor reached WITHOUT calling `.constructor` directly: any value use of a
//       `.constructor` member (`const C = (async () => {}).constructor; C(...)`, `Reflect.construct(f.constructor,
//       ...)`, `Object.getPrototypeOf(async function () {}).constructor`), a `constructor` key in a destructuring
//       binding or assignment pattern (`const { constructor: F } = fn`, `({ constructor } = fn)`, string or computed
//       key), and the string "constructor" as a value (`Reflect.get(fn, "constructor")`). Whether the receiver is a
//       function (async / generator / async generator) cannot be known statically, so every such use is reported;
//       a class's own `constructor() {}` declaration is not a use and stays clean.
//     - the built-ins that evaluate code: `vm`, `worker_threads` (with or without `node:`).
//    Data flow through third-party code cannot be followed statically; the rules close every syntactic route.
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
const LOADER_BUILTINS = new Set(["module", "node:module", "vm", "node:vm", "worker_threads", "node:worker_threads"]);
/** Names that reach a module loader at runtime (F-DG1-109, F-DG1-117). */
const LOADER_NAMES = new Set(["createRequire", "getBuiltinModule", "mainModule", "_load"]);
/** Global objects through which the runtime (and its loaders) can be reached by computed members. */
const RUNTIME_ROOTS = new Set(["process", "globalThis", "global"]);
/** Globals that evaluate a string as code - and can therefore contain an unchecked import(). */
const CODE_EVALUATORS = new Set(["Function", "eval"]);
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

/** Strips parentheses and type-only wrappers: `(process as any)` is still `process`. */
function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isTypeAssertionExpression(n) ||
    ts.isSatisfiesExpression(n)
  )
    n = n.expression;
  return n;
}

const rootName = (node: ts.Expression): string | null => {
  const n = unwrap(node);
  return ts.isIdentifier(n) && RUNTIME_ROOTS.has(n.text) ? n.text : null;
};

/** True when `node` is an identifier in a VALUE position (not a property/member name, label or type). */
function isValueReference(node: ts.Identifier): boolean {
  const p = node.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return false;
  // Type positions: `typeof process.env`, `x: Function` (a QualifiedName occurs only inside types/namespaces).
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) return false;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p)) &&
    p.name === node
  )
    return false;
  if (ts.isBindingElement(p) && p.propertyName === node) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isLabeledStatement(p)) return false;
  if (ts.isBreakOrContinueStatement(p)) return false;
  return true;
}

/** True for a property name `constructor`, `"constructor"` or `["constructor"]` (in a pattern or object literal). */
function isConstructorKey(name: ts.Node | undefined): boolean {
  if (!name) return false;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
    return name.text === "constructor";
  if (ts.isComputedPropertyName(name)) return literalText(unwrap(name.expression)) === "constructor";
  return false;
}

/** True when the object literal is (nested in) the target of a destructuring assignment: `({ a } = x)`, `for ({ a } of xs)`. */
function inAssignmentPattern(literal: ts.Node): boolean {
  let n: ts.Node = literal;
  while (
    ts.isParenthesizedExpression(n.parent) ||
    ts.isArrayLiteralExpression(n.parent) ||
    ts.isObjectLiteralExpression(n.parent) ||
    ts.isPropertyAssignment(n.parent) ||
    ts.isSpreadElement(n.parent) ||
    ts.isSpreadAssignment(n.parent)
  )
    n = n.parent;
  const p = n.parent;
  return (
    (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.left === n) ||
    ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === n)
  );
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
    // Loader names as identifiers or property names (F-DG1-109, F-DG1-117); as string keys below.
    if (ts.isIdentifier(node) && LOADER_NAMES.has(node.text)) evasions.push(`${node.text} (${at(node)})`);
    if (ts.isElementAccessExpression(node)) {
      const root = rootName(node.expression);
      if (root !== null) evasions.push(`computed member of ${root} (${at(node)})`);
      const key = literalText(node.argumentExpression);
      if (key !== null && LOADER_NAMES.has(key)) evasions.push(`${key} (${at(node)})`);
      if (key !== null && (CODE_EVALUATORS.has(key) || key === "constructor"))
        evasions.push(`code evaluation via ["${key}"] (${at(node)})`);
    } else if (ts.isPropertyAccessExpression(node)) {
      const root = rootName(node.expression);
      if (root === "globalThis" || root === "global") {
        const name = node.name.text;
        if (RUNTIME_ROOTS.has(name) || CODE_EVALUATORS.has(name) || name === "require" || name === "module")
          evasions.push(`${root}.${name} (${at(node)})`);
      }
      if (node.name.text === "constructor") {
        const called =
          (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) && node.parent.expression === node;
        // F-DG1-121: an aliased/passed `.constructor` is the same Function/AsyncFunction/GeneratorFunction constructor.
        evasions.push(`code evaluation via .constructor${called ? "()" : " (aliased)"} (${at(node)})`);
      }
    } else if (ts.isIdentifier(node) && isValueReference(node)) {
      if (CODE_EVALUATORS.has(node.text)) {
        evasions.push(`code evaluation via ${node.text} (${at(node)})`);
      } else if (RUNTIME_ROOTS.has(node.text)) {
        // `process.env` / `(process as X).y` are member uses; anything else hands the runtime root on (an alias).
        let up: ts.Node = node;
        while (
          ts.isParenthesizedExpression(up.parent) ||
          ts.isAsExpression(up.parent) ||
          ts.isNonNullExpression(up.parent) ||
          ts.isTypeAssertionExpression(up.parent) ||
          ts.isSatisfiesExpression(up.parent)
        )
          up = up.parent;
        const wrappedMemberUse =
          (ts.isPropertyAccessExpression(up.parent) || ts.isElementAccessExpression(up.parent)) &&
          up.parent.expression === up;
        if (!wrappedMemberUse) evasions.push(`${node.text} used as a value (${at(node)})`);
      }
    }
    // F-DG1-121: the constructor taken out by destructuring (binding or assignment pattern; plain, string or
    // computed key; shorthand) - `const { constructor: F } = fn`, `({ constructor: F } = fn)`, `const { constructor } = fn`.
    if (
      (ts.isBindingElement(node) && isConstructorKey(node.propertyName ?? node.name)) ||
      ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        isConstructorKey(node.name) &&
        inAssignmentPattern(node.parent))
    )
      evasions.push(`code evaluation via a destructured constructor (${at(node)})`);
    // F-DG1-121: the key as a string value - `Reflect.get(fn, "constructor")`, `getOwnPropertyDescriptor(p, "constructor")`.
    // (Element-access keys are reported above already; literal types and import specifiers are not values.)
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === "constructor" &&
      !(ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) &&
      !ts.isComputedPropertyName(node.parent) &&
      !(ts.isBindingElement(node.parent) || ts.isPropertyAssignment(node.parent)) &&
      !ts.isLiteralTypeNode(node.parent)
    )
      evasions.push(`code evaluation via the "constructor" key as a value (${at(node)})`);
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
