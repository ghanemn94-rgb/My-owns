import type { Provider } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../../platform/config';
import { OBJECT_STORAGE, ObjectStorage } from './object-storage';
import { LocalFsStorage } from './local-fs.storage';
import { S3CompatibleStorage } from './s3-compatible.storage';

/** Chooses the storage driver from configuration (`HUB_STORAGE_DRIVER`, `HUB_STORAGE_LOCAL_DIR`). */
export const objectStorageProvider: Provider = {
  provide: OBJECT_STORAGE,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): ObjectStorage => (config.storage.driver === 's3' ? new S3CompatibleStorage() : new LocalFsStorage(config.storage.localDir)),
};
