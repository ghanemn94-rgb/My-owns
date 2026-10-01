# Handback T-DG1-BE11: F-DG1-130 (backend-workflow-engineer)

- **Stage:** DG1 round-10 repair. **Assignment:** `docs/delivery/assignments/DG1/round-10/T-DG1-BE11.md` (sha256 e26d20a7…7b4f, verified).
- **Invocation:** run `DG1-T-DG1-BE11-backend-workflow-engineer-20261001T142141Z-a0dc8534`, session `a0dc8534-2fe0-4907-8a97-ea0691e42079`.
- **Base:** `HEAD` was `8ec95a6` when I started. During the run the orchestrator committed `99f3447`, which touches only `docs/delivery/decisions.md`. A concurrent uncommitted change to `docs/delivery/findings.json` (F-DG1-131 status) is also present in the working tree. Neither is mine, I did not edit either one, and neither conflicts with this change. The diff below is against `99f3447`.
- **Environment:** Node v22.22.2 (OpenSSL 3.5.5), offline, existing `node_modules`, no `pnpm install`.
- **Requirement:** REQ-S16-003 (F-DG1-130, Low, non-mandatory).
- **No migrations and no API endpoints** (test-only lint change).

## 1. Changed files
- `apps/api/src/architecture.testkit.ts`:
  - adds `setEngine` to `BANNED_PRIMITIVES` (rule 1, kind `"native loader"`);
  - adds a "SCOPE OF THE DEFAULT-DENY" paragraph and the member audit to the header;
  - corrects the `SAFE_NODE_BUILTINS` doc claim.
- `apps/api/src/architecture.test.ts`:
  - adds a new 4-column `it.each` table (S1, S2, S3) for the F-DG1-124 blanket ban;
  - adds a `node:crypto` positive control;
  - adds a header note.

## 2. Behaviour delivered (REQ-S16-003 / F-DG1-130)
1. **Ban:** `setEngine` is now a rule-1 banned name, labelled `native loader`. Rule 1 already matches every syntactic form:
   - an identifier, including a named import `{ setEngine }`;
   - `.setEngine` / `.setEngine()`;
   - `["setEngine"]`, a `"setEngine"` string literal, a destructured key, or an object key.

   Type positions stay legal. `grep` shows no `setEngine` identifier in `apps/` or `packages/` outside the two lint files, so no module loses a legitimate use.
2. **Member audit:** I audited the 7 allow-listed built-ins. The command and output are in §4. `crypto.setEngine` is the only member that loads, evaluates or executes code or loads a native object. The header records:
   - the name matches I cleared by hand: `os.loadavg`, `fs.open*`/`opendir`/`truncate`, `util.debug`/`debuglog`/`inspect`, `util.types.isModuleNamespaceObject`/`isNativeError`;
   - `crypto.setFips(bool)`: it toggles the OpenSSL FIPS provider named in the OpenSSL config, not a path the caller supplies;
   - that `node:fs` write-then-`import()` stays residual (b);
   - that the audit must be re-run when the Node floor or target changes.
3. **Header corrected:**
   - It now says default-deny applies to which built-in **modules** may be imported, not to the **members** of an allowed module.
   - The `SAFE_NODE_BUILTINS` doc now says the allowed built-ins expose no load/eval/exec/debugger/native member **except** `crypto.setEngine`, which rule 1 bans.
   - Residuals (a) data flow, (b) `node:fs` code generation + import, and (c) `WebAssembly` are unchanged.
4. **Self-check:**
   - **S1** is the named import and **S2** the namespace import, as assigned. I added **S3** (`(crypto as any)["setEngine"](…)`) as an extra form.
   - The 4th column is `"missed"`: 0 violations with the round-9 lint (verified below).
   - **Deviation:** the assignment said to add these rows to the existing F-DG1-124 table. That table's test title reads "round-4 lint: $3", and I did not verify these plants against the round-4 lint. So I put them in their own `it.each` with the same 4-column shape and the title "round-9 lint: $3", directly after the F-DG1-124 table. The existing D-055 positive control (`randomUUID` from `node:crypto`) is unchanged. A new control shows that a named and a namespace `node:crypto` import with `randomUUID`/`createHash` stay clean.

