# EduGuard production-readiness verification

Verified **2026-11-01**. Scope: existing React/Vite frontend, FastAPI API, PeerJS service and PostgreSQL deployment configuration. No Streamlit or architecture replacement. Original verification baseline was commit `53c4b60` plus the UI/evaluation working tree, subsequently pushed as `a0ed32d`. The teacher-account update below adds further changes. This is not a signed release attestation.

## Teacher-account update

Teacher-owned registration/sign-in and recovery replace the shared-password frontend. Local Python tests now report **56 passed, 1 PostgreSQL test skipped**; JavaScript remains **61 passed**. The actual React/FastAPI browser lifecycle now includes registration, one-time recovery acknowledgement, sign-out, incorrect login, recovery reset and sign-in with the new password. All **7 Playwright tests pass** with the account update, including media privacy/regression scenarios. Build and compatibility checks pass. The public endpoint measurements below predate this account update; no deployed account verification is claimed. See TEACHER_ACCOUNTS.md for migration version 3 and residual limitations. In the older findings below, shared teacher-password requirements are superseded: AUTH_SIGNING_KEY is still required; TEACHER_ADMIN_PASSWORD is optional legacy compatibility only and can be removed from Render.

## Verdict

**Production readiness is NOT established.** Local regression and browser checks pass, and public endpoints are reachable after initial delays. Blocking evidence gaps remain: real PostgreSQL migration/persistence testing, authenticated deployed lifecycle tests, actual multi-device/cross-network calls, and working TURN relay delivery. The public Vercel bundle still contains the older UI, so local fixes must not be treated as deployed.

No production room was created/deleted, no production migration was executed, no paid service was provisioned and no real student media was captured. Public checks are read-only apart from a temporary signaling peer registration that was closed. No configured passwords, signed access/resume/invitation tokens, database connection strings or TURN credentials are included here.

## Actual commands and results

| Check | Result | Evidence / scope |
| --- | --- | --- |
| `.venv/Scripts/python.exe -m pytest -q` | **51 passed, 1 skipped** | SQLite API, auth, admission, timestamps, lifecycle, historical migration, concurrency, expiry and deletion. PostgreSQL test skipped because `TEST_POSTGRES_URL` is absent. |
| Python warnings | 1 non-failing warning | Existing Starlette TestClient/httpx deprecation; not a demonstrated production runtime failure. |
| `npm run test:js` | **61 passed** | Engine, privacy guards, payload validation, durable queue, UI rendering, evaluation tools, signaling and lifecycle checks. Synthetic benchmarks are not field-accuracy evidence. |
| `npm run build` | **Pass** | Vite production build; about 247.5 kB main JS / 77.5 kB gzip. Browser command separately builds with local test API configuration. |
| `npm run test:browser` | **7 passed, 0 failed** | Final expanded Playwright run, serial files, approximately 63.2 seconds. Chromium on this Windows host; synthetic inputs. |
| `npm run lint:js` | **Pass** | Embedded classroom/capture script syntax checks. Not a full static security analyzer. |
| Generated engine drift check | **Pass** | Included in JS pretest. |
| `.venv/Scripts/python.exe scripts/verify_cdn.py` | **4 pinned CDN entry scripts verified** | MediaPipe dynamically loaded assets are version-pinned, not SRI-verified. |
| `npm audit --omit=dev --json` | **0 reported production vulnerabilities** | Point-in-time npm advisory check; excludes dev dependencies and is not a security guarantee. |
| `.venv/Scripts/python.exe -m pip check` | **Pass** | Installed requirement compatibility; not a Python vulnerability audit. |
| `git diff --check` | **Pass** | Git emitted line-ending notices, no whitespace errors. |

The first expanded browser run passed five scenarios and failed two. The calibration test's intercepted local HTML response triggered Chrome local-network-access checks; the harness now serves the modified synthetic-test HTML directly without weakening browser protections. The relay-only test exposed transient failure text overwritten by asynchronous playback handling. A persistent notice fixed that product issue. The final run passed all seven; the failures are not counted as successful tests.

## Browser and API scenario coverage

