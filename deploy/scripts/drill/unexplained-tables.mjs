#!/usr/bin/env node
// unexplained-tables.mjs: the tables a failed mode 2 recheck could not explain (transfer-drill.sh D9; T-DG7-DO-E,
// D-264). The mode 2 report of `reconcile.mjs --after-use` (packages/db/src/transfer/reconcile.ts) prints, for every
// audited table, an informational line `  <table>: <n> explaining events`, and for a table it could NOT explain one
// line `  <table>: <a> added, <c> changed, <m> missing (<basis>)`. Only the second form is a failure. Before this
// helper, transfer-drill.sh named every indented `<table>:` line "changed outside the allowance", so T-B11 run 2 of
// T-DG7-DO-D7 named 19 tables when 3 were unexplained.
//
//   node deploy/scripts/drill/unexplained-tables.mjs <reconcile output file>
//
// Prints one line `<table> <a> added, <c> changed, <m> missing (<basis>)` per unexplained table, in report order,
// each table once. Exit 0 (also when no table is listed; the caller decides), 2 on a missing file.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The failure line of the mode 2 report (reconcile.ts `perTable`). */
export const UNEXPLAINED_LINE = /^ {2}([a-z_][a-z0-9_]*): (\d+) added, (\d+) changed, (\d+) missing \(([a-z_]+)\)$/;

/**
 * The unexplained tables of a mode 2 report, in report order, each once.
 * @param {string} text the reconcile output
 * @returns {{table: string, added: number, changed: number, missing: number, basis: string}[]}
 */
export function unexplainedTables(text) {
  const seen = new Set();
  const out = [];
  for (const line of text.split("\n")) {
    const m = UNEXPLAINED_LINE.exec(line.replace(/\r$/, ""));
    if (m === null || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ table: m[1], added: Number(m[2]), changed: Number(m[3]), missing: Number(m[4]), basis: m[5] });
  }
  return out;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const file = process.argv[2];
  if (file === undefined || !existsSync(file)) {
    console.error(`unexplained-tables: BLOCKED: reconcile output ${file ?? "(none given)"} not found`);
    process.exit(2);
  }
  for (const t of unexplainedTables(readFileSync(file, "utf8")))
    console.log(`${t.table} ${t.added} added, ${t.changed} changed, ${t.missing} missing (${t.basis})`);
}
