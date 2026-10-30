# T-DG6-BE-S: export proof, four configurations (same load database, same host, back to back)

Generated from export-proof-{before,code,sql,after}.json by a one-off node -e (shown in the handback). Load average 10.7-15.0 on 4 CPUs throughout (shared host; my unit and integration chains ran at the same time). Sandbox measurement, not Mobily production capacity.

| configuration | part A start p50/p95/max ms | part B start p50/p95/max ms | B starts > 2 s | A completion p50/max ms | B completion p50/max ms | assertion failures (A / B) | jobs succeeded |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | 226.703 / 807.629 / 807.629 | 2817.705 / 3479.549 / 3771.285 | 50 of 50 | 1661.357 / 2228.274 | 48572.955 / 98696.234 | 0 / 50 | 66 of 66 |
| code | 165.212 / 753.352 / 753.352 | 2946.308 / 3760.678 / 3797.152 | 49 of 50 | 1648.867 / 2890.759 | 49258.162 / 99000.558 | 0 / 49 | 66 of 66 |
| sql | 245.027 / 968.783 / 968.783 | 3125.991 / 3386.02 / 3911.918 | 50 of 50 | 1708.42 / 1962.123 | 48338.552 / 98316.706 | 0 / 50 | 66 of 66 |
| after | 153.593 / 597.383 / 597.383 | 2803.467 / 3259.147 / 3262.497 | 48 of 50 | 1766.807 / 3257.239 | 48898.107 / 99060.02 | 0 / 48 | 66 of 66 |
