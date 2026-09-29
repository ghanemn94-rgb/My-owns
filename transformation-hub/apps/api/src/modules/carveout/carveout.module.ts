import { Module } from '@nestjs/common';
import { PlanningModule } from '../planning/planning.module';
import { CarveoutController } from './carveout.controller';
import { CarveoutSupport } from './carveout.support';
import { PerimeterService } from './perimeter.service';
import { TransfersService } from './transfers.service';
import { PerimeterVersionsService } from './perimeter-versions.service';
import { AgreementsService } from './agreements.service';

/**
 * Perimeter register, sites, transfers (legal/economic), reconciliation, perimeter versions, agreements and consents.
 * Change control after baseline approval goes through planning's ChangeControlService (AT-07); status dimensions are
 * recomputed by the gates worker on `perimeter.changed`. Owner: see docs/architecture/module-guide.md.
 * Exported for other modules: PerimeterService (read helpers: consentsOf, day1Dto), AgreementsService, TransfersService.
 */
@Module({
  imports: [PlanningModule],
  controllers: [CarveoutController],
  providers: [CarveoutSupport, PerimeterService, TransfersService, PerimeterVersionsService, AgreementsService],
  exports: [CarveoutSupport, PerimeterService, TransfersService, PerimeterVersionsService, AgreementsService],
})
export class CarveoutModule {}
