# EduGuard real-world evaluation and calibration

**Real-world accuracy is unmeasured.** No consented, independently labeled video dataset was supplied. `status/tables.tex` is an honest publication status table, not a performance result. Existing synthetic landmark tests establish implementation behavior only. Do not put their accuracy figures into a real-world results section.

The workflow replays **unchanged** `core/engagement.mjs`, extends `benchmarks/capture.html`, and is accessible through `scripts/benchmark_video.mjs --rigorous`. No production thresholds, API, hosting or classroom privacy behavior changes. Calibration settings remain evaluation artifacts until evidence and a separate review justify deployment.

## 1. Consent, sampling and data custody

Recruit consenting adults initially. Participation must be voluntary, separate from grades, employment or attendance consequences. Explain local video/landmark processing, purpose, access, retention, planned aggregate publication, and withdrawal. Record explicit permission for recording **if recording**; classroom monitoring consent alone does not authorize research recording. Follow institutional ethics requirements before involving minors or collecting sensitive demographic data.

Use a random stable participant pseudonym across every session/device; never split the same person under multiple aliases. Store identity mapping and signed consent separately from videos and landmark exports. Assign a local custodian, deletion date and withdrawal contact. Withdrawal requires removing that participant from every export, regenerating splits/calibration, and retracting affected reports. Aggregate results may not be fully retractable after publication; disclose this before consent.

Raw video stays on the participant/research computer, preferably in an encrypted directory **outside the repository and any cloud-synced folder**. This workspace is inside OneDrive: do not put raw videos here. No video upload, recording API, microphone analysis, transcription or remote inference is introduced by these tools. The capture page fetches pinned MediaPipe JS/WASM/model assets from jsDelivr; disconnect after assets are available if local policy requires it, or locally mirror assets and document the version. Third-party code is a residual trust risk. Inspect browser Network to confirm only static/model requests and no media POST/WebSocket requests during extraction. The classroom no-raw-video guard is a separate invariant.

Derived landmarks are also potentially identifying biometric/behavioral data. Keep exports, labels, splits, consent identifiers, calibration locks and detailed reports private in ignored `evaluation/private/`, or an external encrypted directory. Raw video extensions are globally ignored as defense in depth; `.gitignore` cannot protect files already tracked or deliberately force-added. Never commit consent documents or raw/derived participant data. Only explicitly reviewed, sufficiently aggregated results should be copied into a publication directory. Do not publish small identifying strata.

## 2. Acquisition plan (pre-register before viewing predictions)

Aim for at least 30 independent participants initially, with repeated sessions on multiple days and balanced tasks; this is a planning target, **not a power guarantee**. Six participants is the tool's mechanical minimum (not enough for convincing inference). Plan participant count from a pilot, desired interval width and critical false-alert rate. Seek multiple participants and positive/negative examples per held-out condition and class. Publish exact participant, clip, event and class counts and exclusions.

For each person, collect short randomized blocks with recovery periods:

- Neutral/open eyes, spontaneous blinks, deliberate closures shorter than 1s and at least 2–3s, return to open eyes. Never require uncomfortable prolonged closure.
- Face present, leave frame, return, brief face/eye occlusion, partial and complete occlusion.
- Independently referenced yaw sweeps (both signs), pitch up/down, roll both signs, and combined motion. Include held neutral poses and points near decision boundaries.
- Normal and low light (record approximate illumination), glasses with/without glare as applicable, natural head motion and fast motion, occlusion.
- Camera at eye level, above, below and to the side; laptop-integrated, phone and external cameras. Record coarse device/browser/model version, resolution, actual sampling cadence, camera placement and condition tags. Do not collect serial numbers or unnecessary identifiers.

Use overlapping condition tags for combined challenges, and separate clips when conditions change. Repeat tasks across devices; all clips for a participant remain in one split. The current extractor uses one face, fixed 10 Hz sampling and the engine's existing 640x480 geometry convention. Record original video dimensions. Findings apply to that capture pipeline; independently test live scheduling/frame drops before claiming deployed performance. Sampling gives about 100ms temporal resolution; it is unsuitable for precise blink timing. Do not claim multi-face evaluation from this extractor.

