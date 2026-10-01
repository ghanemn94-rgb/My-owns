// Module dependency-lint (ADR-0002), shared by architecture.test.ts and every module's own suite (D-048). Test-only:
// excluded from the build (tsconfig.build.json `*.testkit.ts`) and never imported by runtime code.
//
// It walks the TypeScript AST of each file (F-DG1-109: `ts.preProcessFile` saw only literal specifiers) and reports:
//  - every static import / export-from / `import x = require()` / type-only import specifier, and every
//    `import("...")` / `require("...")` with a string-literal specifier - each checked against the module boundary;
//  - a computed `import(expr)` / `require(expr)` (the target cannot be checked);
//  - DEFAULT-DENY for Node built-ins (D-055; F-DG1-129/213, F-DG1-010): a `node:` specifier is allowed only when it
//    is in SAFE_NODE_BUILTINS (the small set module source legitimately uses); every other built-in - module, vm,
//    worker_threads, inspector, repl, child_process, cluster, process, sqlite, test, wasi, v8, net, http, ... and any
//    built-in a later Node version adds - is a violation. A bare built-in name without `node:` (`"fs"`) is not a
//    dependency of @mth/api and stays a violation as before.
//
// F-DG1-124 - BLANKET BAN of the dynamic-code-loading primitives in module source. F-DG1-117 and F-DG1-121 matched
// ever more spellings of the same thing (`.constructor()`, aliased `.constructor`, destructured `constructor`, ...)
// and a constructed key (`f["constr" + "uctor"]`, `Reflect.get(fn, "constr".concat("uctor"))`) still got through.
// P1 module code has no legitimate need to load or evaluate code at runtime, so instead of recognising patterns the
// lint now forbids the building blocks themselves; every way to reach a primitive needs one of them:
//  1. BANNED NAMES, in EVERY syntactic form outside type positions - identifier, `.member`, `["key"]`, string
//     literal anywhere (`Reflect.get(fn, "constructor")`), object/destructuring key, import/export name:
//     code evaluation  eval, Function, AsyncFunction, GeneratorFunction, AsyncGeneratorFunction, constructor
//     module loaders   require, createRequire, getBuiltinModule, mainModule, _load
//     reflection       Reflect, getPrototypeOf, __proto__, getOwnPropertyDescriptor(s), getOwnPropertyNames,
//                      __lookupGetter__, __lookupSetter__ (they read a property by a runtime name, or expose the
//                      prototype / non-enumerable keys where `constructor` lives).
//     A class's own `constructor() {}` declaration has no name node and stays legal; so do type positions
//     (`interface I { constructor: string }`, `typeof Reflect`).
//  2. UNCHECKABLE KEYS: a computed member `x[k]` or computed property name `{ [k]: v }` / `{ [k]: v } = x` whose key
//     is not a string/number literal or a numeric-by-construction expression (`a.length - 1`, `-i`, `i * 2`). A
//     constructed key can spell any banned name, so the key itself is the violation. Dictionary lookups use a `Map`
//     (a Map returns only what was put in it and never reaches the prototype chain).
//  3. RUNTIME ROOTS `process`, `globalThis`, `global`: used other than as `root.member` (aliased, passed,
//     destructured), indexed at all (`process["x"]`), `globalThis.<root|primitive>`; the CommonJS free variable
//     `module` as a value; and DEFAULT-DENY for `process.<member>` (D-055): only the members in SAFE_PROCESS_MEMBERS
//     are allowed. Everything else - kill, _kill, _debugProcess (both start the in-process V8 inspector, F-DG1-129 /
//     F-DG1-213), execve, binding, _linkedBinding, dlopen, getBuiltinModule, abort, reallyExit, ... and any member a
//     later Node version adds - is a violation.
//     Rule 3 covers the GLOBAL `process`; an IMPORTED process object (`import p from "node:process"`, a namespace or
//     a named `{ dlopen }` import) is closed by the specifier check instead (`node:process` is not allow-listed).
//  4. FAIL CLOSED: a file with a syntax error is a violation (the AST the rules see would not be the code written).
// Both built-in checks are allow-lists, not enumerations of known-bad routes, so they do not depend on the Node
// version the lint runs on (production targets Node 24, the supported floor is Node 22.18+): a new built-in or
// `process` member is denied until someone deliberately reviews it and adds it here. Nothing is executed.
// Residual limits (stated and ACCEPTED, not closable statically):
//  (a) runtime DATA FLOW: a string computed at runtime and handed to third-party code that itself reads
//      `input[key]` (e.g. a schema library given `Object.fromEntries([[k, ...]])`); rules 1-2 remove every syntactic
//      route inside module source.
//  (b) F-DG1-127: runtime code GENERATION followed by a dynamic import of a literal same-module path (an allowed
//      built-in such as `node:fs` writes a file, then `import("./local.mjs")`): the specifier is a legal own-module
//      path and the bytes exist only at runtime, so the lint never sees them. Irreducible for a static lint;
//      `node:fs` stays allowed (a module may legitimately read files; a write-API-only ban would be brittle).
//  (c) `WebAssembly` global instantiation (a wasm exec, not a JS-module loader).
// Rationale: this is static defence-in-depth for the ADR-0002 module boundaries, enforced against human-reviewed code
// that runs with a read-only production source tree; it is NOT a runtime security boundary.
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
/**
 * D-055 DEFAULT-DENY allow-list of `node:` built-ins (without the prefix) that module source may import. Seeded from
 * what module source imports (crypto, fs, path, url) plus the read/utility built-ins fs/promises, os and util. None of
 * them loads, evaluates or executes code, opens a debugger, or loads native objects. NEVER add a code-loading, exec,
 * native or debug built-in (module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test,
 * wasi, v8, net, http, https, dgram, async_hooks, ...): those routes were closed one by one by F-DG1-109/117/125/127/128
 * and are now denied by default. Network I/O belongs to the composition root, not module source.
 */
