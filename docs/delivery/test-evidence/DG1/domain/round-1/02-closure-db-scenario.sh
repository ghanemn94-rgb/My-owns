#!/usr/bin/env bash
set -u
B=http://localhost:3000; H=(-H "Origin: $B" -H "Content-Type: application/json")
J=$TMPDIR/jar2; mkdir -p $J
ADMIN="postgresql://postgres@127.0.0.1:${QA_E2E_PG_PORT}/mth"
login(){ curl -s -o /dev/null -w "%{http_code}" -c $J/$1 -b $J/$1 "${H[@]}" -X POST $B/api/v1/auth/dev-login -d "{\"username\":\"$1\"}"; }
csrf(){ curl -s -b $J/$1 $B/api/v1/me | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).csrfToken))'; }
U=dev.office; echo "1 login $U: $(login $U)"; C=$(csrf $U)
post(){ curl -s -b $J/$U "${H[@]}" -H "X-CSRF-Token: $C" -H "Idempotency-Key: $1" -X POST $B/api/v1/transformations -d "$2"; }
idof(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))'; }
R=$(post domrev-c-0001 '{"businessUnitId":"01920000-0000-7000-9000-000000000102","name":"Synthetic E2E closure probe","mode":"end_to_end"}'); echo "2 create: $R"; ID=$(echo "$R"|idof)
patch(){ curl -s -w " HTTP=%{http_code}" -b $J/$U "${H[@]}" -H "X-CSRF-Token: $C" -H "If-Match: \"$1\"" -X PATCH $B/api/v1/transformations/$ID -d "$2"; echo; }
echo "3 draft->closed (illegal):"; patch 1 '{"status":"closed"}'
echo "4 draft->active:"; patch 1 '{"status":"active"}'
echo "5 active->closed (no G6, no benefit register exists):"; patch 2 '{"status":"closed"}'
echo "6 closed->active (reopen):"; patch 3 '{"status":"active"}'
echo "7 currentPhase change attempt:"; patch 3 '{"currentPhase":"realize"}'
echo "8 audit trail:"; curl -s -b $J/$U $B/api/v1/transformations/$ID/audit | head -c 1600; echo
echo "9 modular standalone TOM at design:"; post domrev-c-0002 '{"businessUnitId":"01920000-0000-7000-9000-000000000101","name":"Synthetic modular TOM","mode":"modular","entryPhase":"design","standaloneDeliverableType":"target_operating_model","currency":"USD","timezone":"Europe/London"}'; echo
echo "10 modular without entryPhase:"; post domrev-c-0003 '{"businessUnitId":"01920000-0000-7000-9000-000000000101","name":"Synthetic bad modular","mode":"modular"}'; echo
echo "11 org defaults:"; psql "$ADMIN" -At -c "select default_timezone, default_currency, default_locale from organization"
echo "12 SoD trigger (owner insert ADM_TECH+finance.validate):"; psql "$ADMIN" -At -c "insert into role_permission(role_id,permission_code) select id,'finance.validate' from role where code='ADM_TECH'" 2>&1 | head -2
echo "13 float/money columns:"; psql "$ADMIN" -At -c "select count(*) from information_schema.columns where table_schema='public' and data_type in ('real','double precision','money')"
echo "14 public tables:"; psql "$ADMIN" -At -c "select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
echo "15 ERD P1 tables vs DB:"; for t in organization business_unit app_user user_identity session oidc_login_state role permission role_permission scoped_assignment delegation transformation audit_event outbox_event processed_message idempotency_record schema_migration; do psql "$ADMIN" -At -c "select to_regclass('public.$t') is not null" | sed "s/^/$t=/"; done | tr '\n' ' '; echo
echo "16 audit immutability as mth_app:"; psql "$ADMIN" -At -c "set role mth_app; update audit_event set reason='x'" 2>&1 | head -1
