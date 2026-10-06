# sample kernel-assigned client ports: N connects to a local listener; report min/max and any port < 32768
import socket
srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(512)
ports = []
for _ in range(3000):
    c = socket.socket(); c.connect(srv.getsockname()); ports.append(c.getsockname()[1]); a, _ = srv.accept(); a.close(); c.close()
lo, hi = map(int, open("/proc/sys/net/ipv4/ip_local_port_range").read().split())
print("ip_local_port_range", lo, hi, "| sampled", len(ports), "client ports: min", min(ports), "max", max(ports),
      "| outside range:", [p for p in ports if p < lo or p > hi], "| in 24000-31999:", [p for p in ports if 24000 <= p <= 31999])