| Scenario | Actual result and boundary |
| --- | --- |
| Teacher login | Incorrect secret rejected, valid disposable test secret admitted through actual React UI + local FastAPI. No live admin login attempted. |
| Invitation | Teacher invitation copied from rendered UI and used for admission. Incomplete invitation disables joining. API rejects wrong-room invitation and unconsented join. |
| Consent | Student checkbox required; telemetry-only is default. Local tests reject `consent:false`. No claim of legally sufficient research consent. |
| Camera granted | Synthetic getUserMedia video/audio sources; teacher preview and received lecture decode at 640px width. No physical webcam used. |
| Camera denied | Simulated NotAllowedError for student camera; telemetry-only student still decodes lecture and sends zero media tracks. Observations remain unavailable. |
| Calibration | Synthetic valid FaceMesh landmarks drive the actual 30-frame calibration button to completion. This checks the UI routine, not real calibration accuracy. This scenario stubs the model and removes entry-script SRI only from the test server's HTML; production SRI remains intact. |
| Telemetry-only | Actual local PeerJS call, teacher video decodes, **zero student RTP sender tracks**. |
| Synthetic mesh | Actual local PeerJS call; student outbound video track has canvas provenance and differs from all original capture video track IDs. |
| Optional microphone | Audio capture explicitly opted into and then disabled; **no student audio sender** in either privacy mode. Local energy analysis only. |
| Broadcast | Teacher video received/decoded in both modes, including camera-denied student. Existing autoplay unit checks cover blocked-play fallback; genuine Safari/mobile gesture behavior remains untested. |
| Signaling reconnect | Student signaling explicitly disconnected, automatic reconnect observed. Same-host simulation, not a carrier/network handover. |
| Media reconnect | Student call explicitly closed, new RTCPeerConnection created and lecture decoding restored. Captured sender inspection still rejects raw camera/audio tracks. |
| Offline telemetry recovery | API routes deliberately failed, event committed to IndexedDB, tab closed/reopened, event recovered under same participant ID without duplicate attendance. |
| Reports | Successful real local CSV download through UI; separate browser case renders report-service failure. API tests verify teacher-only access and spreadsheet formula escaping. |
| Room closure | Teacher UI closes room, API marks participant completed, student UI stops classroom component after polling. New joins/resume rejected. |
| Deletion | Student UI deletes own data, roster becomes empty; teacher UI deletes room, old token loses access. API tests ensure one student cannot erase peers. |
| Restrictive-network simulation | Student RTCPeerConnection forced to relay-only **with no TURN server**. No teacher video decoded; persistent timeout/TURN warning displayed. This is a controlled ICE configuration test, not a real institutional firewall test. |
| Persistence and crash recovery | SQLite database reopen, event deduplication, attendance intervals, additive historical migrations, stale closure and concurrent admissions/writes pass. PostgreSQL not substituted by these results. |

Browser media tests use independent teacher/student pages in one browser context on one machine, a temporary real Node signaling server and synthetic camera/audio sources. The React/API lifecycle test uses a temporary actual FastAPI server with SQLite and deliberate camera denial; the UI-filter test stubs API/media responses. Those tests collectively exercise components but are **not one fully deployed end-to-end test across Vercel, Render and PostgreSQL**.

## Public deployment observations

Targets checked:

- Frontend: https://eduguardapp.vercel.app
- API: https://eduguard-zt6a.onrender.com
- Signaling: https://eduguard-signaling.onrender.com

Initial requests: frontend HTTP 200 in 852 ms; signaling ID endpoint HTTP 200 in 22,512 ms; API `/health` and `/config` exceeded a 30,000 ms deadline. On subsequent retry `/health` returned 200 in 493 ms, `/config` 200 in 303 ms and signaling WebSocket sent `OPEN` in 746 ms. These are **cold-start-like observations**, not a controlled idle-period experiment or proof of the cause; platform logs were not available.

A repeatable sanitized probe, `node scripts/validate_public.mjs`, completed at **2026-11-01T08:56:32Z**:

| Endpoint/check | Actual result | Elapsed |
| --- | --- | --- |
| Vercel root | 200 | 193 ms |
| API `/health` | 200 | 374 ms |
| API `/config` | 200 | 367 ms |
| Signaling `/eduguard/peerjs/id` | 200 | 406 ms |
| Allowed-origin CORS preflight | 200; exact Vercel origin allowed | 257 ms |
| Untrusted-origin CORS preflight | 400; no allow-origin header | 247 ms |
| Signaling WebSocket | `OPEN`, then test peer closed | 691 ms |

Actual live config: signaling host is the separate signaling service, secure=true, port 443, path `/eduguard`; **one ICE server entry, no TURN URL**. The probe intentionally prints only ICE counts/relay presence, never credentials. HTTP `/health` executes a database `SELECT 1`; it does not identify the database dialect or demonstrate historical persistence.

The deployed frontend asset contains the expected API HTTPS base address. It contains `Engagement timeline`, not the new `Observation timeline`, establishing a UI version mismatch with this working tree. Vercel sent `X-Content-Type-Options: nosniff` and `Permissions-Policy: camera=(self), microphone=(self)`. Its static-page `Access-Control-Allow-Origin: *` is not the API's CORS policy. Signaling HTTP without an Origin header has no allow-origin header; WebSocket OPEN is the relevant direct connection evidence, not proof of cross-network media.

