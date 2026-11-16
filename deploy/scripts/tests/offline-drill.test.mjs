// T-B13, the check half (p7-work-split §B.4; ADR-0069 §5; T-DG7-DO-E): drill/connection-check.mjs on fixture logs,
// and offline-drill.sh's BLOCKED and isolation paths. The offline RUN itself (the lifecycle specs inside the namespace)
// is the drill run recorded in T-DG7-DO-E's handback, re-run by QA-C.
//   node --test deploy/scripts/tests/offline-drill.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkLog, classify, isLoopback } from "../drill/connection-check.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DRILL = join(REPO, "deploy/scripts/offline-drill.sh");
const CHECK = join(REPO, "deploy/scripts/drill/connection-check.mjs");
const work = mkdtempSync(join(tmpdir(), "mth-offline-drill-test-"));
after(() => rmSync(work, { recursive: true, force: true }));
const hasBwrap = () => spawnSync("bwrap", ["--dev-bind", "/", "/", "--unshare-net", "true"]).status === 0;

// Fixture lines in the module's own shape (packages/config/src/connection-log.ts ConnectionLogLine).
const at = "2026-11-13T21:00:00.000Z";
const line = (process, channel, host, address, port) => ({ at, process, channel, host, address, port });
const GOOD = [
  line("api", "net.client.socket", "127.0.0.1", "127.0.0.1", 25440),
  line("qa-preload:apps/api/dist/main.js", "net.client.socket", "localhost", "::1", 25440),
  line("qa-preload:node_modules/.bin/playwright", "undici:client:beforeConnect", "localhost", null, 25310),
  line("worker", "net.client.socket", "::ffff:127.0.0.1", "::ffff:127.0.0.1", 25440),
  line("qa-preload:packages/db/dist/cli.js", "net.client.socket", null, null, null),
];
const ndjson = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

describe("T-B13 connection-check.mjs on fixture logs", () => {
  it("loopback addresses and hosts are loopback; anything else is not", () => {
    for (const v of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "localhost", "LOCALHOST"])
      assert.ok(isLoopback(v), v);
    for (const v of [
      "10.0.0.1",
      "1.1.1.1",
      "::ffff:10.0.0.1",
      "2001:db8::1",
      "registry.npmjs.org",
      "localhost.example",
      "",
      null,
    ])
      assert.ok(!isLoopback(v), String(v));
  });

  it("a log of loopback and socket entries passes, with the counts by category", () => {
    const r = checkLog(ndjson(GOOD));
    assert.equal(r.result, "PASS", r.problems.join("\n"));
    assert.deepEqual(r.byCategory, { loopback: 4, socket: 1, outside: 0 });
    assert.equal(r.apiLines, 2);
  });

  it("a fixture line with a non-loopback address fails with the B.5 line naming address, port and process", () => {
    const bad = line("api", "net.client.socket", "api.example.invalid", "203.0.113.7", 443);
    const r = checkLog(ndjson([...GOOD, bad]));
    assert.equal(r.result, "FAIL");
    assert.deepEqual(r.problems, ["offline-drill: connection outside loopback: 203.0.113.7:443 by api"]);
  });

  it("a host name that is not loopback fails even when it was never dialled (failed lookup: null address and port)", () => {
    const r = checkLog(ndjson([...GOOD, line("worker", "net.client.socket", "registry.npmjs.org", null, null)]));
    assert.equal(r.result, "FAIL");
    assert.deepEqual(r.problems, ["offline-drill: connection outside loopback: registry.npmjs.org:- by worker"]);
  });

  it("a loopback host name that resolved to an outside address fails (every known value must be loopback)", () => {
    assert.equal(classify(line("api", "net.client.socket", "localhost", "198.51.100.2", 80)), "outside");
  });

  it("a port with no host or address is not provably local; a socket-directory path is a socket", () => {
    assert.equal(classify(line("api", "net.client.socket", null, null, 5432)), "outside");
    assert.equal(classify(line("api", "net.client.socket", "/run/pg/.s.PGSQL.5432", null, null), "/run/pg"), "socket");
    assert.equal(
      classify(line("api", "net.client.socket", "/run/pgx/.s.PGSQL.5432", null, null), "/run/pg"),
      "outside",
    );
  });

  it("a log with no line of the API process fails (an empty or switched-off log is never a pass)", () => {
    const r = checkLog(ndjson(GOOD.filter((l) => !/api/.test(l.process))));
    assert.equal(r.result, "FAIL");
    assert.match(r.problems.join("\n"), /no line of the API process/);
    assert.equal(checkLog("").result, "FAIL");
  });

  it("the CLI: exit 0 / 1 with the summary file; a missing log or a non-JSON line is BLOCKED (exit 2)", () => {
    const good = join(work, "good.ndjson");
    const bad = join(work, "bad.ndjson");
    const junk = join(work, "junk.ndjson");
    writeFileSync(good, ndjson(GOOD));
    writeFileSync(bad, ndjson([...GOOD, line("api", "net.client.socket", "1.1.1.1", "1.1.1.1", 443)]));
    writeFileSync(junk, "not json\n");
    const run = (args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });
    const ok = run(["--log", good, "--out", join(work, "good.json")]);
    assert.equal(ok.status, 0, ok.stdout);
    assert.equal(JSON.parse(readFileSync(join(work, "good.json"), "utf8")).result, "PASS");
    const fail = run(["--log", bad]);
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /^offline-drill: connection outside loopback: 1\.1\.1\.1:443 by api$/m);
    assert.equal(run(["--log", join(work, "none.ndjson")]).status, 2);
    assert.equal(run(["--log", junk]).status, 2);
  });
});

