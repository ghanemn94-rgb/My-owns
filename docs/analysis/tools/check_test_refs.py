#!/usr/bin/env python3
"""Cross-check test titles and files cited in the requirement register (T-DG0-AN-08, F-DG0-207; T-DG0-AN-10, F-DG0-009).

Usage (from any directory):
  python3 docs/analysis/tools/check_test_refs.py

The declared test titles are derived from the test files themselves, not from a hand-maintained list (T-DG0-AN-10,
finding F-DG0-009: the former EXPECTED_TITLES list went stale when the round-4 repair added tests):
  - JavaScript: the literal first argument of every test("...") / test('...') / test(`...`) call in
    tools/gates/tests/*.test.mjs and tools/agents/tests/*.test.mjs;
  - Python: the name of every `def test_...` method in tools/agents/tests/test_*.py (cite it as, e.g.,
    'test_write_then_edit_is_replayed_and_bound').

Checks on docs/delivery/requirements.csv:
  T1  every quoted test title in an acceptance clause (a '...' string that follows the words 'test', 'tests' or
      'including' inside a clause that mentions a test) equals a declared title exactly. A ' ... ' inside a quote
      is not allowed: cite the full title.
  T2  a clause that names a self-test ('validator test', 'guard test', 'P0 test', 'self-test', 'runner metadata
      test') quotes at least one title, so the reference can be traced.
  T3  every file named in the evidence column exists, and every repository path or delivery file named in the
      acceptance column exists (resolved against the repository root, docs/delivery/ and tools/gates/schemas/).
      Skipped: paths with placeholders (<DGx>) or globs, per-run 'meta.json' files, and gate records
      gates/DGn.json, which are outputs that exist only once a run or gate has happened.
  T4  the derivation itself is sound, so a parser gap cannot silently shrink the title set: every test file yields
      at least one title; in each JavaScript file the number of test( calls equals the number of titles parsed
      (a call whose title is not a string literal is reported); no title is declared twice (a citation would be
      ambiguous).
  T5  built-in negative control, run every time: a synthetic register row citing a non-existent title and naming a
      self-test without a title must produce a T1 and a T2 problem; otherwise the checker itself is broken.
Exit status 1 on any problem.
"""
import csv, glob, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
JS_TEST_FILES = ['tools/gates/tests/*.test.mjs', 'tools/agents/tests/*.test.mjs']
PY_TEST_FILES = ['tools/agents/tests/test_*.py']
# Bare file names used in acceptance text, resolved to their repository path.
BARE = {
    'decisions.md': 'docs/delivery/decisions.md', 'environment.md': 'docs/delivery/environment.md',
    'agents.md': 'docs/delivery/agents.md', 'agent-protocol.md': 'docs/delivery/agent-protocol.md',
    'progress.md': 'docs/delivery/progress.md', 'CLAUDE.md': 'CLAUDE.md',
    'stages.json': 'docs/delivery/stages.json', 'findings.json': 'docs/delivery/findings.json',
    'findings.schema.json': 'tools/gates/schemas/findings.schema.json',
    'validate.mjs': 'tools/gates/validate.mjs', 'requirements.csv': 'docs/delivery/requirements.csv',
}
FUTURE_OUTPUTS = re.compile(r'^(meta\.json|gates/DG([0-7]|x)\.json)$')
SEARCH_DIRS = ['', 'docs/delivery/', 'tools/gates/schemas/']
SELFTEST = re.compile(r'\b(validator|guard|P0|self-|runner metadata)\s*tests?\b', re.I)
JS_TITLE = re.compile(r'(?<![\w.$])test\(\s*(["\'`])((?:\\.|(?!\1).)+)\1\s*,', re.S)
JS_CALL = re.compile(r'(?<![\w.$])test\s*\(')
PY_TITLE = re.compile(r'^\s*def\s+(test_\w+)\s*\(', re.M)


def _files(patterns):
    return sorted(p for pat in patterns for p in glob.glob(os.path.join(ROOT, pat)))


