// T-DG4-BE-R7 (D-138) non-vacuity: writes a temporary scratch copy of tests/qa/integration/a08-gate-controls.test.ts in
// which (1) DELIVERY points at a scratch copy of docs/delivery/ (env MUTANT_DELIVERY, so no real delivery record is
// touched) and (2) one mutation selected by env MUTANT is applied between the two fingerprints of the G6 test, i.e.
// after the approval and its worker consumer and before the final equality. Everything else is the test verbatim.
// Usage: node make-mutant.mjs <repo-root> <output-test-file>; delete the output file afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2]);
const outFile = resolve(process.argv[3]);
let src = readFileSync(join(root, "tests/qa/integration/a08-gate-controls.test.ts"), "utf8");

const replaceOnce = (from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`expected exactly one occurrence, found ${n}: ${from}`);
  src = src.replace(from, to);
};

replaceOnce(
  'const DELIVERY = fileURLToPath(new URL("../../../docs/delivery/", import.meta.url));',
  "const DELIVERY = process.env.MUTANT_DELIVERY!.replace(/\\/?$/, \"/\");\n" +
    'import { appendFileSync as mAppend, mkdirSync as mMkdir, rmSync as mRm } from "node:fs";\n' +
    "function mutate(): void {\n" +
    "  const m = process.env.MUTANT ?? \"none\";\n" +
    '  if (m === "decisions") mAppend(join(DELIVERY, "decisions.md"), "x");\n' +
    '  else if (m === "gate") mAppend(join(DELIVERY, "gates", "DG3.json"), " ");\n' +
    '  else if (m === "findings-removed") mRm(join(DELIVERY, "findings.json"));\n' +
    '  else if (m === "handback") { mMkdir(join(DELIVERY, "handbacks"), { recursive: true }); mAppend(join(DELIVERY, "handbacks", "x.md"), "x"); }\n' +
    '  else if (m !== "none") throw new Error(`unknown MUTANT ${m}`);\n' +
    "}",
);
replaceOnce(
  '    await handleGateDecided(api.db, await envelopeByKey(api, decidedEvents[0]!.idempotency_key), "qa-a08-g6-decided");\n' +
    "    expect(deliveryFingerprint()).toEqual(before);",
  '    await handleGateDecided(api.db, await envelopeByKey(api, decidedEvents[0]!.idempotency_key), "qa-a08-g6-decided");\n' +
    "    mutate();\n" +
    "    expect(deliveryFingerprint()).toEqual(before);",
);
writeFileSync(outFile, src);
console.log(`wrote ${outFile}`);
