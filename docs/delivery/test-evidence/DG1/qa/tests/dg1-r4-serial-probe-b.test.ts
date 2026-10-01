// qa-verifier DG1 round-4 (F-DG1-009): independent probe that integration FILES never run concurrently.
// Copied into a disposable clone's tests/qa/integration/ (not part of the candidate). Each probe file takes an
// exclusive lock file (O_EXCL) for ~1.5 s; if another integration file runs at the same time it finds the lock
// and fails. Two probe files + a shared journal of start/end times per pid.
import { appendFileSync, closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LOCK = join(process.env["QA_SERIAL_DIR"] ?? tmpdir(), "qa-serial-probe.lock");
const JOURNAL = join(process.env["QA_SERIAL_DIR"] ?? tmpdir(), "qa-serial-probe.journal");

describe("qa serial probe b (F-DG1-009)", () => {
  it("no other probe file holds the lock while this file runs", async () => {
    let fd: number;
    try {
      fd = openSync(LOCK, "wx");
    } catch (e) {
      appendFileSync(JOURNAL, `b OVERLAP pid=${process.pid} t=${Date.now()} lock=${readFileSync(LOCK, "utf8")}\n`);
      throw new Error(`probe b: another integration file is running concurrently (${String(e)})`);
    }
    try {
      appendFileSync(JOURNAL, `b start pid=${process.pid} t=${Date.now()}\n`);
      closeSync(fd);
      appendFileSync(LOCK, `b pid=${process.pid}`);
      await new Promise((r) => setTimeout(r, 1500));
      expect(readFileSync(LOCK, "utf8")).toBe(`b pid=${process.pid}`);
    } finally {
      unlinkSync(LOCK);
      appendFileSync(JOURNAL, `b end pid=${process.pid} t=${Date.now()}\n`);
    }
  });
});
