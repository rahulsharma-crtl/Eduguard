> Current navigation: Research Validation is always visible as a link in the existing teacher login card, above the sign-in controls. No VITE_RESEARCH_VALIDATION_ENABLED setting is needed. Earlier flag-based navigation instructions below are superseded. The existing header and classroom layout are retained.

> Audio correction: narration is now required. Missing or failed speech interrupts capture before the next measurement. Speech timeout is 10 seconds; total capture limit remains 100 seconds. Earlier text-only continuation instructions are superseded. Verification before push: all 77 JavaScript tests and all four research browser tests pass, including mandatory-narration interruption. The production build passed.

# Facial Validation Mode — supervised pilot protocol

## Current website protocol: v2 (Research Validation UI)

The current research page emits **eduguard-facial-validation-v2**. The v1 specification below is retained for older CSVs; its fixed time schedule and old interface instructions are not the current procedure. The existing production engine, thresholds, FaceMesh configuration, five expected actions, observer independence, eight-window sampling, majority rule, invalid/unknown handling and CSV column names are unchanged.

1. Obtain adult voluntary consent and observer presence, then choose **Check camera readiness**. This requests camera only and loads the existing model. Review local face visibility/tracking quality; the check is advisory and does not exclude poor model performance. No class predictions or measured research observations are stored during readiness. One engine runs continuously with an absolute monotonic timestamp through readiness and capture, without research-only state resets.
2. Check the local preview. **Show local facial mesh** changes drawing only, never inference. **Mute instructions / Unmute instructions** controls generic English SpeechSynthesis prompts. Only voices marked as local English services are selected; absent/failed voices fall back to visible text and observer instructions. There is no speech recognition, microphone capture or participant data spoken.
3. Press **Start one validation session**. A large single instruction, phase countdown and trial progress are shown. Preparation lasts at least 10 seconds. For each of the same five actions: finish the instruction's narration (or document text-only fallback), allow a full 5-second settling interval, then measure an exact 8-second window. Spoken preparation is included in the preparation interval. The total is normally approximately **75–100 seconds** plus camera setup/observer review. A 4-second narration timeout cancels speech and falls back to text; speech that still fails to stop prevents new measurement. A run exceeding 100 seconds is interrupted rather than shortening or relabeling a trial.
4. The supervisor may independently mark action onset. Readiness diagnostics are hidden during trials, and class predictions remain hidden until all five observer verdicts are locked. Confirm, invalidate or mark uncertain from the actual participant, not mesh availability. Mesh feedback can itself bias observation: pre-register a consistent setting across participants (prefer hiding it during measured trials when observer blinding matters). The CSV records initial/timed-start display settings and whether controls changed during capture.
5. After capture stops, lock the independent verdicts and immediately download **one CSV**. Incorrect, unknown and insufficient-quality results remain intact. Use only one supervised attempt per adult, document interruptions rather than selecting better runs, and clear only the isolated research record for the next participant.

### V2 actual timing records and compatibility

CSV columns remain identical to v1. V2 adds `record_type=phase_timing` rows using existing fields: `phase`, `trial_id`, `window_start_ms`, `window_end_ms`, `quality_reason` (narration outcome), and `result_status` (complete/interrupted/open). A completed session has **16 phase records**: preparation plus instruction, transition and observation for each of five trials. Muted/unavailable instructions can have zero duration; they still have a recorded boundary. Observation windows start only after narration and settling, not at old fixed offsets. All times are actual monotonic session-relative boundaries; no clock compression is used to fit 75 seconds. Capture timestamps are frame-submission times, not sensor exposure times.

There are still five trial summaries and forty sampling windows plus underlying inference observations in the same file. A trial not reached in an interrupted v2 run has blank timing bounds and explicit missing/unknown windows; those are not fabricated observations. The analyzer validates actual phase order/duration, reconstructs the per-second sampling decisions from those boundaries and preserves every error/unknown. It accepts both v1 and v2 CSVs and can re-export saved v1 sessions without rewriting their timings. **Do not pool protocols:** the CLI rejects a combined v1/v2 cohort, even with the same engine hash, because narration, readiness and visual feedback alter the procedure. Keep the first v1 CSV as a pilot/diagnostic and analyze it separately.

