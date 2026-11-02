# Current architecture

EduGuard runs **React/Vite + FastAPI + PeerJS + PostgreSQL**, with the frontend on Vercel and separate API/signaling services on Render. Streamlit is not a runtime dependency. This describes repository wiring, not proof that a particular deployment is current or production-ready.

## Browser and classroom assets

- `web/index.html` loads `web/src/main.jsx`. The React shell uses `TeacherAccess.jsx` for teacher accounts, `observations.jsx` for observation presentation, `identity.mjs` for participant identity, `privacy.mjs` for telemetry validation, `durable_outbox.mjs` for IndexedDB retries, and `style.css` for layout.
- The shell embeds the active student and teacher pages in `components/student_room/frontend/index.html` and `components/teacher_room/frontend/index.html`. Their directory names come from the earlier architecture; these files are still production UI.
- `core/engagement.mjs` is the canonical browser inference source; `core/roster.mjs` supplies teacher roster logic. `scripts/build_engagement.mjs` generates their committed browser counterparts, `engagement.js` and `roster.js`, beside the HTML. Preserve both source and generated files; CI checks for drift.
- `scripts/prepare_web.mjs` copies the classroom assets to ignored `web/public/classroom/`. Vite builds `web/` into ignored `dist/`. `vercel.json` selects `npm run build`, serves `dist/` and preserves classroom/asset routes.

Students explicitly consent and select telemetry-only or synthetic mesh sharing. Face inference stays in the browser. The current student client sends no raw camera or microphone tracks: telemetry-only has no outbound student media; mesh mode sends synthetic canvas video. Optional microphone-energy analysis is local. Derived observations and mesh can still carry privacy risks; they are not proof of attention or misconduct.

## API, accounts and persistence

- `backend/app.py` exposes the FastAPI app. Render starts `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`; root `app.py` is a retained compatibility alias.
- `backend/passwords.py` implements password hashing and recovery-code hashing. Teachers create their own accounts; signed account and room capabilities enforce access. `AUTH_SIGNING_KEY` remains required. `TEACHER_ADMIN_PASSWORD` is optional legacy compatibility, not required for account signup or server startup.
- `backend/store.py` owns classroom/session/sample/attendance/account persistence, indexes and additive migrations (versions 2 and 3). Hosted deployments use PostgreSQL through SQLAlchemy/psycopg; SQLite remains supported for local work and tests. `scripts/migrate_db.py` is the documented migration entrypoint. Preserve historical records and back up before migration.
- The current CSV report route uses Python's `csv` module and the current Store tables. It does not call `core/reporting.py`.

## Signaling and deployment configuration

`signaling/server.cjs` runs the Node PeerJS service at `/eduguard`. Signaling establishes browser media/data connections; it is separate from FastAPI and does not itself relay media through restrictive networks. ICE settings come from the API's `ICE_SERVERS_JSON`; STUN-only configuration cannot establish universal connectivity. TURN relay delivery requires its own configuration and testing.

`render.yaml` defines API, signaling and PostgreSQL resources. `vercel.json` and `vite.config.mjs` define the browser build. `VITE_API_URL` is the public API address injected at frontend build time; `ALLOWED_ORIGINS`, `DATABASE_URL`, `SIGNALING_URL` and the signing key are backend settings. Keep credentials out of `VITE_*` variables. Free-plan limits, actual dashboard configuration and deployed revisions need separate verification.

## Development, tests and retained legacy files

`README.md` documents local setup with `scripts/configure_env.py` and `scripts/start_local.py`. `package.json` contains build/test commands; `.github/workflows/checks.yml` runs Python/JS tests, build and Playwright, with a dedicated PostgreSQL test service. `benchmarks/capture.html`, `scripts/benchmark_video.mjs` and `evaluation/` support consent-based local research evaluation, not production inference or demonstrated field accuracy.

`core/db_manager.py`, `core/reporting.py`, `core/global_state.py`, `config.py` and `web/src/outbox.mjs` are retained legacy/support code with test dependencies. They are not the current runtime's database, presence cache, threshold source or durable queue. They have not been deleted. Historical/copied-formula tests preserve audit reproductions; passing them does not validate the current engine. Actual source/runtime tests provide separate evidence.

For setup use [README.md](README.md); for accounts use [TEACHER_ACCOUNTS.md](TEACHER_ACCOUNTS.md); for data flow use [PRIVACY.md](PRIVACY.md) and [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md). [REPOSITORY_CLEANUP_AUDIT.md](REPOSITORY_CLEANUP_AUDIT.md) is the cleanup inventory. AUDIT.md, REMEDIATION.md, FRONTEND_AUDIT.md and VALIDATION_REPORT.md are historical snapshots; their old architecture, counts and live observations must not be interpreted as current deployment status.
