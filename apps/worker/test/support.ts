// Worker integration support: each test file gets its OWN fresh database (queue policies and schedules are global
// state in pg-boss), migrated by the real runner, and connects as the runtime role mth_app.
import { createDb, createPool, DEV_ISSUER, type Db } from "@mth/db";
import pg from "pg";
import { randomUUID as uuidv7 } from "node:crypto";
import { migrate } from "../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../packages/db/test/helpers.ts";
import { createBoss } from "../src/queues.ts";

export interface WorkerEnv {
  readonly appUrl: string;
  readonly db: Db;
  readonly owner: pg.Pool;
  close(): Promise<void>;
}

export async function workerEnv(): Promise<WorkerEnv> {
  const { adminUrl } = testDatabase();
  const name = await createScratchDatabase(adminUrl, "mth_wrk");
  await migrate(roleUrl(adminUrl, name, "mth_owner"));
  const appUrl = roleUrl(adminUrl, name, "mth_app");
  const db = createDb(createPool(appUrl, { max: 5 }));
  const ownerUrl = new URL(roleUrl(adminUrl, name, null));
  const owner = new pg.Pool({ connectionString: ownerUrl.toString(), options: "-c role=mth_owner", max: 2 });
  return {
    appUrl,
    db,
    owner,
    async close() {
      await db.destroy();
      await owner.end();
      await dropScratchDatabase(adminUrl, name);
    },
  };
}

export function bossFor(appUrl: string) {
  return createBoss(appUrl, { schedule: true, supervise: false, applicationName: "worker-test" });
}

/** A synthetic organization, BU, user and transformation plus its outbox event, as the API would write them. */
export async function seedTransformationWithOutbox(
  db: Db,
): Promise<{ transformationId: string; outboxId: string; userId: string; idempotencyKey: string }> {
  const org = uuidv7();
  const bu = uuidv7();
  const user = uuidv7();
  const t = uuidv7();
  const code = `W${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await db
    .insertInto("organization")
    .values({ id: org, code, name_en: "Synthetic worker org", name_ar: "مؤسسة", created_by: null, updated_by: null })
    .execute();
  await db
    .insertInto("business_unit")
    .values({
      id: bu,
      organization_id: org,
      code: "WBU",
      name_en: "Unit",
      name_ar: "وحدة",
      created_by: null,
      updated_by: null,
    })
    .execute();
  await db
    .insertInto("app_user")
    .values({
      id: user,
      organization_id: org,
      display_name: "Synthetic worker user",
      created_by: null,
      updated_by: null,
    })
    .execute();
  await db
    .insertInto("user_identity")
    .values({ id: uuidv7(), user_id: user, issuer: DEV_ISSUER, subject: `w.${code.toLowerCase()}` })
    .execute();
  await db
    .insertInto("transformation")
    .values({
      id: t,
      organization_id: org,
      business_unit_id: bu,
      code: "TR-0001",
      name: "Synthetic",
      mode: "end_to_end",
      current_phase: "diagnose",
      timezone: "Asia/Riyadh",
      currency: "SAR",
      created_by: user,
      updated_by: user,
    })
    .execute();
  const outboxId = uuidv7();
  const idempotencyKey = `transformation.created:${t}`;
  await db
    .insertInto("outbox_event")
    .values({
      id: outboxId,
      organization_id: org,
      aggregate_type: "transformation",
      aggregate_id: t,
      event_type: "transformation.created",
      schema_version: 1,
      idempotency_key: idempotencyKey,
      payload: JSON.stringify({
        transformationId: t,
        organizationId: org,
        businessUnitId: bu,
        mode: "end_to_end",
        entryPhase: null,
        standaloneDeliverableType: null,
        createdBy: user,
        occurredAt: new Date().toISOString(),
      }),
    })
    .execute();
  return { transformationId: t, outboxId, userId: user, idempotencyKey };
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
  stepMs = 200,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
