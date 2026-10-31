// qa-verifier A21 (DG6, T-DG6-QA-D; ADR-0059 §12): turns on the product's OWN connection-log module
// (packages/config/dist/connection-log.js, installConnectionLog) in every Node process of an e2e run, through
// `NODE_OPTIONS=--import <this file>` (e2e/support/a21-connection-log-run.sh). ADR-0059 §12 names one call each in
// apps/api/src/server.ts and apps/worker/src/main.ts; at the reviewed HEAD neither file calls it (reported as a
// finding in docs/delivery/test-evidence/DG6/qa/T-DG6-QA-D-authoring/handback.md), so this test instrument installs
// the same module from outside the product. It changes no product behaviour: it only appends one JSON line per
// outbound connection attempt to the file named by MTH_CONNECTION_LOG, and it is a no-op when that is unset or when
// NODE_ENV is production (the module's own rule). Nothing is sent anywhere.
import { installConnectionLog } from "../../packages/config/dist/connection-log.js";

const script = process.argv[1] ?? "node";
const name = script.split(/[\\/]/).slice(-3).join("/");
installConnectionLog(`qa-preload:${name}`);
