"""Tests for tools/agents/agent_settings.py (D-025): per-run guard hook plus OS Bash sandbox deny list."""
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import agent_settings  # noqa: E402


class AgentSettingsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = os.path.realpath(os.path.join(self.tmp.name, "repo"))
        for d in ["docs/delivery/test-evidence", "docs/delivery/reviews", "docs/analysis", "tools/gates", "apps/api", "tests/qa"]:
            os.makedirs(os.path.join(self.repo, d))
        for f in ["docs/delivery/requirements.csv", "docs/delivery/decisions.md", "package.json"]:
            open(os.path.join(self.repo, f), "w").close()
        subprocess.run(["git", "init", "-q", self.repo], check=True)
        subprocess.run(["git", "-C", self.repo, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "c"], check=True)

    def tearDown(self):
        self.tmp.cleanup()

    def deny(self, role, cwd=None):
        s = agent_settings.build(role, self.repo, cwd or self.repo)
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
        s = agent_settings.build("backend-workflow-engineer", self.repo, wt)
        denies = s["sandbox"]["filesystem"]["denyWrite"]
        self.assertIn(os.path.join(wt, "tools/gates"), denies)
        self.assertIn(os.path.join(self.repo, "tools/gates"), denies)

    def test_cwd_outside_the_repository_is_refused(self):
        with self.assertRaises(SystemExit):
            agent_settings.build("backend-workflow-engineer", self.repo, self.tmp.name)

    def test_unknown_role_is_refused(self):
        with self.assertRaises((SystemExit, FileNotFoundError)):
            agent_settings.build("nobody", self.repo, self.repo)


if __name__ == "__main__":
    unittest.main()
