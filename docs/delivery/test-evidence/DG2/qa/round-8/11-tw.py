# usage: python3 -I 11-tw.py PORT [PORT...] : leave a client socket bound to each 127.0.0.1:PORT in TIME_WAIT
import errno, socket, sys, time
for p in map(int, sys.argv[1:]):
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); srv.bind(("127.0.0.1", 0)); srv.listen()
    c = socket.socket(); c.bind(("127.0.0.1", p)); c.connect(srv.getsockname()); a, _ = srv.accept()
    c.close(); time.sleep(0.1); a.close(); srv.close(); time.sleep(0.1)
    st = [l.split()[3] for l in open("/proc/net/tcp").read().splitlines()[1:] if l.split()[1].endswith(":%04X" % p)]
    pr = socket.socket(); pr.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try: pr.bind(("127.0.0.1", p)); pr.listen(); r = "bind OK"
    except OSError as e: r = "bind FAILED " + errno.errorcode[e.errno]
    pr.close()
    print("TIME_WAIT on %d: states %s; SO_REUSEADDR probe %s" % (p, st, r)); sys.stdout.flush()
    if "06" not in st or "EADDRINUSE" not in r: sys.exit(1)
