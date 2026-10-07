// F-DG2-430: self-test of the unit-web React warning guard (apps/web/test/react-warning-guard.ts, installed by
// apps/web/test/setup.ts). The guard fails a test on React's "Cannot update a component ... while rendering a different
// component" and act() warnings, and on nothing else. React's real warning is produced here with console.error
// silenced by a spy (so the warning text never reaches the unit log), then handed to the guard's own matcher.
import { cleanup, render } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertNoReactWarnings,
  reactWarningOf,
  recordConsoleError,
  takeReactWarnings,
} from "../../test/react-warning-guard.ts";

afterEach(cleanup);

/**
 * The pre-fix RecordForm shape: a child calls the parent's setState from inside its own state updater. React prints
 * the warning once per component pair, so every call makes components with their own names.
 */
let pairs = 0;
function impurePair(): ReactElement {
  const id = ++pairs;
  function Child({ onChange }: { onChange: (n: number) => void }) {
    const [n, setN] = useState(0);
    if (n === 0) {
      setN((v) => {
        onChange(v + 1); // side effect in an updater: React runs it while rendering Child
        return v + 1;
      });
    }
    return <p>{n}</p>;
  }
  function Parent() {
    const [, setSeen] = useState(0);
    return <Child onChange={(n) => setSeen(n)} />;
  }
  Child.displayName = `ImpureChild${id}`;
  Parent.displayName = `ImpureParent${id}`;
  return <Parent />;
}

/** Renders `ui` with console.error silenced and returns every console.error call's arguments. */
function consoleErrorsOf(ui: ReactElement): unknown[][] {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    render(ui);
    return spy.mock.calls.map((args) => [...args]);
  } finally {
    spy.mockRestore();
  }
}

describe("unit-web React warning guard (F-DG2-430)", () => {
  it("recognises React's real warning for a parent setState inside a child's state updater", () => {
    const calls = consoleErrorsOf(impurePair());
    const warnings = calls.map(reactWarningOf).filter((w): w is string => w !== null);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Cannot update a component \(`ImpureParent\d+`\) while rendering .*`ImpureChild\d+`/);
  });

  it("fails the test (throws) once such a warning is recorded, and is clear again afterwards", () => {
    for (const args of consoleErrorsOf(impurePair())) recordConsoleError(args);
    expect(() => assertNoReactWarnings("in the self-test")).toThrow(/F-DG2-430 guard.*1 warning/);
    expect(takeReactWarnings()).toEqual([]);
    expect(() => assertNoReactWarnings("in the self-test")).not.toThrow();
  });

  it("recognises act() warnings, formatted from React's printf-style arguments", () => {
    expect(
      reactWarningOf(["An update to %s inside a test was not wrapped in act(...).%s", "Widget", "\n\nWhen testing"]),
    ).toContain("An update to Widget inside a test was not wrapped in act(...)");
  });

  it("ignores every other console.error, so legitimate error-path tests are unaffected", () => {
    for (const args of [
      ["Request failed", new Error("403 forbidden")],
      ["The above error occurred in the <Broken> component."],
      [new Error("Cannot update the record: version conflict")],
      ["%s", "Uncaught rejection"],
    ]) {
      expect(reactWarningOf(args)).toBeNull();
      recordConsoleError(args);
    }
    expect(takeReactWarnings()).toEqual([]);
  });
});
