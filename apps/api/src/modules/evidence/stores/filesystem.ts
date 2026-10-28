// The filesystem EvidenceStore adapter (ADR-0010; EVIDENCE_STORAGE_DRIVER=filesystem, the default). T-DG6-BE-H
// (ADR-0054 §2) moved it here from evidence/store.ts WITHOUT a behaviour change: an atomic write (temporary file, fsync,
// rename) with the SHA-256 and size computed WHILE streaming, keys confined to the store root, and reads only through the
// API route that applies the parent record's authorization. The interface and the driver selection stay in store.ts.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  EvidenceStoreUnavailable,
  EvidenceTooLarge,
  type EvidenceBody,
  type EvidenceStore,
  type RemovedTemporary,
  type StoredObject,
  type SweepResult,
} from "../store.ts";

/** The only names the sweep ever removes: an upload's temporary object (a UUID key + `.part`). */
const TEMPORARY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/;
/** Keys are organization/transformation/evidence/uuid: temporaries live exactly 3 directories below the root. */
const KEY_DEPTH = 3;

const KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}$/;

export class FilesystemEvidenceStore implements EvidenceStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    if (!KEY.test(key) || key.includes("..")) throw new Error("evidence store: invalid key");
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("evidence store: key escapes the root");
    return p;
  }

  private tempOf(key: string): string {
    return `${this.pathOf(key)}.part`;
  }

  async put(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject> {
    const stored = await this.receive(key, body, maxBytes);
    await this.finalise(key);
    return stored;
  }

  async receive(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject> {
    const final = this.pathOf(key);
    const temp = this.tempOf(key);
    try {
      await mkdir(dirname(final), { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new EvidenceStoreUnavailable(`evidence store directory is not writable: ${(err as Error).message}`);
    }
    const hash = createHash("sha256");
    let size = 0;
    const handle = await open(temp, "wx", 0o600);
    try {
      const chunks: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array> =
        body instanceof Uint8Array ? [body] : body;
      for await (const chunk of chunks) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        size += bytes.byteLength;
        if (size > maxBytes) throw new EvidenceTooLarge(maxBytes);
        hash.update(bytes);
        await handle.write(bytes);
      }
      await handle.sync();
    } catch (err) {
      // T-DG2-BE18A: the temporary is removed even when closing the handle fails.
      try {
        await handle.close();
      } finally {
        await rm(temp, { force: true });
      }
      throw err;
    }
    await handle.close();
    return { key, sha256: hash.digest("hex"), size };
  }

  async finalise(key: string): Promise<void> {
    await rename(this.tempOf(key), this.pathOf(key));
  }

  async get(key: string): Promise<AsyncIterable<Uint8Array>> {
    const p = this.pathOf(key);
    await stat(p);
    return createReadStream(p);
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      return { size: (await stat(this.pathOf(key))).size };
    } catch {
      return null;
    }
  }

  async discardUncommitted(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
    await rm(this.tempOf(key), { force: true });
  }

  async sweepStaleTemporaries(
    olderThanMs: number,
    onRemoved: (removed: RemovedTemporary) => void,
  ): Promise<SweepResult> {
    let removed = 0;
    let keptFresh = 0;
    const visit = async (dir: string, depth: number): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return; // no store yet, or removed concurrently
        throw err;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (depth < KEY_DEPTH) {
          // Real directories only: a symbolic link is never followed out of the store.
          if (entry.isDirectory()) await visit(path, depth + 1);
          continue;
        }
        if (!entry.isFile() || !TEMPORARY_NAME.test(entry.name)) continue; // final objects are never touched
        let info;
        try {
          info = await lstat(path);
        } catch {
          continue; // finalised or removed meanwhile
        }
        if (!info.isFile()) continue;
        const ageMs = Date.now() - info.mtimeMs;
        if (ageMs <= olderThanMs) {
          keptFresh += 1;
          continue;
        }
        await rm(path, { force: true });
        removed += 1;
        onRemoved({
          key: relative(this.root, path).split(sep).join("/"),
          sizeBytes: info.size,
          ageMs: Math.round(ageMs),
        });
      }
    };
    await visit(this.root, 0);
    return { removed, keptFresh };
  }
}
