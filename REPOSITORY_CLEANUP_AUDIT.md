# Repository cleanup audit

Date: 2026-11-01. Repository: `https://github.com/rahulsharma-crtl/Eduguard.git`. Audited commit: **7adbe8925acbc652f08cb3c5e77889b2568db6bf**. `git ls-remote origin refs/heads/main` matched local HEAD at audit time. Working tree was clean before this report. This audit creates **only this Markdown file**; no existing source, tests, dependency manifests, databases, configuration or historical documents were changed. No commit, push or deployment was performed.

## Method and interpretation

Inventory: all **94 Git-tracked files**. Read imports, HTML script sources, source-text test reads, package scripts, build-copy scripts, ASGI entrypoints, deployment files and CI discovery. Used `git ls-files`, `rg`, targeted reads and remote-head comparison. Searched tracked source consumers as well as documentation; documentation references alone do not establish runtime use. Dynamic tests that extract functions from other test files were included. Ignored/local artifacts are treated separately and their secret/data contents were not read.

This is a static dependency audit. No builds, tests, migrations or helper scripts were run: some regenerate files or write temporary databases, contrary to the initial read-only requirement. Earlier validation reports are historical evidence, not fresh results from this audit. Absence of a tracked reference does not rule out an external Docker deployment, an operator command, a notebook or another consumer outside this repository. Live dashboard settings and database contents were not inspected.

Categories (one primary category per file): **1** Active production code/configuration; **2** Required development/test/operational support (includes current documentation and optional documented tools); **3** Historical documentation/status snapshots; **4** Unused legacy code **relative to current production entrypoints**, potentially still required by support/tests; **5** Potential duplicate, including intentional generated counterparts. Category 4 or 5 does not authorize deletion.

## Actual dependency paths

```text
Vercel -> vercel.json -> npm run build
  -> scripts/build_engagement.mjs
       core/engagement.mjs -> components/student_room/frontend/engagement.js
       core/roster.mjs     -> components/teacher_room/frontend/roster.js
  -> scripts/prepare_web.mjs
       components/{student,teacher}_room/frontend/* -> web/public/classroom/{student,teacher}/*
  -> Vite (root web) -> dist
       web/index.html -> web/src/main.jsx
         -> TeacherAccess.jsx, observations.jsx, style.css
         -> durable_outbox.mjs, identity.mjs, privacy.mjs
         -> same-origin /classroom/{student,teacher}/index.html iframes

Render API -> pip install -r requirements.txt
  -> uvicorn backend.app:app
       backend/app.py -> backend/store.py + backend/passwords.py
       Store -> SQLAlchemy schema, migrations 2/3, SQLite or PostgreSQL
       API reports -> csv.DictWriter (not core/reporting.py)

Render signaling -> npm ci --omit=dev -> node signaling/server.cjs -> peer package
  Browser PeerJS client loads pinned CDN JS; the Node peer server is a different dependency.

CI -> .github/workflows/checks.yml
  -> PostgreSQL service + npm ci + requirements-dev.txt
  -> test:js (pretest checks generated bundles) -> tests/js/*.test.mjs
  -> pytest -> tests/test_*.py, including legacy tests
  -> Vite build -> Playwright tests/browser/*.test.mjs
```

`components/` is **active**, despite its old Streamlit-origin directory names. Neither iframe is a React component, but both are still production UI. The generated `engagement.js` and `roster.js` are not hand-maintained obsolete copies. `web/public/classroom/` and `dist/` are build outputs, not alternate source directories.

## Cleanup candidates and removal safety

