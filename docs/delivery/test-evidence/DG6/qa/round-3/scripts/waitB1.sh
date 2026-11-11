#!/bin/bash
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-3
until [ -f $E/04-unit-node24-cutf8.rc ]; do sleep 15; done
echo "seqB1 start $(date -u +%FT%TZ)"
/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-3/scripts/seqB1.sh