## 3. Exact diff (against 99f3447)
```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index ca30e94..3d65ef8 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -11,7 +11,8 @@
 //     primitive name (eval, Function & co., constructor, require, createRequire, Reflect, getPrototypeOf, ...) in any
 //     syntactic form, and any computed key that is not a literal (a constructed key can spell any of them); since
 //     D-055 (F-DG1-129/213), any member of the global process outside the allow-list (process.kill, _debugProcess,
-//     execve, binding, ...) - default-deny, independent of the Node version;
+//     execve, binding, ...) - default-deny, independent of the Node version; since F-DG1-130, the native-loader
+//     member `setEngine` of the allow-listed node:crypto (rule 1, every form);
 //  4. a module directory is not in the module map, a P1 module has no index.ts, or a §16 business module has no
 //     test suite of its own (A12, D-048);
 //  5. the declared module graph has a cycle, or audit/access depend on a business module;
@@ -386,6 +387,36 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     expect(v.join("\n")).toMatch(message);
   });
 
+  // F-DG1-124 blanket ban extended by F-DG1-130 (same 4-column shape; the 4th column is the round-9 lint's result).
+  it.each([
+    // F-DG1-130: `crypto.setEngine(path)` dlopen()s an arbitrary shared object (native loader) although `node:crypto`
+    // itself is allow-listed (default-deny covers modules, not members). Rule 1 now bans the `setEngine` name in every
+    // form. "missed" here = 0 violations with the round-9 lint (HEAD 8ec95a6; handback T-DG1-BE11). Importing
+    // node:crypto stays allowed (D-055 positive control below).
+    [
+      "S1 crypto.setEngine (named import)",
+      `import { setEngine } from "node:crypto";\nsetEngine("/tmp/x.so");`,
+      /native loader via setEngine \(line 2\)/,
+      "missed",
+    ],
+    [
+      "S2 crypto.setEngine (namespace import)",
+      `import * as c from "node:crypto";\nc.setEngine("/tmp/x.so");`,
+      /native loader via \.setEngine\(\)/,
+      "missed",
+    ],
+    [
+      'S3 crypto["setEngine"] (string key)',
+      `import crypto from "node:crypto";\n(crypto as any)["setEngine"]("/tmp/x.so");`,
+      /native loader via \["setEngine"\]/,
+      "missed",
+    ],
+  ])("%s is a violation (round-9 lint: $3)", (_case, source, message, _before) => {
+    const v = planted("transformations", source);
+    expect(v.length, `${_case}: ${JSON.stringify(v)}`).toBeGreaterThan(0);
+    expect(v.join("\n")).toMatch(message);
+  });
+
   // D-055 / F-DG1-129, F-DG1-213, F-DG1-010: DEFAULT-DENY for node: built-ins and process.* members. The third column
   // records what the round-8 lint (HEAD ed43620, denylists LOADER_BUILTINS / PROCESS_LOADERS) did with the same plant:
   // "missed" = 0 violations; "caught" = flagged by the old denylist (kept as a regression guard).
@@ -494,6 +525,15 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     expect(planted("transformations", allowed)).toEqual([]);
   });
 
+  it("F-DG1-130: only setEngine is banned - node:crypto and its other members stay allowed (positive control)", () => {
+    const allowed = [
+      `import { randomUUID, createHash } from "node:crypto";`,
+      `import * as nodeCrypto from "node:crypto";`,
+      `export const id = randomUUID() + nodeCrypto.randomUUID() + createHash("sha256").update("x").digest("hex");`,
+    ].join("\n");
+    expect(planted("transformations", allowed)).toEqual([]);
+  });
+
   it("allowed forms stay clean (public index of a declared dependency, shared packages, own files)", () => {
     const clean = [
       `import { authorize } from "../access/index.ts";`,
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index e1e8ce8..1109418 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -20,6 +20,8 @@
 //     literal anywhere (`Reflect.get(fn, "constructor")`), object/destructuring key, import/export name:
 //     code evaluation  eval, Function, AsyncFunction, GeneratorFunction, AsyncGeneratorFunction, constructor
 //     module loaders   require, createRequire, getBuiltinModule, mainModule, _load
+//     native loader    setEngine (F-DG1-130: `crypto.setEngine(path)` dlopen()s an arbitrary shared object, whose
+//                      ELF constructor runs before the call throws - a member of the allow-listed `node:crypto`)
 //     reflection       Reflect, getPrototypeOf, __proto__, getOwnPropertyDescriptor(s), getOwnPropertyNames,
 //                      __lookupGetter__, __lookupSetter__ (they read a property by a runtime name, or expose the
 //                      prototype / non-enumerable keys where `constructor` lives).
@@ -41,6 +43,18 @@
 // Both built-in checks are allow-lists, not enumerations of known-bad routes, so they do not depend on the Node
 // version the lint runs on (production targets Node 24, the supported floor is Node 22.18+): a new built-in or
 // `process` member is denied until someone deliberately reviews it and adds it here. Nothing is executed.
+// SCOPE OF THE DEFAULT-DENY (F-DG1-130): it decides which built-in MODULES may be imported; it does NOT allow-list
+// the MEMBERS of an allowed module. Members of the 7 allow-listed built-ins are covered by a recorded audit instead:
+// MEMBER AUDIT (Node v22.22.2 / OpenSSL 3.5.5, every own property of node:{crypto, fs, fs/promises, os, path, url,
+// util} plus the namespaces fs.promises, path.posix/win32, util.types, crypto.webcrypto/subtle; handback
+// T-DG1-BE11): the ONLY member that loads, evaluates or executes code or loads a native object is
+// `crypto.setEngine`, which rule 1 now bans in every form. Name matches checked and cleared by hand:
+// `os.loadavg` (system-load averages, not a loader); `fs.open*`/`opendir`/`truncate` (file I/O); `util.debug`/
+// `debuglog`/`inspect` (logging/formatting, no debugger); `util.types.isModuleNamespaceObject`/`isNativeError`
+// (type predicates). `crypto.setFips(bool)` only toggles the OpenSSL FIPS provider named by the OpenSSL config, not a
+// caller-supplied path. No member of fs/promises, os, path, url or util exposes a code loader; `node:fs` writing a
+// file that is then `import()`ed is residual (b). A later Node version can add a loader MEMBER to an allowed module:
+// re-run the audit when the Node floor or target changes, and ban any such member here.
 // Residual limits (stated and ACCEPTED, not closable statically):
 //  (a) runtime DATA FLOW: a string computed at runtime and handed to third-party code that itself reads
 //      `input[key]` (e.g. a schema library given `Object.fromEntries([[k, ...]])`); rules 1-2 remove every syntactic
@@ -68,8 +82,10 @@ const THIRD_PARTY = new Set(Object.keys(apiPkg.dependencies).filter((d) => !d.st
 const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db"]);
 /**
  * D-055 DEFAULT-DENY allow-list of `node:` built-ins (without the prefix) that module source may import. Seeded from
- * what module source imports (crypto, fs, path, url) plus the read/utility built-ins fs/promises, os and util. None of
- * them loads, evaluates or executes code, opens a debugger, or loads native objects. NEVER add a code-loading, exec,
+ * what module source imports (crypto, fs, path, url) plus the read/utility built-ins fs/promises, os and util. Per the
+ * member audit in the header (F-DG1-130), they expose no member that loads, evaluates or executes code, opens a
+ * debugger, or loads native objects EXCEPT `crypto.setEngine` (a native loader), which rule 1 bans; residuals (a)-(c)
+ * of the header still apply (`node:fs` code generation + import is (b)). NEVER add a code-loading, exec,
  * native or debug built-in (module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test,
  * wasi, v8, net, http, https, dgram, async_hooks, ...): those routes were closed one by one by F-DG1-109/117/125/127/128
  * and are now denied by default. Network I/O belongs to the composition root, not module source.
@@ -81,6 +97,8 @@ const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
     (n) => [n, "code evaluation"] as const,
   ),
   ...["require", "createRequire", "getBuiltinModule", "mainModule", "_load"].map((n) => [n, "module loader"] as const),
+  // F-DG1-130: a native-loader MEMBER of the allow-listed node:crypto (dlopen of an arbitrary shared object).
+  ["setEngine", "native loader"] as const,
   ...[
     "Reflect",
     "getPrototypeOf",
```

