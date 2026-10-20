// qa-verifier DG5 round 4 (T-DG5-REV-QA-R4C): DB-FREE substitute for the 390 px / 200 % text and axe checks of the P5
// screens, used only because this run's sandbox cannot start PostgreSQL (round-4/03-sandbox-userns-blocker.log).
// NOT part of the candidate. In a disposable clone it is copied to apps/web/test/zz-qa-dump.ts and imported FIRST by
// apps/web/test/setup.ts; the P5 screen test files then run with `--sequence.hooks=list`, so this afterEach runs before
// each file's own cleanup. After every test whose rendered document holds a <main>, it writes the document (lang, dir,
// body) to $QA_DUMP_ALL. Nothing is asserted here: the dumps are laid out in Chromium with the BUILT stylesheet and
// checked with axe by zz-qa-r4-p5-layout.mjs. Every value in them is the tests' own SYNTHETIC fixture data.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect } from "vitest";

const DIR = process.env["QA_DUMP_ALL"];
let n = 0;
if (DIR) {
  mkdirSync(DIR, { recursive: true });
  afterEach(() => {
    if (!document.body.querySelector("main")) return;
    const st = expect.getState();
    const file = `${path.basename(st.testPath ?? "x")}--${String(++n).padStart(3, "0")}--${st.currentTestName ?? "x"}`
      .replace(/[^\w.؀-ۿ-]+/g, "_")
      .slice(0, 140);
    const h = document.documentElement;
    writeFileSync(
      path.join(DIR, `${file}.html`),
      `<!doctype html>\n<html lang="${h.lang}" dir="${h.dir}"><head><meta charset="utf-8"></head>${document.body.outerHTML}</html>`,
    );
  });
}
