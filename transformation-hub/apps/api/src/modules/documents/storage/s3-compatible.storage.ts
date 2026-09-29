import type { Readable } from 'node:stream';
import { ruleViolation } from '@hub/domain';
import { assertStorageKey, ObjectStorage } from './object-storage';

/**
 * S3-compatible object storage (MinIO / Ceph / on-prem S3) — **Not configured**. Skeleton only: endpoint, bucket,
 * credentials, private-bucket policy, object lock and server-side encryption are completed in P7 (ADR-0010, MQ-11).
 * Every operation fails closed; nothing is ever reported as stored.
 */
export class S3CompatibleStorage implements ObjectStorage {
  readonly driver = 's3' as const;
  readonly status = 'not_configured' as const;

  private notConfigured(): never {
    throw ruleViolation('storage.not_configured', 'S3-compatible object storage is not configured in this environment (planned for P7)');
  }

  async put(key: string, _data: Buffer): Promise<void> {
    assertStorageKey(key);
    this.notConfigured();
  }

  async get(key: string): Promise<Readable> {
    assertStorageKey(key);
    this.notConfigured();
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    this.notConfigured();
  }

  async exists(key: string): Promise<boolean> {
    assertStorageKey(key);
    this.notConfigured();
  }
}
