#!/usr/bin/env python3
"""Enter a per-run Landlock domain, then exec the wrapped command (decision D-033, finding F-DG0-152).

run-agent.sh runs each project agent inside a bubblewrap process sandbox that, by design, shares the host PID namespace
and binds a read-write host /proc (D-030): a reviewer's own nested bwrap needs the procfs to stay "fully visible" so it
can mount a fresh procfs for the pre-freeze. That sharing left one cross-run path open (F-DG0-152): two runs owned by the
same uid could reach each other through /proc/<peer-pid>/root and /proc/<peer-pid>/cwd -- a PTRACE_MODE_READ that passes
between same-uid processes -- and could send each other signals.

This wrapper closes it without touching the procfs binding. Just before `claude` execs, the run enters its own fresh,
scope-only Landlock domain: handled_access_fs = 0 and handled_access_net = 0 (so NO filesystem or network access is
restricted -- the run's own areas stay writable and a nested bwrap with a fresh --proc still works), with
scoped = LANDLOCK_SCOPE_SIGNAL | LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET (Landlock ABI >= 6). Two things follow:

  - Being in ANY non-empty Landlock domain restricts ptrace to the domain and its descendants. Every run enters its OWN
    domain, so two runs are in sibling domains and neither may ptrace the other; the kernel therefore refuses one run's
    access to /proc/<peer>/root and /proc/<peer>/cwd (Permission denied). This is the cross-run write fix.
  - LANDLOCK_SCOPE_SIGNAL refuses a signal sent to a process outside the sender's domain, so a run cannot signal another
    run (this also narrows threat-model residual 8). LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET refuses connecting to an abstract
    unix socket owned outside the domain, closing that cross-run channel in the shared network namespace.

The domain is inherited across execve and by every descendant, so it covers the whole run (the CLI, the agent's shell,
its nested sandboxes). Within a single run all processes share the one domain, so the run operates on its own /proc and
its own sockets normally. Verified against the real agent_sandbox.py args in the round-18 spike
(docs/delivery/test-evidence/DG0/code-security/round-18/{r18-landlock-spike.mjs,04-landlock-spike.log}).

Fail-closed: if Landlock is unavailable (kernel/ABI too old) or any step fails, this raises and `claude` never execs, so
a run can never proceed with the cross-run hole silently open (CLAUDE.md: a control that did not run is not "passed").

Usage: landlock_exec.py -- CMD [ARG...]
"""
import ctypes
import os
import sys

# uapi/linux/landlock.h. The scope bits exist since Landlock ABI 6; this kernel reports ABI 7 (round-18 spike log).
LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET = 1 << 0
LANDLOCK_SCOPE_SIGNAL = 1 << 1
# Syscall numbers are identical on x86-64 and arm64.
NR_LANDLOCK_CREATE_RULESET = 444
NR_LANDLOCK_RESTRICT_SELF = 446
PR_SET_NO_NEW_PRIVS = 38


def restrict_self():
    """Put the calling thread in a fresh scope-only Landlock domain. Raises OSError on any failure."""
    libc = ctypes.CDLL(None, use_errno=True)
    # landlock_restrict_self needs no_new_privs (the run holds no CAP_SYS_ADMIN). The process sandbox already sets it;
    # setting it again is an idempotent no-op that makes the precondition explicit and independent of the caller.
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        err = ctypes.get_errno()
        raise OSError(err, "prctl(PR_SET_NO_NEW_PRIVS): " + os.strerror(err))
    # struct landlock_ruleset_attr { __u64 handled_access_fs; __u64 handled_access_net; __u64 scoped; } (ABI 6+).
    attr = (ctypes.c_uint64 * 3)(0, 0, LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET | LANDLOCK_SCOPE_SIGNAL)
    fd = libc.syscall(NR_LANDLOCK_CREATE_RULESET, ctypes.byref(attr), ctypes.sizeof(attr), 0)
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, "landlock_create_ruleset (a scope-only domain needs Landlock ABI >= 6): " + os.strerror(err))
    try:
        if libc.syscall(NR_LANDLOCK_RESTRICT_SELF, fd, 0) != 0:
            err = ctypes.get_errno()
            raise OSError(err, "landlock_restrict_self: " + os.strerror(err))
    finally:
        os.close(fd)


def main(argv):
    if len(argv) < 2 or argv[0] != "--":
        raise SystemExit("usage: landlock_exec.py -- CMD [ARG...]")
    cmd = argv[1:]
    restrict_self()
    os.execv(cmd[0], cmd)


if __name__ == "__main__":
    main(sys.argv[1:])
