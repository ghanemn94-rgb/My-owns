import { Module } from '@nestjs/common';
import { GatesModule } from '../gates/gates.module';
import { DocumentsModule } from '../documents/documents.module';
import { NewcoController } from './newco.controller';
import { NewcoSupport } from './newco.support';
import { LegalEntitiesService } from './legal-entities.service';
import { RegulatoryService } from './regulatory.service';

/**
 * Legal entities, incorporation status with verification (a status dimension of its own — AT-06), regulatory /
 * external-party / internal approvals. Status dimensions are recomputed through the gates module's
 * StatusDimensionsService; setup-wizard evidence is linked through the documents module's EvidenceService.
 * Owner: see docs/architecture/module-guide.md. Exported: LegalEntitiesService, RegulatoryService.
 */
@Module({
  imports: [GatesModule, DocumentsModule],
  controllers: [NewcoController],
  providers: [NewcoSupport, LegalEntitiesService, RegulatoryService],
  exports: [LegalEntitiesService, RegulatoryService],
})
export class NewcoModule {}