describe("T-B13 offline-drill.sh: BLOCKED and isolation paths", () => {
  it("usage without --out is BLOCKED (exit 2)", () => {
    const r = spawnSync("bash", [DRILL], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^offline-drill: BLOCKED: usage:/m);
  });

  it("a non-empty output directory is BLOCKED (exit 2): two runs never mix their logs", () => {
    const out = join(work, "o-used");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "connections.ndjson"), "");
    const r = spawnSync("bash", [DRILL, "--out", out], { encoding: "utf8" });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^offline-drill: BLOCKED: output directory \S+ is not empty$/m);
  });

  it("no installed Chromium: exit 3 with the B.5 line, and nothing is downloaded", () => {
    const empty = join(work, "no-browsers");
    mkdirSync(empty, { recursive: true });
    const r = spawnSync("bash", [DRILL, "--out", join(work, "o-chromium")], {
      encoding: "utf8",
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty },
    });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /^offline-drill: BLOCKED: no installed Chromium for Playwright \(it is never downloaded\)$/m,
    );
    assert.equal(spawnSync("bash", ["-c", `ls -A "${empty}" | wc -l`], { encoding: "utf8" }).stdout.trim(), "0");
  });

  it("without bwrap (stub PATH) it exits 3 with the BLOCKED line", () => {
    const bin = mkdtempSync(join(work, "bin-"));
    for (const t of ["bash", "node", "ls", "sort", "tail", "dirname", "mkdir"]) {
      const real = spawnSync("bash", ["-c", `command -v ${t}`], { encoding: "utf8" }).stdout.trim();
      if (!real) continue;
      writeFileSync(join(bin, t), `#!/bin/sh\nexec ${real} "$@"\n`);
      chmodSync(join(bin, t), 0o755);
    }
    const r = spawnSync(join(bin, "bash"), [DRILL, "--out", join(work, "o-bwrap")], {
      encoding: "utf8",
      env: { PATH: bin, HOME: work, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "" },
    });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /^offline-drill: BLOCKED: no network namespace with loopback \(bwrap unavailable\)$/m);
  });

  it("a probe that connects exits 1 with the isolation line, before any spec runs", () => {
    if (!hasBwrap()) throw new Error("BLOCKED: bwrap --unshare-net is not available here");
    const out = join(work, "o-probe");
    mkdirSync(out, { recursive: true });
    const inner = `node -e 'require("node:net").createServer((s) => s.end()).listen(25998, "127.0.0.1")' & sleep 0.5;
      MTH_OD_INNER=1 MTH_EGRESS_PROBE=127.0.0.1:25998 MTH_EGRESS_DNS_PROBE=no-such-host.invalid bash "$DRILL" --out "$OUT"; rc=$?; kill %1; exit $rc`;
    const r = spawnSync("bwrap", ["--dev-bind", "/", "/", "--unshare-net", "bash", "-c", inner], {
      encoding: "utf8",
      env: { ...process.env, OUT: out, DRILL },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^offline-drill: network isolation is not effective$/m);
    assert.doesNotMatch(r.stdout, /group demo/);
  });
});
