S=/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg6/V4; cd /home/user/wt/verify; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
step(){ n=$1; shift; [ -f $S/$n.rc ] && return; "$@" > $S/$n.log 2>&1; echo $? > $S/$n.rc; }
step contrast pnpm --filter @mth/design-tokens run check:contrast
step e2e-unset env -u LANG -u LC_ALL -u LC_CTYPE MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 QA_PG_PORT=29350 E2E_API_PORT=29351 MTH_PORT_POOL=29352-29390 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1
step e2e-cutf8 env MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 LANG=C.UTF-8 LC_ALL=C.UTF-8 QA_PG_PORT=29350 E2E_API_PORT=29351 MTH_PORT_POOL=29352-29390 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1
step root bash -c 'MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 QA_PG_PORT=29360 E2E_API_PORT=29361 MTH_PORT_POOL=29362-29390 apps/web/e2e/support/with-stack.sh npx playwright test $(ls e2e/*.spec.ts | grep -v /a02-) --workers=1'
step demo bash -c 'QA_PG_PORT=29400 E2E_API_PORT=29401 MTH_PORT_POOL=29402-29430 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-*.spec.ts --workers=1'
touch $S/done