## 3. Independent annotation

Annotators must not see engine outputs. Two independent raters label intervals from the original local video; preserve their original files, adjudicate disagreements using a third rater, record protocol/version and boundary uncertainty. Report inter-rater agreement and disagreement rates before adjudication (e.g. Cohen's kappa for categorical tasks); this implementation requires adjudicated labels but does not calculate kappa. Do not let low model confidence define ground truth. Use `null` for visually unresolvable labels and report those exclusions.

Label the dimensions **independently**; simultaneous eye closure/head turn is permitted:

| Key | Values | Ground-truth definition |
| --- | --- | --- |
| `face` | `present`, `absent`, null | A human face is visibly in frame, independent of landmark success. Occlusion can make other tasks unlabelable. |
| `eyes` | `open`, `closed`, null | Visible eyelid closure, including brief blinks. Ambiguous/hidden eyes are null. |
| `closure` | `yes`, `no`, null | `yes` begins 1000ms after an independently annotated continuous eye closure starts; ends when eyes reopen. Earlier closed frames are `no`. Freeze this definition while tuning model duration thresholds. |
| `yaw` | `neutral`, `turned`, null | Independent reference has absolute yaw >25 degrees = turned; equality is neutral. |
| `pitch` | `down`, `neutral`, `up`, null | Independent reference pitch <−15 degrees = down; >20 degrees = up; otherwise neutral. |
| `roll` | `neutral`, `tilted`, null | Independent reference absolute roll >25 degrees = tilted. |
| `quality` | `usable`, `unusable`, `absent`, null | Human rubric: usable = one adequately sized, visible face with eyes and pose resolvable; unusable = face visible but resolution/occlusion/motion/lighting prevents reliable measurement; absent = no face. Define rubric thresholds before labeling and adjudicate independently of MediaPipe. |

Angles require synchronized **independent measurements** (validated reference tracker/IMU with coordinate calibration, or carefully calibrated multi-camera annotation). Task instructions such as “turn 30 degrees” are not measured angle truth. If no angle reference exists, do not invent degrees; mark angle labels/reference values null. Qualified manual directional labels can support explicitly described categorical-only experiments; they do not validate degree accuracy. Record reference method, synchronization error and axis/sign convention in `annotationProtocol` documentation. Reference angles must use the engine convention; verify yaw/pitch/roll signs using a calibration object before recruitment. `referenceAngles` is optional; MAE stays undefined without genuine numeric references.

`phase:"calibration"` is a separate neutral/open-eye prefix (at least 30 **usable** samples). Never label evaluation frames as calibration retrospectively. Neutral calibration must be possible at deployment and contains no test outcome labels. It is participant adaptation, not permission to tune global thresholds on test people. The tool excludes calibration frames from all metrics. No automatic calibration is inferred from unlabeled evaluation data.

The legacy class name `ATTENTIVE` is not ground truth for attention. This protocol measures observable behavior and measurement quality, not cognition, learning, attendance truth or misconduct.

## 4. Extract and merge locally

From the repository root, serve files locally:

```powershell
.venv/Scripts/python.exe -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/benchmarks/capture.html`. Confirm consent; choose a local video; enter pseudonymous participant/consent/protocol IDs, coarse device and condition tags. Paste your independently adjudicated intervals. The example labels in the form are an editing template, **not real labels**; replace them completely. Every sampled timestamp must have exactly one interval, end exclusive. Calibration must precede evaluation. Export contains landmarks and derived metadata, never video or its filename.

Allowed conditions: `normal`, `low-light`, `glasses`, `head-motion`, `occlusion`, `camera-high`, `camera-low`, `camera-side`, `device-laptop`, `device-phone`, `device-external`.

Schema v2 example (shape only; not a dataset):

```json
{
  "schemaVersion": 2,
  "source": "real-video",
  "consentConfirmed": true,
  "clips": [{
    "id": "random-clip-id",
    "participantId": "P001",
    "consentRecord": "local-consent-P001-v1",
    "annotationProtocol": "two-rater-v1-adjudicated-reference-method",
    "device": "laptop-integrated",
    "conditions": ["normal", "device-laptop"],
    "frames": [{
      "timestampMs": 100,
      "phase": "evaluation",
      "labels": {"face":"present","eyes":"open","closure":"no","yaw":null,"pitch":null,"roll":null,"quality":"usable"},
      "referenceAngles": null,
      "landmarks": null
    }]
  }]
}
```

A null landmark result does **not** mean the human reference must say absent. Annotate the video, not the model. Partial landmark arrays and null observations are preserved. Missing/partial/complete counts are instrumentation coverage, not “missing landmark accuracy.” The `face` and `quality` tasks quantify failures against independent human labels.

```powershell
node evaluation/run.mjs merge --files evaluation/private/P001.json,evaluation/private/P002.json --out evaluation/private/dataset.json
```

Merge all participants, not just two. Validation enforces required metadata, task values, phase order, unique clip IDs and monotonic timestamps; it cannot verify consent honesty, real-video provenance, participant identity or annotation correctness. Audit those separately. It refuses explicit synthetic test fixtures.

## 5. Freeze participant-disjoint splits

```powershell
node evaluation/run.mjs split --dataset evaluation/private/dataset.json --seed 731 --out evaluation/private/split.json
```

Deterministically shuffled participants are assigned approximately 60/20/20 train/validation/test, with no overlap and all a person's clips grouped. Dataset hash binds the manifest. No frame-level random split is allowed. Inspect class and condition coverage **without looking at predictions**; small random splits may lack important strata. Pre-register any coverage-constrained participant allocation before tuning, freeze it, and document deviations. The supplied tool does not promise stratification. Do not try many seeds and select by performance. A locked external device/site cohort is recommended for later generalization claims.

## 6. Calibration and ablations

```powershell
node evaluation/run.mjs calibrate --dataset evaluation/private/dataset.json --split evaluation/private/split.json --out evaluation/private/calibration.json
```

This uses existing `calibrateCameraOffset` and `calibrateBaselineEARFromSamples`; no estimator rewrite. At least 30 usable neutral/open-eye prefix frames are required; otherwise default calibration remains and reports flag that adaptation was not applied. Camera correction and EAR adaptation are logged per clip.

The predeclared bounded candidate grid perturbs one threshold family at a time: yaw/pitch/roll limits, closure duration, fallback EAR thresholds/individual EAR ratios, and minimum interocular distance. Current defaults are included. Training ranks the grid by mean supported-class macro-F1 across available tasks; the top three are compared on validation only, with deterministic ties. This small search is intentionally not an exhaustive multi-parameter optimizer. Fix your scientific objective before data collection; changing it requires a new development cycle, not revisiting test scores.

The lock records candidate grid, shortlist, selected settings, dataset/split/engine/evaluator hashes and timestamp. Test evaluation refuses mismatches. Hashes are reproducibility checks, not tamper-proof access control. Researchers must still enforce a genuinely sealed test set.

Frozen variants: current defaults; defaults plus personal calibration; selected calibrated settings; remove camera adaptation; remove EAR adaptation; near-zero temporal debounce (1ms rather than 0 because existing default fallback uses `||`); disable score smoothing; disable jitter rejection. These are offline diagnostics only. `current_personalized` versus `calibrated` isolates threshold selection from adaptation. Other ablations isolate one selected component, and paired differences versus `current` are exported. Compare calibrated-minus-component manually from their task values; this is not a causal estimate of all interactions.

Categorical yaw/pitch/roll use instantaneous returned pose and independent axis limits, rather than the mutually exclusive behavior class. `closure` uses the engine's existing `is_drowsy` flag, while eye state uses its hysteresis state. The flag and combined behavior classifier have different frame/duration logic; this workflow does not silently “fix” it. Temporal debounce changes may therefore affect eye closure without changing instantaneous head labels. Smoothing operates on scores, so it should not improve these categorical tasks; it is a negative control with a supplementary stable-score-step RMS metric. No-jitter-gate ablation leaves other quality checks intact.

## 7. Evaluate the sealed test set once

```powershell
node evaluation/run.mjs evaluate --dataset evaluation/private/dataset.json --split evaluation/private/split.json --lock evaluation/private/calibration.json --bootstrap 1000 --out evaluation/results-local
# Equivalent entry through the existing benchmark:
node scripts/benchmark_video.mjs --rigorous evaluate --dataset evaluation/private/dataset.json --split evaluation/private/split.json --lock evaluation/private/calibration.json --out evaluation/results-local
```

An existing report blocks accidental reruns. `--repeat` is for identical reproducibility checks only, not model selection. A new output folder can bypass this guard: organizational blinding is still required. Node/browser timing varies with hardware/load; report distributions and environment before making runtime claims.

Outputs from genuine inputs:

- `report.json`: each variant's confusion matrices, class support, precision, recall, F1, one-versus-rest FPR, supported-class macro-F1, overall accuracy, coverage, null-label exclusions, missing classes and 95% participant-cluster percentile bootstrap intervals. Undefined denominators are null, never 100%. Unknown predictions are explicit confusion columns, count against recall/accuracy and are never a scored low observation.
- Paired bootstrap deltas use the **same resampled participants** for both settings. Classification bootstrap uses exact participant confusion counts for efficiency, not independent-frame resampling. At least 200 replicates are required; default 1000. Fixed seed 731. Intervals with fewer than two contributing participants remain null. Always inspect support, valid replicate count and participant count; tiny cohorts or absent events make intervals untrustworthy. In particular, zero observed false positives can yield a degenerate [0,0] bootstrap interval; this does not bound unseen rare errors. Report the event-free support and recruit more independent participants rather than claiming a zero population rate. These intervals are descriptive, not multiplicity-adjusted evidence of significance.
- `strata` and `devices`: calibrated results by condition and coarse device, including empty/unmeasured strata. Tags overlap, so stratum counts must not be summed. Stratified reports need enough independent people; device-held-out testing is not implied by participant splitting.
- Missing/partial/complete landmark counts, unknown coverage, per-task transitions/minute during contiguous unchanged truth, closure event detection/misses/left- and right-censored counts, conditional onset latency and its cluster interval. Gaps >250ms break continuity. Latency starts at the first labeled prolonged-closure timestamp; detected latency alone hides misses, so report both. Open-ended events without detection are censored, not claimed negatives.
- Angle MAE per axis and cluster intervals only when independent degree references exist. Node landmark replay ms/frame and browser extraction ms/frame are separate; neither is end-to-end classroom network latency. Extraction includes MediaPipe processing, not seek/decode or upload.
- `tables.tex`: IEEEtran-compatible tables for task metrics and macro-F1 intervals, per-class metrics, confusion matrices, timing/angle errors and paired deltas. Include `\usepackage{graphicx}` for resized matrices, then `\input{tables.tex}`. Detailed class-specific intervals and condition results remain in JSON; select appropriate tables for page limits. Audit anonymous aggregate tables before publication.

FPR is FP / all labeled frames of other classes, including abstentions on negative frames. Coverage must accompany it: abstaining everywhere can have zero FPR and zero recall. Frame-weighted point estimates give longer clips more influence; participant clusters address dependence in intervals but do not equalize clip weights. Balance planned recording durations and report per-participant/condition supports. Macro-F1 excludes unsupported truth classes and explicitly lists them; it is not a full-class result when classes are missing.

## 8. No-data and verification commands

```powershell
node evaluation/run.mjs status --out evaluation/status
node --test tests/js/evaluation.test.mjs
npm run test:js
npm run lint:js
```

Only the no-data status table is committed. Never generate empirical tables from the synthetic unit fixtures. Tests verify rejection, participant leakage/hash checks, metric denominators, abstention, cluster intervals, event latency/censoring, missing landmarks and LaTeX generation. They establish tooling correctness, not field accuracy.

Methods background: [scikit-learn grouped cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data) explains grouping to avoid related entities across splits; [NIST bootstrap guidance](https://itl.nist.gov/div898/handbook/eda/section3/eda334.htm) describes bootstrap uncertainty. This implementation resamples participants as clusters because video frames are dependent.
