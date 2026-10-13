#!/usr/bin/env bash
# qa-verifier DG4 round 10: independent non-vacuity mutants of the narrowed A08 G6 fingerprint (D-138, T-DG4-BE-R7).
# A scratch copy of tests/qa/integration/a08-gate-controls.test.ts (zz-qa-r10-a08-mutant.test.ts, deleted afterwards) differs
# in exactly two ways: DELIVERY points at a scratch copy of docs/delivery/ under $TMPDIR (no real record is touched), and
# a mutate() call sits right before the final `expect(deliveryFingerprint()).toEqual(before)`. The whole file runs (31 tests; the suite is sequential, so the G6 test needs the earlier tests: attempt 1 with -t was invalid, see 06-a08-mutants-attempt1-filtered-INVALID.log).
# Mutants: none (control, pass) | stages | requirements | findings-removed | new-gate-DG7 | new-review | candidates (out of scope: pass)
set -u
C=${CLONE:-$TMPDIR/review-dg4r10}; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-10; L=$E/06-a08-mutants.log
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; SRC=tests/qa/integration/a08-gate-controls.test.ts; M=tests/qa/integration/zz-qa-r10-a08-mutant-$$.test.ts
SCR=$TMPDIR/a08-scratch-delivery-$$
python3 -I - "$SRC" "$M" <<'PY'
import sys
s=open(sys.argv[1]).read()
a='const DELIVERY = fileURLToPath(new URL("../../../docs/delivery/", import.meta.url));'
assert s.count(a)==1
s=s.replace(a,'const DELIVERY = process.env["QA_R10_DELIVERY"]!.replace(/\\/?$/, "/");')
b='    expect(deliveryFingerprint()).toEqual(before);\n  });\n});'
assert s.count(b)==1
s=s.replace(b,'    qaR10Mutate();\n'+b)
s=s.replace('import { afterAll,','import { appendFileSync as qaAppend, mkdirSync as qaMkdir, rmSync as qaRm, writeFileSync as qaWrite } from "node:fs";\nimport { afterAll,',1)
s+='''
function qaR10Mutate(): void {
  const m = process.env["QA_R10_MUTANT"] ?? "none";
  const d = DELIVERY;
  if (m === "stages") qaAppend(join(d, "stages.json"), " ");
  else if (m === "requirements") qaAppend(join(d, "requirements.csv"), "\\n");
  else if (m === "findings-removed") qaRm(join(d, "findings.json"));
  else if (m === "new-gate-DG7") qaWrite(join(d, "gates", "DG7.json"), "{}");
  else if (m === "new-review") { qaMkdir(join(d, "reviews", "DG7", "round-1"), { recursive: true }); qaWrite(join(d, "reviews", "DG7", "round-1", "x.json"), "{}"); }
  else if (m === "candidates") { qaMkdir(join(d, "candidates", "DG7"), { recursive: true }); qaWrite(join(d, "candidates", "DG7", "x.json"), "{}"); }
}
'''
open(sys.argv[2],'w').write(s)
PY
{ echo "## $(date -u +%FT%TZ) scratch mutant diff (a08 -> zz-qa-r10-a08-mutant)"; diff -u $SRC $M; 
for MUT in none stages requirements findings-removed new-gate-DG7 new-review candidates; do
  rm -rf $SCR; mkdir -p $SCR; cp -a docs/delivery/{gates,stages.json,findings.json,reviews,decisions.md,requirements.csv} $SCR/; mkdir -p $SCR/candidates
  echo; echo "### MUTANT=$MUT  load: $(cut -d' ' -f1-3 /proc/loadavg)"
  QA_R10_MUTANT=$MUT QA_R10_DELIVERY=$SCR QA_PG_PORT=26620 MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $M 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "✓|×|FAIL|AssertionError|^\s+[-+] +\"|Tests |Test Files|skipped|Error" | head -30
  echo "EXIT(MUTANT=$MUT) ${PIPESTATUS[0]}"
done
rm -f $M; rm -rf $SCR; echo; echo "scratch removed; git status of the clone:"; git status --short; echo "(end)"; date -u +%FT%TZ; } > $L 2>&1
grep -E "^### |^EXIT|Tests " $L
