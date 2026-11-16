// qa-verifier support (T-DG7-QA-F): wait for a child process's READY line deterministically.
//
// Root cause of the pre-freeze run 2 failure "a13c-child-api.ts exited (0) before READY: READY": the former waiter
// polled every 150 ms and checked `child.exitCode !== null` BEFORE it looked for READY in the output. A child in
// `request` mode (a13c-child-api.ts) prints READY, runs its one request, prints RESPONSE and exits 0 by design. When
// the request is fast (the restarted import commit, with the blocking trigger switched off), the whole sequence fits
// between two polls, so the next poll saw an exit code although READY (and the RESPONSE) had already been received,
// and reported a failure. Whether a poll landed between READY and exit depended on timing, which is why run 1 passed.
//
// This waiter is event-driven instead of polled:
//  - it resolves on the first `data` chunk that completes a READY line (on stdout or stderr);
//  - it rejects only on `close`, which Node emits after the process has exited AND every stdio stream has ended, so
//    all output the child wrote has been delivered as `data` events first. "Exited before READY" is therefore only
//    reported when the child really never printed READY;
//  - it rejects on a spawn `error` and on a timeout.
// A child that exits after READY is not an error here; whether that exit is expected is the caller's business.
import type { ChildProcess } from "node:child_process";

export interface ChildOutput {
  /** Everything the child has written to stdout and stderr so far, in arrival order. */
  output(): string;
  /** Resolves when a line equal to `marker` has been received; rejects as described above. */
  readonly ready: Promise<void>;
}

export function watchChildOutput(child: ChildProcess, what: string, marker = "READY", ms = 90_000): ChildOutput {
  let out = "";
  let seen = false;
  const line = new RegExp(`(?:^|\\n)${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n`);
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const timer = setTimeout(() => {
    settle?.reject(new Error(`timed out after ${ms} ms waiting for ${what} ${marker}: ${out}`));
    settle = null;
  }, ms);
  timer.unref();
  const done = (e?: Error) => {
    clearTimeout(timer);
    if (settle === null) return;
    if (e) settle.reject(e);
    else settle.resolve();
    settle = null;
  };
  const onData = (b: Buffer) => {
    out += b.toString();
    if (!seen && line.test(out)) {
      seen = true;
      done();
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.once("error", (e) => done(new Error(`${what} failed to start: ${e.message}\n${out}`)));
  child.once("close", (code, signal) => {
    if (!seen) done(new Error(`${what} exited (${signal ?? code}) before ${marker}: ${out}`));
  });
  return { output: () => out, ready };
}
