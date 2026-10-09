// Compatibility entry (T-DG4-BE-A): the handler registry moved to ./handlers/index.ts (platform handlers in
// ./handlers/platform.ts, one file per domain; p4-work-split §I+C.1). New code imports ./handlers/index.ts.
export * from "./handlers/index.ts";
