#!/usr/bin/env node
// Validates the OpenAPI 3.1 contract (ADR-0007, acceptance check 3).
//  1. @apidevtools/swagger-parser (pinned devDependency) validates the document against the OAS 3.1 schema
//     and resolves every $ref. Runs fully offline.
//  2. Project rules: unique operationIds, every mutating operation requires the CSRF scheme, every
//     If-Match operation documents 409 + 428, every error response uses application/problem+json.
// Usage: node scripts/openapi-lint.mjs docs/api/openapi.yaml
import SwaggerParser from "@apidevtools/swagger-parser";

const file = process.argv[2] ?? "docs/api/openapi.yaml";
const problems = [];
let api;
try {
  api = await SwaggerParser.validate(file);
} catch (err) {
  console.error(`FAIL ${file}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
if (!String(api.openapi).startsWith("3.1")) problems.push(`openapi must be 3.1.x, got ${api.openapi}`);

const UNSAFE = new Set(["post", "put", "patch", "delete"]);
const PUBLIC_UNSAFE = new Set(["devLogin"]); // login-CSRF is handled by the Origin check (ADR-0005)
const seen = new Set();
for (const [path, item] of Object.entries(api.paths ?? {})) {
  for (const [method, op] of Object.entries(item)) {
    if (!["get", "put", "post", "patch", "delete"].includes(method)) continue;
    const id = op.operationId;
    if (!id) problems.push(`${method.toUpperCase()} ${path}: missing operationId`);
    else if (seen.has(id)) problems.push(`duplicate operationId ${id}`);
    else seen.add(id);
    if (!path.startsWith("/api/v1/") && !["/healthz", "/readyz"].includes(path))
      problems.push(`${path}: outside /api/v1`);
    if (UNSAFE.has(method) && !PUBLIC_UNSAFE.has(id)) {
      const sec = op.security ?? api.security ?? [];
      if (!sec.some((req) => "csrfToken" in req && "sessionCookie" in req))
        problems.push(`${id}: unsafe method without sessionCookie+csrfToken`);
    }
    const params = [...(item.parameters ?? []), ...(op.parameters ?? [])];
    if (params.some((p) => p.in === "header" && p.name === "If-Match")) {
      for (const code of ["409", "428"])
        if (!op.responses?.[code]) problems.push(`${id}: If-Match operation lacks ${code}`);
    }
    for (const [code, resp] of Object.entries(op.responses ?? {})) {
      if (Number(code) >= 400 && code !== "503" && !resp.content?.["application/problem+json"])
        problems.push(`${id} ${code}: error response is not application/problem+json`);
    }
  }
}
if (problems.length) {
  console.error(`FAIL ${file} (${problems.length} problem(s))`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`PASS ${file}: OpenAPI ${api.openapi}, ${seen.size} operations`);
