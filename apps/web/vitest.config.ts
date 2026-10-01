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
    },
  }),
);
