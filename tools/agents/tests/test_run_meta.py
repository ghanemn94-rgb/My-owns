"""Unit tests for tools/agents/run_meta.py (run: python3 -m unittest discover -s tools/agents/tests -p 'test_*.py')."""
import gzip
import hashlib
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import run_meta  # noqa: E402


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class RunMetaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        self.out = os.path.join(self.root, "docs/delivery/runs/DG0/run1")
        os.makedirs(self.out)

    def tearDown(self):
        self.tmp.cleanup()

    def run_meta(self, events, pre, post):
        with gzip.open(os.path.join(self.out, "transcript.jsonl.gz"), "wt", encoding="utf-8") as f:
            for e in events:
                f.write((e if isinstance(e, str) else json.dumps(e)) + "\n")
        for name, data in ((".pre-snapshot.json", pre), (".post-snapshot.json", post)):
            with open(os.path.join(self.out, name), "w", encoding="utf-8") as f:
                json.dump(data, f)
        args = [self.out, "run1", "qa-verifier", "DG0", "T", "sid", "m", self.root, "head", "a.md", "x",
                "t0", "t1", "0", "0", self.root]
        return run_meta.build_meta(args)

    def tool_use(self, uid, name, **inp):
        return {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": uid, "name": name, "input": inp}]}}

    def test_string_messages_and_non_object_lines_are_tolerated(self):
        # Regression: round 5 crashed on an event whose "message" is a string.
        events = [{"type": "system", "message": "a plain string"}, "[1, 2]", "not json",
                  {"type": "user", "message": "text"}, {"type": "result", "session_id": "sid", "is_error": False}]
        meta = self.run_meta(events, {}, {})
        self.assertEqual(meta["tool_authored"], {})
        self.assertFalse(meta["is_error"])

    def test_write_then_edit_is_replayed_and_bound(self):
        p = os.path.join(self.root, "docs/r.json")
        events = [self.tool_use("u1", "Write", file_path=p, content='{"a": 1}'),
                  self.tool_use("u2", "Edit", file_path=p, old_string="1", new_string="2"),
                  {"type": "result", "session_id": "sid", "is_error": False}]
        meta = self.run_meta(events, {}, {"docs/r.json": sha('{"a": 2}')})
        self.assertEqual(meta["tool_authored"], {"docs/r.json": sha('{"a": 2}')})

    def test_failed_calls_and_shell_edits_are_not_bound(self):
        p = os.path.join(self.root, "docs/x.txt")
        q = os.path.join(self.root, "docs/y.txt")
        events = [self.tool_use("u1", "Write", file_path=p, content="mine"),
                  {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "u1", "is_error": True}]}},
                  self.tool_use("u2", "Write", file_path=q, content="hello"),
                  {"type": "result", "session_id": "sid", "is_error": False}]
        post = {"docs/x.txt": sha("someone else"), "docs/y.txt": sha("hello\ntampered\n")}
        meta = self.run_meta(events, {}, post)
        self.assertEqual(meta["tool_authored"], {})
        self.assertEqual(sorted(meta["written_by_tools"]), ["docs/x.txt", "docs/y.txt"])
        self.assertEqual(sorted(meta["outputs"]), ["docs/x.txt", "docs/y.txt"])

    def test_edit_without_a_prior_write_is_not_reconstructible(self):
        p = os.path.join(self.root, "docs/z.txt")
        events = [self.tool_use("u1", "Edit", file_path=p, old_string="a", new_string="b"),
                  {"type": "result", "session_id": "sid", "is_error": False}]
        meta = self.run_meta(events, {"docs/z.txt": sha("a")}, {"docs/z.txt": sha("b")})
        self.assertEqual(meta["tool_authored"], {})

    def test_snapshots_survive_a_failure_for_diagnosis(self):
        # A malformed snapshot makes build_meta fail before meta.json exists; the snapshots must not be deleted.
        with gzip.open(os.path.join(self.out, "transcript.jsonl.gz"), "wt", encoding="utf-8") as f:
            f.write("{}\n")
        with open(os.path.join(self.out, ".pre-snapshot.json"), "w", encoding="utf-8") as f:
            f.write("{broken")
        with open(os.path.join(self.out, ".post-snapshot.json"), "w", encoding="utf-8") as f:
            f.write("{}")
        with self.assertRaises(ValueError):
            run_meta.build_meta([self.out, "run1", "qa-verifier", "DG0", "T", "sid", "m", self.root, "head", "a.md",
                                 "x", "t0", "t1", "0", "0", self.root])
        self.assertTrue(os.path.exists(os.path.join(self.out, ".pre-snapshot.json")))
        self.assertFalse(os.path.exists(os.path.join(self.out, "meta.json")))


if __name__ == "__main__":
    unittest.main()


class ExternalConfigTest(RunMetaTest):
    def test_external_config_changes_are_recorded(self):
        with open(os.path.join(self.out, ".config-changed.txt"), "w", encoding="utf-8") as f:
            f.write("/root/.claude/settings.json 0123\n")
        meta = self.run_meta([{"type": "result", "session_id": "sid", "is_error": False}], {}, {})
        self.assertEqual(meta["external_config_changed"], ["/root/.claude/settings.json 0123"])

    def test_no_change_records_an_empty_list(self):
        meta = self.run_meta([{"type": "result", "session_id": "sid", "is_error": False}], {}, {})
        self.assertEqual(meta["external_config_changed"], [])
