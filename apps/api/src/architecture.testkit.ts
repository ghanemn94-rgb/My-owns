// Module dependency-lint (ADR-0002), shared by architecture.test.ts and every module's own suite (D-048). Test-only:
// excluded from the build (tsconfig.build.json `*.testkit.ts`) and never imported by runtime code.
//
// FILE SCOPE (F-DG1-134): walk() collects EVERY buildable JS/TS module file, `/\.[cm]?[jt]sx?$/` (.ts .tsx .mts .cts
// .js .jsx .mjs .cjs), so no module code evades the lint by its extension (a `.mts` file typechecks and ships in dist as
// `.mjs`). All of them get the same rules 1-5 and boundary checks; `.tsx`/`.jsx` are parsed as TSX, the rest as TS (a
// superset of JS).
// TEST CLASSIFICATION (F-DG1-135): the test-only allowances (importing `modules.ts`/`architecture.testkit.ts`, and
// `vitest`) apply ONLY to `*.test.ts`/`*.test.tsx` (TEST_FILE) - exactly the test extensions tsconfig.build.json
// excludes. Any other test-looking file (`*.test.mts`, `*.test.js`, ...) is not run by vitest and ships in dist, so it
// is a NON-test module file: still scanned by walk(), with the full boundary rules and no test exemption.
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
//  1. BANNED NAMES, in every SPELLED form outside type positions - identifier, `.member`, `["key"]`, string
//     literal anywhere (`Reflect.get(fn, "constructor")`), object/destructuring key, import/export name, unicode
//     escape, namespace member `ns.name` (a name that is never written is not statically visible; for the one
//     banned MEMBER of an allow-listed built-in, `crypto.setEngine`, the enumeration route is closed by rule 5):
//     code evaluation  eval, Function, AsyncFunction, GeneratorFunction, AsyncGeneratorFunction, constructor
//     module loaders   require, createRequire, getBuiltinModule, mainModule, _load
//     native loader    setEngine (F-DG1-130: `crypto.setEngine(path)` dlopen()s an arbitrary shared object, whose
//                      ELF constructor runs before the call throws - a member of the allow-listed `node:crypto`)
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
//  5. NAMED IMPORTS ONLY for an allow-listed built-in that carries a rule-1-banned member (NAMESPACE_RESTRICTED_BUILTINS,
//     today only `node:crypto`, because of `setEngine`; F-DG1-132/133). Without a namespace or default binding the
//     module object never becomes a value in module source, so it cannot be enumerated (`Object.entries(c)`,
//     `Object.values(c).find(...)`, `new Map(Object.entries(c)).get(runtimeKey)`) to reach the banned member without
//     spelling it. Flagged: `import * as c`, `import c` (also `import c, { x }`), `import { default as c }`,
//     `export *` / `export * as c` / `export { default } from`, `import c = require(...)`, and a literal-specifier
//     `import("node:crypto")` / `require("node:crypto")` (both yield the namespace). Named imports
//     (`import { randomUUID, createHash } from "node:crypto"`) stay allowed; `import { setEngine }` is rule 1.
// Both built-in checks are allow-lists, not enumerations of known-bad routes, so they do not depend on the Node
// version the lint runs on (production targets Node 24, the supported floor is Node 22.18+): a new built-in or
// `process` member is denied until someone deliberately reviews it and adds it here. Nothing is executed.
// SCOPE OF THE DEFAULT-DENY (F-DG1-130): it decides which built-in MODULES may be imported; it does NOT allow-list
// the MEMBERS of an allowed module. Members of the 7 allow-listed built-ins are covered by a recorded audit instead:
// MEMBER AUDIT (Node v22.22.2 / OpenSSL 3.5.5, every own property of node:{crypto, fs, fs/promises, os, path, url,
// util} plus the namespaces fs.promises, path.posix/win32, util.types, crypto.webcrypto/subtle; handback
// T-DG1-BE11): the ONLY member that loads, evaluates or executes code or loads a native object is
// `crypto.setEngine`, which rule 1 bans in every SPELLED form (identifier, `.member`, `["literal"]`, destructured,
// string literal, unicode escape, namespace `ns.setEngine`); reaching it by runtime ENUMERATION of the `node:crypto`
// namespace/default binding, without writing the name, is CLOSED by rule 5 (named imports only: no such binding can
// exist in module source; F-DG1-132/133). Name matches checked and cleared by hand:
// `os.loadavg` (system-load averages, not a loader); `fs.open*`/`opendir`/`truncate` (file I/O); `util.debug`/
// `debuglog`/`inspect` (logging/formatting, no debugger); `util.types.isModuleNamespaceObject`/`isNativeError`
// (type predicates). `crypto.setFips(bool)` only toggles the OpenSSL FIPS provider named by the OpenSSL config, not a
// caller-supplied path. No member of fs/promises, os, path, url or util exposes a code loader; `node:fs` writing a
// file that is then `import()`ed is residual (b). A later Node version can add a loader MEMBER to an allowed module:
// re-run the audit when the Node floor or target changes, and ban any such member here.
// Residual limits (stated and ACCEPTED by choice: this is a defence-in-depth lint over human-reviewed code):
//  (a) runtime DATA FLOW over PLAIN OBJECTS and third-party readers: a plain object or a third-party value passed to
//      readers (`Object.entries`/`Object.values`/`Map`/`Array.prototype.find`/a regex over keys, a schema library
//      given `Object.fromEntries([[k, ...]])`) and indexed by a key built or carried at runtime, rather than written
//      as a banned name or a directly-flagged `x[k]` computed member. Enumerating plain objects is legitimate module
//      code (`new Map(Object.entries(request.cookies)).get(name)`) and stays allowed. No allow-listed built-in
//      NAMESPACE reaches this residual any more: the only one with a loader member (`node:crypto`, `setEngine`) can
//      no longer be namespace- or default-bound (rule 5, F-DG1-132/133), so the former enumeration route
//      (`new Map(Object.entries(c)).get("set".concat("Engine"))`, `Object.values(c).find(...)`) is a violation at the
//      import. If the member audit ever finds a loader member in another allow-listed built-in, add that built-in to
//      NAMESPACE_RESTRICTED_BUILTINS as well as banning the member name.
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
 * what module source imports (crypto, fs, path, url) plus the read/utility built-ins fs/promises, os and util. Per the
 * member audit in the header (F-DG1-130), they expose no member that loads, evaluates or executes code, opens a
 * debugger, or loads native objects EXCEPT `crypto.setEngine` (a native loader), which rule 1 bans in every SPELLED
 * form and rule 5 keeps unreachable by enumeration (named imports only for node:crypto); residuals (a)-(c)
 * of the header still apply (`node:fs` code generation + import is (b)). NEVER add a code-loading, exec,
 * native or debug built-in (module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test,
 * wasi, v8, net, http, https, dgram, async_hooks, ...): those routes were closed one by one by F-DG1-109/117/125/127/128
 * and are now denied by default. Network I/O belongs to the composition root, not module source.
 */
