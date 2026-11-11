#!/bin/bash
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-5
cd $E
{ echo "# $(date -u +%FT%TZ) error-line classification over the four binding integration logs (unique lines, counts)";
  for f in 12-integration-*.log 13-integration-*.log; do echo "== $f"; grep -E "Test Files|Tests |applied [0-9]+ migrations|exit=" $f;
    echo "-- lines matching ×|FAIL|Hook timed out|Unhandled|Timeout calling|ERR_|\"level\":\"(error|warn|fatal)\"|Error: (sorted, counted):";
    grep -E "×|FAIL|Hook timed out|Unhandled|Timeout calling|ERR_|\"level\":\"(error|warn|fatal)\"|^Error: |^\s+Error: " $f | sed -E 's/"time":[0-9]+,?//; s/"(reqId|pid|hostname|requestId|organizationId|correlationId|id|jobId|runId)":"?[^,"}]*"?,?//g; s/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g; s/[0-9]+ms/<n>ms/g' | cut -c1-260 | sort | uniq -c | sort -rn | head -40; done; } > $E/43-integration-error-lines.log 2>&1