| Candidate | Classification | Dependency evidence and why it appears obsolete/duplicate | Removal assessment |
| --- | --- | --- | --- |
| `web/src/outbox.mjs` | 5 | Original storage-array queue. `main.jsx` imports `durable_outbox.mjs` instead. Only direct code consumer found is `tests/js/outbox.test.mjs`. Current durable queue still supports old storage formats independently through `migrateLegacy`; it does not import the old class. | Not runtime-required; **not safe under the preserve-tests constraint** because its test import breaks. Retain; evaluate retirement as a separate approved change after preserving coverage. |
| `core/global_state.py` | 4 | No backend/frontend imports. `tests/test_global_state_concurrency.py` is its code consumer. Its docstring identifies a legacy process-local presence cache; current presence is Store transactions. | No observed production reachability, but not safe to delete with tests unchanged. SESSION_LIFECYCLE explicitly retains legacy helper support. |
| `core/db_manager.py` | 4 | No current backend import. Used by `core/reporting.py`, `tests/test_db_manager.py`, `tests/test_reporting.py`; old SQLite schema differs from `backend/store.py`. | **Preserve historical-record tooling and tests.** Not a drop-in duplicate of Store. Do not delete databases or migrations along with it. |
| `core/reporting.py` | 4 | Only code consumer found is `tests/test_reporting.py`; imports pandas and legacy DatabaseManager. New API CSV route uses stdlib csv and current tables. | Production-unreachable but supports old exports. Removal breaks tests and historical export capability; retain. |
| `config.py` | 4 | No import by current frontend or backend Settings. Imported by `tests/test_config_sync.py`, `tests/test_scoring.py` and legacy db_manager. The db_manager reference is an unused CONFIG import; its remaining use is test constants. | Preserve for existing tests/legacy support. It is not the active JS threshold source. Do not synchronize it by changing algorithms during cleanup. |
| `app.py` | 5 | Three-line `from backend.app import app` compatibility entrypoint. Render, local launcher and browser API harness all use `backend.app:app`. Only `app.py` itself advertises `app:app`. | Internally unused alias; **conditionally removable** after confirming no external start command uses it. Tiny compatibility value means keep in minimal cleanup. Never remove backend/app.py. |
| `tests/test_scoring.py` | 2, historical/duplicate concern | Reimplements historical and corrected formulas in Python instead of executing core/engagement.mjs; imports CONFIG. `tests/js/scoring.test.mjs` exercises actual engine and already keeps historical reference cases. | Do not delete tests. A later approved test-quality change could replace copied formulas with actual engine coverage; not equivalent to proving all tests redundant. |
| `tests/test_config_sync.py` | 2, obsolete-assertion concern | Checks literal CONFIG values; does not read frontend defaults despite its test name. | Keep now; later correct the assertion scope/name. Do not infer current synchronization from a pass. |
| `tests/js/kinematics.test.mjs` | 2, historical/duplicate concern | Contains local copies of old EAR/pitch functions and demonstrates the old looking-up/down bug; no production engine import. | Preserve tests; later distinguish historical reproduction from current behavior and migrate useful boundary cases. |
| `tests/js/webrtc_lifecycle.test.mjs` | 2, duplicate/obsolete-description concern | Uses copied mocks/logic. A test title claims student mesh plus microphone audio, which contradicts the current no-student-audio invariant. Other static tests and actual Playwright calls cover real source/runtime paths. | Keep coverage; later fix misleading wording and replace copied assertions where justified. File is discovered by CI, not unused. |
| `tests/test_webrtc_lifecycle.py` and `tests/js/remediation.test.mjs` | 2, overlapping coverage | Python static checks read actual HTML; remediation JS extracts actual functions with VM and checks generated-engine parity; browser tests perform actual media calls. | Different mechanisms; **not proven duplicates**. Do not delete solely for similar names. |
| `tests/js/facial_behavior_benchmark.test.mjs` | 2 | Looks like an old synthetic benchmark, but `evaluation.test.mjs` and `tests/browser/webrtc.test.mjs` read its source and extract generateSyntheticFace. | **Required dependency.** Removing or restructuring it breaks unrelated calibration/evaluation tests. Later extract a shared synthetic fixture module first, preserving tests. |
| `components/student_room/frontend/engagement.js` and `components/teacher_room/frontend/roster.js` | 5, intentional | Generated from canonical core modules; loaded by HTML and required by pretest drift reads. npm dev copies existing outputs without regenerating them. | **Keep.** Removing tracked outputs requires an approved build/dev/CI redesign and would currently break fresh-checkout checks/dev. |
| `deployment/signaling.Dockerfile` | 2, alternate path | Native Node Render blueprint does not use it; Dockerfile still builds the actual current PeerJS server and installs the shared lockfile. | Optional fallback, not proven obsolete. Confirm external/manual use before removing; negligible minimal-cleanup benefit. |
| `deployment/RENDER.md` | 2, short pointer | Redirects to root deployment instructions; no runtime consumers. | Documentation-only optional simplification, not necessary. Keep because it provides a discoverable deployment entry point. |
| `AUDIT.md` | 3 | Explicit historical-baseline banner; describes old Streamlit architecture and source paths that no longer exist. | Runtime-independent but valuable provenance. Archive/link/label rather than delete. Never treat its old missing-file references as missing current code to restore. |
| `REMEDIATION.md` | 3, stale mixed status | Describes sessionStorage outbox, permanent tab-close loss and audio disclosure in terms superseded by durable IndexedDB/current local-only audio. | Documentation refresh candidate; retain audit history and point to SESSION_LIFECYCLE/AUDIO_OBSERVATIONS. No code deletion needed. |
| `FRONTEND_AUDIT.md` / `VALIDATION_REPORT.md` | 3 | Dated results/status snapshots; validation has later account addendum and older superseded secret requirements in its body. Test counts/revisions are not a live guarantee. | Preserve historical evidence. Add clear supersession links in a later approved documentation cleanup, not reinterpret old results as current. |
| `evaluation/status/status.json` and `tables.tex` | 3 | Generated **unmeasured** status via `evaluation/run.mjs status`; no runtime/test import found. | Can regenerate, but intentional publication-status disclosure. Keep unless publication policy changes; never replace with invented performance. |
| `scripts/start_local.py` | 2, stale message only | README invokes it; actually starts the current three services. Final message incorrectly says password is in .env.local after account registration replaced that setup. | File active. Recommend changing only that message in a later approved edit; deleting launcher is unsafe for documented setup. |
| `scripts/pin_cdn.py` / `verify_cdn.py` | 2, apparent tool overlap | pin_cdn mutates dependency pins/SRI; verify_cdn only validates. No automatic invocation of pin_cdn found, but manual security maintenance remains legitimate. | Keep both. Obsolete camera_utils entry in pinning map is an internal cleanup candidate, not a reason to remove the tool. Audit did not execute either. |
| `scripts/benchmark_video.mjs` vs `evaluation/run.mjs` | 2, intentional compatibility | npm benchmark:video still targets the first; remediation tests import its v1 evaluate; --rigorous dispatches to the second. | Keep both; not interchangeable. Real-video capture v2 must use rigorous split/lock workflow. |
| `pandas` in `requirements.txt` | Dependency placement candidate | Only tracked production-tree import is legacy core/reporting.py; current API uses csv. requirements-dev includes requirements.txt and legacy tests need pandas. | Do not remove from dependencies now. A separate approved packaging change could move it to dev/explicit legacy extras, preserving legacy exports/tests. Removing it outright is unsafe. |
| `lint:py` npm script | Configuration drift, not unused file | Invokes flake8 on core/config/tests, omits backend, and flake8 is not declared in either requirement file. CI currently runs lint:js, not this command. | Future tooling fix/clarification; not a reason to drop tests or core files. Existing manifests remain unchanged. |

