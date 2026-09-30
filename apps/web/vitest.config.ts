// Web unit tests (ADR-0012): jsdom environment, referenced by the root vitest.config.ts as project "unit-web".
import { defineProject, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: "unit-web",
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  }),
);
