"""运行隔离实体验收；直接管理 node 进程，避免 Windows shell 留下后台服务。"""
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
(ROOT / 'data').mkdir(exist_ok=True)
servers = []
logs = []

def listening(port):
    with socket.socket() as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(('127.0.0.1', port)) == 0

try:
    for script, port in [('test/mock-llm.mjs', 3101), ('test/start-test-server.mjs', 3100)]:
        if listening(port):
            raise RuntimeError(f'验收端口 {port} 已占用，请先关闭旧的验收服务。')
        output = open(ROOT / f'data/test-server-{port}.log', 'w', encoding='utf-8')
        logs.append(output)
        proc = subprocess.Popen(['node', script], cwd=ROOT, stdout=output, stderr=subprocess.STDOUT,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        servers.append(proc)
        deadline = time.monotonic() + 60
        while not listening(port):
            if proc.poll() is not None:
                raise RuntimeError(f'验收服务启动失败，请查看 data/test-server-{port}.log')
            if time.monotonic() > deadline:
                raise RuntimeError(f'验收服务启动超时：{port}')
            time.sleep(0.2)
    if '--content-only' not in sys.argv and '--deletion-only' not in sys.argv:
        result = subprocess.run(['node', 'test/learning-loop.mjs', '--browser'], cwd=ROOT)
        if result.returncode:
            sys.exit(result.returncode)
    if '--deletion-only' not in sys.argv:
        result = subprocess.run(['node', 'test/content-quality.mjs'], cwd=ROOT)
        if result.returncode:
            sys.exit(result.returncode)
    sys.exit(subprocess.run(['node', 'test/space-deletion.mjs'], cwd=ROOT).returncode)
finally:
    for proc in reversed(servers):
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
    for output in logs:
        output.close()
