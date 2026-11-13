#!/usr/bin/env bash
# restore-drill.sh: the A19 restore drill (ADR-0066 §9; p7-work-split §E.2; T-DG7-DO-F). REQ-S19-012, REQ-S20-019.
#
#   deploy/scripts/restore-drill.sh --admin-url <superuser url of a disposable cluster> --work <dir> [--out <dir>]
#
# Steps: the SYNTHETIC demo installation (a fresh database, `mth-db migrate`, `mth-db seed-demo`, an empty evidence
# root) -> backup.sh -> a fresh target (a new database, a new empty evidence root) -> restore.sh (R1-R8) -> R9 (the
# ADR-0050 demo checksum of the restored database equals the source's) -> drill-report.json with the measured timings.
#
# This is the CONTAINER-FREE half (D-243 Q1): one local PostgreSQL cluster (same major on both sides, D-243 Q14) and
# filesystem evidence roots. The Compose half (the `backup` profile on the pinned postgres:18 image, a second Compose
# project with new volumes, /readyz over HTTP) runs on the orchestrator's host: docs/handover/backup-restore.md
# "Compose drill". A local drill is NOT proof of high-availability production readiness, and its timings are drill
# timings on the synthetic demo, not recovery objectives (RPO/RTO are to agree with Mobily IT).
#
# Example (from the repository root):
#   tests/qa/support/with-pg.sh bash -c 'deploy/scripts/restore-drill.sh --admin-url "$TEST_DATABASE_ADMIN_URL" \
#     --work "$TMPDIR/a19-drill" --out "$TMPDIR/a19-drill"'
#
# Exit codes: 0 every check passed; 1 a check failed; 2 usage; 3 a missing tool. Approves nothing; never touches
# DG0-DG7.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
admin="" work="" out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --admin-url) admin="${2:-}"; shift 2 ;;
    --work) work="${2:-}"; shift 2 ;;
    --out) out="${2:-}"; shift 2 ;;
    *) echo "BLOCKED: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$admin" ] && [ -n "$work" ] || {
  echo "BLOCKED: usage: restore-drill.sh --admin-url <url> --work <dir> [--out <dir>]" >&2
  exit 2
}
[ -n "$out" ] || out="$work"
command -v node >/dev/null || { echo "BLOCKED: node not found" >&2; exit 3; }
PSQL="${PGBIN:+$PGBIN/}psql"
command -v "$PSQL" >/dev/null || { echo "BLOCKED: psql not found (set PGBIN)" >&2; exit 3; }
mkdir -p "$work" "$out"
clock() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.3f", (b - a) }'; }
sql() { "$PSQL" -X -q -A -t -v ON_ERROR_STOP=1 "$admin" -c "$1"; }
# The admin URL with another database and `-c role=<role>` (the convention of packages/db/test/helpers.ts).
role_url() {
  node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2];
    if (process.argv[3]) u.searchParams.set("options", "-c role=" + process.argv[3]); console.log(u.toString());' \
    "$admin" "$1" "${2:-}"
}
checksum() {
  (cd "$REPO/packages/db" && DATABASE_URL="$1" node --conditions=@mth/source --input-type=module -e '
    import { createDb, createPool, datasetChecksum } from "./src/index.ts";
    const db = createDb(createPool(process.env.DATABASE_URL, { max: 1 }));
    try { console.log(await datasetChecksum(db)); } finally { await db.destroy(); }')
}

suffix="$(date -u +%Y%m%d%H%M%S)_$$"
src="mth_drill_src_$suffix"
tgt="mth_drill_tgt_$suffix"
for r in mth_owner mth_app; do
  [ "$(sql "SELECT count(*) FROM pg_roles WHERE rolname = '$r'")" = 1 ] || sql "CREATE ROLE $r NOLOGIN"
done
for d in "$src" "$tgt"; do
  sql "CREATE DATABASE $d OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
  sql "ALTER DATABASE $d SET timezone TO 'UTC'"
done
cleanup() { for d in "$src" "$tgt"; do sql "DROP DATABASE IF EXISTS $d WITH (FORCE)" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
src_url="$(role_url "$src" mth_owner)"
tgt_url="$(role_url "$tgt" mth_owner)"
mkdir -p "$work/source-evidence" "$work/backups"
rm -rf "$work/target-evidence"

T0="$(clock)"
(cd "$REPO/packages/db" && DATABASE_OWNER_URL="$src_url" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate) \
  >"$out/drill-migrate.log" 2>&1
(cd "$REPO/packages/db" && DATABASE_OWNER_URL="$src_url" NODE_ENV=development AUTH_MODE=dev MTH_ENV=demo \
  node --conditions=@mth/source src/cli.ts seed-demo) >"$out/drill-seed.log" 2>&1
T1="$(clock)"
src_sum="$(checksum "$src_url")"

label="drill-$(date -u +%Y%m%dt%H%M%Sz)"
B0="$(clock)"
DATABASE_URL="$src_url" EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$work/source-evidence" \
  bash "$HERE/backup.sh" --out "$work/backups" --label "$label" --operator "restore-drill (synthetic)" \
  2>&1 | tee "$out/drill-backup.log"
B1="$(clock)"
set +e
EVIDENCE_STORAGE_DRIVER=filesystem bash "$HERE/restore.sh" --from "$work/backups/$label" \
  --target-database-url "$tgt_url" --target-evidence-path "$work/target-evidence" --out "$out" \
  --manifest-sha256 "$(sha256sum "$work/backups/$label/backup-manifest.json" | cut -d' ' -f1)" \
  2>&1 | tee "$out/drill-restore.log"
rc="${PIPESTATUS[0]}"
set -e
R1="$(clock)"
tgt_sum="$(checksum "$tgt_url")"
R9="FAIL"
[ "$src_sum" = "$tgt_sum" ] && [ -n "$src_sum" ] && R9="PASS"
R2="$(clock)"

node -e '
  const fs = require("node:fs");
  const [out, label, rc, r9, src, tgt, seed, backup, restore, r9s, total, set] = process.argv.slice(1);
  const report = JSON.parse(fs.readFileSync(out + "/restore-report.json", "utf8"));
  const manifest = JSON.parse(fs.readFileSync(set + "/backup-manifest.json", "utf8"));
  const drill = {
    schemaVersion: "mth-restore-drill/1", label, mode: "container-free (local PostgreSQL, filesystem evidence)",
    dataset: "synthetic demo (mth-db seed-demo)", restoreExit: Number(rc),
    checks: [...report.checks, { id: "R9", name: "demo checksum", expected: src, actual: tgt, result: r9 }],
    timings: { seedSource: Number(seed), backup: Number(backup), backupSteps: manifest.timings,
      restore: Number(restore), restoreSteps: report.steps, r9: Number(r9s), total: Number(total) },
    note: "Measured drill timings on the synthetic demo, not recovery objectives (RPO/RTO are to agree with Mobily IT). Not proof of high-availability production readiness.",
  };
  drill.result = drill.restoreExit === 0 && drill.checks.every((c) => c.result === "PASS") ? "PASS" : "FAIL";
  fs.writeFileSync(out + "/drill-report.json", JSON.stringify(drill, null, 2) + "\n");
  console.log("restore-drill: " + label + " " + drill.result + "; backup " + backup + " s, restore " + restore + " s, R9 " + r9);
  process.exitCode = drill.result === "PASS" ? 0 : 1;
' "$out" "$label" "$rc" "$R9" "$src_sum" "$tgt_sum" "$(secs "$T0" "$T1")" "$(secs "$B0" "$B1")" \
  "$(secs "$B1" "$R1")" "$(secs "$R1" "$R2")" "$(secs "$T0" "$R2")" "$work/backups/$label"
