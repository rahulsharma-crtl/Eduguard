"""Verify version-pinned CDN entry scripts against committed SRI hashes, without changing pins."""
from pathlib import Path
import re, hashlib, base64, urllib.request
count=0
for path in Path('components').glob('*/frontend/index.html'):
    for url, digest in re.findall(r'<script src="(https://[^"]+)" integrity="sha384-([^"]+)"',path.read_text(encoding='utf-8')):
        data=urllib.request.urlopen(url,timeout=30).read()
        actual=base64.b64encode(hashlib.sha384(data).digest()).decode()
        if actual!=digest: raise SystemExit(f'SRI mismatch: {url}')
        count+=1
print(f'Verified {count} pinned CDN entry scripts. Dynamic MediaPipe assets are version-pinned, not SRI-verified.')
