#!/usr/bin/env bash
# Applies mutation $1 to the disposable clone $M (never to the working tree), runs the A02/A21 file, restores.
set -u
M="$1"; ID="$2"; LOG="$3"
cd "$M"
git checkout -q -- apps packages
case "$ID" in
  M0) : ;;
  M1) python3 - <<'P'
p='apps/api/src/modules/admin/walkthrough.ts'; s=open(p).read()
a='''  benefit_validated: (t) =>
    sql`SELECT EXISTS'''
assert a in s; s=s.replace(a,'''  benefit_validated: (t) =>
    sql`SELECT false AND EXISTS''',1); open(p,'w').write(s)
P
  ;;
  M2) python3 - <<'P'
p='apps/api/src/modules/admin/walkthrough.ts'; s=open(p).read()
a="""                         AND NOT EXISTS (SELECT 1 FROM demo_seed_record r
                                          WHERE r.record_type = 'transformation' AND r.record_id = x.id)) AS done`,"""
assert a in s; s=s.replace(a,""")) AS done`,""",1); open(p,'w').write(s)
P
  ;;
  M3) python3 - <<'P'
p='apps/api/src/modules/reporting/reports/assemblers/executive-pack.ts'; s=open(p).read()
a='["achievements", r.achievements],'
assert a in s; s=s.replace(a,'["achievements", r.achievements === null ? null : "Edited by hand"],',1); open(p,'w').write(s)
P
  ;;
  M4) python3 - <<'P'
p='apps/api/src/modules/procedures/definitions.ts'; s=open(p).read()
a='descriptionEn: r.completion_en,'
assert a in s; s=s.replace(a,'descriptionEn: `${r.completion_en} Upload the signed spreadsheet.`,',1); open(p,'w').write(s)
P
  ;;
  M5) python3 - <<'P'
p='apps/api/src/modules/admin/environment.ts'; s=open(p).read()
a='coverage: asObject(r.coverage),'
assert a in s; s=s.replace(a,'coverage: { ...(asObject(r.coverage) as Record<string, number>), "kpi.stale": 0 },',1); open(p,'w').write(s)
P
  ;;
  M6) python3 - <<'P'
p='apps/api/src/modules/procedures/outputs/kpi.ts'; s=open(p).read()
a='''  advanced: (r) => r.state["status"] === "active" && r.state["validation_status"] === "validated",'''
assert a in s; s=s.replace(a,'''  advanced: (r) => r.state["status"] === "active",''',1); open(p,'w').write(s)
P
  ;;
esac
git diff --stat -- apps packages
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
QA_PG_PORT=23655 MTH_PORT_POOL=23656-23669 timeout 600 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa/integration/a02-a21-complete-lifecycle.test.ts > "$LOG" 2>&1
echo "$ID vitest exit=$?"
git diff -- apps packages > "$LOG.diff"
git checkout -q -- apps packages
