import { it } from "vitest";
const spin = (ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { /* busy */ } };
for (let i = 0; i < 4; i++) it(`synchronous 17 s test ${i}`, () => spin(17_000), 60_000);