The observation end boundary is the effective capture-eligibility cutoff, exactly eight seconds after its actual start. If a browser timer callback runs late, captures after that cutoff are not relabeled as observations and any gap before the next phase remains unmeasured. Browser scheduling and camera exposure are not hard real-time guarantees; missing sampling windows remain missing.

### Enable, disable and collect the ten CSV files

The optional landing-page navigation link uses **VITE_RESEARCH_VALIDATION_ENABLED=true** at Vite build time. It is false by default. Set it in the frontend environment and rebuild/redeploy only after approval; removing it or setting false and rebuilding hides the link again. It never appears on student invitations or active classrooms and opens the separate page in a new tab. Render/API settings need no change. This flag hides navigation only: the direct `/classroom/validation/index.html` URL remains accessible, and is not an authentication gate. No teacher account or classroom is required for the study.

For local review, run `npm run dev` with that variable set in the shell (or a private local frontend environment). For ten participants, follow the current steps above once each, retain exactly one CSV per person in a protected directory, and use the combining command in the shared analysis section below. Neither the site nor analysis script uploads results. `JITTER_INVESTIGATION.md` documents the reproduced engine-quality issue and a candidate fix requiring separate approval; it has **not** been bypassed or fixed in research code. Review that limitation before using results in a paper.

## Legacy v1 procedure and shared analysis reference

The remaining original v1 text preserves its fixed-timing import specification, consent/analysis formulas and prior implementation evidence. Where UI or timing descriptions differ, use the v2 procedure above for new collection. Prior test counts are historical snapshots, not current certification.

Protocol ID: **eduguard-facial-validation-v1**. Intended sample: **10 consenting adults, one session each**. This is a small, fixed-model facial-behavior feasibility study, not validation of attention, learning, drowsiness as a medical condition, identity, attendance or misconduct. No real participant results have been collected or invented by this implementation.

## Scope and frozen implementation

The optional page is `/classroom/validation/index.html`. It is a direct, unlisted link, **not an authenticated/private access boundary**. Nothing is added to teacher/student navigation. It needs no account, classroom, invitation, FastAPI connection, PostgreSQL record or PeerJS connection. The existing website/deployment configuration and classroom sources are unchanged; `scripts/prepare_web.mjs` only adds a copy of the isolated page after the original classroom copies.

Detection uses the existing `components/student_room/frontend/engagement.js`, generated from **unchanged** `core/engagement.mjs`, and the same pinned MediaPipe FaceMesh version and model settings as the production student page: `@mediapipe/face_mesh@0.4.1633559619`, max one face, refineLandmarks=true, detection/tracking confidence 0.5. No separate detector, threshold search or new classification algorithm is introduced. A new default `EngagementEngine` runs continuously throughout the timed session; it is not reset to make each trial succeed. Camera offsets remain zero and EAR thresholds remain defaults. There is **no personal calibration** in this protocol; the preparation period is familiarization, not threshold fitting. Do not add calibration or change engine settings after looking at these ten participants' results.

Record the engine bundle SHA-256 and defaults exported in each CSV. Freeze the tested source revision before recruitment and keep all ten sessions on the same build/browser protocol. Mixed engine hashes are rejected by the analysis tool. The script cannot cryptographically establish that an observer was truthful or that a CSV was not edited.

## Recruitment, consent and custody

Recruit ten adults aged 18 or older who freely agree to one supervised session. Avoid coercion, grade/attendance consequences or implying that declining indicates inattention. Obtain institutional ethics approval or exemption as applicable before recruitment. Explain the purpose, tasks, approximate duration, local processing, planned CSV use, retention/deletion dates, supervisor contact, and withdrawal procedure. The website checkboxes record a declaration of adult consent and observer presence; they do not replace your research consent process.

