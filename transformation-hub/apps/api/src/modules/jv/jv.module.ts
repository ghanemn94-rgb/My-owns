import { Module } from '@nestjs/common';
import { GatesModule } from '../gates/gates.module';
import { DocumentsModule } from '../documents/documents.module';
import { JvController } from './jv.controller';
import { JvSupport } from './jv.support';
import { PartnersService } from './partners.service';
import { DealsService } from './deals.service';
import { RoomsService } from './rooms.service';
import { DiligenceService } from './diligence.service';
import { TransactionsService } from './transactions.service';
import { PostCloseService } from './postclose.service';

const providers = [JvSupport, PartnersService, DealsService, RoomsService, DiligenceService, TransactionsService, PostCloseService];

/**
 * Partners, rooms & grants, deal scenarios, negotiation, DD, findings, signing/closing, CPs, funds flow, post-close and
 * program closure (spec §8). Owner: see docs/architecture/module-guide.md. Uses the gates module's WaiverService
 * (registers the `closing_condition` target) and the documents module (disclosed downloads, integrity check).
 */
@Module({ imports: [GatesModule, DocumentsModule], controllers: [JvController], providers, exports: providers })
export class JvModule {}
