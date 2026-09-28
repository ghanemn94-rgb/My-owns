#!/usr/bin/env python3
"""Cross-check test titles and files cited in the requirement register (T-DG0-AN-08, finding F-DG0-207).

Usage (from any directory):
  python3 docs/analysis/tools/check_test_refs.py

Checks on docs/delivery/requirements.csv:
  T1  every quoted test title in an acceptance clause (a '...' string that follows the words 'test', 'tests' or
      'including' inside a clause that mentions a test) equals a title in EXPECTED_TITLES exactly. A ' ... '
      inside a quote is not allowed: cite the full title.
  T2  a clause that names a self-test ('validator test', 'guard test', 'P0 test', 'self-test') quotes at least
      one title, so the reference can be traced.
  T3  every file named in the evidence column exists, and every repository path or delivery file named in the
      acceptance column exists (resolved against the repository root, docs/delivery/ and tools/gates/schemas/).
      Skipped: paths with placeholders (<DGx>) or globs, per-run 'meta.json' files, and gate records
      gates/DGn.json, which are outputs that exist only once a run or gate has happened.
  T4  EXPECTED_TITLES equals the set of test("...") titles declared in tools/gates/tests/*.test.mjs and
      tools/agents/tests/*.test.mjs, so that the list itself cannot go stale unnoticed.
EXPECTED_TITLES is the list of current titles given in assignment T-DG0-AN-08 (output of
`node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` at the round-2 base).
Exit status 1 on any problem.
"""
import csv, glob, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
EXPECTED_TITLES = [
    "reviewers may write only review records and evidence",
    "qa-verifier may add tests under tests/qa and e2e but not product code",
    "implementers cannot edit gate rules, agent definitions, sources or gate records",
    "release-auditor writes gate decisions but not implementation",
    "transformation-analyst is limited to analysis outputs and the register",
    "unknown roles are denied and scratch space outside a repo is allowed",
    "the hook entry point blocks with exit code 2 and allows with 0",
    "implementers cannot write reviewer test evidence",
    "F-DG0-105: Claude configuration surfaces and the unrelated project are protected from implementers",
    "F-DG0-105: writes through a symlink into a protected path are blocked",
    "F-DG0-105: protected-path matching is case-insensitive",
    "F-DG0-111: a planted nested .git cannot move the guarded root; .git paths are never writable",
    "the production guard root is this repository",
    "a fully evidenced DG0 gate passes in current and historical mode",
    "A24: a missing specialist reviewer fails the gate",
    "A23: a reviewer who authored the scope, or who is an owner, is rejected",
    "A23: reviewers sharing one invocation are not independent",
    "A24 / F-DG0-102: fabricated or incomplete provenance is rejected",
    "F-DG0-201: a review bound to an unrelated run of the same role is rejected",
    "A24: failed or BLOCKED checks and non-PASS verdicts fail the gate",
    "A24: unresolved blocking findings fail the gate; owners cannot verify their own fix",
    "F-DG0-101: findings cannot escape by relabelling, dropping or downgrading",
    "A24 / F-DG0-106 / F-DG0-202: incomplete requirements, placeholder evidence and coverage gaps fail",
    "A25: a source change invalidates the approval; review metadata does not",
    "A25 / F-DG0-103: symlinks are part of the candidate identity; submodules are refused",
    "F-DG0-104: the manifest spec must equal the stage spec and the approved policy",
    "A25: a tampered manifest or a stale review candidate is detected",
    "F-DG0-102: approval records are immutable after approval (historical mode)",
    "the gate record must be written by the audited release-auditor invocation",
    "A24: the pipeline cannot advance past a gate that is not APPROVED",
    "illegal stage transitions are rejected",
    "an APPROVED gate with a BLOCKED decision or blocking conditions fails",
    "F-DG0-107: the CSV parser rejects text after a closing quote and ragged rows",
    "F-DG0-110 / F-DG0-204: closure comes from the reviewer's own verification sidecar and bound run",
    "F-DG0-101 residual: deleting an earlier review round is detected",
    "F-DG0-205: evidence that is a symlink to a file outside the repository is rejected",
    "F-DG0-112 / F-DG0-206: file mode and entry type are part of the candidate identity",
]
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
SELFTEST = re.compile(r'\b(validator|guard|P0|self-)\s*tests?\b', re.I)


def declared_titles():
    out = []
    for path in sorted(glob.glob(f'{ROOT}/tools/gates/tests/*.test.mjs') + glob.glob(f'{ROOT}/tools/agents/tests/*.test.mjs')):
        src = open(path, encoding='utf-8').read()
        out += [m.group(2) for m in re.finditer(r'\btest\((["`])(.+?)\1\s*,', src)]
    return out


def quoted_titles(clause):
    """Quoted strings that follow 'test(s)' or 'including' (possibly as a list joined by ',' / 'and')."""
    found = []
    for m in re.finditer(r"\b(?:tests?|including)\s+((?:'[^']+'(?:\s*,\s*|\s+and\s+)?)+)", clause):
        found += re.findall(r"'([^']+)'", m.group(1))
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


def main():
    problems = []
    titles = set(EXPECTED_TITLES)
    declared = declared_titles()
    for t in sorted(set(declared) - titles):
        problems.append(f'T4 declared test not in EXPECTED_TITLES: {t!r}')
    for t in sorted(titles - set(declared)):
        problems.append(f'T4 expected title not declared in any test file: {t!r}')
    rows = list(csv.DictReader(open(f'{ROOT}/docs/delivery/requirements.csv', newline='', encoding='utf-8')))
    cited = 0
    for r in rows:
        rid = r['req_id']
        for clause in split_clauses(r['acceptance']):
            qs = quoted_titles(clause) if re.search(r'\btests?\b', clause, re.I) else []
            for q in qs:
                cited += 1
                if q not in titles:
                    near = [t for t in titles if q.replace('...', '').strip() and q.split('...')[0].strip() in t]
                    hint = f' (did you mean {near[0]!r}?)' if near else ''
                    problems.append(f'{rid}: T1 cites a test title that does not exist: {q!r}{hint}')
            if SELFTEST.search(clause) and not qs:
                problems.append(f'{rid}: T2 names a self-test without quoting its title: {clause.strip()!r}')
        for e in [x.strip() for x in r['evidence'].split(';') if x.strip()]:
            if not os.path.isfile(os.path.join(ROOT, e)):
                problems.append(f'{rid}: T3 evidence file does not exist: {e}')
        for p in re.findall(r'(?<![\w/.<*-])((?:\.?[\w-]+/)+[\w.-]+\.\w+|[\w.-]+\.(?:md|json|mjs|py|sh|yml))\b', r['acceptance']):
            if FUTURE_OUTPUTS.match(p):
                continue
            path = BARE.get(p, p)
            if not any(os.path.isfile(os.path.join(ROOT, d + path)) for d in SEARCH_DIRS):
                problems.append(f'{rid}: T3 acceptance names a file that does not exist: {p}')
    print(f'{len(declared)} declared test titles, {len(EXPECTED_TITLES)} expected; '
          f'{cited} quoted test title citation(s) in {len(rows)} register rows; {len(problems)} problem(s)')
    for p in problems:
        print('  -', p)
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
