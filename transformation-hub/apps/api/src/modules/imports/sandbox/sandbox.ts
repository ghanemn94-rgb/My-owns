import { Worker } from 'node:worker_threads';
import { IMPORT_LIMITS } from '@hub/domain';
import { sandboxParse, type ParseResult, type ParserLimits } from './parser';

export type SandboxOutcome = { ok: true; result: ParseResult } | { ok: false; code: string; detail: string };

/**
 * Worker source: the parser function's own text plus a tiny harness. The worker gets an EMPTY environment (no secrets,
 * no database URL), only `zlib` and the bytes; it has no access to the API's modules, database pool or storage.
 */
const WORKER_SOURCE = `'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const zlib = require('node:zlib');
const parse = ${sandboxParse.toString()};
let out;
try {
  out = { ok: true, result: parse(new Uint8Array(workerData.bytes), workerData.kind, workerData.limits, zlib) };
} catch (e) {
  const code = e && typeof e.code === 'string' && e.code.startsWith('imports.parse.') ? e.code : 'imports.parse.malformed';
  out = { ok: false, code, detail: String((e && e.message) || e).slice(0, 300) };
}
parentPort.postMessage(out);
`;

/**
 * Sandboxed conversion (REQ-SEC-015, C-16, C-44 in-process part): the untrusted file is parsed in a separate V8 isolate
 * (worker thread) with a heap / stack cap and a wall-clock timeout; an over-limit, crashing or hanging parse is terminated
 * and reported as a refusal of the file — the API and worker processes keep running (AT-25 "without service disruption").
 * OS-level isolation (separate container without network, seccomp, non-root) is a deployment control — Not configured in
 * this build (docs/security/imports-and-integrations.md).
 */
export function runSandboxedParse(bytes: Buffer, kind: 'xlsx' | 'csv' | 'docx', limits: Partial<typeof IMPORT_LIMITS> = {}): Promise<SandboxOutcome> {
  const l = { ...IMPORT_LIMITS, ...limits };
  const parserLimits: ParserLimits = {
    maxSheets: l.maxSheets,
    maxRows: l.maxRows,
    maxColumns: l.maxColumns,
    maxCells: l.maxCells,
    maxCellChars: l.maxCellChars,
    maxFormulaChars: l.maxFormulaChars,
    maxZipEntries: l.maxZipEntries,
    maxUncompressedBytes: l.maxUncompressedBytes,
    maxEntryBytes: l.maxEntryBytes,
    maxRatio: l.maxRatio,
    maxParagraphs: l.maxParagraphs,
  };
  return new Promise((resolve) => {
    let settled = false;
    const done = (o: SandboxOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => undefined);
      resolve(o);
    };
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      env: {},
      workerData: { bytes: new Uint8Array(bytes), kind, limits: parserLimits },
      resourceLimits: { maxOldGenerationSizeMb: l.heapMb, maxYoungGenerationSizeMb: 32, codeRangeSizeMb: 16, stackSizeMb: 4 },
      stdout: true,
      stderr: true,
    });
    const timer = setTimeout(() => done({ ok: false, code: 'imports.parse.timeout', detail: `Parsing exceeded ${l.timeoutMs} ms and was stopped` }), l.timeoutMs);
    worker.once('message', (m: SandboxOutcome) => done(m));
    worker.once('error', (e: Error & { code?: string }) =>
      done(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? { ok: false, code: 'imports.parse.memory_limit', detail: 'Parsing exceeded the memory limit and was stopped' } : { ok: false, code: 'imports.parse.crashed', detail: 'The parser stopped unexpectedly' }),
    );
    worker.once('exit', (c) => done({ ok: false, code: 'imports.parse.crashed', detail: `The parser exited (${c})` }));
  });
}