The supervisor should maintain any consent records and participant correspondence **separately** from exported study data. Use no names, email addresses, student numbers or filenames containing real identities. The page assigns random pseudonymous participant and session IDs. They are not a guarantee of complete anonymity: observation times and conditions can be identifying, and the supervisor personally knows the volunteer. Provide a way for a participant to quote their study ID to request withdrawal before the agreed analysis/publication cutoff.

Raw camera frames, facial images and landmarks remain in volatile browser processing. No video recording, microphone request, biometric upload or evaluation-result upload is implemented. Optional device and condition descriptions should be coarse, e.g. normal/low light, glasses, eye-level/high/low camera, laptop/external camera; do not enter personal details. Avoid deliberately hazardous lighting/poses or anything uncomfortable. Participants may stop immediately.

Derived predictions, timestamps, conditions and observer verdicts are saved only under the isolated `eduguard-facial-validation:v1` sessionStorage key for same-tab recovery, then exported as one local CSV. They are not mixed with classroom storage or metrics. No plaintext video/landmark payload is stored there. Clear this isolated record between volunteers. Browser/session restore behavior varies; closing the tab, clearing storage, quota errors or a crash can lose local data. An already downloaded CSV is outside the app's deletion control. Store CSVs in a protected local directory outside version control and cloud-sync folders; this workspace is under OneDrive, so choose an appropriate external location. All `*.csv` files are ignored by this repository as defense in depth.

MediaPipe JS/WASM/model assets are fetched from pinned jsDelivr URLs, and the current engine bundle is read from the same website to calculate its hash. This is static asset traffic, not biometric transmission. External browser code remains a trust dependency; initial asset downloads may fail offline. No research results are sent to the backend, even after consent; sharing the downloaded CSV with the supervisor is a separate participant action under the consent agreement.

## Running one participant

1. On a supported desktop browser (current Chrome/Edge/Firefox/Safari capabilities must be checked on your target machines), open the direct URL on HTTPS or localhost. The capture code requires camera access, Web Crypto, and a way to identify fresh video frames (`requestVideoFrameCallback`, or `getVideoPlaybackQuality` fallback). Automated coverage is Chromium; other browsers are not certified by these tests.
2. Explain consent and read the procedure aloud. The supervising observer must remain present and able to see the participant and local camera framing. The participant ticks adult/voluntary consent and observer presence. Optionally enter coarse conditions/device category.
3. Click **Start one validation session**. Allow **camera** access. No microphone permission is requested. Initial model download/warm-up is outside the timed 75 seconds and may take additional time.
4. Follow the sequence below. The observer reads cues aloud while the participant's eyes are closed and while they are outside the camera view. At the first independently observed onset of each requested action, the observer may click **Observer: action started** once. The button's availability is based only on the protocol clock, never model predictions.
5. Camera capture stops at completion (allow up to two seconds to resolve a previously captured inference before review). The observer selects **confirmed**, **invalid**, or **uncertain** for all five trials, using personal observations. No model predictions are shown before verification is locked.
6. Click **Lock verification and prepare CSV**. Decisions become immutable for that record; do not revise them after inspecting predictions. Immediately click **Download CSV**. There is one file per session, containing every trial, window and observation. Re-downloading is the same session artifact, not a new experiment.
7. Transfer the CSV as consented, verify it is present, then use **Clear this tab’s study data for the next participant**. Do not repeat a participant because the prediction was wrong, unknown or disappointing. Document failures/withdrawals rather than selecting a better attempt.

If a participant withdraws during capture, **Withdraw and erase this local record** stops the camera and clears this study key. It cannot erase a file already shared or downloaded. If they wish to retain a failed attempt, use **Stop and keep incomplete record**, independently review, and export the incomplete session; it is excluded from primary completed-session metrics.

