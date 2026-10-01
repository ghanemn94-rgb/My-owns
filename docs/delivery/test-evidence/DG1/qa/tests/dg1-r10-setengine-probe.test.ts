// QA round-10 independent probe (qa-verifier, T-DG1-REV-QA-R10). Not part of the candidate.
// Copy to apps/api/src/ in a DISPOSABLE clone and run with:
//   pnpm vitest run --project unit-node apps/api/src/dg1-r10-setengine-probe.test.ts --reporter=verbose
// Verifies F-DG1-130 ("setEngine is banned by rule 1 in every form; node:crypto + randomUUID/createHash stay allowed")
// against the frozen candidate's module lint WITHOUT trusting the implementer's S1/S2/S3 table:
//  R1 rule-1 spellings of the NAME (aliases, destructuring, escapes, template keys, export-from, dynamic import,
//     optional chaining, default export, `in`) are flagged as "native loader".
//  R2 the member reached WITHOUT ever writing its name: enumerate the allow-listed namespace (Object.values /
//     Object.entries / Map) and select the function with a runtime-built string or a regex. Reported with the
//     lint's actual result, and the runtime identity of what each form selects is checked against
//     crypto.setEngine (nothing is loaded: identity only).
//  R3 member audit, independent of the header: every own member (and one nested level) of the 7 allow-listed
//     built-ins on the running Node, screened for loader/exec/native/debug names; the QA-reviewed result is pinned.
//  R4 positive controls: legitimate node:crypto/fs/path/url/util/os uses stay clean.
import * as nodeCrypto from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileViolations, MODULES_DIR } from "./architecture.testkit.ts";

const FILE = join(MODULES_DIR, "transformations", "zz-qa-r10-planted.ts");
const v = (src: string) => fileViolations("transformations", FILE, src);
const P = `"/nonexistent/qa.so"`;

describe("R1 rule-1 spellings of setEngine are flagged (native loader)", () => {
  const forms: Array<[string, string]> = [
    ["named import", `import { setEngine } from "node:crypto";\nsetEngine(${P});`],
    ["aliased named import", `import { setEngine as s } from "node:crypto";\ns(${P});`],
    ["namespace member", `import * as c from "node:crypto";\nc.setEngine(${P});`],
    ["default-export member", `import crypto from "node:crypto";\ncrypto.setEngine(${P});`],
    ["namespace .default member", `import * as c from "node:crypto";\nc.default.setEngine(${P});`],
    ["optional chain", `import * as c from "node:crypto";\nc?.setEngine?.(${P});`],
    ["string key", `import * as c from "node:crypto";\n(c as any)["setEngine"](${P});`],
    ["template key", "import * as c from \"node:crypto\";\n(c as any)[`setEngine`](" + P + ");"],
    ["unicode-escaped string key", `import * as c from "node:crypto";\n(c as any)["set\\u0045ngine"](${P});`],
    ["unicode-escaped identifier", `import * as c from "node:crypto";\n(c as any).set\\u0045ngine(${P});`],
    ["destructuring", `import * as c from "node:crypto";\nconst { setEngine } = c;\nsetEngine(${P});`],
    ["destructuring rename", `import * as c from "node:crypto";\nconst { setEngine: s } = c;\ns(${P});`],
    ["string-key destructuring", `import * as c from "node:crypto";\nconst { "setEngine": s } = c;\ns(${P});`],
    ["export-from", `export { setEngine } from "node:crypto";`],
    ["export-from rename", `export { setEngine as s } from "node:crypto";`],
    ["dynamic import", `export const f = async () => (await import("node:crypto")).setEngine(${P});`],
    ["then() destructuring", `import("node:crypto").then(({ setEngine }) => setEngine(${P}));`],
    ["'in' probe", `import * as c from "node:crypto";\nexport const has = "setEngine" in c;`],
  ];
  it.each(forms)("%s", (_name, src) => {
    const out = v(src);
    console.log(`R1 ${_name}: ${out.length} violation(s) ${JSON.stringify(out)}`);
    expect(out.join("\n")).toMatch(/native loader via/);
  });
});

// Each form: [label, module-source plant, runtime selector equivalent (run here in the test, not in module source)].
const ENUM_FORMS: Array<[string, string, () => unknown]> = [
  [
    "E1 Object.values + name built at runtime",
    `import * as c from "node:crypto";\nconst f = Object.values(c).find((x) => typeof x === "function" && x.name === "set" + "Engine") as (p: string) => void;\nf(${P});`,
    () => Object.values(nodeCrypto).find((x) => typeof x === "function" && x.name === "set" + "Engine"),
  ],
  [
    "E2 Map(Object.entries) + get(concat)",
    `import * as c from "node:crypto";\nconst m = new Map(Object.entries(c));\n(m.get("set".concat("Engine")) as (p: string) => void)(${P});`,
    () => new Map(Object.entries(nodeCrypto)).get("set".concat("Engine")),
  ],
  [
    "E3 Object.entries + regex on the key, numeric index",
    `import * as c from "node:crypto";\nconst e = Object.entries(c).find(([k]) => /^setEng/.test(k))!;\n(e[1] as (p: string) => void)(${P});`,
    () => Object.entries(nodeCrypto).find(([k]) => /^setEng/.test(k))![1],
  ],
  [
    "E4 default export enumerated, for-of over entries",
    `import crypto from "node:crypto";\nfor (const [k, f] of Object.entries(crypto)) if (k.startsWith("set") && k.endsWith("Engine")) (f as (p: string) => void)(${P});`,
    () => Object.entries(nodeCrypto.default).find(([k]) => k.startsWith("set") && k.endsWith("Engine"))![1],
  ],
];

