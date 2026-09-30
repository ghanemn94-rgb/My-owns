#!/usr/bin/env node
// Generates /.env.example from the frozen configuration catalogue `ENV_VARS` in packages/config/src/index.ts
// (ADR-0011, REQ-S19-009). The template carries variable NAMES ONLY: every line is `NAME=` with no value, secret or
// not. Defaults, requirements and consumers appear in comments. Secrets may instead be supplied as `<NAME>_FILE`.
//
//   node deploy/scripts/generate-env-example.mjs           write .env.example
//   node deploy/scripts/generate-env-example.mjs --check   exit 1 if .env.example differs from a fresh generation,
//                                                          if any name is missing/extra, or if any line has a value
//
// Needs Node >= 22.18 (TypeScript type stripping) and an installed workspace (the catalogue module imports zod).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = join(root, ".env.example");
const { ENV_VARS } = await import(pathToFileURL(join(root, "packages", "config", "src", "index.ts")).href);

const lines = [
  "# Mobily Transformation Hub: environment template (GENERATED; do not edit by hand).",
  "# Source: packages/config/src/index.ts ENV_VARS. Regenerate: node deploy/scripts/generate-env-example.mjs",
  "#",
  "# NAMES ONLY. This file never contains values; secrets are runtime configuration outside the repository",
  "# (environment, or a file mounted at runtime and named by <NAME>_FILE, e.g. DATABASE_URL_FILE=/run/secrets/db_url).",
  "# Setting both NAME and NAME_FILE is refused at startup. Invalid configuration exits 78 and names the variable.",
  "# Unset optional variables take the default shown. Compose users: see deploy/compose/ and docs/operations/.",
  "",
];
for (const [name, spec] of Object.entries(ENV_VARS)) {
  lines.push(`# ${spec.description}`);
  const facts = [
    spec.required ? "required" : "optional",
    spec.secret ? `SECRET (prefer ${name}_FILE)` : null,
    spec.default !== undefined ? `default: ${spec.default === "" ? "(empty)" : spec.default}` : null,
    `used by: ${spec.usedBy.join(", ")}`,
  ].filter(Boolean);
  lines.push(`# ${facts.join(" | ")}`);
  lines.push(`${name}=`);
  lines.push("");
}
const text = `${lines.join("\n").trimEnd()}\n`;

if (process.argv.includes("--check")) {
  const problems = [];
  if (!existsSync(target)) problems.push(".env.example is missing");
  else {
    const current = readFileSync(target, "utf8");
    if (current !== text) problems.push(".env.example differs from the generated template");
    const assigned = current.split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l));
    const names = assigned.map((l) => l.slice(0, l.indexOf("=")));
    const expected = Object.keys(ENV_VARS);
    const missing = expected.filter((n) => !names.includes(n));
    const extra = names.filter((n) => !expected.includes(n));
    const withValue = assigned.filter((l) => l.slice(l.indexOf("=") + 1).trim() !== "").map((l) => l.split("=")[0]);
    if (missing.length) problems.push(`missing: ${missing.join(", ")}`);
    if (extra.length) problems.push(`not in ENV_VARS: ${extra.join(", ")}`);
    if (withValue.length) problems.push(`lines with a value (must be names only): ${withValue.join(", ")}`);
    if (problems.length === 0)
      console.log(`OK: .env.example lists exactly the ${expected.length} ENV_VARS names, none with a value`);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    process.exit(1);
  }
} else {
  writeFileSync(target, text);
  console.log(`wrote .env.example (${Object.keys(ENV_VARS).length} variables, names only)`);
}
