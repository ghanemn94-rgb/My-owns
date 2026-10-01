/** Environment for integration tests (shared by vitest config and global setup). */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  HUB_MODE: 'demo',
  HUB_ORG_SLUG: 'mobily',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test',
  DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL ?? 'postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test',
  HUB_STORAGE_LOCAL_DIR: '.data/test-objects',
  HUB_LOG_LEVEL: 'error',
  // The suite signs the same demo personas in many times a minute: the per-IDENTITY and heavy-class limits (REQ-DAT-016)
  // are lifted here and exercised by their own test with low limits (test/ops/dat-016-rate-limits.spec.ts). The
  // per-session and public limits keep their defaults.
  HUB_RATE_LIMIT_USER_PER_MINUTE: '100000',
  HUB_RATE_LIMIT_USER_MUTATIONS_PER_MINUTE: '100000',
  HUB_RATE_LIMIT_HEAVY_PER_MINUTE: '100000',
};
