# EduGuard

Privacy-focused live classrooms with a React/Vite frontend, FastAPI backend, PeerJS signaling, and PostgreSQL. Streamlit is no longer part of the running application.

Students receive teacher video/audio while MediaPipe runs locally. Students explicitly select mesh video or telemetry-only sharing. Student microphone audio is not transmitted; optional audio analysis stays local. Derived observations and mesh still carry privacy risks. The frontend requests hardware permissions after joining. Engagement scores are heuristic observations, not evidence of intent or learning.

## Local development

Use Python 3.11+ and Node 24.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
npm ci
python scripts/configure_env.py
npm run build
python scripts/start_local.py
```

Open http://localhost:5173. Your generated teacher password is in ignored `.env.local`. Existing locally configured teacher passwords are imported by the setup script when available. SQLite is used locally; the previous eduguard_telemetry.db is preserved and is not overwritten. The new API uses its own classroom tables. Historical Streamlit records are not automatically imported into the new dashboard.

## Deploy frontend to Vercel

1. Import this GitHub repository into Vercel, with the repository root as Root Directory. `vercel.json` selects Vite, `npm run build`, and `dist`.
2. Set **VITE_API_URL** to your deployed FastAPI HTTPS origin, without a trailing slash. It is a public address; never place administrator or signing secrets in VITE_ variables.
3. Deploy and copy the exact frontend origin, for example https://your-project.vercel.app.

## Deploy API and signaling to Render

Use the root `render.yaml` Blueprint. It creates two free web services and a free PostgreSQL database. No paid plan is selected.

1. Deploy `eduguard-signaling`, copy its actual HTTPS origin, then use that value for **SIGNALING_URL** on the API service.
2. Configure the API's **TEACHER_ADMIN_PASSWORD** (your private password), **ALLOWED_ORIGINS** (the exact Vercel frontend origin; comma-separated for multiple origins), and **SIGNALING_URL**. The Blueprint generates **AUTH_SIGNING_KEY** and connects **DATABASE_URL** automatically. Keep the signing key stable; changing it invalidates existing classroom tokens.
3. Copy the API HTTPS origin into Vercel's **VITE_API_URL** and redeploy the frontend. Vercel preview origins must be explicitly added to ALLOWED_ORIGINS if you use them.
4. Check API `/health`, signaling `/eduguard/peerjs/id`, then create a classroom and join from another browser/device. Camera/microphone permissions and HTTPS are required. Restricted NATs may need a TURN relay; public STUN is currently configured.

**Free hosting limits:** Render web services sleep when idle, so initial connections can take about a minute. Render free PostgreSQL expires after 30 days: use a long-lived PostgreSQL provider or upgrade before expiry for ongoing records. Database backups and capacity planning remain deployment responsibilities. See [Render free limits](https://render.com/docs/free).

## Behavior and security

- Teacher passwords are checked server-side. Signed, room-scoped tokens expire after 12 hours; student tokens cannot read rosters/reports or control other rooms. Signed expiring invitation links grant student access only after explicit consent; this is not LMS identity verification.
- Derived telemetry is committed to IndexedDB before HTTP delivery. API sample IDs make retries idempotent; failed uploads retry while the tab remains open or after reloading it. Committed pending events survive tab closure and recover when that participant returns; browser eviction/clearing or expired recovery credentials can still prevent recovery. Stored data uses PostgreSQL in the supplied cloud setup.
- Ending a classroom stops ingestion and causes student media to shut down on their next status poll (within about five seconds when online). Connection loss cannot guarantee immediate remote shutdown.
- Reports and session averages use all stored observations. Low-quality observations remain unknown and are excluded from scoring averages. Microphone muting and head tilt are not engagement penalties.
- Camera calibration is available in the student panel. esbuild generates the browser engagement/roster modules from core sources.

## Validation

```powershell
python -m pytest -q
npm run test:js
npm run lint:js
npm run build
```

`tests/js` includes synthetic-landmark regressions and a local signaling integration test. Real-video capture is at `benchmarks/capture.html` (serve the repository with `python -m http.server 8001`); run `npm run benchmark:video -- dataset.json report.json` on consented, independently labeled clips. No real-video accuracy is claimed without such data.

`AUDIT.md` is the historical Streamlit audit. `REMEDIATION.md` records the fixes and the migration. Deployment references: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/), [Render Blueprints](https://render.com/docs/blueprint-spec).

### Blank lecture / restricted networks

If the browser blocks audio autoplay, student video now retries muted and shows a Play lecture / enable audio button. Click it inside the lecture panel. The teacher must have a working local camera preview. For networks where direct media cannot connect, configure the API ICE_SERVERS_JSON environment variable with a JSON array containing STUN and your provider's browser-usable TURN credentials, then redeploy the API and reload both classrooms. Never use your TURN provider account/API secret as a browser credential. Signaling alone cannot relay media through restrictive NAT/firewalls.

Run `npm run test:media` for a real two-page WebRTC smoke test using synthetic cameras. It uses installed Chrome on Windows, or install Chromium with `npx playwright install chromium`. No physical camera or microphone is used. CI runs this test after building the static classroom assets.

## Privacy hardening

See [PRIVACY.md](PRIVACY.md) for the audited flow, threat model, data inventory, retention and limits. Start a new classroom after this security update: old invitation links and non-consented student tokens are no longer accepted. Choose telemetry-only or mesh and explicitly consent before joining. Students can withdraw/delete their data; teachers can end/delete the classroom. RETENTION_DAYS defaults to 7; expired rooms are removed by the running server. Configure a teacher password of at least 12 characters (admin123 is rejected). Microphone audio is never transmitted by the current student client.

## Session lifecycle

See [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) for durable queues, signed reconnects, five-second heartbeats, stale closure, UTC timestamps, attendance coverage, late recovery, and additive migration details. Browser credentials now persist locally with expiry to recover after tab/browser closure. Use withdrawal/deletion or clear local data on shared computers. Back up databases and run `python -m scripts.migrate_db` with one process before a multi-worker rollout. Migrations retain existing rows; the separately configured retention policy still applies when the API runs.

Run `npm run test:browser` for both synthetic-media privacy tests and real frontend/API offline-close-reopen recovery. This builds a test-only frontend with a localhost API address; production Vercel builds must use the configured deployment API URL. Install Playwright Chromium first if no supported local Chrome is available.
