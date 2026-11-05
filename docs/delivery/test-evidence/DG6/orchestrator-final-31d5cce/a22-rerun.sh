cd /home/user/wt/verify; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
S=/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg6/V6
MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 QA_PG_PORT=29360 E2E_API_PORT=29361 MTH_PORT_POOL=29362-29399 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts --workers=1 --repeat-each=3 > $S/a22-rerun.log 2>&1; echo $? > $S/a22-rerun.rc
