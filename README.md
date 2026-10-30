# EduGuard

Privacy-focused live classrooms with a React/Vite frontend, FastAPI backend, PeerJS signaling, and PostgreSQL. Streamlit is no longer part of the running application.

Students receive teacher video/audio while MediaPipe runs locally. Only synthetic face-mesh video, microphone audio while unmuted, and derived observations leave the student's device. The frontend requests hardware permissions after joining. Engagement scores are heuristic observations, not evidence of intent or learning.

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

- Teacher passwords are checked server-side. Signed, room-scoped tokens expire after 12 hours; student tokens cannot read rosters/reports or control other rooms. Invitation links grant student access; this is not LMS identity verification.
- Derived telemetry is queued in the current browser tab's session storage before HTTP delivery. API sample IDs make retries idempotent; failed uploads retry while the tab remains open or after reloading it. Closing the tab permanently can lose samples that never reached the API. Stored data uses PostgreSQL in the supplied cloud setup.
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