def declared_titles():
    """Return ({title: [relative file, ...]}, [T4 problems])."""
    titles, problems = {}, []
    for path in _files(JS_TEST_FILES) + _files(PY_TEST_FILES):
        rel = os.path.relpath(path, ROOT)
        src = open(path, encoding='utf-8').read()
        if path.endswith('.py'):
            found = PY_TITLE.findall(src)
        else:
            found = [m.group(2) for m in JS_TITLE.finditer(src)]
            calls = len(JS_CALL.findall(src))
            if calls != len(found):
                problems.append(f'T4 {rel}: {calls} test( call(s) but {len(found)} literal title(s) parsed')
        if not found:
            problems.append(f'T4 {rel}: no test titles found')
        for t in found:
            titles.setdefault(t, []).append(rel)
    for t, where in sorted(titles.items()):
        if len(where) > 1:
            problems.append(f'T4 test title declared more than once ({", ".join(where)}): {t!r}')
    return titles, problems


def quoted_titles(clause):
    """Quoted strings that follow 'test(s)' or 'including' (possibly as a list joined by ',' / 'and')."""
    # An apostrophe between two letters (reviewer's, round's) is part of a title, not a closing quote; the same rule
    # as split_clauses (T-DG0-AN-09).
    q = r"'(?:[^']|(?<=[A-Za-z])'(?=[A-Za-z]))+'"
    found = []
    for m in re.finditer(r"\b(?:tests?|including)\s+((?:" + q + r"(?:\s*,\s*|\s+and\s+)?)+)", clause):
        found += [t[1:-1] for t in re.findall(q, m.group(1))]
    return found


def split_clauses(text):
    """Split an acceptance cell on ';' outside single-quoted titles (titles may themselves contain ';')."""
    out, cur, quoted = [], '', False
    for i, ch in enumerate(text):
        if ch == "'" and not (0 < i < len(text) - 1 and text[i - 1].isalpha() and text[i + 1].isalpha()):
            quoted = not quoted
        if ch == ';' and not quoted:
            out.append(cur); cur = ''
        else:
            cur += ch
    return out + [cur]


def check_titles(rows, titles):
    """T1/T2 over register rows; returns (number of citations, problems)."""
    problems, cited = [], 0
    for r in rows:
        rid = r['req_id']
        for clause in split_clauses(r['acceptance']):
            qs = quoted_titles(clause) if re.search(r'\btests?\b', clause, re.I) else []
            for q in qs:
                cited += 1
                if q not in titles:
                    stem = q.split('...')[0].strip()
                    near = sorted(t for t in titles if stem and stem in t)
                    hint = f' (did you mean {near[0]!r}?)' if near else ''
                    problems.append(f'{rid}: T1 cites a test title that does not exist: {q!r}{hint}')
            if SELFTEST.search(clause) and not qs:
                problems.append(f'{rid}: T2 names a self-test without quoting its title: {clause.strip()!r}')
    return cited, problems


def check_files(rows):
    problems = []
    for r in rows:
        rid = r['req_id']
        for e in [x.strip() for x in r['evidence'].split(';') if x.strip()]:
            if not os.path.isfile(os.path.join(ROOT, e)):
                problems.append(f'{rid}: T3 evidence file does not exist: {e}')
        for p in re.findall(r'(?<![\w/.<*-])((?:\.?[\w-]+/)+[\w.-]+\.\w+|[\w.-]+\.(?:md|json|mjs|py|sh|yml))\b', r['acceptance']):
            if FUTURE_OUTPUTS.match(p):
                continue
            path = BARE.get(p, p)
            if not any(os.path.isfile(os.path.join(ROOT, d + path)) for d in SEARCH_DIRS):
                problems.append(f'{rid}: T3 acceptance names a file that does not exist: {p}')
    return problems


def negative_control(titles):
    """T5: the checker must reject a fabricated citation and an untraceable self-test reference."""
    fake = {'req_id': 'T5-CONTROL', 'acceptance':
            "A24: the validator test 'no such test title (T5 control)' passes; the guard tests pass"}
    _, found = check_titles([fake], titles)
    kinds = {p.split(': ')[1].split(' ')[0] for p in found}
    return [] if kinds == {'T1', 'T2'} else [f'T5 negative control not detected as expected (got {found!r})']


def main():
    titles, problems = declared_titles()
    problems += negative_control(titles)
    rows = list(csv.DictReader(open(f'{ROOT}/docs/delivery/requirements.csv', newline='', encoding='utf-8')))
    cited, p = check_titles(rows, titles)
    problems += p + check_files(rows)
    n_files = len(_files(JS_TEST_FILES) + _files(PY_TEST_FILES))
    print(f'{len(titles)} declared test titles derived from {n_files} test files; '
          f'{cited} quoted test title citation(s) in {len(rows)} register rows; {len(problems)} problem(s)')
    for p in problems:
        print('  -', p)
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