## Exact timed sequence

The clock starts only after the camera/model are ready. It uses monotonic `performance.now()`; timestamps are also mapped to UTC using the session's initial browser wall clock (not a synchronized reference clock).

| Segment | Relative time | Procedure / reference |
| --- | --- | --- |
| Preparation | 0–10 s | Face forward with eyes open. Familiarize with camera framing; not scored. |
| T1 transition | 10–15 s | Move to a comfortable forward-facing pose. |
| T1 scored interval | 15–23 s | Forward, eyes open → expected `ATTENTIVE`. |
| T2 transition | 23–28 s | Close both eyes gently, keeping head forward. |
| T2 scored interval | 28–36 s | Sustained closure → expected `PROLONGED_EYE_CLOSURE`. Observer tells participant when to reopen. |
| T3 transition | 36–41 s | Open eyes and turn head roughly 35–45° sideways; no strain. |
| T3 scored interval | 41–49 s | Hold sideways pose → expected `LOOKING_AWAY`. |
| T4 transition | 49–54 s | Return to forward-facing pose. |
| T4 scored interval | 54–62 s | Forward, eyes open again → expected `ATTENTIVE`. |
| T5 transition | 62–67 s | Move entire face out of camera frame. |
| T5 scored interval | 67–75 s | Remain outside frame → expected `FACE_NOT_DETECTED`. |

If an eight-second closure or any pose is uncomfortable, stop/withdraw or mark that reference invalid; never pressure the volunteer. Transition results are recorded for traceability/optional latency but excluded from scored windows. These **five trials cover four true classes**, not five. `ATTENTIVE` is the unchanged engine's internal label; the page describes a visual pose and does not claim the person is paying attention.

The engine's mutually exclusive `behavioral_state` is the prediction endpoint. Its absence/quality/eye/head priority rules and temporal state are preserved. Other returned classes (`NATURAL_BLINK`, `LOOKING_DOWN`, `LOOKING_UP`, `HEAD_TILT`) are exported unchanged as wrong-class outcomes where appropriate. `INSUFFICIENT_QUALITY` retains its raw label but normalizes to `UNKNOWN` for scoring. Missing/failed inference is also UNKNOWN, with an empty raw label and explicit reason. The engine's `is_drowsy` flag has different timing logic from its combined behavior classifier; this protocol does not mix those endpoints.

## Sampling and trial summaries (pre-specified)

Only newly presented camera frames are eligible for inference. Inference starts at most about 10 times per second (minimum 100ms between starts), never concurrently. Dropped/stalled frames are not reused. Frame-submission-relative times (`capture_rel_ms`) and inference-completion times are exported. The former is the browser time just before submitting the newly presented frame, not a camera sensor-exposure timestamp. This cadence is not a hard real-time guarantee, and a frame-count fallback inside the unchanged engine may be cadence-dependent. Keep the same browser/machine protocol and report observed timing.

Within each eight-second scored interval, define **eight non-overlapping one-second windows**. For each window, choose the first fresh inference capture in `[window midpoint, midpoint + 250ms)`. If none exists, record a missing window with UNKNOWN prediction and **no fabricated capture timestamp or value**. An insufficient/error result at that selected point remains UNKNOWN; the code does not search for a later correct frame.

The trial prediction is a strict majority over all eight window predictions, **including UNKNOWN**. A label needs at least five of eight votes. If no label has a strict majority, the trial prediction is UNKNOWN. The chosen rule is fixed before collection, not optimized for these participants. Incorrect labels remain incorrect. Underlying fresh-frame predictions and selected window outcomes remain in the same CSV so summaries can be audited.

Inference observations and window points are repeated measurements, **not independent primary trials**. The primary analysis uses at most one summary per instructed trial, five trials per person, and treats participants as clusters. Even the five trials within one person are correlated.

## Observer verification, validity and latency

