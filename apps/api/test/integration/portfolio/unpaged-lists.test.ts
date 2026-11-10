// ADR-0021 §11 item 6 (T-DG3-ARCH-04; FE-A handback §5.3) as amended by ADR-0007 §4a (D-199, D-200 item 2;
// T-DG6-BE-V): the P3 child lists and catalogues that were unpaged have no bound, so they are cursor-paginated like the
// other lists: they accept `limit` (1-100) and answer `{ items, nextCursor }`, and still refuse an unknown query
// parameter or an out-of-range limit with 400 (ADR-0007 §5 strict query objects). The full paging proof is
// test/integration/hardening/list-pagination.test.ts. All data is synthetic; nothing here touches DG0-DG7.
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

describe("the formerly unpaged P3 lists are paged (ADR-0021 §11 item 6, ADR-0007 §4a)", () => {
  it("200 with {items, nextCursor} with and without limit; 400 on an out-of-range limit or unknown parameter", async () => {
    const p = await setupP2World(api, w);
    const [ini] = await insertInitiatives(api, p, [{}]);
    const T = `/api/v1/transformations/${p.transformationId}`;
    const I = `/api/v1/initiatives/${ini!.id}`;
    const formerlyUnpaged = [
      `${I}/gap-links`,
      `${I}/outcome-contributions`,
      `${I}/decision-links`,
      `${I}/deliverables`,
      `${I}/milestones`,
      `${T}/waves`,
      `${T}/resource-roles`,
      "/api/v1/dependency-types",
    ];
    for (const path of formerlyUnpaged) {
      const plain = await call<Body>(api.app, "GET", path, { session: p.lead.session });
      expect([path, plain.status, Array.isArray(plain.body.items), "nextCursor" in plain.body]).toEqual([
        path,
        200,
        true,
        true,
      ]);
      const limited = await call<Body>(api.app, "GET", `${path}?limit=10`, { session: p.lead.session });
      expect([path, limited.status, "nextCursor" in limited.body]).toEqual([path, 200, true]);
      for (const bad of ["limit=0", "limit=101", "unknownParameter=1"]) {
        const refused = await call<Body>(api.app, "GET", `${path}?${bad}`, { session: p.lead.session });
        expect([path, bad, refused.status]).toEqual([path, bad, 400]);
      }
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
