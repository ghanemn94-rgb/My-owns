set -u
export OUT=/var/tmp/mth-run.3sKDTK/claude-0/shots
for p in r13-ui r9-ui charter-blank-ui dom-shots walk-ui r12-team-ui r12-journey-steps-ui regress-d067-ui regress-d066-ui; do
  L=$p; [ $p = r9-ui ] && L=ui-upload-alert
  echo "### node rv/$p.mjs"; node rv/$p.mjs > /home/user/My-owns/docs/delivery/test-evidence/DG2/domain/round-13/$L.log 2>&1; s=$?; echo "### $p exit=$s" | tee -a /home/user/My-owns/docs/delivery/test-evidence/DG2/domain/round-13/$L.log
done