## 4. Member audit of the 7 allow-listed built-ins (command + full output)
Command: `node $TMPDIR/audit.mjs` (scratch script, not committed). The script:
- lists every own property name of `node:{crypto,fs,fs/promises,os,path,url,util}`, plus the namespaces `promises`, `posix`, `win32`, `types`, `webcrypto` and `subtle` where they exist;
- marks the names that match `/load|engine|open(?!dir)|dlopen|eval|exec|spawn|fork|run|compile|require|import|module|binding|native|addon|inspect|debug|worker|script|vm|wasm|shell|process|plugin|extension/i`.

I then classified every marked name, and I also read the full lists by hand. Script:
```js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mods = ["crypto", "fs", "fs/promises", "os", "path", "url", "util"];
// Name patterns that indicate a load / eval / exec / native-load / debugger capability.
const RX = /load|engine|open(?!dir)|dlopen|eval|exec|spawn|fork|run|compile|require|import|module|binding|native|addon|inspect|debug|worker|script|vm|wasm|shell|process|plugin|extension/i;
console.log(`node ${process.version} openssl ${process.versions.openssl}`);
for (const m of mods) {
  const o = require(`node:${m}`);
  const names = new Set();
  const add = (obj, pre) => { for (const k of Object.getOwnPropertyNames(obj)) names.add(pre + k); };
  add(o, "");
  // nested namespaces: fs.promises, fs.constants, path.posix/win32, util.types, crypto.webcrypto/subtle
  for (const k of ["promises", "posix", "win32", "types", "webcrypto", "subtle"]) if (o[k] && typeof o[k] === "object") add(o[k], k + ".");
  const all = [...names].sort();
  const flagged = all.filter((n) => RX.test(n));
  console.log(`\nnode:${m}: ${all.length} members`);
  console.log(`  ALL: ${all.join(", ")}`);
  console.log(`  NAME-FLAGGED (manual classification below): ${flagged.join(", ") || "(none)"}`);
}
```
Output (exit 0):
```
node v22.22.2 openssl 3.5.5

node:crypto: 71 members
  ALL: Certificate, Cipher, Cipheriv, Decipher, Decipheriv, DiffieHellman, DiffieHellmanGroup, ECDH, Hash, Hmac, KeyObject, Sign, Verify, X509Certificate, checkPrime, checkPrimeSync, constants, createCipheriv, createDecipheriv, createDiffieHellman, createDiffieHellmanGroup, createECDH, createHash, createHmac, createPrivateKey, createPublicKey, createSecretKey, createSign, createVerify, diffieHellman, fips, generateKey, generateKeyPair, generateKeyPairSync, generateKeySync, generatePrime, generatePrimeSync, getCipherInfo, getCiphers, getCurves, getDiffieHellman, getFips, getHashes, getRandomValues, hash, hkdf, hkdfSync, pbkdf2, pbkdf2Sync, privateDecrypt, privateEncrypt, prng, pseudoRandomBytes, publicDecrypt, publicEncrypt, randomBytes, randomFill, randomFillSync, randomInt, randomUUID, rng, scrypt, scryptSync, secureHeapUsed, setEngine, setFips, sign, subtle, timingSafeEqual, verify, webcrypto
  NAME-FLAGGED (manual classification below): setEngine

node:fs: 138 members
  ALL: Dir, Dirent, F_OK, FileReadStream, FileWriteStream, R_OK, ReadStream, Stats, W_OK, WriteStream, X_OK, _toUnixTimestamp, access, accessSync, appendFile, appendFileSync, chmod, chmodSync, chown, chownSync, close, closeSync, constants, copyFile, copyFileSync, cp, cpSync, createReadStream, createWriteStream, exists, existsSync, fchmod, fchmodSync, fchown, fchownSync, fdatasync, fdatasyncSync, fstat, fstatSync, fsync, fsyncSync, ftruncate, ftruncateSync, futimes, futimesSync, glob, globSync, lchmod, lchmodSync, lchown, lchownSync, link, linkSync, lstat, lstatSync, lutimes, lutimesSync, mkdir, mkdirSync, mkdtemp, mkdtempSync, open, openAsBlob, openSync, opendir, opendirSync, promises, promises.access, promises.appendFile, promises.chmod, promises.chown, promises.constants, promises.copyFile, promises.cp, promises.glob, promises.lchmod, promises.lchown, promises.link, promises.lstat, promises.lutimes, promises.mkdir, promises.mkdtemp, promises.open, promises.opendir, promises.readFile, promises.readdir, promises.readlink, promises.realpath, promises.rename, promises.rm, promises.rmdir, promises.stat, promises.statfs, promises.symlink, promises.truncate, promises.unlink, promises.utimes, promises.watch, promises.writeFile, read, readFile, readFileSync, readSync, readdir, readdirSync, readlink, readlinkSync, readv, readvSync, realpath, realpathSync, rename, renameSync, rm, rmSync, rmdir, rmdirSync, stat, statSync, statfs, statfsSync, symlink, symlinkSync, truncate, truncateSync, unlink, unlinkSync, unwatchFile, utimes, utimesSync, watch, watchFile, write, writeFile, writeFileSync, writeSync, writev, writevSync
  NAME-FLAGGED (manual classification below): ftruncate, ftruncateSync, open, openAsBlob, openSync, promises.open, promises.truncate, truncate, truncateSync

node:fs/promises: 32 members
  ALL: access, appendFile, chmod, chown, constants, copyFile, cp, glob, lchmod, lchown, link, lstat, lutimes, mkdir, mkdtemp, open, opendir, readFile, readdir, readlink, realpath, rename, rm, rmdir, stat, statfs, symlink, truncate, unlink, utimes, watch, writeFile
  NAME-FLAGGED (manual classification below): open, truncate

node:os: 23 members
  ALL: EOL, arch, availableParallelism, constants, cpus, devNull, endianness, freemem, getPriority, homedir, hostname, loadavg, machine, networkInterfaces, platform, release, setPriority, tmpdir, totalmem, type, uptime, userInfo, version
  NAME-FLAGGED (manual classification below): loadavg

node:path: 51 members
  ALL: _makeLong, basename, delimiter, dirname, extname, format, isAbsolute, join, matchesGlob, normalize, parse, posix, posix._makeLong, posix.basename, posix.delimiter, posix.dirname, posix.extname, posix.format, posix.isAbsolute, posix.join, posix.matchesGlob, posix.normalize, posix.parse, posix.posix, posix.relative, posix.resolve, posix.sep, posix.toNamespacedPath, posix.win32, relative, resolve, sep, toNamespacedPath, win32, win32._makeLong, win32.basename, win32.delimiter, win32.dirname, win32.extname, win32.format, win32.isAbsolute, win32.join, win32.matchesGlob, win32.normalize, win32.parse, win32.posix, win32.relative, win32.resolve, win32.sep, win32.toNamespacedPath, win32.win32
  NAME-FLAGGED (manual classification below): (none)

node:url: 13 members
  ALL: URL, URLSearchParams, Url, domainToASCII, domainToUnicode, fileURLToPath, fileURLToPathBuffer, format, parse, pathToFileURL, resolve, resolveObject, urlToHttpOptions
  NAME-FLAGGED (manual classification below): (none)

node:util: 92 members
  ALL: MIMEParams, MIMEType, TextDecoder, TextEncoder, _errnoException, _exceptionWithHostPort, _extend, aborted, callbackify, debug, debuglog, deprecate, diff, format, formatWithOptions, getCallSite, getCallSites, getSystemErrorMap, getSystemErrorMessage, getSystemErrorName, inherits, inspect, isArray, isBoolean, isBuffer, isDate, isDeepStrictEqual, isError, isFunction, isNull, isNullOrUndefined, isNumber, isObject, isPrimitive, isRegExp, isString, isSymbol, isUndefined, log, parseArgs, parseEnv, promisify, setTraceSigInt, stripVTControlCharacters, styleText, toUSVString, transferableAbortController, transferableAbortSignal, types, types.isAnyArrayBuffer, types.isArgumentsObject, types.isArrayBuffer, types.isArrayBufferView, types.isAsyncFunction, types.isBigInt64Array, types.isBigIntObject, types.isBigUint64Array, types.isBooleanObject, types.isBoxedPrimitive, types.isCryptoKey, types.isDataView, types.isDate, types.isExternal, types.isFloat16Array, types.isFloat32Array, types.isFloat64Array, types.isGeneratorFunction, types.isGeneratorObject, types.isInt16Array, types.isInt32Array, types.isInt8Array, types.isKeyObject, types.isMap, types.isMapIterator, types.isModuleNamespaceObject, types.isNativeError, types.isNumberObject, types.isPromise, types.isProxy, types.isRegExp, types.isSet, types.isSetIterator, types.isSharedArrayBuffer, types.isStringObject, types.isSymbolObject, types.isTypedArray, types.isUint16Array, types.isUint32Array, types.isUint8Array, types.isUint8ClampedArray, types.isWeakMap, types.isWeakSet
  NAME-FLAGGED (manual classification below): debug, debuglog, inspect, isNullOrUndefined, types.isModuleNamespaceObject, types.isNativeError
```
**Classification:**
- `crypto.setEngine`: **native loader** (dlopen of a caller-supplied path, per F-DG1-130). Now banned.
- `fs.open`/`openSync`/`openAsBlob`/`promises.open`, `truncate`/`ftruncate` and their Sync forms: file I/O, not a loader. They match only because the name contains "open" or "run".
- `os.loadavg`: system-load averages, not a loader.
- `util.debug`/`debuglog`: `NODE_DEBUG` logging, no debugger. `util.inspect`: object formatting, not the inspector. `util.types.isModuleNamespaceObject`/`isNativeError`/`isNullOrUndefined`: type predicates.
- Not marked by the pattern, but I reviewed these by hand:
  - `crypto.setFips(bool)` / `crypto.fips`: toggles the configured FIPS provider and takes no path.
  - `os.setPriority`: scheduling.
  - `util.parseEnv`: parses a string, not a file loader.
  - `util.setTraceSigInt`: stack trace on SIGINT.
  - `fs.watch`/`glob`/`cp`: file I/O.