The observer must base the verdict on the visible participant/action, not model output. The software hides predictions until all verdicts are locked. Confirm only if the requested pose/action was actually maintained throughout the scored interval. Use invalid for incomplete/wrong action or unintended competing behavior; use uncertain if occlusion, distraction or timing prevents an independent reference. Record the reason separately in the supervisor's nonidentifying study notes if needed. Independent observation does not mean a second independent rater; this pilot has only one observer.

- `reference_status=valid`: completed session and observer-confirmed trial. These enter primary metrics, **including UNKNOWN or wrong predictions**.
- `reference_status=invalid`: invalid observer verdict or interrupted session. Preserve/export and exclude, with counts.
- `reference_status=uncertain`: completed session without a confirmed/invalid reference. Preserve/export and exclude, with counts.
- `validity` combines the reference and prediction for convenient display: invalid reference → invalid; uncertain reference or unknown prediction → unknown; otherwise valid. **Do not filter primary metrics by validity**, since that would incorrectly discard unknown predictions against valid references.

`detection_latency_ms` is the completion time of the first matching inference captured at/after the observer-marked action onset, minus that onset. It includes inference/processing delay and observer reaction error; it is not sensor-ground-truth latency. If onset is not independently marked, the field remains blank. If no matching detection exists, latency remains blank with `latency_status=not_detected`; report misses and do not average them as zero. `cue_to_detection_ms` is separately measured from the scripted cue; it must not be relabeled as actual action-onset latency. Invalid/uncertain references do not enter aggregate latency results. Individual record latencies are retained even if their reference is invalid.

Camera denial produces an interrupted record with no observed predictions. Tracking errors produce explicit unknown observations; “no face detected” from a successful model result is preserved as the actual label, even if the observer says a face was present. Moving off-screen or hiding the tab interrupts capture; refresh recovers the derived record as interrupted and never restarts the camera. Completed/locked records can be re-downloaded after refresh in the same tab. No incomplete run is silently resumed, extended or converted to completed.

## Single CSV schema

All rows share one header. `record_type` is:

- `session`: one row with consent declarations, protocol version, random IDs, status, engine bundle SHA-256 and engine defaults JSON.
- `trial_summary`: exactly five rows, including invalid/uncertain/missing trials. This is the **primary metric input**.
- `window_summary`: exactly forty rows, including missing windows, for summary auditing and descriptive coverage.
- `observation`: fresh inference outputs during the five action periods, including transitions. Preparation measurements stay local for continuous engine state and are not part of scored exports.

Columns: `protocol_version`, `record_type`, `participant_id`, `session_id`, `session_status`, `consent_confirmed`, `observer_present`, `trial_id`, `expected_behavior`, `predicted_behavior`, `engine_behavior`, `phase`, `window_index`, `window_start_ms`, `window_end_ms`, `capture_rel_ms`, `observation_utc`, `completed_rel_ms`, `frame_id`, `observer_verification`, `reference_status`, `validity`, `result_status`, `is_unknown`, `quality`, `quality_reason`, `processing_ms`, `observer_onset_ms`, `detection_latency_ms`, `cue_to_detection_ms`, `latency_status`, `conditions`, `device`, `engine_sha256`, `prediction_counts`, `interruption_reason`, `started_at_utc`, `engine_defaults_json`.

Relative times are milliseconds from the monotonic session start. `observation_utc` for a measured row is its estimated capture time; trial-summary UTC is the window start. It is blank for an unmeasured window. Blank numeric values mean unavailable, not zero. Camera frame IDs support duplicate detection. The engine may report quality valid on an absent-face result; use `quality_reason`, `engine_behavior` and unknown state together, rather than interpreting quality alone as face presence.

There are no images, landmarks, EAR/pose biometric coordinates, audio samples, CEI, classroom IDs, attendance records, teacher tokens or names in this schema. CSV quoting handles commas/newlines/quotes; spreadsheet formula-like text is prefixed with an apostrophe for safety.

