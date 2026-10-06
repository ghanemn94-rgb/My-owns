import socket, errno
# server with SO_REUSEADDR on an ephemeral port
srv=socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); srv.bind(('127.0.0.1',0)); srv.listen(); sp=srv.getsockname()[1]
c=socket.socket(); c.connect(('127.0.0.1',sp)); cp=c.getsockname()[1]
a,_=srv.accept()
c.close()   # client closes first -> client side enters TIME_WAIT on its ephemeral port cp
a.close()
import time; time.sleep(0.2)
tw=[l.split() for l in open('/proc/net/tcp').readlines()[1:]]
print('server port',sp,'client ephemeral port',cp,'client socket state', [x[3] for x in tw if int(x[1].split(':')[1],16)==cp])
s2=socket.socket(); s2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # postgres also sets SO_REUSEADDR
try:
    s2.bind(('127.0.0.1',cp)); s2.listen(); print('bind+listen on',cp,'OK')
except OSError as e:
    print('bind on',cp,'FAILED:',errno.errorcode[e.errno], e)
