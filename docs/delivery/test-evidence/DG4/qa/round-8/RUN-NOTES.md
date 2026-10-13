# qa-verifier DG4 round 8: run notes (T-DG4-REV-QA-R8, confirmation round per D-134)

The record is `docs/delivery/reviews/DG4/round-8/qa-verifier.json`, with `qa-verifier.verifications.json` and `qa-verifier.md` next to it. I wrote no new test this round; `docs/delivery/test-evidence/DG4/qa/tests/round-8/` is not created.

## Order of work

1. Clone and candidate (`00-candidate-start.log`), 07:16–07:20Z. `$TMPDIR/rev` is a complete clone at `8553323`, not shallow, with a clean status. Candidate `sha256:8014e5ce…`, 1475 files, on the clone and on the working tree (HEAD `78fe975` = `8553323` + the freeze commit: 3 assignments, the manifest, `stages.json`). `git diff dab4562..8553323 -- . ':!docs/delivery'` has 0 files.
2. Offline install (`00-install.log`) and `pnpm -r build` (`01-pnpm-r-build.log`). The build is a prerequisite of `pnpm test`.
3. **`pnpm test` inside the envelope, before any other heavy work** (`02-*`), 07:22–07:52Z. There are 2 series of 4 runs (Node 22/24 × locale unset/C.UTF-8), run one after another. No other job of mine was running. The load average was sampled every 15 s (max gap 16 s).
   - A first launch at 07:21Z ran no test: a script bug passed an empty suffix argument (`$3: unbound variable`). Its empty samples file was removed, the script fixed, and the series relaunched as `-r1`.
4. The six remaining static checks (`01-*`), then the validators (`05-*`), the register confirmation (`06-*`) and the end-of-review candidate check (`00-candidate-end.log`).

## Unit (`02-unit-envelope-summary.txt`)

| Series | 1-min load (min / median / max) | Samples > 8 | Runs |
|---|---|---|---|
| r1 | 0.68 / 4.46 / 6.01 (n=58) | 0 | 4/4 EXIT 0 |
| r2 | 2.74 / 4.88 / 5.85 (n=58) | 0 | 4/4 EXIT 0 |

- **Each run:** unit-node 1589/1589, unit-web 1347/1347, unit-formula-nocodegen 259 passed + 2 skipped. The 2 skips are by design (`it.skipIf(NOCODEGEN)` in `fuzz.test.ts`).
- **Margins on the two F-DG4-148 classes:**
  - `architecture.test.ts` took 10.0–13.2 s against its 30 s limit.
  - raid "action register" took 1.1–1.9 s against the 5 s wait.
- **Non-pass lines.** Each log has 14 React "Encountered two children with the same key" stderr warnings, in passing tests of `kpiUnit.test.tsx` and `percentKpi.test.tsx`. These are fixture artefacts:
  - `kpiUnit`'s `adoption()` gives all three indicator rows `kpiDefinitionId: ID.f1`;
  - `percentKpi`'s area items reuse `KPI_ID`.
  - The same 14 lines appear in round 6 (`02-unit-node24-unset-lowload.log`) and round 7 (`02-unit-node24-unset-clean.log`) on identical code. No test fails because of them.
- There are no FAIL lines and no timeouts.

## Carry-forward (not re-run this round, D-134)

The product, its tests and its contract are byte-identical to round 7's candidate `baa6ff4d` (`dab4562`). These checks cite `../round-7/` and were not re-run:
- integration ×2;
- `tests/qa` alone;
- REQ-DLV-036;
- full e2e (en/ar × unset/C.UTF-8);
- the probes (axe, 390 px, 200 %, AUD);
- the integration probes;
- the F-DG4-146 mutants and the F-DG4-147 runs;
- the 137-row requirement trace.

`06-register-confirmation.txt` re-checks on this clone that the 137 assigned ids equal the register's DG4-final rows, that all 137 are IMPLEMENTED, and that all 1150 evidence paths exist. `requirements.csv` is unchanged since `dab4562`.