## Combining ten exports and calculating metrics

Do **not** concatenate CSV text with ten repeated headers or count every row as a trial. Keep each participant's one file separately and run the local analysis script from the repository root:

```powershell
# Use a protected external data directory; filenames must not identify volunteers.
$studyFiles = Get-ChildItem -LiteralPath 'D:\EduGuardStudy' -Filter '*.csv' | Select-Object -ExpandProperty FullName
node scripts/analyze_facial_validation.mjs --out evaluation/results-local/facial-validation $studyFiles
```

Or pass ten explicit CSV paths. No network/backend is used by the analysis. It validates the schema, five unique trial summaries and forty windows, observer/reference consistency, unique ordered frame observations, sampling decisions, frozen majority summaries and latency calculations. It rejects duplicate participant/session exports and mixed engine hashes. Random IDs cannot detect a dishonest retake assigned a new ID; the supervisor must enforce one session per actual person and maintain the recruitment log independently.

Outputs: `report.json`, `confusion.csv`, `metrics.csv`, `participants.csv`. JSON contains primary accuracy, class precision/recall/F1/FPR, supported-class macro-F1, unknown rate/coverage, participant summaries, exclusions, descriptive window-unknown rates, latency counts and participant-cluster bootstrap intervals. These outputs are ignored local research artifacts; inspect aggregate privacy before publication. The script reports actual N and warns if not ten; it never fills missing people/trials. No eligible confirmed completed trials → unmeasured/undefined metrics, not perfect accuracy.

For the primary multiclass task, true rows are the four instructed classes. Predicted columns include every other supported engine class plus UNKNOWN, so off-task/unknown predictions remain errors. The existing combined classifier is mutually exclusive, so this four-class instructed-action task supports one multiclass confusion matrix. It does **not** establish independent sensitivity for simultaneous eye/head states, angle regression, pitch or roll. A future independent binary-task protocol would require independently verified labels for those dimensions; do not derive additional ground truth from the model outputs.

For each class c:

- TP = expected c and predicted c.
- FP = expected another class and predicted c.
- FN = expected c and predicted anything else, **including UNKNOWN**.
- Precision = TP / (TP + FP).
- Recall = TP / (TP + FN).
- F1 = 2TP / (2TP + FP + FN).
- One-versus-rest FPR = FP / number of eligible trials with another expected class.
- Accuracy = correct eligible trial summaries / all eligible trial summaries.
- Unknown rate = UNKNOWN eligible trial summaries / all eligible trial summaries.
- Macro-F1 = arithmetic mean of F1 over true classes with support; missing classes are explicitly reported. Do not claim full four-class coverage when a class has no valid reference.

Undefined denominators remain null/blank. Class-negative abstentions remain in the FPR denominator, so FPR must be read alongside coverage and recall. Precision for a class never predicted is undefined; a supported class with no correct detections has F1 zero. Participant summaries and mean participant accuracy are separate from pooled trial accuracy, especially if invalid/uncertain exclusions produce unequal trial counts.

The JSON uses 1000 fixed-seed participant-cluster percentile bootstrap replicates, reusing the existing evaluation utility. It resamples people with all their eligible trials, not inference frames. Fewer than two contributing participants cannot produce an interval. Ten people give unstable intervals; zero observed errors can yield a degenerate bootstrap interval and does not demonstrate zero population error. These are descriptive uncertainty estimates, not a power calculation or multiplicity-adjusted hypothesis test.

## IEEE paper presentation and limitations

Before data collection, freeze this procedure, summary rule, engine build and exclusion policy. These ten sessions are evaluation of a fixed model, not data for choosing thresholds or the best aggregation rule. If you tune using them, label that exploratory development and collect a separate participant-disjoint evaluation cohort. No train/validation/test split is needed for this small fixed-model pilot, but it cannot simultaneously serve as calibration and an unbiased held-out test.

