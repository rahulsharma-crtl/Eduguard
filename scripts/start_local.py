"""Run API, private signaling, and the Vite frontend together."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--check',action='store_true',help='Verify local services and stop')
args = parser.parse_args()
if not (ROOT / '.env.local').exists():
    raise SystemExit('First run: python scripts/configure_env.py')
load_dotenv(ROOT / '.env.local')
subprocess.run(['node','scripts/prepare_web.mjs'],cwd=ROOT,check=True)
commands = [['node','signaling/server.cjs'],
            [sys.executable,'-m','uvicorn','backend.app:app','--host','127.0.0.1','--port','8000'],
            ['node','node_modules/vite/bin/vite.js','--host','127.0.0.1']]
processes = []
flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
try:
    for command in commands:
        processes.append(subprocess.Popen(command,cwd=ROOT,creationflags=flags))
    for url in ['http://localhost:9000/eduguard/peerjs/id','http://localhost:8000/health','http://127.0.0.1:5173']:
        for attempt in range(150):
            if any(process.poll() is not None for process in processes):
                raise RuntimeError('A local service exited. Check its logs.')
            try:
                with urllib.request.urlopen(url,timeout=1) as response:
                    if response.status == 200: break
            except OSError: time.sleep(0.1)
        else: raise RuntimeError(f'Service readiness timed out: {url}')
    print('All three services are healthy. Open http://localhost:5173; password is in .env.local')
    if not args.check:
        while all(process.poll() is None for process in processes): time.sleep(0.5)
except KeyboardInterrupt:
    pass
finally:
    for process in reversed(processes): process.terminate()
    for process in processes:
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: process.kill()
