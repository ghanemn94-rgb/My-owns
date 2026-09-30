#!/usr/bin/env node
// Migration runner CLI skeleton (ADR-0003). backend-workflow-engineer implements `migrate` (apply pending
// migrations under an advisory lock, verify checksums of applied ones) and `status`. There is no `down`.
const [command] = process.argv.slice(2);
if (command !== "migrate" && command !== "status") {
  console.error("usage: mth-db migrate | status");
  process.exit(64);
}
console.error(`mth-db ${command}: not implemented in the skeleton (T-DG1-BE)`);
process.exit(2);
