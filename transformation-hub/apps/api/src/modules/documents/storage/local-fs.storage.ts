import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { assertStorageKey, ObjectStorage } from './object-storage';

/**
 * Local filesystem storage for development and tests only (production configuration rejects it — config.ts).
 * The resolved path must stay under the root directory; objects are written atomically with owner-only permissions.
 */
export class LocalFsStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  readonly status = 'configured' as const;
  readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /** Absolute path of an object (exposed for tests); throws if the key could escape the root. */
  pathOf(key: string): string {
    assertStorageKey(key);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Storage path escapes the storage root');
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathOf(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.${randomUUID()}.tmp`;
    await writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
    await rename(tmp, p);
  }

  async get(key: string): Promise<Readable> {
    const p = this.pathOf(key);
    await stat(p); // throws ENOENT before a stream is handed out
    return createReadStream(p);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathOf(key));
      return true;
    } catch {
      return false;
    }
  }
}