const SAFE_NODE_BUILTINS: ReadonlySet<string> = new Set(["crypto", "fs", "fs/promises", "os", "path", "url", "util"]);
/** F-DG1-124: dynamic-code primitives, banned in every syntactic form (rule 1), by the kind of bypass they give. */
const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
  ...["eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "constructor"].map(
    (n) => [n, "code evaluation"] as const,
  ),
  ...["require", "createRequire", "getBuiltinModule", "mainModule", "_load"].map((n) => [n, "module loader"] as const),
  ...[
    "Reflect",
    "getPrototypeOf",
    "__proto__",
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
    "getOwnPropertyNames",
    "__lookupGetter__",
    "__lookupSetter__",
  ].map((n) => [n, "reflection"] as const),
]);
/** Global objects through which the runtime (and its loaders) can be reached. */
const RUNTIME_ROOTS = new Set(["process", "globalThis", "global"]);
/**
 * D-055 DEFAULT-DENY allow-list of members of the global `process` that module source may use (rule 3): reading the
 * environment and arguments, and the lifecycle calls exit/once. NEVER add kill, _kill, _debugProcess, _debugEnd,
 * execve, binding, _linkedBinding, dlopen, getBuiltinModule, abort, reallyExit, setSourceMapsEnabled, ... (signal /
 * debugger / exec / native-loader routes, F-DG1-125/128/129/213).
 */
const SAFE_PROCESS_MEMBERS: ReadonlySet<string> = new Set(["env", "exit", "argv", "once"]);
/** Binary operators whose result is always a number/bigint, so the key can never spell a property name. */
const NUMERIC_OPERATORS = new Set([
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
]);
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
  if (spec.startsWith("node:")) return SAFE_NODE_BUILTINS.has(spec.slice("node:".length));
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

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/**
 * Rule 2: a key the lint can read - a string/number literal (its text is then checked by rule 1), or an expression
 * that is numeric by construction (`a.length - 1`, `-i`, `i++`). Only parentheses are looked through: a type
 * assertion (`k as "a"`) can lie about the value, so it does not make a key static.
 */
function isStaticKey(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isStaticKey(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) return true;
  if (ts.isPrefixUnaryExpression(node)) return node.operator !== ts.SyntaxKind.ExclamationToken;
  if (ts.isPostfixUnaryExpression(node)) return true;
  return ts.isBinaryExpression(node) && NUMERIC_OPERATORS.has(node.operatorToken.kind);
}

/** True for nodes whose subtree is type space only (erased at runtime): types, interfaces, type aliases. */
function isTypeSpace(node: ts.Node): boolean {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return true;
  // `class C extends Base {}`: ExpressionWithTypeArguments is a TypeNode, but a class heritage is a runtime value.
  if (ts.isExpressionWithTypeArguments(node)) return !ts.isClassLike(node.parent.parent);
  return ts.isTypeNode(node);
}

