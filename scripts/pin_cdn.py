"""Pin CDN scripts and calculate SRI from the exact response bytes."""
import base64
import hashlib
import re
import urllib.request
from pathlib import Path

VERSIONS = {"camera_utils": "0.3.1675466862", "drawing_utils": "0.3.1675466124", "face_mesh": "0.4.1633559619"}
for path in Path("components").glob("*/frontend/index.html"):
    text = path.read_text(encoding="utf-8")
    def pin(match):
        url = match.group(1)
        if "@mediapipe/" in url:
            for name, version in VERSIONS.items():
                url = url.replace(f"@mediapipe/{name}/", f"@mediapipe/{name}@{version}/")
        data = urllib.request.urlopen(url, timeout=30).read()
        digest = base64.b64encode(hashlib.sha384(data).digest()).decode()
        return f'<script src="{url}" integrity="sha384-{digest}" crossorigin="anonymous"></script>'
    text = re.sub(r'<script src="(https://[^"]+)"[^>]*></script>', pin, text)
    # Pin dynamically fetched WASM/model support assets to the matching package version.
    text = text.replace("@mediapipe/face_mesh/${file}", "@mediapipe/face_mesh@0.4.1633559619/${file}")
    path.write_text(text, encoding="utf-8")
