#!/usr/bin/env node
// Delivery gate validator. Exits non-zero whenever a gate or the pipeline is not in a valid approved state.
//   node tools/gates/validate.mjs --stage DG0                gate DG0 against the working tree (approval time)
//   node tools/gates/validate.mjs --stage DG0 --historical   gate DG0 against its recorded source commit
//   node tools/gates/validate.mjs --pipeline                 every approved gate (historical) + no stage advanced past a failed gate
//   node tools/gates/validate.mjs --register DG0             register/coverage rules only (pre-review self-check)
//   node tools/gates/validate.mjs --reconcile                resumption report: frozen candidate vs working tree, stale reviews
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRegister, reconcile, validateGate, validatePipeline } from "./lib/rules.mjs";

const repo = process.env.GATE_REPO_ROOT ? resolve(process.env.GATE_REPO_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function finish(label, errors) {
  if (errors.length) {
    console.error(`FAIL ${label} (${errors.length} problem${errors.length === 1 ? "" : "s"})`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
  process.exit(0);
}

if (args.includes("--reconcile")) {
  const { errors, report } = reconcile(repo);
  report.forEach((l) => console.log(l));
  finish("reconcile (structure)", errors);
} else if (args.includes("--pipeline")) {
  const { errors, current } = validatePipeline(repo);
  finish(`pipeline (active stage: ${current ? `${current.id} ${current.state}` : "none"})`, errors);
} else if (opt("--register")) {
  const errors = [];
  checkRegister(repo, opt("--register"), errors);
  finish(`register rules at ${opt("--register")}`, errors);
} else if (opt("--stage")) {
  const stageId = opt("--stage");
  const mode = args.includes("--historical") ? "historical" : "current";
  finish(`gate ${stageId} (${mode})`, validateGate(repo, stageId, { mode }));
} else {
  console.error("usage: validate.mjs --stage DGx [--historical] | --pipeline | --register DGx | --reconcile");
  process.exit(64);
}
