// T-DG6-BE-X9 (D-203 O-1): runJobBatch settles each job of a batch on its own, bounds concurrency, and never hides a
// settlement failure (the real pg-boss path is apps/worker/test/integration/batch-settlement.test.ts).
import { describe, expect, it } from "vitest";
import { JOB_THROUGHPUT_DEFAULTS, runJobBatch } from "./worker.ts";

function fakeBoss(failSettle: ReadonlySet<string> = new Set()) {
  const settled: { op: "complete" | "fail"; id: string; data: unknown }[] = [];
  const op = (kind: "complete" | "fail") => async (_q: string, id: string | string[], data?: unknown) => {
    if (typeof id === "string" && failSettle.has(id)) throw new Error(`settle ${id} unreachable`);
    settled.push({ op: kind, id: id as string, data });
  };
  return { settled, boss: { complete: op("complete"), fail: op("fail") } as never };
}

describe("runJobBatch (D-203 O-1)", () => {
  it("has the documented safe defaults", () => {
    expect(JOB_THROUGHPUT_DEFAULTS).toEqual({ batchSize: 8, concurrency: 4 });
  });

  it("completes each success with its own output and fails each error alone", async () => {
    const { boss, settled } = fakeBoss();
    const jobs = ["a", "b", "c"].map((id) => ({ id }));
    await runJobBatch(boss, "q", jobs, 2, async (j) => {
      if (j.id === "b") throw new Error("synthetic b");
      return { outcome: j.id };
    });
    expect(settled.sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { op: "complete", id: "a", data: { outcome: "a" } },
      { op: "fail", id: "b", data: expect.objectContaining({ message: "synthetic b" }) },
      { op: "complete", id: "c", data: { outcome: "c" } },
    ]);
  });

  it("never runs more than `concurrency` jobs at once", async () => {
    const { boss } = fakeBoss();
    let running = 0;
    let peak = 0;
    const jobs = Array.from({ length: 10 }, (_, i) => ({ id: `j${i}` }));
    await runJobBatch(boss, "q", jobs, 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    });
    expect(peak).toBe(3);
  });

  it("rethrows a settlement failure after settling the rest (pg-boss then fails what is not completed)", async () => {
    const { boss, settled } = fakeBoss(new Set(["b"]));
    const jobs = ["a", "b", "c"].map((id) => ({ id }));
    await expect(runJobBatch(boss, "q", jobs, 1, async () => ({ ok: true }))).rejects.toThrow("settle b unreachable");
    expect(settled.map((s) => s.id)).toEqual(["a", "c"]);
  });
});
