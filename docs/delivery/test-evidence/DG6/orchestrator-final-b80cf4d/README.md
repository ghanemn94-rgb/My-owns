# Orchestrator merged-tree verification V10 on b80cf4ded

Every step exits 0 (`summary.txt`, `*.rc`): historical DG5, install, build, typecheck, lint, format, openapi, contrast, unit (locale unset and C.UTF-8), integration (4276 passed, 1 skipped, 1 todo), e2e locale unset (556 passed) and C.UTF-8 (556 passed), root e2e (288 passed, 18 skipped), demo (10 passed).

`root.truncated-by-duplicate.log`: the orchestrator mistakenly started a second copy of the run script after a container restart, while the first was still running; it was stopped within seconds but truncated the first root log. That log is not used as evidence; the root step was re-run alone afterwards (`root.log`, exit 0).