- `path` and `url`: nothing marked and nothing loader-like.

**Result:** `crypto.setEngine` is the only native-loader, loader or exec member. `node:fs` writing a file that is then `import()`ed stays the documented residual (b).

**Audit limits:**
- It enumerates own properties of the module objects and the namespaces above. It does not enumerate prototype methods of the exported classes (for example `KeyObject`, `FileHandle`, `Dir`), although I know of no loader among them.
- It ran on Node 22.22.2 only. Node 24, the production target, is **BLOCKED**: there is no Node 24 binary in this environment. The header asks for the audit to be re-run when the Node version changes.

## 5. S1 before/after (and controls)
Probe: `fileViolations("transformations", <MODULES_DIR>/transformations/zz-planted.ts, src)` run with `node --experimental-strip-types`. "Before" ran against a disposable clone of `8ec95a6` (the round-9 lint) under `$TMPDIR`. "After" ran against the working tree.

Before (8ec95a6, round-9 lint):
```
S1 named []
S2 namespace []
S3 string key []
control randomUUID []
```
After:
```
S1 named ["modules/transformations/zz-planted.ts: native loader via setEngine (line 1) bypasses the module-interface check","modules/transformations/zz-planted.ts: native loader via setEngine (line 2) bypasses the module-interface check"]
S2 namespace ["modules/transformations/zz-planted.ts: native loader via .setEngine() (line 2) bypasses the module-interface check"]
S3 string key ["modules/transformations/zz-planted.ts: native loader via [\"setEngine\"] (line 2) bypasses the module-interface check"]
control randomUUID []
```
`import { randomUUID } from "node:crypto"` is still allowed (0 violations). Only `setEngine` is banned.

