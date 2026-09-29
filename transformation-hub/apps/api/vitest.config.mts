import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { TEST_ENV } from './test/test-env';

// Integration tests run against a real PostgreSQL database (hub_test), serially (shared DB).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } })],
  test: {
    root: __dirname,
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    env: TEST_ENV,
  },
});