describe("R2 setEngine reached by enumeration, without its name in source", () => {
  const lintPassed: string[] = [];
  it.each(ENUM_FORMS)("%s", (label, src, select) => {
    const out = v(src);
    const same = select() === nodeCrypto.setEngine;
    console.log(`R2 ${label}: lint ${out.length} violation(s) ${JSON.stringify(out)}; runtime selects crypto.setEngine: ${same}`);
    if (out.length === 0) lintPassed.push(label);
    // The runtime equivalent really reaches the native loader (identity; nothing is loaded).
    expect(same).toBe(true);
  });
  it("summary: forms that reach crypto.setEngine with 0 lint violations", () => {
    console.log(`R2 SUMMARY: ${lintPassed.length}/${ENUM_FORMS.length} enumeration forms pass the lint: ${JSON.stringify(lintPassed)}`);
    // Recorded, not asserted green/red: the review record states the verdict on this result.
    expect(lintPassed.length).toBeGreaterThanOrEqual(0);
  });
});

describe("R3 independent member audit of the 7 allow-listed built-ins (running Node)", () => {
  const SCREEN = /engine|dlopen|load|exec|spawn|fork|eval|compile|require|import|module|script|binding|native|addon|wasm|worker|debug|inspect|trace|signal|kill|priority/i;
  // QA-reviewed classification of every screen hit (manual reading of the Node v22 docs for each member).
  const QA_CLEARED = new Map<string, string>([
    ["os.loadavg", "load averages"],
    ["os.getPriority", "scheduling priority read"],
    ["os.setPriority", "scheduling priority write (nice); no code loading"],
    ["util.debug", "alias of debuglog (logging)"],
    ["util.debuglog", "logging"],
    ["util.inspect", "formatting"],
    ["util.setTraceSigInt", "print a stack trace on SIGINT; no code loading"],
    ["util.transferableAbortSignal", "marks an AbortSignal transferable (screen hit on 'signal'); no code loading"],
    ["util.convertProcessSignalToExitCode", "Node 24 only: maps a signal name to an exit code (pure); no code loading"],
    ["util.types.isModuleNamespaceObject", "type predicate"],
    ["util.types.isNativeError", "type predicate"],
  ]);
  const LOADERS = new Set(["crypto.setEngine"]);
  it("every screen hit is either the banned native loader or QA-cleared", async () => {
    const hits: string[] = [];
    for (const m of ["crypto", "fs", "fs/promises", "os", "path", "url", "util"]) {
      const ns = (await import(`node:${m}`)) as Record<string, unknown> & { default?: Record<string, unknown> };
      const root = (ns.default ?? ns) as Record<string, unknown>;
      const seen = new Set<string>();
      const walk = (o: Record<string, unknown>, pre: string, depth: number) => {
        for (const k of Object.keys(o).concat(Object.getOwnPropertyNames(o))) {
          if (seen.has(pre + k)) continue;
          seen.add(pre + k);
          let val: unknown;
          try {
            val = o[k];
          } catch {
            continue;
          }
          if (SCREEN.test(k)) hits.push(`${m.replace("/promises", ".promises")}.${pre}${k}`);
          if (depth < 1 && val && typeof val === "object" && k !== "constants")
            walk(val as Record<string, unknown>, `${pre}${k}.`, depth + 1);
        }
      };
      walk(root, "", 0);
    }
    const unique = [...new Set(hits)].sort();
    const unclassified = unique.filter((h) => !LOADERS.has(h) && !QA_CLEARED.has(h));
    console.log(`R3 node ${process.version} openssl ${process.versions.openssl}; screen hits: ${JSON.stringify(unique)}`);
    console.log(`R3 unclassified: ${JSON.stringify(unclassified)}`);
    expect(unique).toContain("crypto.setEngine");
    expect(unclassified).toEqual([]);
  });
});

describe("R4 positive controls stay clean", () => {
  const ok: Array<[string, string]> = [
    ["crypto named", `import { randomUUID, createHash } from "node:crypto";\nexport const a = randomUUID() + createHash("sha256").update("x").digest("hex");`],
    ["crypto namespace", `import * as c from "node:crypto";\nexport const a = c.randomUUID() + c.timingSafeEqual(Buffer.from("a"), Buffer.from("a"));`],
    ["crypto default", `import crypto from "node:crypto";\nexport const a = crypto.createHmac("sha256", "k").update("x").digest("hex");`],
    ["fs/path/url", `import { readFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { fileURLToPath } from "node:url";\nexport const a = () => readFileSync(join(fileURLToPath(import.meta.url), "x"), "utf8");`],
    ["os/util/fs.promises", `import { tmpdir } from "node:os";\nimport { format } from "node:util";\nimport { readFile } from "node:fs/promises";\nexport const a = () => readFile(format("%s/x", tmpdir()));`],
    ["setFips read", `import { getFips } from "node:crypto";\nexport const a = getFips();`],
  ];
  it.each(ok)("%s", (_n, src) => expect(v(src)).toEqual([]));
});
