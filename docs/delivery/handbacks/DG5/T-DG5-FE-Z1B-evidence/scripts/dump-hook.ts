// T-DG5-FE-Z1B DB-free reproduction (not part of the product): after each test whose rendered document holds a
// <main> or a dialog, write the document (lang, dir, body) to $Z1_DUMP. Registered before test/setup.ts and run with
// --sequence.hooks=list, so it sees the document before Testing Library's cleanup. Uses Vitest globals.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const DIR = process.env["Z1_DUMP"]!;
let n = 0;
mkdirSync(DIR, { recursive: true });
afterEach(() => {
  if (!document.body.querySelector("main, [role='dialog'], table")) return;
  const st = expect.getState();
  const name = `${path.basename(st.testPath ?? "x")}--${String(++n).padStart(3, "0")}--${st.currentTestName ?? "x"}`
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 150);
  const h = document.documentElement;
  writeFileSync(
    path.join(DIR, `${name}.html`),
    `<!doctype html>\n<html lang="${h.lang}" dir="${h.dir}"><head><meta charset="utf-8"></head>${document.body.outerHTML}</html>`,
  );
});
