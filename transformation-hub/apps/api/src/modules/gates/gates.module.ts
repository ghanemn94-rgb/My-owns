import { Module } from '@nestjs/common';
import { GatesController } from './gates.controller';
import { GatesService } from './gates.service';
import { GateLoader } from './gates.evaluation';
import { WaiverService } from './waiver.service';
import { StatusDimensionsService } from './status-dimensions.service';

/**
 * Business gates, criteria assessments, waivers, status dimensions. Owner: see docs/architecture/module-guide.md.
 * Exported for other modules: WaiverService (generic waiver register — readiness/JV register their target resolvers),
 * StatusDimensionsService (recomputeDimensions), GatesService (read-only evaluation helpers).
 */
@Module({
  controllers: [GatesController],
  providers: [GatesService, GateLoader, WaiverService, StatusDimensionsService],
  exports: [GatesService, WaiverService, StatusDimensionsService],
})
export class GatesModule {}