## 6. Checks actually run (working tree = 99f3447 + this change)
- `pnpm vitest run apps/api/src/architecture.test.ts`: exit 0. The real-module-tree check passes, so `moduleViolations` is zero for every module:
```
 ✓ |unit-node| apps/api/src/architecture.test.ts (105 tests) 1063ms
   ✓ API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages  590ms

 Test Files  1 passed (1)
      Tests  105 passed (105)
   Start at  14:24:21
   Duration  2.01s (transform 155ms, setup 0ms, collect 652ms, tests 1.06s, environment 0ms, prepare 58ms)

```
- `pnpm vitest run apps/api/src/architecture.test.ts -t "setEngine|F-DG1-130|positive control" --reporter=verbose`: 5 passed:
```
S1 crypto.setEngine (named import) is a violation (round-9 lint: 'missed')
S2 crypto.setEngine (namespace import) is a violation (round-9 lint: 'missed')
S3 crypto["setEngine"] (string key) is a violation (round-9 lint: 'missed')
default-deny keeps the allow-listed built-ins and process members clean (D-055 positive controls)
F-DG1-130: only setEngine is banned - node:crypto and its other members stay allowed (positive control)
      Tests  5 passed | 100 skipped (105)
```
- `pnpm -r typecheck`: exit 0.
- `pnpm lint` (`eslint . --max-warnings=0`): exit 0.
- `pnpm exec prettier --check apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts`: exit 0, "All matched files use Prettier code style!".
- `pnpm test` (`vitest run --project unit-node --project unit-web`): exit 0:
```
 Test Files  21 passed (21)
      Tests  298 passed (298)
   Start at  14:24:50
   Duration  10.19s (transform 1.75s, setup 0ms, collect 8.28s, tests 11.17s, environment 4.35s, prepare 1.57s)

```
- `grep -rln setEngine apps packages` (ts/tsx/mts/mjs/js, excluding node_modules): finds only `apps/api/src/architecture.testkit.ts` and `apps/api/src/architecture.test.ts`.

## 7. Known gaps / not done
- **Node 24 is BLOCKED:** neither the member audit nor the probes ran on Node 24, because no binary is available here.
- The audit does not cover class prototype methods of the exported classes (see §4).
- Default-deny covers modules, not members. A later Node version could add a loader member to an allowed module. This is stated in the header, which asks for the audit to be re-run.
- **D-055 is not edited.** `docs/delivery/decisions.md` is outside my write scope. Its "closes the whole loader/exec class" wording (cited in F-DG1-130) should be reconciled by the orchestrator: default-deny applies per module, and the `setEngine` member is banned by rule 1.
- I don't close my own finding. F-DG1-130 needs verification by a non-author reviewer.

## 8. Merge instructions
- Test-only change to the two files above. No migrations, no runtime code, no dependency changes.
- No conflicts with `99f3447`. It and the concurrent `findings.json` edit come from the orchestrator and are untouched by me.
