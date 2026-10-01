import { spawn } from 'node:child_process';
import { IMPORT_LIMITS } from '@hub/domain';
import { sandboxParse, type ParseResult, type ParserLimits } from './parser';

export type SandboxOutcome = { ok: true; result: ParseResult } | { ok: false; code: string; detail: string };

/**
 * Child source: the parser function's own text plus a tiny IPC harness. The child receives the bytes over IPC, parses them
 * and answers once; it gets no environment (no secrets, no database URL) and no access to the API's code, pool or storage.
 */
const CHILD_SOURCE = `'use strict';
const zlib = require('node:zlib');
const parse = ${sandboxParse.toString()};
process.once('message', (m) => {
  let out;
  try {
    out = { ok: true, result: parse(new Uint8Array(m.bytes), m.kind, m.limits, zlib) };
  } catch (e) {
    const code = e && typeof e.code === 'string' && e.code.startsWith('imports.parse.') ? e.code : 'imports.parse.malformed';
    out = { ok: false, code, detail: String((e && e.message) || e).slice(0, 300) };
  }
  process.send(out, () => process.exit(0));
});
`;

/** Node's permission model flag (stable name since 22.13; the experimental name before). */
const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';

/**
 * Sandboxed conversion (REQ-SEC-015, C-16; the in-application part of C-44): the untrusted file is parsed in a SEPARATE
 * Node process started with
 *  - `--max-old-space-size` (heap cap; an over-limit parse aborts the child, never the API / worker),
 *  - Node's permission model (`--permission`): no file-system read or write, no child processes, no worker threads, no
 *    native add-ons,
 *  - an EMPTY environment (no secrets, no database URL, no NODE_OPTIONS),
 *  - a wall-clock timeout after which the child is killed (SIGKILL).
 * The child's code is the parser function only; it loads no network module (it receives bytes and answers over IPC).
 * Network isolation at OS level (separate container / namespace without network, seccomp, non-root) is a deployment
 * control — Not configured in this build (docs/security/imports-and-integrations.md).
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
    let stderr = '';
    const child = spawn(process.execPath, [`--max-old-space-size=${l.heapMb}`, PERMISSION_FLAG, '-e', CHILD_SOURCE], {
      env: {},
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
      windowsHide: true,
    });
    const done = (o: SandboxOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve(o);
    };
    const timer = setTimeout(() => done({ ok: false, code: 'imports.parse.timeout', detail: `Parsing exceeded ${l.timeoutMs} ms and was stopped` }), l.timeoutMs);
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString('utf8');
    });
    child.on('message', (m: SandboxOutcome) => done(m));
    child.on('error', () => done({ ok: false, code: 'imports.parse.crashed', detail: 'The parser process could not be started' }));
    child.on('close', (code, signal) => {
      const oom = /heap limit|heap out of memory|allocation failed/i.test(stderr) || signal === 'SIGABRT';
      done(oom ? { ok: false, code: 'imports.parse.memory_limit', detail: 'Parsing exceeded the memory limit and was stopped' } : { ok: false, code: 'imports.parse.crashed', detail: `The parser stopped unexpectedly (${signal ?? code})` });
    });
    child.send({ bytes: new Uint8Array(bytes), kind, limits: parserLimits }, (err) => {
      if (err) done({ ok: false, code: 'imports.parse.crashed', detail: 'The file could not be handed to the parser' });
    });
  });
}
