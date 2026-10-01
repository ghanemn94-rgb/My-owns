#!/usr/bin/env python3
"""Bring the loopback interface up inside a fresh network namespace (fallback when `ip` is not installed).

Used by scripts/ops/fresh-install-drill.sh only: `unshare -n` creates a namespace whose only interface, lo, is down.
"""
import fcntl
import socket
import struct

SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
flags = struct.unpack("16sH", fcntl.ioctl(s, SIOCGIFFLAGS, struct.pack("16sH", b"lo", 0)))[1]
fcntl.ioctl(s, SIOCSIFFLAGS, struct.pack("16sH", b"lo", flags | IFF_UP))
