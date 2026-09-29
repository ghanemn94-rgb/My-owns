import { Module } from '@nestjs/common';
import { GatesModule } from '../gates/gates.module';
import { ReadinessController } from './readiness.controller';
import { ReadinessSupport } from './readiness.support';
import { ReadinessChecksService } from './checks.service';
import { CutoverService } from './cutover.service';
import { TsaService } from './tsa.service';
import { ReadinessSummaryService } from './summary.service';

const providers = [ReadinessSupport, ReadinessChecksService, CutoverService, TsaService, ReadinessSummaryService];

/**
 * Day-1 readiness checks, cutover plans / go-no-go, TSA services (spec §7.3, §7.4). Owner: see
 * docs/architecture/module-guide.md. Uses the gates module's WaiverService (registers the `readiness_check` target).
 * Exports the services so reporting / AI retrieval can reuse the same scoped reads.
 */
@Module({ imports: [GatesModule], controllers: [ReadinessController], providers, exports: providers })
export class ReadinessModule {}
