#!/usr/bin/env bash
# qa-verifier DG7 round 4 (T-DG7-REV-QA-R4): A18 on a fresh archive built from the FROZEN candidate clone (471072d6).
# Part 1: transfer-drill.sh directly with --keep, so the target cluster's pg.log shows whether D9 really stopped and
#         restarted PostgreSQL (F-DG7-921, independent of the register's citation).
# Part 2: the shipped A18 harness (tests/qa/integration/a18-transfer-drill.test.ts) with QA_A18_REQUIRE=1 on the same
#         archive (missing inputs FAIL, never skip).
# Run under tests/qa/support/with-pg.sh. SYNTHETIC data only; nothing here approves anything (no G1-G6, Finance, IT, DG).
set -u
REPO="${QA_REPO:?}"; OUT="${QA_OUT:?}"; B="$TMPDIR/qa-r4-a18"; CAND=sha256:d91f7152950ed7119b412db0135836c53a3f01e95300af32c86db367f0712e59
[ -e "$B" ] && { echo "BLOCKED: $B exists"; exit 2; }
cd "$REPO"; ts() { date -u +%T; }
echo "start $(ts); HEAD $(git rev-parse HEAD); node $(node -v); free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
U=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_a18_src";u.username="mth_owner";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_a18_src OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_a18_src TO mth_app;
SQL
(cd packages/db && DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate >/dev/null && \
  DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo | grep "reporting periods relative to") || { echo "demo db FAIL"; exit 1; }
DATABASE_OWNER_URL="$U" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -3
echo "demo export exit ${PIPESTATUS[0]}; manifest sha256 $(sha256sum "$B/export/manifest.json" | cut -c1-64)"
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --candidate $CAND --out "$B/arch" | tail -3
echo "build-archive exit ${PIPESTATUS[0]}"
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") $(stat -c %s "$A") bytes sha256 $S"
node tools/release/build-archive.mjs --verify "$A" --expect-sha256 "$S" --candidate $CAND; echo "archive --verify exit $?"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_a18_src WITH (FORCE);"; rm -rf "$B/export"
mkdir -p "$B/store" && cp -a "${QA_STORE_SRC:?}" "$B/store/v10"
mkdir -p "$OUT/direct"; W="$B/work"
echo "--- part 1: transfer-drill.sh --keep start $(ts) free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$OUT/direct" --work "$W" --keep > "$OUT/direct/stdout.txt" 2> "$OUT/direct/stderr.txt"
rc1=$?; echo "part 1 drill exit $rc1 $(ts)"; grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL)' "$OUT/direct/stdout.txt"
echo "stderr lines: $(wc -l < "$OUT/direct/stderr.txt")"; head -5 "$OUT/direct/stderr.txt"
echo "--- target cluster pg.log: shutdown / startup lines (F-DG7-921)"
grep -n -E 'received fast shutdown|database system is shut down|database system is ready to accept connections|starting PostgreSQL' "$W/pgT/pg.log" | sed 's/^/  /'
cp "$W/pgT/pg.log" "$OUT/direct/pgT-pg.log" 2>/dev/null
pgrep -f "$W/pg" >/dev/null && echo "drill PostgreSQL left running: YES" || echo "drill PostgreSQL left running: none"
rm -rf "$W"; echo "removed work tree $(ts)"
echo "--- part 2: A18 harness start $(ts) free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
mkdir -p "$OUT/harness"
QA_A18_REQUIRE=1 QA_A18_ARCHIVE="$A" QA_A18_ARCHIVE_SHA256="$S" QA_A18_STORE="$B/store" QA_A18_OUT="$OUT/harness" \
  npx vitest run --project integration tests/qa/integration/a18-transfer-drill.test.ts --reporter=verbose
rc2=$?; echo "A18 harness exit $rc2 end $(ts)"
rm -rf "$B"; echo "removed $B"
echo "part 1 drill exit $rc1; part 2 harness exit $rc2"
[ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ] || exit 1
exit 0
