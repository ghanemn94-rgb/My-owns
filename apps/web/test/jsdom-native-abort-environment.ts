// Web unit-test environment (test harness only, F-DG1-214): Vitest's built-in jsdom environment, but with Node's
// native AbortController/AbortSignal kept as the globals.
//
// Why: the built-in jsdom environment copies jsdom's own AbortController/AbortSignal onto the global object, while
// `Request`/`fetch` stay Node's (undici). react-router's createClientSideRequest builds
// `new Request(url, { signal: new AbortController().signal })`. On Node 24 (undici 7) the Request constructor checks
// `signal instanceof AbortSignal` against Node's *native* AbortSignal, so a jsdom signal is rejected with
// "RequestInit: Expected signal to be an instance of AbortSignal" (Node 22 / undici 6 accepted it, which hid the
// mismatch). Keeping the abort primitives in the same realm as `Request` makes both runtimes behave like a browser,
// where AbortSignal and Request always share one realm. Everything else (document, window, events, storage) is
// unchanged jsdom.
import { builtinEnvironments, type Environment } from "vitest/environments";

const ABORT_GLOBALS = ["AbortController", "AbortSignal"] as const;

const jsdomWithNativeAbort: Environment = {
  name: "jsdom-native-abort",
  transformMode: "web",
  async setup(global, options) {
    // Captured before jsdom populates the global object, i.e. Node's native constructors (same realm as Request).
    const native = ABORT_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)] as const);
    const jsdomEnv = await builtinEnvironments.jsdom.setup(global, options);
    for (const [key, descriptor] of native) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
    }
    return jsdomEnv;
  },
};

export default jsdomWithNativeAbort;
