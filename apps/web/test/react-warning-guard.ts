// F-DG2-430: fails a unit-web test when React prints a "state update during render" or an act() warning.
//
// Scope: ONLY the React warnings matched by REACT_WARNING_PATTERNS fail a test. Every console.error call is still
// forwarded to the real console unchanged, so legitimate error-path tests (an ApiError logged by a component, a
// rejected promise a test expects, React's own uncaught-error report for an error-boundary test) keep passing and
// keep their output. The guard never mocks or silences console.error; it only records the matching messages.
//
// React formats its warnings with printf-style placeholders (`console.error("Cannot update a component (`%s`) ...",
// name)`), so the arguments are formatted with node:util `format` before matching, exactly as Node prints them.
import { format } from "node:util";

/** React warnings that mean a component has a render-phase side effect or an un-awaited update. */
export const REACT_WARNING_PATTERNS: readonly RegExp[] = [
  // setState of another component while rendering (e.g. a side effect inside a state updater, F-DG2-430).
  /Cannot update a component \(`[^`]*`\) while rendering a different component/,
  // setState of the same component class during render (class components / legacy paths).
  /Cannot update during an existing state transition/,
  // An update outside act() in a test, or act() used where the environment doesn't support it.
  /not wrapped in act\(/,
  /The current testing environment is not configured to support act\(/,
  /A component suspended inside an `act` scope, but the `act` call was not awaited/,
];

const captured: string[] = [];
let installed = false;

/** The console.error arguments as Node prints them, if they are a React warning the guard fails on; else null. */
export function reactWarningOf(args: readonly unknown[]): string | null {
  const message = format(...args);
  return REACT_WARNING_PATTERNS.some((p) => p.test(message)) ? message : null;
}

/** Records the console.error arguments if they are a React warning the guard fails on. */
export function recordConsoleError(args: readonly unknown[]): void {
  const warning = reactWarningOf(args);
  if (warning !== null) captured.push(warning);
}

/** Wraps console.error once: forwards every call unchanged, and records the calls that match a React warning pattern. */
export function installReactWarningGuard(): void {
  if (installed) return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    recordConsoleError(args);
    original(...args);
  };
}

/** Returns and clears the React warnings recorded since the last call. */
export function takeReactWarnings(): string[] {
  return captured.splice(0, captured.length);
}

/** Throws (failing the current test or hook) if any React warning was recorded since the last check. */
export function assertNoReactWarnings(where: string): void {
  const found = takeReactWarnings();
  if (found.length === 0) return;
  const first = found[0]!.split("\n")[0];
  throw new Error(
    `React warning printed to console.error ${where} (F-DG2-430 guard, apps/web/test/react-warning-guard.ts): ` +
      `${found.length} warning(s). First: ${first}`,
  );
}
