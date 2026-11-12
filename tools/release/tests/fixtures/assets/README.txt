SYNTHETIC clean twins of the asset scan self-test (ADR-0062 §8). The dist/ and node_modules/ twins are git-ignored paths, so
scan-assets.test.mjs writes them at run time; the planted hits are also written at run time from
fragments by scan-assets.test.mjs, so no whole planted value exists in the repository.
