import { Controller, Get, HttpCode, HttpException, SetMetadata } from '@nestjs/common';

/** Infrastructure endpoints bypass the contract/auth guard (they expose no data). */
export const INFRA_META = 'hub:infra';
import { DbService } from './db.service';

/** Liveness / readiness probes (outside the contract registry; no data exposed). */
@Controller()
@SetMetadata(INFRA_META, true)
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get('/healthz')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('/readyz')
  async ready() {
    try {
      await this.db.pool.query('select 1');
      return { status: 'ready' };
    } catch {
      throw new HttpException({ status: 'not_ready' }, 503);
    }
  }
}