No tracked source file is recommended for **unconditional immediate deletion** while preserving all current tests, compatibility and historical-record support. Runtime-unreachable and safely deletable are different judgments.

## Complete tracked-file inventory

Each of the 94 audited tracked files appears once below. For category 4/5 removal caveats, use the candidate table above. The report being created is additional to this baseline inventory.

| File | Category | Actual role / dependency evidence |
| --- | --- | --- |
| `.env.example` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `.gitattributes` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `.github/workflows/checks.yml` | 2 | Active CI: PostgreSQL service, JS/Python tests, Vite build and Playwright tests. |
| `.gitignore` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `AUDIO_OBSERVATIONS.md` | 2 | Current setup, security/privacy, lifecycle, account or measurement guidance; preserve despite historical references. |
| `AUDIT.md` | 3 | Dated audit/remediation snapshots; mixed historical/current claims; retain provenance and clarify superseded text later. |
| `FRONTEND_AUDIT.md` | 3 | Dated audit/remediation snapshots; mixed historical/current claims; retain provenance and clarify superseded text later. |
| `PRIVACY.md` | 2 | Current setup, security/privacy, lifecycle, account or measurement guidance; preserve despite historical references. |
| `README.md` | 2 | Current setup, security/privacy, lifecycle, account or measurement guidance; preserve despite historical references. |
| `REMEDIATION.md` | 3 | Dated audit/remediation snapshots; mixed historical/current claims; retain provenance and clarify superseded text later. |
| `SESSION_LIFECYCLE.md` | 2 | Current setup, security/privacy, lifecycle, account or measurement guidance; preserve despite historical references. |
| `TEACHER_ACCOUNTS.md` | 2 | Current setup, security/privacy, lifecycle, account or measurement guidance; preserve despite historical references. |
| `VALIDATION_REPORT.md` | 3 | Dated audit/remediation snapshots; mixed historical/current claims; retain provenance and clarify superseded text later. |
| `app.py` | 5 | Alternative ASGI alias imports backend.app.app; no tracked deployment/start/test command selects app:app. |
| `backend/__init__.py` | 1 | Backend package marker; backend.app and test imports use this package. |
| `backend/app.py` | 1 | Render/local/Playwright ASGI entrypoint; auth, admission, telemetry, reports, deletion. |
| `backend/passwords.py` | 1 | Imported by backend.app; Argon2id password verification and recovery-code hashing. |
| `backend/store.py` | 1 | Imported by backend.app and migration tool; authoritative SQLite/PostgreSQL store, schema versions 2/3 and indexes. |
| `benchmarks/capture.html` | 2 | Active local consent-based evaluation capture; lint and capture tests read it; not copied into production dist. |
| `components/student_room/frontend/engagement.js` | 5 | Intentional generated production counterpart of core/engagement.mjs; student HTML loads it; CI drift check reads it. |
| `components/student_room/frontend/index.html` | 1 | prepare_web copies it to classroom/student; React iframe loads it; browser/static/VM tests depend on it. |
| `components/teacher_room/frontend/index.html` | 1 | prepare_web copies it to classroom/teacher; React iframe loads it; browser/static/VM tests depend on it. |
| `components/teacher_room/frontend/roster.js` | 5 | Intentional generated production counterpart of core/roster.mjs; teacher HTML loads it; CI drift check reads it. |
| `config.py` | 4 | Legacy Python constants; imported only by legacy db_manager and config/scoring tests, not current JS/ASGI settings. |
| `core/db_manager.py` | 4 | Legacy SQLite schema/support; imported by core.reporting and legacy tests; no current API import. |
| `core/engagement.mjs` | 1 | Canonical production inference source; esbuild bundles it; scoring, privacy and evaluation tests import it. |
| `core/global_state.py` | 4 | Legacy process-local cache; only concurrency regression test imports it; current API uses database state. |
| `core/reporting.py` | 4 | Legacy SQLite CSV helper, imported by test_reporting only; current API uses csv.DictWriter directly. |
| `core/roster.mjs` | 1 | Canonical teacher roster logic; esbuild bundle consumed by teacher HTML; roster tests. |
| `deployment/RENDER.md` | 2 | Current short deployment pointer to README/render.yaml; not an old executable deployment. |
| `deployment/signaling.Dockerfile` | 2 | Valid alternate PeerJS container deployment; not selected by native-node render.yaml; manual-use status unverified. |
| `evaluation/README.md` | 2 | Current real-world dataset/calibration/evaluation instructions. |
| `evaluation/lib.mjs` | 2 | Used by evaluation runner and evaluation tests; imports current engine. |
| `evaluation/run.mjs` | 2 | Executable calibration/report CLI; imported by benchmark_video --rigorous and evaluation tests. |
| `evaluation/status/status.json` | 3 | Generated no-dataset/unmeasured status snapshot, not empirical results; run.mjs status can regenerate it. |
| `evaluation/status/tables.tex` | 3 | Generated no-dataset/unmeasured status snapshot, not empirical results; run.mjs status can regenerate it. |
| `package-lock.json` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `package.json` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `render.yaml` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `requirements-dev.txt` | 2 | CI/development pip input; includes production requirements plus pytest/httpx. |
| `requirements.txt` | 1 | Render pip install input; current backend dependencies plus pandas for legacy reporting support. |
| `scripts/benchmark_audio.mjs` | 2 | Documented AUDIO_OBSERVATIONS local consent-based aggregate audio-energy evaluation; not production capture. |
| `scripts/benchmark_video.mjs` | 2 | npm benchmark:video, remediation tests and rigorous evaluation dispatch; v1 path remains tested. |
| `scripts/build_engagement.mjs` | 2 | Invoked by build/build:engagement/check:engagement/pretest:js; creates/compares both production browser bundles. |
| `scripts/configure_env.py` | 2 | README setup command and prerequisite for start_local; writes ignored local configuration, not a shared teacher password. |
| `scripts/lint_frontend.js` | 2 | npm lint:js and CI; checks inline scripts in classroom HTML and capture page. |
| `scripts/migrate_db.py` | 2 | Documented one-process additive API migration entrypoint; preserves current database/auth schema. |
| `scripts/pin_cdn.py` | 2 | Manual dependency-maintenance tool that rewrites HTML pins; not CI/runtime; complements verify_cdn. |
| `scripts/prepare_web.mjs` | 2 | Invoked by dev/build/start_local/test_browser; copies active HTML and generated JS assets. |
| `scripts/start_local.py` | 2 | README development entrypoint; starts current backend/signaling/Vite. Final password-in-env message is stale. |
| `scripts/test_browser.mjs` | 2 | npm test:browser runner; builds with local API then discovers browser test files. |
| `scripts/validate_public.mjs` | 2 | Documented sanitized public endpoint/CORS/WebSocket smoke check; no production credentials. |
| `scripts/verify_cdn.py` | 2 | Documented manual SRI validation; network read-only check, not pinning duplicate. |
| `signaling/server.cjs` | 1 | Render start command, npm start:signaling, Docker and signaling/browser tests. |
| `tests/__init__.py` | 2 | Test package/root path setup; test_teacher_accounts imports fixture from tests.test_api. |
| `tests/browser/session.test.mjs` | 2 | Playwright file discovered by test_browser and CI browser glob; exercises built assets/current flows or controlled mocks. |
| `tests/browser/ui.test.mjs` | 2 | Playwright file discovered by test_browser and CI browser glob; exercises built assets/current flows or controlled mocks. |
| `tests/browser/webrtc.test.mjs` | 2 | Playwright file discovered by test_browser and CI browser glob; exercises built assets/current flows or controlled mocks. |
| `tests/js/audio_observation.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/capture_evaluation.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/durable_outbox.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/evaluation.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/facial_behavior_benchmark.test.mjs` | 2 | JS glob/CI plus source-text generator extraction by evaluation.test.mjs and browser/webrtc.test.mjs; cannot delete as synthetic-only. |
| `tests/js/kinematics.test.mjs` | 2 | JS glob/CI discovers it; copied EAR/pitch functions and historical-defect assertions, not current engine imports. |
| `tests/js/outbox.test.mjs` | 2 | JS glob/CI discovers it; direct dependency on older web/src/outbox.mjs, unlike current durable_outbox tests. |
| `tests/js/privacy.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/react_observations.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/remediation.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/scoring.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/signaling.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/js/webrtc_lifecycle.test.mjs` | 2 | JS glob/CI discovers mock lifecycle tests; some obsolete audio/privacy descriptions; not all assertions target actual source. |
| `tests/js/webrtc_roster.test.mjs` | 2 | Discovered by npm test:js/CI glob; current engine/module, generated bundle, capture, evaluation or privacy regression coverage. |
| `tests/test_api.py` | 2 | Discovered by pytest/CI; actual API integration/auth/expiry fixture also imported by account tests. |
| `tests/test_config_sync.py` | 2 | Discovered by pytest/CI; assertions check config constants only; no actual frontend-sync comparison. |
| `tests/test_db_manager.py` | 2 | Discovered by pytest/CI; directly imports legacy DatabaseManager; protects historical-record support. |
| `tests/test_global_state_concurrency.py` | 2 | Discovered by pytest/CI; imports legacy locked cache; deletion would reduce retained regression coverage. |
| `tests/test_lifecycle.py` | 2 | Discovered by pytest/CI; current Store recovery, concurrent writes and additive historical migration coverage. |
| `tests/test_postgres.py` | 2 | Discovered by pytest/CI; isolated-schema PostgreSQL integration with TEST_POSTGRES_URL; do not remove. |
| `tests/test_reporting.py` | 2 | Discovered by pytest/CI; imports legacy DatabaseManager/reporting/pandas; not current API report path. |
| `tests/test_scoring.py` | 2 | Discovered by pytest/CI; copied historical/corrected Python formulas plus CONFIG, not actual production JS. |
| `tests/test_teacher_accounts.py` | 2 | Discovered by pytest/CI; imports API fixture, actual password/auth/store logic; six-character boundary/recovery tests. |
| `tests/test_webrtc_lifecycle.py` | 2 | Discovered by pytest/CI; static source checks of actual student/teacher HTML; overlaps other tests but differs in mechanism. |
| `vercel.json` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `vite.config.mjs` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `web/.env.example` | 1 | Current deployment/build/environment or repository-integrity configuration; preserve. |
| `web/index.html` | 1 | Vite root document loads /src/main.jsx. |
| `web/src/TeacherAccess.jsx` | 1 | Imported by main.jsx; registration, login, recovery, owned-room reopening. |
| `web/src/durable_outbox.mjs` | 1 | Imported by main.jsx; IndexedDB persistence, retries and old queue migration; durable_outbox tests. |
| `web/src/identity.mjs` | 1 | Imported by main.jsx; stable participant IDs and credential expiry; tested by durable_outbox suite. |
| `web/src/main.jsx` | 1 | React root; imports current UI, durable queue, privacy and identity modules; mounts classroom iframes. |
| `web/src/observations.jsx` | 1 | Imported by main.jsx; neutral observation summaries/trends/guidance; React rendering tests. |
| `web/src/outbox.mjs` | 5 | Older storage-array TelemetryOutbox; only tests/js/outbox.test.mjs imports it; runtime uses DurableTelemetryOutbox. |
| `web/src/privacy.mjs` | 1 | Imported by main.jsx; inbound telemetry sanitization; privacy tests. |
| `web/src/style.css` | 1 | Imported by main.jsx; current responsive UI. |

