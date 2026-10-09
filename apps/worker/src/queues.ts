// Compatibility entry (T-DG4-BE-A): the queue registry moved to ./queues/index.ts (platform queues in ./queues/platform.ts,
// one file per domain; p4-work-split §I+C.1). New code imports ./queues/index.ts.
export * from "./queues/index.ts";
