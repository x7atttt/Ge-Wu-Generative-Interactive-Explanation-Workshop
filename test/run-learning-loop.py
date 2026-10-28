"""运行隔离实体验收；直接管理 node 进程，避免 Windows shell 留下后台服务。"""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
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
        args = ['node', script, *(['--dev'] if port == 3100 and '--keys-only' in sys.argv else [])]
        proc = subprocess.Popen(args, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        servers.append(proc)
        deadline = time.monotonic() + 60
        while not listening(port):
            if proc.poll() is not None:
                raise RuntimeError(f'验收服务启动失败，请查看 data/test-server-{port}.log')
            if time.monotonic() > deadline:
                raise RuntimeError(f'验收服务启动超时：{port}')
            time.sleep(0.2)
    if '--keys-only' in sys.argv:
        sys.exit(subprocess.run(['python', 'test/header-keys-ui.py'], cwd=ROOT).returncode)
    if '--teaching-only' in sys.argv:
        sys.exit(subprocess.run(['node', 'test/teaching-flow.mjs', *[arg for arg in sys.argv if arg.startswith('--eval-run=')]], cwd=ROOT).returncode)
    choices = {'--review-only': ['content-review.mjs'], '--transport-only': ['generation-transport.mjs'], '--diagram-only': ['diagram-effort.mjs'], '--repair-only': ['generation-repair.mjs'], '--layout-only': ['light-toolbar.mjs'], '--hover-only': ['hover-select.mjs'], '--deletion-only': ['space-deletion.mjs'], '--content-only': ['content-quality.mjs']}
    choices['--diagram-speed'] = ['diagram-effort.mjs', 'content-review.mjs', 'generation-transport.mjs', 'teaching-flow.mjs']
    scripts = next((scripts for flag, scripts in choices.items() if flag in sys.argv), ['learning-loop.mjs', 'content-quality.mjs', 'generation-repair.mjs', 'space-deletion.mjs', 'hover-select.mjs', 'light-toolbar.mjs', 'diagram-effort.mjs', 'generation-transport.mjs'])
    if not any(flag in sys.argv for flag in choices):
        scripts.append('teaching-flow.mjs')
        scripts.append('content-review.mjs')
    for script in scripts:
        result = subprocess.run(['node', f'test/{script}', *(['--browser'] if script == 'learning-loop.mjs' else [])], cwd=ROOT)
        if result.returncode:
            sys.exit(result.returncode)
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
