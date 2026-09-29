#!/usr/bin/env node
// Aggregates the evaluation results recorded by test/ai/*.spec.ts (evalBody) into Markdown tables.
// Usage: node test/ai/summarize-evals.mjs [dir]   (default: $HUB_AI_EVAL_OUT or <tmpdir>/hub-ai-eval)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = process.argv[2] ?? process.env.HUB_AI_EVAL_OUT ?? join(tmpdir(), 'hub-ai-eval');
const rows = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).map((r) => ({ ...r, file: f.replace(/\.json$/, '') })));

const table = (key) => {
  const m = new Map();
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key];
    const e = m.get(k) ?? { pass: 0, fail: 0 };
    r.pass ? e.pass++ : e.fail++;
    m.set(k, e);
  }
  return [...m.entries()].sort().map(([k, v]) => `| ${k} | ${v.pass + v.fail} | ${v.pass} | ${v.fail} |`).join('\n');
};

const total = rows.length;
const passed = rows.filter((r) => r.pass).length;
console.log(`Total evaluation cases: ${total}; passed: ${passed}; failed: ${total - passed}\n`);
console.log('| Category | Cases | Pass | Fail |\n|---|---|---|---|\n' + table('category') + '\n');
console.log('| Category / language | Cases | Pass | Fail |\n|---|---|---|---|\n' + table((r) => `${r.category} / ${r.lang}`) + '\n');
console.log('| Provider script | Cases | Pass | Fail |\n|---|---|---|---|\n' + table('provider') + '\n');
console.log('| Case | Category | Lang | Provider | AIT | Result |\n|---|---|---|---|---|---|');
for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(`| ${r.id} | ${r.category} | ${r.lang} | ${r.provider} | ${(r.ait ?? []).join(', ')} | ${r.pass ? 'PASS' : `FAIL: ${r.detail ?? ''}`} |`);
}
