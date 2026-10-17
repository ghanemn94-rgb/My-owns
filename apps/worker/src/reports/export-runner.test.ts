// T-DG5-BE-T5 (D-QA-F2-3): discardEarlierAttempts removes exactly this job's earlier attempts' keys (1 .. n-1) through
// the store port, idempotently, never the current attempt's key or another job's, and a store error never fails it.
import { describe, expect, it } from "vitest";
import type { ExportFileStore } from "@mth/reporting";
import { attemptStorageKey, discardEarlierAttempts } from "./export-runner.ts";

const ORG = "01920000-0000-7000-8000-000000000001";
const JOB = "01920000-0000-7000-8000-000000000002";

function recordingStore(fail = false): ExportFileStore & { discarded: string[] } {
  const discarded: string[] = [];
  return {
    discarded,
    put: () => Promise.reject(new Error("not used")),
    get: () => Promise.reject(new Error("not used")),
    head: () => Promise.resolve(null),
    discard: async (key) => {
      discarded.push(key);
      if (fail) throw new Error("synthetic store outage");
    },
  };
}

describe("discardEarlierAttempts (D-QA-F2-3)", () => {
  const job = (attempt_count: number) => ({ id: JOB, organization_id: ORG, format: "xlsx", attempt_count });

  it("attempt 3 discards a1 and a2 of this job only; attempt 1 discards nothing", async () => {
    const s = recordingStore();
    await discardEarlierAttempts(s, job(3));
    expect(s.discarded).toEqual([`exports/${ORG}/${JOB}-a1.xlsx`, `exports/${ORG}/${JOB}-a2.xlsx`]);
    expect(s.discarded).not.toContain(attemptStorageKey(job(3), 3));
    const first = recordingStore();
    await discardEarlierAttempts(first, job(1));
    expect(first.discarded).toEqual([]);
  });

  it("is idempotent and best-effort: a repeat discards the same keys; a store error does not throw", async () => {
    const s = recordingStore();
    await discardEarlierAttempts(s, job(2));
    await discardEarlierAttempts(s, job(2));
    expect(s.discarded).toEqual([`exports/${ORG}/${JOB}-a1.xlsx`, `exports/${ORG}/${JOB}-a1.xlsx`]);
    const failing = recordingStore(true);
    await expect(discardEarlierAttempts(failing, job(3))).resolves.toBeUndefined();
    expect(failing.discarded).toHaveLength(2);
  });
});
