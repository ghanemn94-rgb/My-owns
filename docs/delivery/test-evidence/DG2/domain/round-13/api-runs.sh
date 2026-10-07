set -u
for p in live-scenario design-registers r13-delta-api r12-delta-api r11-delta-api r10-delta-api regress-d069-api regress-d068-api regress-d067-api regress-d066-api; do
  echo "### node rv/$p.mjs"; node rv/$p.mjs > /home/user/My-owns/docs/delivery/test-evidence/DG2/domain/round-13/$p.log 2>&1; s=$?; echo "### $p exit=$s" | tee -a /home/user/My-owns/docs/delivery/test-evidence/DG2/domain/round-13/$p.log
done
