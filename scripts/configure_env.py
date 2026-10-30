"""Generate ignored local API/frontend environment files without printing secrets."""
from pathlib import Path
import secrets
import tomllib
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
output = ROOT / '.env.local'
values = dict(dotenv_values(output)) if output.exists() else {}
legacy = ROOT / '.streamlit' / 'secrets.toml'
password = values.get('TEACHER_ADMIN_PASSWORD')
if not password and legacy.exists():
    password = tomllib.loads(legacy.read_text(encoding='utf-8')).get('TEACHER_ADMIN_PASSWORD')
values.update(TEACHER_ADMIN_PASSWORD=password or secrets.token_urlsafe(32),
              AUTH_SIGNING_KEY=values.get('AUTH_SIGNING_KEY') or secrets.token_urlsafe(48),
              DATABASE_URL=values.get('DATABASE_URL') or 'sqlite:///eduguard_api.db',
              ALLOWED_ORIGINS='http://localhost:5173,http://127.0.0.1:5173',
              SIGNALING_URL='http://localhost:9000')
import json
output.write_text('\n'.join(f'{key}={json.dumps(value)}' for key,value in values.items())+'\n',encoding='utf-8')
frontend = ROOT / 'web' / '.env.local'
if not frontend.exists():
    frontend.write_text('VITE_API_URL=http://localhost:8000\n',encoding='utf-8')
print('Saved ignored .env.local and web/.env.local. Credentials were not printed.')