Report recruited adults, completed sessions, confirmed/invalid/uncertain trial counts, failures/withdrawals, device/lighting/camera conditions, four-class supports, all confusion columns including UNKNOWN, per-class precision/recall/F1, macro-F1, pooled and participant-level accuracy, coverage/unknown rate, and participant-cluster interval method. Report conditional latency together with marked onsets, nondetections and observer timing uncertainty. Clearly distinguish 10 people, at most 50 correlated trial summaries, 400 repeated sampling windows and the larger number of dependent inference observations.

A defensible methods statement is: “Ten consenting adults each completed one prespecified 75-second supervised protocol containing five instructed actions spanning four facial-behavior labels. Production inference thresholds were fixed. Independent observer confirmation preceded disclosure of predictions. Primary units were trial summaries; unknown predictions counted as errors and invalid/uncertain references were separately reported.” Fill in results **only after genuine collection and analysis**.

Limitations: small convenience sample; one observer without stored video for re-annotation; no inter-rater reliability estimate; no measured yaw-angle reference; fixed order and potential temporal carry-over; duplicated forward class; limited conditions/devices; camera/model failures; human onset timing; browser cadence effects; and inability to infer attention, cognition or misconduct. No demographic fairness, multi-face, medical drowsiness, roll/pitch accuracy or real-world classroom generalization claim is supported by this protocol.

## Local execution and verification

Use the existing local setup (`README.md`), then `npm run dev` and open `http://127.0.0.1:5173/classroom/validation/index.html`. The page can operate without API/signaling processes; it needs static assets and initial model downloads. A production artifact can be tested with `npm run build` followed by `npm run preview`. Do not deploy until explicitly approved.

New tests: `node --test tests/js/facial_validation.test.mjs`; browser tests use `npm run test:browser` with the existing regression suite. Synthetic fixtures and accelerated clocks test workflow correctness only. A separate smoke check initializes the real pinned model on synthetic video. Neither constitutes empirical accuracy evidence from consenting adults. Production asset fingerprints before/after the build must remain unchanged except for newly added validation assets.


## Implementation verification (2026-11-01; tooling evidence, not research results)

Work is on `feature/facial-validation`, with no commit, push, merge or deployment. Pre-existing uncommitted documentation cleanup is preserved. Only one existing tracked source file was changed for this feature: scripts/prepare_web.mjs, by appending an isolated copy operation. New feature files are the four components/facial_validation/frontend assets, scripts/analyze_facial_validation.mjs, the JS/browser facial_validation tests, and this protocol.

Before/after SHA-256 comparisons found all **seven existing production build files unchanged**, with none removed: dist/index.html; its existing main JS/CSS assets; classroom/student/index.html and engagement.js; classroom/teacher/index.html and roster.js. Only four classroom/validation assets were added. Of 96 tracked/pre-existing cleanup files fingerprinted before implementation, **95 remained byte-identical**; the allowed prepare_web change is the sole exception. Production engine, generated bundles, authentication, classroom sources, schema/migrations and deployment configurations remained unchanged.

Final local verification: **57 Python tests passed; one PostgreSQL integration test skipped** because TEST_POSTGRES_URL was not configured; **70 JavaScript tests passed**, including nine new workflow/schema/metrics/CLI checks; **10 Playwright tests passed**, including three new validation-page scenarios and all seven existing regression scenarios. Production build, generated-bundle drift, syntax and diff checks passed. One existing Starlette/httpx deprecation warning remains. The new browser tests include real pinned MediaPipe initialization on synthetic video; accelerated workflow tests stub camera/model inputs and do not measure adult-participant accuracy.

Initial development browser runs exposed a test-only cancellation-stub binding error and an overly broad privacy assertion matching default configuration names. Both harness issues were corrected; the final suite has no failures. Real desktop device/browser coverage beyond automated Chromium, physical-camera trials, human observer accuracy, and the ten-person study remain pending. No real-world performance results are asserted.