/** How an occurrence of a banned name reaches it, for the violation message. */
function occurrence(node: ts.Identifier | ts.PrivateIdentifier | ts.StringLiteralLike): string {
  const name = node.text;
  const p = node.parent;
  if (ts.isStringLiteralLike(node)) {
    if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return `["${name}"]`;
    // A string key: `{ "constructor": F } = fn`, `const { ["constructor"]: F } = fn`.
    const key: ts.Node = ts.isComputedPropertyName(p) ? p : node;
    const owner = key.parent;
    if (ts.isBindingElement(owner) && owner.propertyName === key) return `a destructured ${name}`;
    if (ts.isPropertyAssignment(owner) && owner.name === key) return `${name} as an object key`;
    return `the "${name}" key as a value`;
  }
  if (ts.isPropertyAccessExpression(p) && p.name === node) {
    const called = (ts.isCallExpression(p.parent) || ts.isNewExpression(p.parent)) && p.parent.expression === p;
    return `.${name}${called ? "()" : " (aliased)"}`;
  }
  if (ts.isBindingElement(p)) return `a destructured ${name}`;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isShorthandPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p)) &&
    p.name === node
  )
    return `${name} as an object key`;
  return name;
}

/** Parse `source` (as if it were `fileName`) and collect what it loads. */
export function scanSource(fileName: string, source: string): ScanResult {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const evasions: string[] = [];
  const at = (n: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

  /** Specifiers (checked against the boundary) are collected everywhere, types included: `import("x").T`. */
  const collect = (node: ts.Node): void => {
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
  };

  /** True for a string literal that names a module (import/export/require/import() specifier, import-type). */
  const isSpecifierLiteral = (node: ts.Node): boolean => {
    const p = node.parent;
    return (
      ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) ||
      ts.isExternalModuleReference(p) ||
      (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword && p.arguments[0] === node)
    );
  };

  const visit = (node: ts.Node, inType: boolean): void => {
    collect(node);
    const typeOnly = inType || isTypeSpace(node);
    if (!typeOnly) {
      // Rule 1: a banned name in any syntactic form (identifier, member, key, import/export name, string literal).
      if (
        ts.isIdentifier(node) ||
        ts.isPrivateIdentifier(node) ||
        (ts.isStringLiteralLike(node) && !isSpecifierLiteral(node))
      ) {
        const kind = BANNED_PRIMITIVES.get(node.text);
        if (kind !== undefined) evasions.push(`${kind} via ${occurrence(node)} (${at(node)})`);
      }
      // Rule 2: a key the lint cannot read can spell any banned name.
      if (ts.isElementAccessExpression(node)) {
        const root = rootName(node.expression);
        if (root !== null) evasions.push(`computed member of ${root} (${at(node)})`);
        if (!isStaticKey(node.argumentExpression))
          evasions.push(`computed member with a non-literal key (${at(node)})`);
      }
      if (ts.isComputedPropertyName(node) && !isStaticKey(node.expression))
        evasions.push(`computed property name with a non-literal key (${at(node)})`);
      // Rule 3: runtime roots.
      if (ts.isPropertyAccessExpression(node)) {
        const root = rootName(node.expression);
        const name = node.name.text;
        if ((root === "globalThis" || root === "global") && (RUNTIME_ROOTS.has(name) || name === "module"))
          evasions.push(`${root}.${name} (${at(node)})`);
        if (root === "process" && !SAFE_PROCESS_MEMBERS.has(name))
          evasions.push(`non-allow-listed process.${name} member (${at(node)})`);
      }
      if (ts.isIdentifier(node) && isValueReference(node)) {
        if (node.text === "module") evasions.push(`module used as a value (${at(node)})`);
        if (RUNTIME_ROOTS.has(node.text)) {
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
    }
    ts.forEachChild(node, (child) => visit(child, typeOnly));
  };
  visit(sf, false);
  return { specifiers, evasions: [...new Set(evasions)] };
}

/**
 * Rule 4, fail closed: syntax errors in a module file. On a syntax error the parser's recovery can turn code into
 * something else (`(async () => {} as any)[k]` reads `[k]` as a binding pattern), so the rules would inspect a
 * different program from the one written. Syntactic diagnostics only (no type check, nothing executed).
 */
function syntaxErrors(fileName: string, source: string): string[] {
  const { diagnostics = [] } = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve },
  });
  return diagnostics
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      return `unparseable source: ${ts.flattenDiagnosticMessageText(d.messageText, " ")} (line ${line})`;
    });
}

/** Violations of `mod`'s declared boundary by one file (path inside src/modules/<mod>/), given its source text. */
export function fileViolations(mod: ApiModule, file: string, source: string): string[] {
  const violations: string[] = [];
  const where = relative(SRC, file);
  const isTest = file.endsWith(".test.ts");
  const allowedDeps = new Set<string>(API_MODULES[mod].dependsOn);
  const { specifiers, evasions } = scanSource(file, source);
  for (const e of [...syntaxErrors(file, source), ...evasions])
    violations.push(`${where}: ${e} bypasses the module-interface check`);
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
      violations.push(
        spec.startsWith("node:")
          ? `${where}: imports non-allow-listed node built-in ${spec}`
          : `${where}: imports package ${spec}`,
      );
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
