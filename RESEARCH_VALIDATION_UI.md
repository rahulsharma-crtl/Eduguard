> Reconnect follow-up: student signaling now waits 500 ms before reconnecting the same peer, avoiding immediate old/new socket overlap. Cleanup cancels the timer, and callbacks reject replaced/destroyed/already-connected peers. The unchanged full browser suite now passes 12/12 locally; JavaScript passes 79/79 and Python lifecycle checks pass 7/7. Build, syntax and diff checks pass. These results supersede the reconnect failure status below for this local revision; remote CI has not yet run this fix. No engine, media-track, authentication or database behavior was changed.

> Audio correction: narration is now required. Missing or failed speech interrupts capture before the next measurement. Speech timeout is 10 seconds; total capture limit remains 100 seconds. Earlier text-only continuation instructions are superseded. Verification before push: all 77 JavaScript tests and all four research browser tests pass, including mandatory-narration interruption. The production build passed.

# Research Validation UI implementation and checks

Date: 2026-11-02. Branch: `feature/research-validation-ui`, based on the existing `feature/facial-validation` working tree. All prior uncommitted work was preserved. No commit, merge, push or deployment was performed. The live website remains unchanged.

## Implemented behavior

The existing isolated `/classroom/validation/index.html` page now has a consent-gated camera readiness screen, local video plus the production MediaPipe mesh drawing helpers, a rendering-only mesh toggle, local English SpeechSynthesis with mute/text fallback, large single instructions, phase countdowns and trial progress. Readiness shows camera permission, estimated face presence and tracking quality, never classification labels. It is advisory, not a participant-exclusion rule. During capture those diagnostics are hidden. Prediction summaries remain hidden until all five independent observer verdicts are locked.

There is one continuously running production engine, with unchanged defaults, thresholds, normalized input landmarks and FaceMesh settings. Readiness and capture use the same increasing absolute engine clock; exported timestamps use a separate session-relative origin. Research code does not create a classroom, use PeerJS, request microphone audio, send telemetry, write database records or modify classroom storage. Only derived research records are saved in isolated tab sessionStorage; the camera and landmarks remain in volatile local processing. Static model/code asset downloads still require network access.

The default-off React navigation flag adds only a landing-page link, opening the separate page in a new tab. It is absent from classroom invitations and active classrooms. No classroom routes or API contracts were changed. The flag hides navigation only; the direct link is not authenticated or private.

## Timing and compatibility

New sessions use `eduguard-facial-validation-v2`, retaining the previous CSV column schema, five expected actions, eight one-second sampling windows per trial and unchanged strict-majority/unknown rules. One CSV contains session metadata, 16 phase timing records, five trial summaries, 40 window summaries and underlying trial observations. Incorrect and unknown predictions are preserved. Incomplete or unreached trials never receive invented measurements.

Preparation lasts at least 10 seconds. Each trial finishes its spoken cue first, then allows at least five seconds for settling, followed by an eight-second observation interval. Local speech ends, is explicitly muted or is cancelled after a four-second timeout before settling/measurement. Persistent speech prevents measurement. Typical capture is 75–100 seconds; exceeding 100 seconds interrupts the run instead of compressing or relabeling intervals. Actual phase starts and effective observation cutoffs are exported. Late timer callbacks cannot extend a scored window; gaps remain unmeasured.

Previously saved v1 records still recover/export unchanged, and the analyzer supports both protocols separately. It rejects pooling v1/v2 or different engine hashes. Observer-confirmed completed trials remain in the denominator even when predictions are unknown. Invalid/uncertain references and interrupted sessions are retained with exclusion counts. Repeated frame observations are not independent primary trials.

## Run one participant and collect ten files

For this local review, a Vite development server was started with the flag enabled at `http://127.0.0.1:5174/`. The direct research page is `http://127.0.0.1:5174/classroom/validation/index.html`. No backend is required for this page. A participant on another computer cannot use your localhost address. After a separately approved deployment, share the deployed HTTPS direct link; do not share a teacher account or access to your laptop. Remote supervision needs a separately consented way for the observer to establish the actions; model output cannot supply ground truth.

To start the same local preview in PowerShell:

```powershell
$env:VITE_RESEARCH_VALIDATION_ENABLED='true'
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

1. Obtain voluntary adult research consent and explain CSV custody/withdrawal. Follow `FACIAL_VALIDATION_PROTOCOL.md`; do not treat the site checkboxes as ethics approval.
2. Open the research link. Enter coarse conditions only, tick consent and observer presence, and select **Check camera readiness**. Allow camera access. Microphone access is not requested.
3. Agree on a consistent mesh/voice setting across participants. Start when the participant and observer are ready. Follow the five actions and the phase/countdown display. The supervisor may independently mark action onset; no onset means no action-onset latency estimate.
4. After capture stops, select **confirmed**, **invalid**, or **uncertain** for each action from direct observation. Lock the verdicts, then use **Download CSV**. Re-downloading returns the same session artifact.
5. Secure the one CSV, then clear only this tab's study record for the next participant. Keep failures instead of selecting better repeat attempts. Repeat once for each of ten distinct consenting adults.

Keep the files outside version control and cloud-sync folders. This repository is in OneDrive; choose a suitable protected location elsewhere. Combine them with the existing analyzer, explicitly listing exactly the ten unique files:

```powershell
node scripts/analyze_facial_validation.mjs --out C:/Research/EduGuard/results C:/Research/EduGuard/P01.csv C:/Research/EduGuard/P02.csv C:/Research/EduGuard/P03.csv C:/Research/EduGuard/P04.csv C:/Research/EduGuard/P05.csv C:/Research/EduGuard/P06.csv C:/Research/EduGuard/P07.csv C:/Research/EduGuard/P08.csv C:/Research/EduGuard/P09.csv C:/Research/EduGuard/P10.csv
```

Outputs are `report.json`, `confusion.csv`, `metrics.csv` and `participants.csv`, including trial accuracy, per-class precision/recall/F1/FPR, macro-F1, unknown rate, participant summaries and participant-cluster bootstrap intervals. Ten adults are a small feasibility sample, not proof of general accuracy or attention detection.

For a later approved Vercel deployment, set `VITE_RESEARCH_VALIDATION_ENABLED=true` in the frontend build environment and rebuild. Set it to `false` or remove it and rebuild after collection. Render settings, backend, database and deployment files need no changes. No deployment is included in this work.

## Files changed for this enhancement

This list is relative to the working-tree snapshot immediately before this enhancement, not to main. Existing uncommitted documentation cleanup and the original Facial Validation feature remain intact.

| File | Change and purpose |
| --- | --- |
| `web/src/main.jsx` | Conditional landing-only research link; no imports of research inference code into the React classroom bundle. |
| `web/src/style.css` | Scoped research-link width rule for narrow screens. |
| `web/.env.example` | Documents the default-off frontend navigation flag. |
| `components/facial_validation/frontend/index.html` | Existing page extended with readiness, mesh, narration controls and phase/progress display; pinned production drawing helper with SRI. |
| `components/facial_validation/frontend/style.css` | Isolated preview overlay, readable instructions/countdowns and readiness layout. |
| `components/facial_validation/frontend/validation.mjs` | Existing adapter extended for readiness, single-engine frame processing, guided capture, visibility interruption, local recovery and existing export. |
| `components/facial_validation/frontend/workflow.mjs` | Backwards-compatible v2 phase timing and actual trial bounds, keeping existing CSV columns and v1 behavior. |
| `components/facial_validation/frontend/runner.mjs` (new) | Narration/settling/observation orchestration and explicit timeout/interruption handling. |
| `components/facial_validation/frontend/speech.mjs` (new) | Local-English-only SpeechSynthesis wrapper with mute, completion and cancellation fallback. |
| `components/facial_validation/frontend/preview.mjs` (new) | Rendering-only production mesh overlay; no landmark transformation or inference changes. |
| `scripts/analyze_facial_validation.mjs` | Validates v2 timing records and rejects mixed protocols; retains prior metric definitions. |
| `tests/browser/facial_validation.test.mjs` | Readiness, narrated timing, real pinned asset initialization, mesh drawing/toggle, local-only network/track checks, consent/denial, independent verification, CSV/reload and timeout cases. |
| `tests/browser/research_navigation.test.mjs` (new) | Flag off/on, 320px layout and exclusion from invitation/active classroom flows. |
| `tests/js/research_validation_ui.test.mjs` (new) | Five timing, compatibility, narration and rendering tests. |
| `tests/js/quality_jitter_diagnostic.test.mjs` (new) | Reproduces the unchanged production stale-reference jitter gate. |
| `FACIAL_VALIDATION_PROTOCOL.md` | Current v2 procedure/flag/timing guide above the retained legacy v1 and shared analysis reference. |
| `JITTER_INVESTIGATION.md` (new) | Separate source-level investigation and proposed engine fix requiring approval; no fix applied. |
| `RESEARCH_VALIDATION_UI.md` (new) | This operation, file-change and verification report. |

`scripts/prepare_web.mjs` already contained the prior additive research-copy change and was not changed again. It keeps the existing student/teacher copy loop. No files were deleted.

## Regression evidence

Executed on Windows with Python 3.11 from `.venv`, Node's test runner and Playwright with installed Chrome. Counts are actual automated results, not participant accuracy.

| Check | Actual result |
| --- | --- |
| `.venv/Scripts/python.exe -m pytest -q` | **57 passed, 1 skipped**, one existing Starlette/httpx deprecation warning. PostgreSQL test skipped because `TEST_POSTGRES_URL` is not configured; local tests use disposable SQLite. |
| `npm run test:js` | **76 passed**, including v1 workflow/metrics, five new UI unit tests, jitter diagnostic and existing inference/classroom tests. Generated-engine drift check passed. |
| `npm run lint:js`, new-module `node --check`, `git diff --check` | Passed. |
| `npm run test:browser`, flag off | **11 passed, 1 failed**: existing mesh scenario timed out at its 15-second PeerJS reconnect wait after deliberate signaling disconnect. |
| `npm run test:browser`, flag on | **11 passed, 1 failed** at the same existing reconnect wait. Research scenarios, navigation, teacher account/login, student consent/joining, offline recovery, attendance identity, room closure, report export, deletion and mobile UI checks passed. |
| `node --test tests/browser/webrtc.test.mjs` (isolated retry) | **5 passed**: mesh video, telemetry-only, denied camera, calibration and relay-only failure handling. This does not erase the full-suite reconnect failure. |
| `node --test tests/browser/facial_validation.test.mjs` after adding explicit drawing assertions | **4 passed**. Mock sessions used synthetic fixtures; real pinned MediaPipe/drawing assets initialized on synthetic camera input. |
| Production builds | Passed with flag on and off. Final generated build has navigation explicitly disabled. Local review server remains flag-enabled. |
| Source/build preservation | SHA-256 comparison of 104 pre-existing working files found only the ten intended existing-file edits above. Production core, backend, deployment, authentication, classroom sources and prior cleanup files remained byte-identical. All four copied classroom production assets matched their unchanged source hashes. |

The copied `student/index.html`, `student/engagement.js`, `teacher/index.html` and `teacher/roster.js` outputs remain byte-identical to their pre-enhancement source files. The engine bundle SHA-256 remains `107d669ec1e2b890fbd9715a68262df666fea0e283b9ebc71698711a652fdf32`. Research files are additive. React landing bundle/CSS changes are expected from the optional link; the build does not remove or replace classroom assets.

Research browser diagnostics observed only static GET requests, zero WebRTC connections, zero WebSockets, camera-only constraints and stopped tracks before verification. Stored observations exclude images, landmarks and classroom scores. Existing classroom media tests inspect outbound tracks and decoded teacher video. These are local synthetic-input diagnostics, not an audit of every deployed browser/network.

## Remaining problems and limits

- **Excessive jitter remains unfixed.** The actual engine can retain an old accepted landmark reference after a movement is rejected, causing repeated `INSUFFICIENT_QUALITY` at a new stationary location. No threshold, reset or research-only bypass was applied. The first reported CSV was not supplied, so its exact individual cause is not established. See `JITTER_INVESTIGATION.md` before collecting paper results; the proposed engine fix needs separate approval and a distinct evaluation version.
- **Classroom signaling reconnect is intermittent in the full suite.** Both aggregate runs failed the existing reconnect assertion; the unchanged isolated suite passed. Initial broadcast and telemetry connected before failure. No production fix or test-timeout weakening was made. Overall regression verification is therefore not fully green.
- Physical participant cameras, ten supervised adults, real OS voice timing, other browsers, deployed Render/Vercel/PostgreSQL, cross-device networks and cold starts were not newly validated here. Local English voice availability varies; visible instructions and supervisor cues remain required. Permission denial/refresh/hidden tabs stop or invalidate capture rather than inventing continuity.
- Observation thresholds and known labels remain production behavior, not proof of attention or misconduct. Trial dependence, repeated forward-facing references, observer reaction error, mesh feedback and the small supervised cohort limit scientific claims. Accuracy remains **unmeasured** until genuine consented CSVs are supplied. No synthetic test score is a publication result.

Local screenshots were captured with explicitly synthetic camera/landmark fixtures for UI review. They contain no participant images or experimental evidence.