Classification counts: **1: 27**, **2: 53**, **3: 6**, **4: 4**, **5: 4**.

## Ignored/local files: not GitHub cleanup candidates

Top-level inspection found local `dist/`, `node_modules/`, `.venv/`, `__pycache__/`, `.pytest_cache/`, `.vscode/`, `.streamlit/`, `.env.local`, and SQLite database files. Build output also includes ignored `web/public/classroom/`. None is in the 94-file tracked inventory. No contents of private environment files or local databases were inspected.

- `dist/`, copied `web/public/classroom/`, Python caches and test caches are regenerable. Local cleanup is usually feasible when services/tests are stopped and outputs are not needed, but no deletion was performed or authorized here. node_modules/.venv require reinstalling dependencies and are not dead source.
- `.streamlit/` is an ignored legacy local directory; there is no tracked Streamlit app/runtime wrapper or streamlit requirement. It can contain secrets. Do not open/publish/delete it as part of a blanket command. Old paths mentioned in historical docs or .gitignore do not establish tracked obsolete files.
- `.env.local`, `web/.env.local` and any local secrets remain protected. A legacy shared password may remain configured for compatibility; file deletion is not the right credential-migration procedure.
- `eduguard_api.db`, `eduguard_telemetry.db`, `test_reporting_temp.db` and `test_telemetry_temp.db` exist locally. **Preserve all of them during this audit.** Filename alone cannot establish disposability, database content, current use or backup status; do not classify historical student records as cache. No schema migration, DROP, retention purge or data export was executed.
- Ignored evaluation/private and results-local paths are storage policy, not obsolete production directories. Never bulk-delete consented data or publish it to make the source tree look clean.

