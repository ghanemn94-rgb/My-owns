// Module boundaries of the modular monolith (REQ-ARC-011, ADR-0001) — run by `pnpm --filter @hub/api lint`.
//
// A domain module (apps/api/src/modules/<m>) may import another module ONLY through that module's published surface
// below: its Nest module (composition) and the services / helpers other modules are allowed to call. Every other file of
// a module is internal (controllers, commands, support classes, DTO mappers). The module graph must stay acyclic.
// Adding an entry here is an architecture decision: say why in the comment and in the pull request.
// (The requirement names dependency-cruiser; this dependency-free check enforces the same rule.)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules');

/** module → files (relative to the module, without extension) other modules may import. */
const PUBLISHED = {
  documents: [
    'documents.module',
    'documents.service', // documents referenced by other modules' records (approval documents, room disclosures)
    'evidence.service', // evidence links on other modules' records
    'storage/object-storage', // object storage port for partner-room downloads
  ],
  gates: [
    'gates.module',
    'gates.service', // RECOMPUTE_DIMENSIONS_JOB used by the demo seeds
    'status-dimensions.service', // status dimensions recomputed after other modules' changes
    'waiver.service', // waivers of readiness checks and CPs (one waiver model, REQ-LCY-005)
    'gate-authority', // the G1 gate-approval rule reused by the perimeter-version approval
  ],
  governance: [
    'demo-policy', // the DEMO authority policy for demo projects without an approved matrix
    'governance.support', // money amount parsing shared with change control
    // Relying on a governance decision (DOM-P2R-03/-04/-05, QA-P2-01): row lock, current external-approval evidence and
    // the decision-use registry, used by every module whose records a committee decision backs (module-guide.md).
    'decision-reliance',
  ],
  newco: ['legal-entities.service'], // the carve-out demo seed links the demo legal entity
  planning: [
    'planning.module',
    'change-control.service', // perimeter changes after baseline go through planning change requests (AT-07)
  ],
  portfolio: ['portfolio.service'], // demo seeds create projects through the portfolio service
};

const PLATFORM = join(ROOT, '..', 'platform');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

function* files(dir, pattern = /\.ts$/) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p, pattern);
    else if (pattern.test(f)) yield p;
  }
}

const errors = [];
// QA-P2-05 residual: a module holds TypeScript only — a .js / .mjs / .cjs / .jsx / .tsx file would escape the scan below.
for (const file of files(ROOT, SOURCE)) {
  if (!file.endsWith('.ts')) errors.push(`${relative(join(ROOT, '..', '..'), file)} is not a .ts file; module sources must be TypeScript so the boundary check can read them`);
}
// QA-P2-05 residual: the platform layer never depends on a domain module, so it cannot re-export a module's internals to
// other modules ("laundering" through src/platform).
for (const file of files(PLATFORM, SOURCE)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:from|import|require)\s*\(?\s*(['"`])(\.[^'"`]+)\1/g)) {
    const target = relative(ROOT, join(dirname(file), m[2])).split(sep);
    if (target[0] !== '..') errors.push(`${relative(join(ROOT, '..', '..'), file)} imports modules/${target.join('/')}: the platform layer must not depend on a domain module`);
  }
}
const edges = new Map(); // module → Set(module)
let imports = 0;
for (const file of files(ROOT)) {
  const rel = relative(ROOT, file).split(sep);
  const from = rel[0];
  const src = readFileSync(file, 'utf8');
  // A dynamic import() / require() whose path is COMPUTED — a template literal with ${…} or any non-literal argument — cannot
  // be resolved statically, so it is refused (fail closed, P2 security review I-1). Comment lines are skipped.
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (/(?<![\w$.])(?:import|require)\s*\(\s*(?:`[^`]*\$\{|(?=[^\s'"`)]))/.test(line)) {
      errors.push(`${relative(join(ROOT, '..', '..'), file)}:${i + 1} has a dynamic import with a computed path, which the module boundary check cannot verify`);
    }
  });
  // static and dynamic imports, re-exports and require(), with single, double or backtick quotes (SEC-P1S-07, I-1)
  for (const m of src.matchAll(/(?:from|import|require)\s*\(?\s*(['"`])(\.[^'"`]+)\1/g)) {
    const target = relative(ROOT, join(dirname(file), m[2])).split(sep);
    if (target[0] === '..' || target[0] === from) continue; // platform / same module
    imports++;
    const to = target[0];
    const inner = target.slice(1).join('/').replace(/\.(js|ts)$/, '');
    if (!(PUBLISHED[to] ?? []).includes(inner)) {
      errors.push(`${relative(join(ROOT, '..', '..'), file)} imports ${to}/${inner}, which is internal to module '${to}' (published: ${(PUBLISHED[to] ?? []).join(', ') || 'nothing'})`);
    }
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
  }
}

// Cycles between modules (DFS).
const state = new Map();
const stack = [];
function visit(m) {
  state.set(m, 'open');
  stack.push(m);
  for (const n of edges.get(m) ?? []) {
    if (state.get(n) === 'open') errors.push(`module cycle: ${[...stack.slice(stack.indexOf(n)), n].join(' → ')}`);
    else if (!state.has(n)) visit(n);
  }
  stack.pop();
  state.set(m, 'done');
}
for (const m of edges.keys()) if (!state.has(m)) visit(m);

if (errors.length) {
  console.error(`module boundary check FAILED (${errors.length}):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
const edgeCount = [...edges.values()].reduce((n, s) => n + s.size, 0);
console.log(`module boundary check passed: ${imports} cross-module imports, ${edgeCount} module edges, acyclic, only published surfaces`);