## Configuration and security inspection

### Vercel and frontend

`vercel.json` uses Vite, `npm run build`, output `dist`, and SPA rewriting that excludes `/classroom/` and `/assets/`. Student/teacher iframe pages are same-origin, allowing the declared camera/microphone permissions. Production API address is injected at **build time** through `VITE_API_URL`; setting it only on Render has no effect on the Vercel bundle. Keep secrets out of all `VITE_*` settings. Production requests use HTTPS; local build tests deliberately use localhost.

Frontend message handlers check exact origin and iframe source and sanitize/reconstruct telemetry scalars. PII is limited to chosen aliases and session-linked metadata; this is not anonymous. Tokens persist in browser storage for reconnection, increasing shared-device/XSS exposure. No strict CSP/frame-ancestor policy is configured; adding one requires testing existing scripts, WASM, iframe and signaling sources. Third-party JS remains in the browser trust boundary.

### Render and PostgreSQL

`render.yaml` has the correct API entrypoint: `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`. API `/health` and signaling ID endpoint are configured as health checks. API signing key is generated, teacher password/origins/signaling URL require configuration; database URL comes from the PostgreSQL resource. Automatic deployment is **off** for both services, so a Git push does not prove a Render rollout. Confirm actual deployed revisions in the dashboards.

Blueprint web services and database use free plans. Render documents idle web-service spin-down after 15 minutes and free PostgreSQL expiry after 30 days; therefore this blueprint is not a durable production availability/retention commitment. See [Render free-service limits](https://render.com/docs/free). Upgrade/choose persistent PostgreSQL and establish backups/restores before depending on retained records; no plan or cost was changed here.

`backend/store.py` normalizes PostgreSQL URLs to psycopg, creates metadata, applies additive migration version 2 and indexes session/sample lookup/status timestamps. Migration ledger and additive historical SQLite tests pass. `python -m scripts.migrate_db` exists. Source startup still runs schema initialization/migration; concurrent deployment instances can race DDL/ledger writes. Run one backed-up migration step before rollout, validate against a copy of the actual PostgreSQL schema, and serialize migrations before scaling. Render's dedicated pre-deploy command requires eligible paid service types ([Render deployment documentation](https://render.com/docs/deploys)); no unsupported pre-deploy field was silently added to the free blueprint.

A new `tests/test_postgres.py` uses a unique disposable PostgreSQL schema, verifies migration idempotency, store restart, duplicate events, reconnect, indexes and closure, and drops only that schema afterward. It requires **a dedicated test database** through `TEST_POSTGRES_URL`; never point it at production. CI now declares PostgreSQL 16 and runs that test with disposable CI-only credentials. **No CI execution or real PostgreSQL success has been observed in this session.** Backup/restore, PostgreSQL TLS configuration, deployed migration version and actual production data durability remain unverified.

### Signed tokens and admission

Startup rejects missing/short signing key and empty/default/short teacher secret. Authentication uses constant-time secret comparison; signed access tokens enforce role, room, student consent and existing session. Teacher roster/report/closure require teacher scope. Invitations are room-specific and expire after 12 hours; access tokens also expire after 12 hours. Resume tickets have a distinct role and retention-bounded age. New expiry regression tests reject expired access and invitation tokens. Deletion invalidates existing session/room access.

Room IDs are random UUID-derived values; media room capability uses HMAC and is separate from public room ID. There is one shared configured teacher password, not independently accountable teacher accounts/MFA. Login throttling is per process, not distributed. Signed tokens are bearer capabilities, not encrypted secrets or proof of student identity. Teacher refresh/revocation across multiple workers is limited; protect invitation links and browser storage.

### Signaling and ICE/TURN

Node PeerServer uses `/eduguard`, disables discovery and trusts proxy metadata when configured. These settings do not provide per-peer cryptographic media identity or authenticated signaling admission. An admitted participant learns the shared room capability; malicious peers/room-key occupation and service abuse remain threat-model risks. HTTP API authorization does not automatically authenticate a WebRTC caller.

Default and live ICE settings are STUN-only. Configure an operated TURN service with UDP plus TCP/TLS fallback and test actual relay candidates on separate networks. `/config` is public: **do not publish a TURN provider's permanent shared administrative secret there**. Any client-visible TURN credentials need bounded lifetime and an appropriate abuse-control/credential-issuance design. No TURN provider, credential or relay delivery was invented or provisioned.

### Media and transmitted-data audit

Production student capture is video-only until separate microphone opt-in. Raw video is attached to a local hidden video element and supplied as an in-memory MediaPipe image. The only outbound `peer.call` stream is either an empty MediaStream or the synthetic canvas stream, after `assertPrivateStream` checks provenance and excludes all audio tracks. Teacher `call.answer` sends teacher media, which is intentionally different from the student privacy invariant. No production MediaRecorder, raw-frame upload, student-audio upload or replaceTrack path was found in reviewed frontend sources.

Browser tests inspect all student RTCPeerConnections and captured track IDs after connection, audio opt-in and (mesh case) reconnect. Every outbound video is a known canvas track, none is an original capture video ID, and no audio sender exists. Unit tests additionally reject original/cloned/unknown video and audio tracks. Standalone media tests observed **no POST/PUT/PATCH upload requests**. API telemetry rejects raw/landmark extra fields and frontend reconstruction limits stored scalars. The optional research capture page is separate, local and consent-gated; its landmarks are not sent to the API.

This is scoped source/runtime evidence for current paths, not a mathematical proof that raw media can never leak under compromised dependencies, malicious extensions, an altered browser or future changes. Browser HTTP diagnostics do not reveal encrypted RTP contents; sender provenance is the primary evidence. Facial mesh, landmarks, aliases and derived telemetry can still carry privacy risks. Consent withdrawal cannot erase recipient recordings or infrastructure backups automatically.

## Fixes applied during this verification

1. Added a bounded 15-second stalled-media timer, cleanup on call teardown, retry and a persistent TURN/network notice. Incoming stream metadata alone no longer suppresses the timeout: successful connected, decoded video is required. The notice clears on actual playback. Relay-only/no-TURN test verifies the failure path.
2. Camera-init failure now explicitly rechecks connection prerequisites, allowing receiving-only lecture playback even when camera readiness resolves after signaling. Capture failure wording no longer implies microphone permission was necessarily requested.
3. Expanded real local lifecycle Playwright test with failed login, CSV download, student deletion and whole-room deletion; expanded media tests with camera denial, calibration, reconnect and blocked-relay scenarios.
4. Added signed-token expiry regression coverage and an opt-in isolated PostgreSQL integration test plus PostgreSQL CI service.
5. Added sanitized repeatable public endpoint/CORS/WebSocket probe. It does not log secrets or authenticate against production.

No schema/algorithm redesign, no Streamlit, no changed public API contracts and no paid infrastructure deployment.

## Release blockers and remaining validation

| Priority | Open item | Required successful evidence |
| --- | --- | --- |
| Blocker | PostgreSQL | Execute isolated PostgreSQL tests and test additive migrations on a backed-up production-schema copy; verify database engine/TLS, persisted records after redeploy, backups and restore. Current local run skipped this. |
| Blocker | TURN and real networks | Two physical devices on different networks (Wi-Fi/mobile), relay-only with actual TURN, UDP-blocked TCP/TLS relay, and an institutional/firewall test. Confirm selected candidate pair type, decoded video, no student audio/raw video and useful failure states. None performed here. |
| Blocker | Deployed revision/authenticated E2E | Deploy reviewed changes to staging, then test complete authenticated lifecycle across actual Vercel/Render/PostgreSQL with dedicated aliases/consent. Public endpoints alone are insufficient. |
| High | Availability/retention | Move from expiring free DB, quantify cold-start/warm-start distributions with controlled idle intervals, and test recovery after API/signaling restarts. First API probes timed out. |
| High | Signaling identity/abuse | Address admitted-peer impersonation/room-key occupation and public signaling abuse; test rejection of unauthorized media peers, not only HTTP callers. |
| High | Migration concurrency | Serialize migrations and test overlapping instance deploys against PostgreSQL before increasing workers/replicas. |
| Medium | Device/browser matrix | Real Chrome/Firefox/Safari, iOS/Android, denied/revoked permissions, audio gesture policies, camera switching and background/locked-screen behavior. Local Chromium simulations do not replace this. |
| Medium | Capacity and long sessions | Concurrent realistic student counts, mesh bandwidth/CPU/battery, 12-hour token expiry, storage quota/eviction, repeated network handovers and prolonged database outage. No load/SLA benchmark performed. |
| Medium | Security operations | Dependency vulnerability review including Python/dev tools, token/key rotation, distributed rate limits, CSP review, infrastructure logs/access policy and backup deletion policy. |

Nominal participant closure polling is five seconds while active; offline verification failures also stop capture. In-flight requests, timer throttling and background suspension can delay closure, so no strict five-second global-stop guarantee is claimed. IndexedDB improves retry but cannot guarantee delivery of an event not yet committed, survive user-cleared/evicted storage, or execute while the browser is closed. Retention cleanup is process-driven and backups/provider logs require their own policy.

Before production approval, preserve sanitized candidate-pair diagnostics and test results from the missing environments, document deployed revisions and migration version, and update this report with successful evidence. Current results support further staging validation, **not a production-readiness claim**.
