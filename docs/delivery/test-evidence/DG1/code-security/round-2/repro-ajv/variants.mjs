// REPRODUCTION ONLY (code-security-reviewer, DG1 round 2). Run with cwd = disposable clone root:
//   node --conditions=@mth/source <this file>
// Feeds import-form variants of a test-only package (ajv/ajv-formats/yaml) through the candidate's own fileViolations().
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd();
const kit = await import(pathToFileURL(join(root, "apps/api/src/architecture.testkit.ts")).href);
const at = (n) => join(root, "apps/api/src/modules/transformations", n);
const variants = {
  static: `import Ajv from "ajv";`,
  subpath: `import { _ } from "ajv/dist/compile/codegen/index.js";`,
  dynamic: `export const m = import("ajv");`,
  dynamicTemplate: "export const m = import(`ajv`);",
  reexport: `export * from "ajv";`,
  reexportNamed: `export { _ } from "ajv";`,
  typeOnly: `import type { KeywordCxt } from "ajv";`,
  tsImportEquals: `import Ajv = require("ajv");`,
  requireCall: `declare const require: any; export const a = require("ajv");`,
  formats: `import f from "ajv-formats";`,
  yaml: `import { parse } from "yaml";`,
  fastifyAjvCompiler: `import c from "@fastify/ajv-compiler";`,
  inTestMts: `import Ajv from "ajv";`,
};
let bad = 0;
for (const [k, src] of Object.entries(variants)) {
  const file = k === "inTestMts" ? at("zz.test.mts") : at(`zz-${k}.ts`);
  const v = kit.fileViolations("transformations", file, src);
  if (v.length === 0) bad++;
  console.log(`${k.padEnd(18)} violations=${v.length} ${JSON.stringify(v)}`);
}
console.log(`UNFLAGGED=${bad}`);
