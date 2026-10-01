#!/usr/bin/env bash
# domain-reviewer DG1 runtime scenario (disposable stack; SYNTHETIC users)
set -u
B=http://localhost:3000; H=(-H "Origin: $B" -H "Content-Type: application/json")
J=$TMPDIR/jar; mkdir -p $J
login(){ curl -s -o /dev/null -w "%{http_code}" -c $J/$1 -b $J/$1 "${H[@]}" -X POST $B/api/v1/auth/dev-login -d "{\"username\":\"$1\"}"; }
csrf(){ curl -s -b $J/$1 $B/api/v1/me | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.csrfToken)})'; }
echo "1 unauth branding: $(curl -s -o /dev/null -w %{http_code} $B/api/v1/branding/tokens)"
echo "2 login dev.lead: $(login dev.lead)"; C=$(csrf dev.lead)
echo "3 branding tokens:"; curl -s -b $J/dev.lead $B/api/v1/branding/tokens; echo
echo "4 create E2E transformation (no tz/currency):"
R=$(curl -s -b $J/dev.lead "${H[@]}" -H "X-CSRF-Token: $C" -H "Idempotency-Key: domrev-create-0001" -X POST $B/api/v1/transformations -d '{"businessUnitId":"01920000-0000-7000-9000-000000000102","name":"Synthetic roaming review","mode":"end_to_end"}')
echo "$R"; ID=$(echo "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
patch(){ curl -s -w " HTTP=%{http_code}" -b $J/dev.lead "${H[@]}" -H "X-CSRF-Token: $C" -H "If-Match: \"$1\"" -X PATCH $B/api/v1/transformations/$ID -d "$2"; echo; }
echo "5 draft->active:"; patch 1 '{"status":"active"}'
echo "6 active->closed (no G6, no benefits exist):"; patch 2 '{"status":"closed"}'
echo "7 closed->active (reopen):"; patch 3 '{"status":"active"}'
echo "8 illegal draft-type transition status code check done above"
echo "9 audit trail:"; curl -s -b $J/dev.lead $B/api/v1/transformations/$ID/audit | head -c 1500; echo
echo "10 login dev.admin: $(login dev.admin)"; CA=$(csrf dev.admin)
echo "11 admin GET transformation: $(curl -s -o /dev/null -w %{http_code} -b $J/dev.admin $B/api/v1/transformations/$ID)"
echo "12 admin list transformations:"; curl -s -w " HTTP=%{http_code}" -b $J/dev.admin $B/api/v1/transformations | head -c 400; echo
echo "13 admin self-grant SP at org:"; curl -s -w " HTTP=%{http_code}" -b $J/dev.admin "${H[@]}" -H "X-CSRF-Token: $CA" -H "Idempotency-Key: domrev-grant-0001" -X POST $B/api/v1/role-assignments -d '{"userId":"01920000-0000-7000-9000-000000000201","roleCode":"SP","scope":{"type":"organization","id":"01920000-0000-7000-9000-000000000001"},"reason":"domain review SoD probe"}'; echo
echo "14 roles (kinds/perms):"; curl -s -b $J/dev.admin $B/api/v1/roles | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const r of (j.items||j)) console.log(r.code,r.kind,(r.permissions||[]).join(","))})'
echo "15 worker start/stop, API survives:"
node apps/worker/dist/main.js > $TMPDIR/worker.log 2>&1 & WP=$!; sleep 6
echo "   worker alive: $(kill -0 $WP 2>/dev/null && echo yes || echo no)"; kill -TERM $WP; wait $WP; echo "   worker exit=$?"
echo "   readyz after worker stop: $(curl -s -w ' HTTP=%{http_code}' $B/readyz)"
echo "   GET transformation after worker stop: $(curl -s -o /dev/null -w %{http_code} -b $J/dev.lead $B/api/v1/transformations/$ID)"
echo "   worker log:"; cat $TMPDIR/worker.log
echo "16 org defaults:"; psql "$DATABASE_OWNER_URL" -At -c "select default_timezone, default_currency, default_locale from organization"
echo "17 SoD trigger direct insert (owner):"; psql "$DATABASE_OWNER_URL" -At -c "insert into role_permission(role_id,permission_code) select id,'finance.validate' from role where code='ADM_TECH'" 2>&1 | head -2
echo "18 numeric money cols present at P1:"; psql "$DATABASE_OWNER_URL" -At -c "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and data_type in ('real','double precision','money')"
echo "19 tables:"; psql "$DATABASE_OWNER_URL" -At -c "select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public'"
