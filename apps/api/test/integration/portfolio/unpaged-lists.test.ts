// ADR-0021 §11 item 6 (T-DG3-ARCH-04; FE-A handback §5.3): the unpaged P3 child lists and catalogues return {items}
// whole, declare no cursor/limit, and refuse `limit` with 400 (ADR-0007 §5 strict query objects), while the paged
// lists accept it. All data is synthetic; nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World } from "../../support/p2-fixtures.ts";
import { insertInitiatives } from "../contract/p3-exercises-be-c.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

describe("unpaged P3 lists refuse limit; paged lists accept it (ADR-0021 §11 item 6)", () => {
  it("400 on limit for every unpaged list; 200 with {items} and no nextCursor without it", async () => {
    const p = await setupP2World(api, w);
    const [ini] = await insertInitiatives(api, p, [{}]);
    const T = `/api/v1/transformations/${p.transformationId}`;
    const I = `/api/v1/initiatives/${ini!.id}`;
    const unpaged = [
      `${I}/gap-links`,
      `${I}/outcome-contributions`,
      `${I}/decision-links`,
      `${I}/deliverables`,
      `${I}/milestones`,
      `${T}/waves`,
      `${T}/resource-roles`,
      "/api/v1/dependency-types",
    ];
    for (const path of unpaged) {
      const plain = await call<Body>(api.app, "GET", path, { session: p.lead.session });
      expect([path, plain.status, Array.isArray(plain.body.items), "nextCursor" in plain.body]).toEqual([
        path,
        200,
        true,
        false,
      ]);
      const limited = await call<Body>(api.app, "GET", `${path}?limit=10`, { session: p.lead.session });
      expect([path, limited.status]).toEqual([path, 400]);
    }
    const paged = await call<Body>(
      api.app,
      "GET",
      `/api/v1/initiatives?transformationId=${p.transformationId}&limit=1`,
      {
        session: p.lead.session,
      },
    );
    expect([paged.status, "nextCursor" in paged.body]).toEqual([200, true]);
  });
});
