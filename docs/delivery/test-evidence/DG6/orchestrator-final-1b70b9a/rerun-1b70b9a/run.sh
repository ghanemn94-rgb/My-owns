S=/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg6/verify-final6; cd /home/user/wt/verify; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
step(){ n=$1; shift; [ -f $S/$n.rc ] && return; "$@" > $S/$n.log 2>&1; echo $? > $S/$n.rc; }
step head git log --oneline -1
step typecheck pnpm -r typecheck
step lint pnpm lint
step format pnpm format:check
step integration env QA_PG_PORT=26700 MTH_PORT_POOL=26701-26740 MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 tests/qa/support/with-pg.sh pnpm test:integration
touch $S/done
