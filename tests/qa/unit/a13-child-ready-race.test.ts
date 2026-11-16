// qa-verifier (T-DG7-QA-F): regression for the A13 kill-restart harness race seen in pre-freeze run 2
// ("a13c-child-api.ts exited (0) before READY: READY"). A request-mode child prints READY, answers and exits 0 by
// design; the harness must not report that as "exited before READY". Uses tiny inline Node children only (no
// database, no product code).
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { watchChildOutput } from "../support/child-ready.ts";

const node = (code: string) => spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "pipe"] });
const closed = (c: ReturnType<typeof node>) => new Promise((r) => c.once("close", r));

// The child of the failing run: READY, then the response, then process.exit(0) immediately.
const FAST_REQUEST_CHILD = `process.stdout.write("READY\\n"); process.stdout.write("RESPONSE 200 {}\\n"); process.exit(0);`;

describe("A13 harness: waiting for a child's READY line (T-DG7-QA-F)", () => {
  it("root cause: the former exit-first poll misreports a child that printed READY and exited between two polls", async () => {
    const c = node(FAST_REQUEST_CHILD);
    let out = "";
    c.stdout.on("data", (b: Buffer) => (out += b.toString()));
    await closed(c); // the next 150 ms poll comes after the child is gone
    const formerProbe = () => {
      if (c.exitCode !== null) throw new Error(`exited (${c.exitCode}) before READY: ${out}`);
      return out.includes("READY");
    };
    expect(out).toContain("READY\n");
    expect(formerProbe).toThrow(/exited \(0\) before READY: READY/);
  });

  it("resolves for a child that prints READY and exits at once, 50 times in a row, with the whole output", async () => {
    for (let i = 0; i < 50; i++) {
      const c = node(FAST_REQUEST_CHILD);
      const w = watchChildOutput(c, "fast-child", "READY", 20_000);
      await expect(w.ready).resolves.toBeUndefined();
      await closed(c);
      expect(c.exitCode).toBe(0);
      expect(w.output()).toBe("READY\nRESPONSE 200 {}\n");
    }
  });

  it("resolves while a long-running child is still alive after READY", async () => {
    const c = node(
      `process.stdout.write("REA"); setTimeout(() => process.stdout.write("DY\\n"), 50); setInterval(() => {}, 1000);`,
    );
    const w = watchChildOutput(c, "slow-child", "READY", 20_000);
    await w.ready;
    expect(c.exitCode).toBeNull();
    c.kill("SIGKILL");
    await closed(c);
  });

  it("rejects, with the output, for a child that exits without READY", async () => {
    const c = node(`process.stdout.write("boom: config error\\n"); process.exit(3);`);
    const w = watchChildOutput(c, "broken-child", "READY", 20_000);
    await expect(w.ready).rejects.toThrow(/broken-child exited \(3\) before READY: boom: config error/);
  });

  it("does not take READY inside another line as the marker", async () => {
    const c = node(`process.stdout.write("NOT-READY-YET\\n"); process.exit(0);`);
    const w = watchChildOutput(c, "almost-child", "READY", 20_000);
    await expect(w.ready).rejects.toThrow(/exited \(0\) before READY/);
  });

  it("rejects on a timeout for a child that never prints READY", async () => {
    const c = node(`setInterval(() => {}, 1000);`);
    const w = watchChildOutput(c, "silent-child", "READY", 300);
    await expect(w.ready).rejects.toThrow(/timed out after 300 ms waiting for silent-child READY/);
    c.kill("SIGKILL");
    await closed(c);
  });
});
