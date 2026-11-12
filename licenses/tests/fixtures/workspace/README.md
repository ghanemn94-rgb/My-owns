# Licence tooling fixture (SYNTHETIC)

A three-package workspace for `licenses/tests/*.test.mjs` (ADR-0062 §7, §9 T-A7/T-A8). The tests copy it to
`$TMPDIR`, write `node_modules/.pnpm/**/package.json` at run time (`node_modules` is git-ignored) and run
`node licenses/generate-sbom.mjs --root <copy>`. The integrity values are placeholders, not real package hashes.
