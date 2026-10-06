// Web unit tests (ADR-0012): jsdom environment, referenced by the root vitest.config.ts as project "unit-web".
import { defineProject, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: "unit-web",
      // jsdom, with Node's native AbortController/AbortSignal so react-router's request signal is accepted by
      // Node's `Request` on Node 24 as well as Node 22 (F-DG1-214; see test/jsdom-native-abort-environment.ts).
      environment: "./test/jsdom-native-abort-environment.ts",
      include: ["src/**/*.test.{ts,tsx}"],
      // F-DG2-220: test/setup.ts raises Testing Library's async-utility timeout (findBy*/waitFor) from 1000 ms to
      // 5000 ms. The per-test timeout stays 4x above it, so a test with several sequential waits (e.g. open a page,
      // open a dialog, wait for the request) has headroom under parallel load, and a wait that never resolves still
      // fails with Testing Library's own "Unable to find ..." message before the test itself times out.
      setupFiles: ["./test/setup.ts"],
      testTimeout: 20_000,
    },
  }),
);