const SAFE_NODE_BUILTINS: ReadonlySet<string> = new Set(["crypto", "fs", "fs/promises", "os", "path", "url", "util"]);
/**
 * Rule 5 (F-DG1-132/133): allow-listed built-ins that carry a rule-1-banned member (node:crypto -> setEngine) may be
 * imported through NAMED imports only, so their namespace/default object never becomes an enumerable value. The bare
 * `crypto` spelling is listed too (it is already a violation as a non-dependency; listed so the rule does not depend
 * on that).
 */
const NAMESPACE_RESTRICTED_BUILTINS: ReadonlySet<string> = new Set(["crypto", "node:crypto"]);
/** F-DG1-124: dynamic-code primitives, banned in every SPELLED form (rule 1), by the kind of bypass they give. */
const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
  ...["eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "constructor"].map(
    (n) => [n, "code evaluation"] as const,
  ),
  ...["require", "createRequire", "getBuiltinModule", "mainModule", "_load"].map((n) => [n, "module loader"] as const),
  // F-DG1-130: a native-loader MEMBER of the allow-listed node:crypto (dlopen of an arbitrary shared object).
  ["setEngine", "native loader"] as const,
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

/**
 * F-DG1-134: every buildable JS/TS module file - .ts .tsx .mts .cts .js .jsx .mjs .cjs. Matching only .ts/.tsx let a
 * `.mts` module file (typechecks under NodeNext + allowImportingTsExtensions, ships in dist as `.mjs`) evade every rule
 * and the boundary check.
 * F-DG1-135: only `*.test.ts`/`*.test.tsx` is a test (TEST_FILE) - the extensions tsconfig.build.json excludes. A
 * `*.test.mts`/`.test.js`/... is never run as a test yet compiles into dist, so it gets the full boundary rules.
 */
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.test\.tsx?$/;
/** JSX-capable files are parsed as TSX (a TS-kind parse of JSX text such as `a'b {require(x)}` swallows code). */
const scriptKindOf = (fileName: string) => (/\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : CODE_FILE.test(name) ? [p] : [];
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
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const specifiers: string[] = [];
  const evasions: string[] = [];
  const at = (n: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

  /** Rule 5: a namespace/default binding of a built-in that carries a banned member (it could be enumerated). */
  const restricted = (spec: string, node: ts.Node, form: string): void => {
    if (NAMESPACE_RESTRICTED_BUILTINS.has(spec))
      evasions.push(
        `imports the ${spec} namespace/default binding via ${form}; only named imports are allowed ` +
          `(it carries a rule-1-banned member) (${at(node)})`,
      );
  };
  /** `default` as an import/export specifier name binds the module's default export (the module object). */
  const bindsDefault = (elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[]): boolean =>
    elements.some((e) => (e.propertyName ?? e.name).text === "default");

  /** Specifiers (checked against the boundary) are collected everywhere, types included: `import("x").T`. */
  const collect = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const spec = literalText(node.moduleSpecifier);
      if (spec !== null) {
        specifiers.push(spec);
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause;
          if (clause?.name) restricted(spec, node, "a default import");
          const nb = clause?.namedBindings;
          if (nb && ts.isNamespaceImport(nb)) restricted(spec, node, "import * as");
          if (nb && ts.isNamedImports(nb) && bindsDefault(nb.elements)) restricted(spec, node, "import { default }");
        } else {
          const ec = node.exportClause;
          if (!ec) restricted(spec, node, "export *");
          else if (ts.isNamespaceExport(ec)) restricted(spec, node, "export * as");
          else if (bindsDefault(ec.elements)) restricted(spec, node, "export { default }");
        }
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const spec = literalText(node.moduleReference.expression);
      if (spec !== null) {
        specifiers.push(spec);
        restricted(spec, node, "import = require()");
      } else evasions.push(`computed import-equals require (${at(node)})`);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      // Type space only (`typeof import("node:crypto")` is erased), so rule 5 does not apply.
      const spec = literalText(node.argument.literal);
      if (spec !== null) specifiers.push(spec);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = literalText(node.arguments[0]);
        if (spec !== null) {
          specifiers.push(spec);
          restricted(spec, node, "a dynamic import()");
        } else evasions.push(`computed import() specifier (${at(node)})`);
      } else if (ts.isIdentifier(callee) && callee.text === "require") {
        const spec = literalText(node.arguments[0]);
        if (spec !== null) {
          specifiers.push(spec);
          restricted(spec, node, "require()");
        } else evasions.push(`computed require() specifier (${at(node)})`);
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
  const isTest = TEST_FILE.test(file);
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
