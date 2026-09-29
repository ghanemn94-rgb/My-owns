"""Tests for tools/agents/agent_settings.py (D-025): per-run guard hook plus OS Bash sandbox deny list."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

# Hermetic git: tests must not depend on the host's global or system git config (e.g. mandatory commit signing).
os.environ.update({"GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "GIT_AUTHOR_NAME": "gate-test",
                   "GIT_COMMITTER_NAME": "gate-test", "GIT_AUTHOR_EMAIL": "gate-test@example.invalid",
                   "GIT_COMMITTER_EMAIL": "gate-test@example.invalid"})

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import agent_settings  # noqa: E402


class AgentSettingsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = os.path.realpath(os.path.join(self.tmp.name, "repo"))
        # What run-agent.sh guarantees before it generates settings: the run directory, the stage's evidence directories.
        for d in ["docs/delivery/reviews", "docs/delivery/runs/DG1", "docs/analysis", "tools/gates", "tools/agents", "docs/source",
                  "apps/api", "tests/qa", "e2e"] + [f"docs/delivery/test-evidence/DG1/{k}" for k in ("domain", "code-security", "qa", "audit")]:
            os.makedirs(os.path.join(self.repo, d))
        for f in ["docs/delivery/requirements.csv", "docs/delivery/decisions.md", "package.json"]:
            open(os.path.join(self.repo, f), "w").close()
        subprocess.run(["git", "init", "-q", self.repo], check=True)
        subprocess.run(["git", "-C", self.repo, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "c"], check=True)

    def tearDown(self):
        self.tmp.cleanup()

    def deny(self, role, cwd=None):
        s = agent_settings.build(role, self.repo, cwd or self.repo, "DG1")
        sb = s["sandbox"]
        self.assertTrue(sb["enabled"] and sb["failIfUnavailable"] and sb["allowUnsandboxedCommands"] is False)
        self.assertIn("PreToolUse", s["hooks"])
        return {os.path.relpath(p, self.repo) if p.startswith(self.repo) else p for p in sb["filesystem"]["denyWrite"]}

    def test_every_role_denies_protected_paths(self):
        for role in list(agent_settings.CONFINED) + sorted(agent_settings.IMPLEMENTERS):
            d = self.deny(role)
            for p in [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs", ".mcp.json", "CLAUDE.local.md"]:
                self.assertIn(p, d, f"{role} must deny {p}")

    def test_reviewers_are_confined_to_evidence(self):
        d = self.deny("domain-reviewer")
        for p in ["apps", "package.json", "docs/analysis", "docs/delivery/requirements.csv", "docs/delivery/decisions.md"]:
            self.assertIn(p, d)
        self.assertNotIn("docs/delivery/test-evidence", d)
        q = self.deny("qa-verifier")
        self.assertNotIn("tests/qa", q)
        self.assertIn("apps", q)

    def test_analyst_keeps_analysis_and_register_only(self):
        d = self.deny("transformation-analyst")
        self.assertNotIn("docs/analysis", d)
        self.assertNotIn("docs/delivery/requirements.csv", d)
        self.assertIn("apps", d)

    def test_implementers_may_write_product_code(self):
        d = self.deny("backend-workflow-engineer")
        self.assertNotIn("apps", d)
        self.assertNotIn("package.json", d)

    def test_worktrees_are_covered(self):
        wt = os.path.realpath(os.path.join(self.tmp.name, "wt"))
        subprocess.run(["git", "-C", self.repo, "worktree", "add", "-q", wt], check=True)
        s = agent_settings.build("backend-workflow-engineer", self.repo, wt, "DG1")
        denies = s["sandbox"]["filesystem"]["denyWrite"]
        self.assertIn(os.path.join(wt, "tools/gates"), denies)
        self.assertIn(os.path.join(self.repo, "tools/gates"), denies)

    def test_cwd_outside_the_repository_is_refused(self):
        with self.assertRaises(SystemExit):
            agent_settings.build("backend-workflow-engineer", self.repo, self.tmp.name, "DG1")

    def test_unknown_role_is_refused(self):
        with self.assertRaises((SystemExit, FileNotFoundError)):
            agent_settings.build("nobody", self.repo, self.repo, "DG1")

    def test_each_reviewer_writes_only_its_own_evidence_directory(self):
        # F-DG0-144: concurrently running reviewers cannot alter each other's evidence, even before it exists.
        keys = agent_settings.EVIDENCE_KEYS
        for role, key in keys.items():
            d = self.deny(role)
            self.assertNotIn(f"docs/delivery/test-evidence/DG1/{key}", d)
            for other, other_key in keys.items():
                if other != role:
                    self.assertIn(f"docs/delivery/test-evidence/DG1/{other_key}", d, f"{role} must deny {other}'s evidence")

    def test_roles_without_evidence_cannot_write_any(self):
        for role in ["transformation-analyst", "backend-workflow-engineer", "solution-architect"]:
            self.assertIn("docs/delivery/test-evidence", self.deny(role))

    def test_a_stage_is_required(self):
        for stage in [None, "", "DG8", "../x"]:
            with self.assertRaises(SystemExit):
                agent_settings.build("qa-verifier", self.repo, self.repo, stage)

    def test_writable_areas_are_the_confined_scopes(self):
        self.assertEqual(agent_settings.writable_areas("qa-verifier", "DG1"),
                         ["docs/delivery/test-evidence/DG1/qa", "tests/qa", "e2e"])
        self.assertEqual(agent_settings.writable_areas("release-auditor", "DG3"), ["docs/delivery/test-evidence/DG3/audit"])
        self.assertEqual(agent_settings.writable_areas("transformation-analyst", "DG1"),
                         ["docs/analysis", "docs/delivery/requirements.csv", "docs/delivery/handbacks"])

    def test_confined_roles_omit_missing_paths_the_process_sandbox_makes_uncreatable(self):
        # D-030: a missing deny path needs a mount placeholder inside the repository, which the read-only process
        # sandbox cannot create; below the top level such a path has a read-only parent there anyway.
        shutil.rmtree(os.path.join(self.repo, "docs/delivery/test-evidence/DG1/qa"))
        for role in ["domain-reviewer", "transformation-analyst"]:
            d = self.deny(role)
            self.assertIn(".mcp.json", d)  # top level: the sandbox's throwaway tmpfs holds the placeholder
            self.assertIn("CLAUDE.local.md", d)
            self.assertNotIn("docs/delivery/candidates", d)  # missing, parent read-only in the process sandbox
            self.assertNotIn("docs/delivery/test-evidence/DG1/qa", d)
            for p in [".git", ".claude", "tools/gates", "tools/agents", "docs/source", "docs/delivery/reviews", "docs/delivery/runs"]:
                self.assertIn(p, d)  # what the validator requires (F-DG0-230) always exists
        # Implementers write the whole tree, so a missing protected path keeps its entry.
        self.assertIn("docs/delivery/candidates", self.deny("backend-workflow-engineer"))


if __name__ == "__main__":
    unittest.main()
