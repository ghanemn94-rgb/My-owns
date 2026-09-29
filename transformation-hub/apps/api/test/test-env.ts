/** Environment for integration tests (shared by vitest config and global setup). */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  HUB_MODE: 'demo',
  HUB_ORG_SLUG: 'mobily',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test',
  DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL ?? 'postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test',
  HUB_STORAGE_LOCAL_DIR: '.data/test-objects',
  HUB_LOG_LEVEL: 'error',
};
