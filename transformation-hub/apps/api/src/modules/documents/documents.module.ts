import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { EvidenceService } from './evidence.service';
import { SourcesService } from './sources.service';
import { DocumentIndexer } from './document-indexer.service';
import { objectStorageProvider } from './storage/storage.provider';
import { OBJECT_STORAGE } from './storage/object-storage';
import { BuiltInSignatureScanner, MALWARE_SCANNER } from './files/scanner';

/** Documents, versions, evidence links, source register & claims. Owner: see docs/architecture/module-guide.md (file ownership table). */
@Module({
  controllers: [DocumentsController],
  providers: [
    objectStorageProvider,
    // No enterprise scanner is configured in this environment; the built-in check never reports "clean".
    { provide: MALWARE_SCANNER, useClass: BuiltInSignatureScanner },
    DocumentsService,
    EvidenceService,
    SourcesService,
    DocumentIndexer,
  ],
  exports: [DocumentsService, EvidenceService, SourcesService, DocumentIndexer, OBJECT_STORAGE],
})
export class DocumentsModule {}
