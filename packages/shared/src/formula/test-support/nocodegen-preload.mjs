// Test helper for the Vitest project `unit-formula-nocodegen` (ADR-0024 §6 run-time guard; F-DG3-100). NOT engine code:
// it is never imported by the engine, never built (tsconfig has no allowJs) and runs only as `node --import` in the
// forked test processes that vitest.config.ts starts with --disallow-code-generation-from-strings.
//
// Why it exists. Vitest's forks pool runs on tinypool 1.1.1. When a fork starts, tinypool warms the worker module with
// the handler name "default"; vitest's worker module has no default export, so tinypool falls back to
// `new Function("specifier", "return import(specifier)")`, which throws EvalError under the flag and kills the fork
// before any test runs. This preload rewrites only the name in that one warm-up message to "run", an export the worker
// module does have, so tinypool loads it through its normal `import()` path. It does NOT re-enable, wrap or emulate any
// code generation: the flag stays in force for the whole process, which the canary (codegen.nocodegen.test.ts)
// asserts. If tinypool changes its protocol, forks crash or the canary fails: the guard fails loudly, never silently.
const FLAG = "--disallow-code-generation-from-strings";

if (process.execArgv.includes(FLAG) && typeof process.send === "function") {
  const originalOn = process.on;
  process.on = function patchedOn(event, listener) {
    if (event !== "message") return originalOn.call(this, event, listener);
    // The first "message" listener is tinypool's worker entry; later listeners (Vitest's RPC) are untouched.
    process.on = originalOn;
    return originalOn.call(this, event, (message, ...rest) => {
      const warmUp =
        message !== null &&
        typeof message === "object" &&
        message.__tinypool_worker_message__ === true &&
        message.source === "pool" &&
        message.name === "default";
      return listener(warmUp ? { ...message, name: "run" } : message, ...rest);
    });
  };
}
