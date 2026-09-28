# code-security-reviewer round 6: does each committed .pyc hold the bytecode of the committed .py at a059b55?
# Code-object equality (==) compares bytecode, constants (recursively, incl. nested functions), names and line tables.
import marshal, subprocess, sys
pairs = [("tools/agents/run_meta.py", "tools/agents/__pycache__/run_meta.cpython-311.pyc"),
         ("tools/agents/tests/test_run_meta.py", "tools/agents/tests/__pycache__/test_run_meta.cpython-311.pyc")]
print("python", sys.version.split()[0])
for src, pyc in pairs:
    s = subprocess.run(["git", "show", f"a059b55:{src}"], capture_output=True, check=True).stdout
    p = subprocess.run(["git", "show", f"a059b55:{pyc}"], capture_output=True, check=True).stdout
    committed = marshal.loads(p[16:])
    fresh = compile(s, committed.co_filename, "exec", dont_inherit=True)
    print(src, "| src_size", len(s), "| pyc_hdr_size", int.from_bytes(p[12:16], "little"),
          "| embedded co_filename", committed.co_filename, "| code objects equal:", committed == fresh)
