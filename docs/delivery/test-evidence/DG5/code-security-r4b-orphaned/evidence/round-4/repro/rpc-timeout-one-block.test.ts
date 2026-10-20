import { it } from "vitest";
const spin = (ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { /* busy */ } };
it("one synchronous 65 s test", () => spin(65_000), 120_000);