## Minimal cleanup plan (recommendation only; approval required)

1. **Documentation-only first.** Correct the local launcher's obsolete password message; clarify stale remediation/validation statements and mark copied-formula tests as historical in descriptions. This yields clarity without deleting code, tests or data. Scope any approved edits separately from historical evidence.
2. **Keep all current production paths and tests.** Retain classroom HTML, canonical engines, generated browser counterparts, build-copy scripts, auth/password code, backend Store migrations, lockfile, requirements and active CI. Retain the legacy SQLite tools and simple outbox while their support/tests remain part of this repository.
3. **Optional later test/dependency refactor.** Extract the shared synthetic generator before moving benchmark tests. Replace copied-formula assertions with equivalent current-module checks only after comparing coverage. Consider pandas packaging and flake8 setup separately; no broad dependency pruning.
4. **Only then consider tiny compatibility removals.** Root app.py and the alternative Dockerfile need external deployment/operator confirmation first. With no evidence that external paths are unused, leaving them is the lowest-risk minimal plan. No archiving/removal of supported SQLite tooling belongs in the minimal plan.
5. After an approved implementation, run Python, JS, bundle-drift, build and full browser suites; execute the isolated PostgreSQL test using a dedicated test database, verify auth/room ownership and confirm deployment commands still resolve. Preserve historical databases and migration versions 2/3. Review the exact diff before any separately approved push/deployment.

**Action taken:** audit report only. **Actions not taken:** edits to existing files, deletions, dependency installation, tests/builds, database access, migration, commit, push or deployment.
