// qa-verifier DG4 round 9: run the validator's own checkWriteOnce (tools/gates/lib/rules.mjs) on a repo for a stage. Usage: node writeonce.mjs <repo> <stage>
import { pathToFileURL } from "node:url";
const [repo, stage] = process.argv.slice(2);
const { checkWriteOnce } = await import(pathToFileURL(`${repo}/tools/gates/lib/rules.mjs`).href);
const errors = [];
checkWriteOnce(repo, stage, errors);
console.log(`checkWriteOnce ${stage}: ${errors.length} errors`);
for (const e of errors.slice(0, 20)) console.log("  " + e);
process.exit(errors.length ? 1 : 0);
