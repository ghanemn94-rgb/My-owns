import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './config';
import { DbService } from './db.service';

/** Resolves the deployment's default organization (single-org deployments are the norm; A-02). */
@Injectable()
export class OrgService {
  private cached: string | null = null;
  constructor(
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async defaultOrgId(): Promise<string> {
    if (this.cached) return this.cached;
    const { rows } = await this.db.pool.query<{ id: string | null }>(`select hub_auth_org_by_slug($1) as id`, [this.config.orgSlug]);
    const id = rows[0]?.id;
    if (!id) throw new Error(`Organization "${this.config.orgSlug}" not found — run the bootstrap or demo seed`);
    this.cached = id;
    return id;
  }

  reset() {
    this.cached = null;
  }
}
