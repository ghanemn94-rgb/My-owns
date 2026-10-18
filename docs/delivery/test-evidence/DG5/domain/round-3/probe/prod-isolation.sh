#!/usr/bin/env bash
# domain-reviewer DG5 r2 (copied from round 1): run INSIDE apps/web/e2e/support/with-stack.sh (production-path DB: migrate + seed-dev, no marker)
# and also on a fresh DB initialised with `mth-db bootstrap` in production mode. Prints counts and the seed-demo refusal.
set -u
PGURL=$(node -e 'const u=new URL(process.env.DATABASE_OWNER_URL);u.search="";console.log(u.toString())')
echo "== with-stack DB (migrate + seed-dev, no environment marker)"
psql "$PGURL" -At -c "select 'deployment_environment rows', count(*) from deployment_environment" -c "select 'demo_seed_record rows', count(*) from demo_seed_record" -c "select 'demo_dataset_run rows', count(*) from demo_dataset_run" -c "select 'roaming users', count(*) from user_identity where subject like 'roaming.user.%'" -c "select 'ROAMING transformations', count(*) from transformation where code='ROAMING'"
echo "== seed-demo with MTH_ENV=production"
MTH_ENV=production node packages/db/dist/cli.js seed-demo; echo "seed-demo exit=$?"
echo "== seed-demo with MTH_ENV unset on a non-empty DB"
env -u MTH_ENV node packages/db/dist/cli.js seed-demo; echo "seed-demo exit=$?"
psql "$PGURL" -At -c "select 'demo_seed_record rows after refusals', count(*) from demo_seed_record"
