#!/usr/bin/env bash
# Mutation checks for T-DG5-QA-C, run ONLY in the disposable copy $TMPDIR/mut (never the candidate tree).
set -u
M="$TMPDIR/mut"; OUT="$1"; mkdir -p "$OUT"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
case "$M/" in "$TMPDIR"/*) ;; *) echo REFUSED; exit 64;; esac
run() { # id file sed-expr test-file pattern
  local id="$1" f="$M/$2" expr="$3" tf="$4" pat="$5"
  cp "$f" "$f.orig"
  sed -i "$expr" "$f"
  if cmp -s "$f" "$f.orig"; then echo "$id: MUTATION NOT APPLIED" | tee "$OUT/$id.log"; mv "$f.orig" "$f"; return; fi
  { echo "### $id"; echo "file: $2"; echo "sed: $expr"; diff "$f.orig" "$f"; echo "test: $tf -t \"$pat\""; } > "$OUT/$id.log"
  (cd "$M" && QA_PG_PORT=23730 MTH_PORT_POOL=23731-23749 timeout 1500 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$tf" -t "$pat") >> "$OUT/$id.log" 2>&1
  local rc=$?
  echo "EXIT=$rc" >> "$OUT/$id.log"
  mv "$f.orig" "$f"
  echo "$id exit=$rc $(sed 's/\x1b\[[0-9;]*m//g' "$OUT/$id.log" | grep -E '^ +Tests ' | tail -1)"
}
run M1-injection packages/reporting/src/injection.ts 's/return startsLikeFormula(text) ? { text: `'"'"'${text}`, prefixed: true } : { text, prefixed: false };/return { text, prefixed: false };/' tests/qa/integration/a15-selected-records-and-injection.test.ts "REQ-S13-006"
run M2-ar-labels-fall-back packages/reporting/src/labels.ts 's/const own = content?.\[language\] ?? {};/const own = content?.["en"] ?? {};/' tests/qa/integration/a15-outputs-every-definition.test.ts "every file carries"
run M3-kpi-target-not-as-of apps/api/src/modules/reporting/reports/assemblers/registers.ts '351s/\.where("status", "=", "active")/.where("status", "in", ["active", "draft"]).orderBy("version_no", "desc")/' tests/qa/integration/a15-snapshots-and-packs.test.ts "REQ-S13-007"
run M4-raid-filter-ignored apps/api/src/modules/reporting/reports/assemblers/registers.ts '103s/if (f.type !== undefined)/if (false)/' tests/qa/integration/a15-selected-records-and-injection.test.ts "REQ-S13-005: an XLSX"
run M5-presentation-ignores-snapshot apps/api/src/modules/governance/presentation.ts '76s/if (snapshotId !== undefined) {/if (false \&\& snapshotId !== undefined) {/' tests/qa/integration/a15-snapshots-and-packs.test.ts "issued meeting pack"
run M6-no-provenance-footer apps/worker/src/reports/export-runner.ts 's/^  if (row === undefined) return null;$/  if (row !== null) return null;/' tests/qa/integration/a15-outputs-every-definition.test.ts "every file"
