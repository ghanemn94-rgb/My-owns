// A06 "Configuration change" (qa-verifier, T-DG5-QA-A). Scenario (master prompt §20 A06): "Admin adds a field, changes
// a form rule and updates a workflow using the UI; a new published version works without application-code changes".
// The assertions live in tests/qa/support/a06-suite.ts (moved verbatim by T-DG7-QA-B, so that the A06 bundle replay in
// a06-bundle-replay.test.ts runs exactly the same ones). This file runs them on a clean installation migrated from the
// repository's migrations, on its own scratch database. All data is SYNTHETIC; nothing here is a business, Finance or
// IT approval and no DG0-DG7 record is touched.
import { defineA06Suite } from "../support/a06-suite.ts";

defineA06Suite({ dbName: "mth_qa_a06" });
