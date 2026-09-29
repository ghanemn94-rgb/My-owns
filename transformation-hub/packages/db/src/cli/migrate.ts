import { runMigrations } from '../migrate';

const url = process.env.DATABASE_MIGRATION_URL ?? 'postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_dev';
runMigrations(url).catch((e) => {
  console.error('migration failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
