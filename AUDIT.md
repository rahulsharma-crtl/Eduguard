# EduGuard Cloud Architecture & Reliability Audit Report

**Date:** October 30, 2026  
**Auditor:** Senior Full-Stack AI Engineer & Software Reliability Specialist  
**Target Repository:** EduGuard Classroom Telemetry & Privacy Conference System  
**Status:** Audit Completed | Automated Test Suite Deployed | Zero Architecture Modifications Prior to Review  

---

## Executive Summary

EduGuard is designed as a privacy-preserving smart classroom application featuring real-time WebRTC lecture broadcast, in-browser MediaPipe FaceMesh wireframing on a synthetic black canvas, client-side behavioral kinematics (EAR, head pose, acoustic energy), and SQLite telemetry logging with Streamlit analytics dashboards.

This audit evaluated the complete codebase across `app.py`, `config.py`, all `core/` modules, and both custom Streamlit component frontend bundles (`student_room` and `teacher_room`). Empirical tests and inspection of the production database (`eduguard_telemetry.db`) verified critical defects:
1. **Mathematical Scoring Ceiling Defect**: A student maintaining 100% presence, 100% attentiveness, and 0% distraction is mathematically capped at a Composite Engagement Index (CEI) of **75.0%**, making top-tier classification mathematically impossible.
2. **False Audio Evasion Brand**: Respectfully muting one's microphone triggers the `"Audio Evasion (Silenced Lecture)"` classification in session reports.
3. **Multi-Thread Concurrency Crashes**: `core/global_state.py` has no synchronization primitives, reliably raising `RuntimeError: dictionary changed size during iteration` under concurrent student traffic.
4. **Data Loss on Disconnect**: 56.25% (9 of 16) recorded sessions in `eduguard_telemetry.db` were abandoned with `NULL` end times and missing CEI scores because telemetry buffers (up to 25s) are only flushed on manual button clicks.
5. **WebRTC Initialization Race Conditions**: Outbound WebRTC calls execute before `virtualCanvasStream` is initialized, resulting in silent connection dropouts.

---

## 1. End-to-End Data Flow Mapping

The system executes a multi-stage pipeline spanning client hardware capture, local computer vision inference, synthetic media streaming, peer-to-peer data transport, server-side aggregation, and tabular export:

```
[Student Webcam & Mic]
        │
        ├── (display: none) ──> [MediaPipe FaceMesh (WASM)] ──> [Landmarks (468 pts)]
        │                                                             │
        │                                 ┌───────────────────────────┴───────────────────────────┐
        │                                 ▼                                                       ▼
        │                     [Neon Mesh Render]                                         [Local Kinematics]
        │                             │                                                           │
        │                             ▼                                                           ├── 6-Pt EAR (Left/Right)
        │                 [Pitch-Black 640x480 Canvas]                                            ├── Head Pose (Yaw/Pitch)
        │                             │                                                           └── Web Audio RMS Analyser
        │                             ▼                                                                   │
        │             [canvas.captureStream(25)]                                                          ▼
        │                             │                                                   [CEI Formula Calculation]
        │                             │                                                                   │
        └── (AudioTrack) ─────────────┼───────────────────────────────────────────────────────────────────┤
                                      ▼                                                                   ▼
                         [Synthetic MediaStream]                                                  [Telemetry Payload]
                                      │                                                                   │
                                      ▼                                       ┌───────────────────────────┴───────────────────────────┐
                         [Outbound WebRTC Media Call]                         ▼                                                       ▼
                                      │                              [WebRTC DataChannel]                                    [Streamlit Custom Component]
                                      │                           (Reliable P2P to Teacher)                              (setComponentValue every 2.5s)
                                      ▼                                       │                                                       │
                           [Teacher PeerJS Host]                              ▼                                                       ▼
                                      │                           [Real-Time Badge HUD]                               [Streamlit Session State Buffer]
                                      ├── Audio Track Decoded                 │                                                       │
                                      └── Video Track Ignored                 │                                     (Batch insert every 10 records)
                                      (Zero-Video Decode Table)               ▼                                                       │
                                                                 [Teacher Participant Roster]                                 ▼
                                                                                                                  [SQLite DB (eduguard_telemetry.db)]
                                                                                                                  ├── sessions table
                                                                                                                  └── telemetry table
                                                                                                                              │
                                                                                                                              ▼
                                                                                                                  [Teacher Dashboard UI & CSV Export]
```

### Flow Breakdown:
1. **Webcam Capture & Media Isolation (`student_room/frontend/index.html`)**:
   - `navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: true })` captures user media.
   - Physical video is bound to a hidden `<video id="raw_webcam" style="display: none;">` element.
   - Camera frames are pumped into `@mediapipe/face_mesh` via `@mediapipe/camera_utils`.
2. **Synthetic Canvas Generation**:
   - On each landmark callback, `<canvas id="privacy_canvas">` is cleared with `#000000` (pitch black).
   - Only vector wireframes (tessellation, eye contours, lip contours, iris markers) are drawn.
   - `privacyCanvas.captureStream(25)` generates a synthetic video stream completely detached from raw camera pixels.
   - The microphone audio track from physical media is appended to this synthetic stream.
3. **Client Kinematics & Acoustic Sensing**:
   - 6-point EAR computed across both eyes with 15-frame temporal debouncing for drowsiness.
   - 2D head pose heuristics estimate Yaw (`dL / dR`) and Pitch (`dTop / dBot`).
   - Web Audio API `AnalyserNode` calculates RMS microphone energy to flag speech while gaze is diverted.
4. **Dual Transport Channel (P2P + Streamlit Bridge)**:
   - **Video/Audio**: Student calls `${cleanRoom}-teacher` over WebRTC via PeerJS, sending the synthetic canvas stream and receiving teacher lecture video.
   - **P2P Telemetry**: Student opens an RTCDataChannel directly to the teacher peer, pushing telemetry every 2.5 seconds to drive floating badges in the teacher table.
   - **Persistence Bridge**: The same telemetry payload is dispatched via `Streamlit.setComponentValue(...)` to the Python backend.
5. **Backend State & SQLite Persistence (`app.py`, `core/db_manager.py`, `core/global_state.py`)**:
   - `global_state.py` records student presence heartbeats in a shared dictionary.
   - `app.py` appends records to `st.session_state.telemetry_buffer`, flushing batches of 10 to SQLite `telemetry` table.
   - Teacher dashboard auto-refreshes top-level analytics via `@st.fragment(run_every="6s")`.
6. **Reporting (`core/reporting.py`, `core/dashboard_ui.py`)**:
   - Concluded sessions compile aggregation metrics (total duration, average CEI, primary state) via `db.get_room_session_summary_ledger()`.
   - CSV reports are compiled into downloadable data frames from raw SQLite telemetry.

---

## 2. Audit Findings: Summary Matrix

| ID | Issue Description | Category | Severity | Status | Affected Files |
|---|---|---|---|---|---|
| **BUG-01** | CEI Scoring Formula Caps Maximum Attainable Score at 75% | Scoring Defect | **CRITICAL** | **VERIFIED** | `components/student_room/frontend/index.html` |
| **BUG-02** | Muting Student Mic Falsely Flags "Audio Evasion (Silenced Lecture)" | Scoring / Classification | **HIGH** | **VERIFIED** | `core/db_manager.py`, `components/student_room/frontend/index.html` |
| **BUG-03** | Threading Concurrency Race Condition in Shared State (`RuntimeError`) | Concurrency / Stability | **HIGH** | **VERIFIED** | `core/global_state.py` |
| **BUG-04** | Telemetry Buffer Data Loss on Tab Close / Refresh (56.25% Sessions Lost) | Data Loss | **HIGH** | **VERIFIED** | `app.py`, `core/db_manager.py` |
| **BUG-05** | WebRTC Call Race Condition on Initialization (`null` Stream) | Stability / Networking | **HIGH** | **VERIFIED** | `components/student_room/frontend/index.html` |
| **BUG-06** | Student Looking UP Falsely Triggers "Looking Down" Status | Kinematics Defect | **MEDIUM** | **VERIFIED** | `components/student_room/frontend/index.html` |
| **BUG-07** | Watchdog Prunes Valid Students Lacking DataChannel (STUN/NAT Fallback) | WebRTC / UI | **MEDIUM** | **VERIFIED** | `components/teacher_room/frontend/index.html` |
| **BUG-08** | Incomplete Regex in Peer ID Extraction Corrupts Display Names | UI / Parsing | **MEDIUM** | **VERIFIED** | `components/teacher_room/frontend/index.html` |
| **BUG-09** | Empty Session Defaults to 100% Score & "Mainly Attentive" | Database / Aggregation | **MEDIUM** | **VERIFIED** | `core/db_manager.py` |
| **BUG-10** | Hardcoded Teacher Password (`admin123`) & Timing Attack Vulnerability | Security | **HIGH** | **VERIFIED** | `app.py` |
| **BUG-11** | Undisclosed Live Audio Transmission in "Privacy Mode" | Privacy / Misleading UI | **HIGH** | **VERIFIED** | `app.py`, `components/student_room/frontend/index.html`, `components/teacher_room/frontend/index.html` |
| **BUG-12** | False "1080p HD Broadcast" UI Claim (Actual Stream is 720p) | Misleading UI | **LOW** | **VERIFIED** | `components/teacher_room/frontend/index.html` |
| **BUG-13** | Inconsistent Thresholds and Unused Configurations Between Py and JS | Configuration Drift | **MEDIUM** | **VERIFIED** | `config.py`, `components/student_room/frontend/index.html` |
| **BUG-14** | Missing SQLite Table Indexes Causing Full-Table Scans | Scalability / Performance | **MEDIUM** | **VERIFIED** | `core/db_manager.py` |
| **BUG-15** | Connection Leaks in SQLite Database Manager | Resource Leak | **MEDIUM** | **VERIFIED** | `core/db_manager.py` |
| **BUG-16** | Nested `st.download_button` in `st.button` UI State Loss | Streamlit UI Defect | **LOW** | **VERIFIED** | `app.py` |
| **BUG-17** | Rolling 100-Sample Window Distorts Final Session Average CEI | Data Accuracy | **LOW** | **VERIFIED** | `app.py` |
| **BUG-18** | External Public Cloud PeerJS Broker & Unpinned CDNs Without SRI | Security / Privacy | **HIGH** | **SUSPECTED RISK** | `components/student_room/frontend/index.html`, `components/teacher_room/frontend/index.html` |
| **BUG-19** | Unauthenticated Room Access & Student Impersonation | Security | **MEDIUM** | **SUSPECTED RISK** | `app.py` |
| **BUG-20** | Disconnect Notification Gap on Teacher Session Termination | UX / State Sync | **LOW** | **SUSPECTED RISK** | `app.py` |

---

## 3. In-Depth Vulnerability & Defect Reports

### BUG-01: CEI Scoring Formula Caps Maximum Attainable Score at 75%
* **Severity:** CRITICAL
* **Status:** VERIFIED (Reproduced in `tests/test_scoring.py` and `tests/js/scoring.test.mjs`, verified against historical database telemetry)
* **Affected Files:** `components/student_room/frontend/index.html` (lines 716-721), `config.py`
* **Description:**  
  The Composite Engagement Index (CEI) formula is implemented as:
  $$\text{rawCEI} = (0.30 \times P) + (0.45 \times A) - (0.25 \times D)$$
  where $P \in [0, 1]$ (Presence), $A \in [0, 1]$ (Attentiveness), and $D \in [0, 1]$ (Distraction).  
  When a student has perfect presence ($P = 1.0$), perfect focus ($A = 1.0$), and zero distraction ($D = 0.0$):
  $$\text{rawCEI} = (0.30 \times 1.0) + (0.45 \times 1.0) - (0.25 \times 0.0) = 0.75 \quad (75.0\%)$$
  Because the weights $0.30 + 0.45 + 0.25 = 1.00$, subtracting $0.25 \times D$ leaves the positive baseline capped at $0.75$. As a consequence:
  - No active, fully-engaged student can ever score above 75%.
  - In `core/db_manager.py`, the threshold for `"Mainly Attentive"` is $\ge 80.0\%$. Consequently, every attentive student is downgraded to `"Moderate Attention"`.
  - In `core/dashboard_ui.py`, the metric `🎯 Primarily Attentive` looks for `"Attentive"` in `primary_state`, evaluating to `0 / N` for entire classrooms of attentive students.
* **Reproduction Steps:**
  1. Inspect `eduguard_telemetry.db` record `id=6743`: `timestamp=1791272471.29, attentiveness=1.0, distraction=0.0, status='Attentive', cei=0.75`.
  2. Run `pytest tests/test_scoring.py -k test_max_attainable_cei_score_defect`.
  3. Run `npm run test:js` (test: `CEI formula capping defect: 100% focused student gets capped at 75%`). Both pass and confirm the 0.75 cap.
* **Recommended Fix:**  
  Invert distraction as positive compliance $(1 - D)$ or normalize weights:
  $$\text{CEI} = (0.30 \times P) + (0.45 \times A) + (0.25 \times (1.0 - D))$$
  Alternatively, dynamically scale positive weights such that $W_P + W_A = 1.0$ and $D$ acts as a bounded proportional penalty:
  $$\text{CEI} = \max(0.0, \min(1.0, (0.40 \times P + 0.60 \times A) \times (1.0 - 0.50 \times D)))$$

---

### BUG-02: Muting Student Microphone Falsely Flags "Audio Evasion (Silenced Lecture)"
* **Severity:** HIGH
* **Status:** VERIFIED (Reproduced in `tests/test_db_manager.py`)
* **Affected Files:** `core/db_manager.py` (lines 209-221), `components/student_room/frontend/index.html` (line 700)
* **Description:**  
  When a student mutes their microphone, the frontend sets `audioAlertStatus = "Mic Muted"`. When telemetry is processed in `db_manager.py:get_room_session_summary_ledger`, the classifier checks:
  ```python
  evasion_count = sum(1 for s in statuses if ("audio evasion" in s.lower() or "muted" in s.lower()))
  ```
  The substring check `"muted" in s.lower()` matches `"Mic Muted"`. If a student mutes their mic for $\ge 15\%$ of the session, the classifier assigns:
  ```python
  primary_state = "Audio Evasion (Silenced Lecture)"
  ```
  This punishes students who follow standard classroom etiquette (muting background noise) by branding them as evasive in permanent session ledgers and CSV downloads.
* **Reproduction Steps:**
  1. Insert telemetry records with `status = "Mic Muted"` and `status = "Attentive"`.
  2. Call `db.get_room_session_summary_ledger(room_id)`.
  3. Run `pytest tests/test_db_manager.py -k test_mic_muted_falsely_triggers_audio_evasion`. The test verifies that `primary_state` becomes `"Audio Evasion (Silenced Lecture)"`.
* **Recommended Fix:**  
  Disambiguate incoming statuses. Use distinct identifiers such as `LECTURER_AUDIO_SILENCED` vs `STUDENT_MIC_MUTED`. Modify `db_manager.py` to match exact evasion tokens:
  ```python
  evasion_count = sum(1 for s in statuses if "lecture_audio_muted" in s.lower() or "audio evasion" in s.lower())
  ```

---

### BUG-03: Threading Concurrency Race Condition in Shared State (`RuntimeError`)
* **Severity:** HIGH
* **Status:** VERIFIED (Reproduced in `tests/test_global_state_concurrency.py`)
* **Affected Files:** `core/global_state.py` (lines 14-64)
* **Description:**  
  `global_state.py` claims in its docstring: *"Thread-safe shared memory cache supporting live student counts"*. However, it uses a standard Python dictionary `state = get_shared_state()` without any `threading.Lock` or `threading.RLock`.  
  In Streamlit's multi-threaded server architecture, each browser session executes on a separate worker thread. When multiple student threads invoke `update_student_presence` (mutating dict keys) while the teacher thread executes `get_live_students` (iterating over `state[room_id].items()`), the Python runtime throws:
  ```
  RuntimeError: dictionary changed size during iteration
  ```
  This uncaught exception crashes the teacher's telemetry rendering fragment and student heartbeat processing.
* **Reproduction Steps:**
  1. Launch 4 writer threads adding unique student keys to a room in `global_state`.
  2. Launch 4 reader threads querying `get_live_students`.
  3. Run `pytest tests/test_global_state_concurrency.py`. The race condition triggers and throws `RuntimeError`.
* **Recommended Fix:**  
  Introduce a module-level `threading.RLock()`:
  ```python
  import threading

  _STATE_LOCK = threading.RLock()

  def update_student_presence(room_id: str, student_name: str, cei_score: float, status: str):
      with _STATE_LOCK:
          state = get_shared_state()
          if room_id not in state:
              state[room_id] = {}
          ...

  def get_live_students(room_id: str, timeout_seconds: int = 6) -> Dict[str, Dict[str, Any]]:
      with _STATE_LOCK:
          state = get_shared_state()
          if room_id not in state:
              return {}
          now = time.time()
          return {name: data.copy() for name, data in list(state[room_id].items())
                  if now - data["last_seen"] <= timeout_seconds}
  ```

---

### BUG-04: Telemetry Buffer Data Loss on Tab Close / Refresh (56.25% Sessions Lost)
* **Severity:** HIGH
* **Status:** VERIFIED (Verified empirically against `eduguard_telemetry.db` where 9 of 16 sessions have `NULL` end times)
* **Affected Files:** `app.py` (lines 271-283, 316-328), `core/db_manager.py` (lines 80-88)
* **Description:**  
  In `app.py`, telemetry records are buffered in `st.session_state.telemetry_buffer` and flushed in batches of 10. Because dispatches occur once every 2.5 seconds, up to 25 seconds of telemetry data sits uncommitted in memory.  
  The remaining buffer is flushed and `db.end_session(...)` is invoked **only** if the student explicitly clicks `"⏹️ Leave Classroom"` in the Streamlit sidebar. If the student closes the tab, reloads the browser, navigates back, or loses network connection:
  - All uncommitted telemetry points (< 10 records) are permanently lost.
  - `end_session` is never called; `end_time` and `avg_cei` remain `NULL` in the `sessions` table.
  - Queries on `eduguard_telemetry.db` showed **9 out of 16 recorded sessions (56.25%) were orphaned** with `end_time IS NULL`.
* **Reproduction Steps:**
  1. Execute:
     ```bash
     python -c "import sqlite3; conn = sqlite3.connect('eduguard_telemetry.db'); print(conn.execute('SELECT count(*) FROM sessions WHERE end_time IS NULL').fetchone()[0])"
     ```
  2. Result: 9 out of 16 sessions are unclosed.
* **Recommended Fix:**  
  1. Decrease telemetry batch size or commit on every dispatch using an optimized write or WAL queue.
  2. Maintain a `last_heartbeat` in SQLite sessions and implement an automatic sweep or trigger on room session end that auto-finalizes orphaned student sessions from the latest recorded telemetry timestamp:
     ```sql
     UPDATE sessions SET end_time = (
         SELECT MAX(timestamp) FROM telemetry WHERE telemetry.session_id = sessions.session_id
     ) WHERE end_time IS NULL;
     ```

---

### BUG-05: WebRTC Call Race Condition on Initialization (`null` Stream)
* **Severity:** HIGH
* **Status:** VERIFIED (Identified in `components/student_room/frontend/index.html` lines 941-946, 1042-1075)
* **Affected Files:** `components/student_room/frontend/index.html`
* **Description:**  
  When the student iframe loads, two asynchronous operations proceed in parallel:
  1. `initLocalStream()` requests camera/mic permissions, compiles MediaPipe WASM, starts camera capture, and initializes `virtualCanvasStream`.
  2. Streamlit sends `streamlit:render` message to the iframe, triggering `initStudentPeer()`.  
  Inside `initStudentPeer()`, as soon as PeerJS opens (`peer.on("open")`), it immediately invokes:
  ```javascript
  callTeacher(teacherPeerId);
  ```
  Inside `callTeacher`:
  ```javascript
  if (!peer || peer.destroyed || !virtualCanvasStream) return;
  ```
  If `initLocalStream()` has not completed (e.g. camera permission prompt delay or slow model download), `virtualCanvasStream` is `null`.  
  The function exits silently without making the call and without queuing any retry timer. As a result, the student peer is registered on PeerJS, but never connects to the teacher feed until the user manually triggers a full page reload.
* **Reproduction Steps:**
  1. Simulate camera permission prompt delay ($\approx 1000\text{ms}$).
  2. Note that `peer.open` triggers while `virtualCanvasStream === null`.
  3. `callTeacher` aborts; call is never retried.
* **Recommended Fix:**  
  Store a state flag `isStreamReady`. If `peer.open` fires before stream readiness, defer the call; when `virtualCanvasStream` becomes ready, trigger `callTeacher` if peer is open:
  ```javascript
  let isStreamReady = false;

  async function initLocalStream() {
      ...
      isStreamReady = true;
      if (peer && peer.open && !activeCall) {
          callTeacher(teacherPeerId);
      }
  }
  ```

---

### BUG-06: Student Looking UP Falsely Triggers "Looking Down" Status
* **Severity:** MEDIUM
* **Status:** VERIFIED (Reproduced in `tests/js/kinematics.test.mjs`)
* **Affected Files:** `components/student_room/frontend/index.html` (lines 644-656)
* **Description:**  
  The pitch ratio heuristic evaluates:
  $$\text{pitchRatio} = \frac{|\text{nose.y} - \text{forehead.y}|}{|\text{chin.y} - \text{nose.y}|} = \frac{dTop}{dBot}$$
  The condition is written:
  ```javascript
  if (pitchRatio < 0.45 || pitchRatio > 2.3) {
      isLookingDown = true;
      attentiveness -= 0.25;
      distraction += 0.20;
      if (!isDrowsy && !isLookingAway) statusStr = "Looking Down";
  }
  ```
  When a student looks **UP**, their forehead tilts backward and upward, causing the nose to approach the forehead in projected 2D coordinates ($dTop$ decreases) while $dBot$ increases. Thus, $\text{pitchRatio} < 0.45$ signifies **Looking Up**.  
  However, the code sets `isLookingDown = true` and `statusStr = "Looking Down"` for both extremes.
* **Reproduction Steps:**
  1. Input landmark positions representing an upward head tilt ($dTop = 0.04$, $dBot = 0.36$, ratio $= 0.111$).
  2. Run `npm run test:js` (test: `computePitchPose defect: Looking UP triggers isLookingDown = true and status "Looking Down"`).
  3. Output verifies `isLookingDown === true` and `statusStr === "Looking Down"`.
* **Recommended Fix:**  
  Separate the conditions into discrete gaze directions:
  ```javascript
  if (pitchRatio < 0.45) {
      isLookingUp = true;
      attentiveness -= 0.20;
      distraction += 0.15;
      if (!isDrowsy && !isLookingAway) statusStr = "Looking Up";
  } else if (pitchRatio > 2.3) {
      isLookingDown = true;
      attentiveness -= 0.25;
      distraction += 0.20;
      if (!isDrowsy && !isLookingAway) statusStr = "Looking Down";
  }
  ```

---

### BUG-07: Watchdog Prunes Valid Students Lacking DataChannel (STUN/NAT Fallback)
* **Severity:** MEDIUM
* **Status:** VERIFIED (Reproduced in `tests/js/webrtc_roster.test.mjs`)
* **Affected Files:** `components/teacher_room/frontend/index.html` (lines 691-750), `app.py` (lines 222-234)
* **Description:**  
  In `teacher_room/frontend/index.html`, a watchdog runs every 3 seconds:
  ```javascript
  setInterval(() => {
      const now = Date.now();
      for (const [peerId, student] of connectedStudents.entries()) {
          if (student.lastSeen && (now - student.lastSeen > 8000)) {
              removeStudentRoster(peerId);
          }
      }
  }, 3000);
  ```
  `student.lastSeen` is only refreshed inside `updateStudentTelemetryBadge()`. That function is invoked either when a DataChannel message is received, or as a fallback from `args.liveStudents` passed by Streamlit.  
  However:
  1. If a student's DataChannel fails to negotiate due to NAT/firewall constraints, no DataChannel messages arrive.
  2. In `app.py`, `teacher_room` is rendered **outside** the `@st.fragment` auto-refresh loop! Therefore, `args.liveStudents` is static and never updates unless the teacher manually triggers a full page rerun.  
  Consequently, `student.lastSeen` never updates after initial connection. After 8 seconds, the watchdog unceremoniously deletes the student from the roster table, even while the student is actively watching the lecture.
* **Reproduction Steps:**
  1. Connect a student via media stream only (simulate DataChannel blockage).
  2. Advance time past 8000ms.
  3. Observe student being removed from `roster_tbody`.
* **Recommended Fix:**  
  1. Place `teacher_room` inside the fragment or pass dynamic state down through an event trigger.
  2. Update `student.lastSeen` upon receiving video RTP packets or WebRTC media track events (`call.peerConnection.getStats()` or `track.onunmute`).

---

### BUG-08: Incomplete Regex in Peer ID Extraction Corrupts Display Names
* **Severity:** MEDIUM
* **Status:** VERIFIED (Reproduced in `tests/js/webrtc_roster.test.mjs`)
* **Affected Files:** `components/teacher_room/frontend/index.html` (lines 641-642)
* **Description:**  
  In `teacher_room/frontend/index.html`, student names are parsed from `call.peer`:
  ```javascript
  let displayName = peerId.replace(`${currentRoomId}-`, "").replace("student-", "");
  displayName = displayName.replace(/-[0-9]{3,5}$/, "") || "Student";
  ```
  In `student_room`, peer IDs are generated as:
  ```javascript
  const studentPeerId = `${cleanRoom}-student-${cleanName}-${Math.floor(Math.random() * 10000)}`;
  ```
  When `Math.random() * 10000` evaluates to a 1- or 2-digit number (e.g., 42), the regex `-[0-9]{3,5}$` fails to match. The teacher roster displays `"Alice-42"` instead of `"Alice"`. Conversely, if a student's legitimate name ends in numbers (e.g. `"Classroom-101"`), the regex strips their actual name.
* **Reproduction Steps:**
  1. Generate peer ID with 2-digit random number: `RoomA-student-Alice-42`.
  2. Parse with regex. Result is `"Alice-42"` instead of `"Alice"`.
* **Recommended Fix:**  
  Pad random numbers to a fixed length (`String(rand).padStart(4, '0')`), or transmit the student's actual display name via PeerJS call metadata:
  ```javascript
  peer.call(teacherPeerId, stream, { metadata: { studentName: currentStudentName } });
  ```

---

### BUG-09: Empty Session Defaults to 100% Score & "Mainly Attentive"
* **Severity:** MEDIUM
* **Status:** VERIFIED (Reproduced in `tests/test_db_manager.py`)
* **Affected Files:** `core/db_manager.py` (lines 198-204, 234)
* **Description:**  
  In `db_manager.py:get_room_session_summary_ledger`:
  ```python
  if stats["ceis"]:
      avg_cei = sum(stats["ceis"]) / len(stats["ceis"])
  else:
      avg_cei = 1.0  # Defaults to 100%!
  avg_cei_pct = round(avg_cei * 100, 1)
  ...
  else:
      primary_state = "Mainly Attentive" if avg_cei_pct >= 80.0 else "Moderate Attention"
  ```
  If a student joins the class, establishes a database session, and immediately disconnects or crashes before sending any telemetry batches, `stats["ceis"]` is empty. The calculation assigns `avg_cei = 1.0` (100%) and sets `primary_state = "Mainly Attentive"`. A ghost student receives a perfect grade, while a fully present student is capped at 75%.
* **Reproduction Steps:**
  1. Run `pytest tests/test_db_manager.py -k test_empty_telemetry_defaults_to_100_percent`.
  2. The test verifies that a session with 0 telemetry records produces `avg_cei_pct == 100.0` and `primary_state == "Mainly Attentive"`.
* **Recommended Fix:**  
  Default empty sessions to `0.0` and assign an explicit state:
  ```python
  if stats["ceis"]:
      avg_cei = sum(stats["ceis"]) / len(stats["ceis"])
      avg_cei_pct = round(avg_cei * 100, 1)
  else:
      avg_cei = 0.0
      avg_cei_pct = 0.0
      primary_state = "No Telemetry Recorded (Absent / Dropped)"
  ```

---

### BUG-10: Hardcoded Teacher Password (`admin123`) & Timing Attack Vulnerability
* **Severity:** HIGH
* **Status:** VERIFIED
* **Affected Files:** `app.py` (lines 95, 100-108)
* **Description:**  
  The teacher administration portal falls back to `admin123` if environment variables or Streamlit secrets are not populated, and explicitly advertises this in the UI help tooltip:
  ```python
  teacher_pass = st.text_input("Teacher Admin Password", type="password", help="Default password is 'admin123'")
  admin_password = os.getenv("TEACHER_ADMIN_PASSWORD", "admin123")
  ```
  Furthermore, the string comparison `teacher_pass != admin_password` is vulnerable to standard string comparison timing attacks.
* **Reproduction Steps:**
  1. Open teacher login screen on any fresh deployment.
  2. Enter `admin123`. Access is granted.
* **Recommended Fix:**  
  Disallow weak default passwords in production. Require `TEACHER_ADMIN_PASSWORD` to be explicitly configured. Use `hmac.compare_digest(teacher_pass, admin_password)` for constant-time validation.

---

### BUG-11: Undisclosed Live Audio Transmission in "Privacy Mode"
* **Severity:** HIGH
* **Status:** VERIFIED
* **Affected Files:** `app.py` (line 267), `components/student_room/frontend/index.html` (lines 800-815), `components/teacher_room/frontend/index.html` (lines 631-639)
* **Description:**  
  The student UI displays prominent privacy guarantees:
  - *"Privacy Mode Active: Your facial mesh is processed locally in your browser. Zero raw video is saved or transmitted."*
  - *"Zero Raw Video Transmitted"*
  While the video guarantee is upheld by rendering vector wireframes to a synthetic canvas, **the student's microphone is quietly captured (`audio: true`), attached to the synthetic canvas stream (`virtualCanvasStream.addTrack(audioTracks[0])`), and transmitted live over WebRTC to the teacher**.  
  In `teacher_room/frontend/index.html`, a hidden `<audio>` element plays incoming student audio:
  ```javascript
  if (stream && stream.getAudioTracks && stream.getAudioTracks().length > 0) {
      const audioElem = document.createElement("audio");
      audioElem.autoplay = true;
      audioElem.srcObject = stream;
      audioElem.style.display = "none";
      row.appendChild(audioElem);
  }
  ```
  Furthermore, the client runs acoustic surveillance via the Web Audio API, classifying vocal activity into "Side-Channel Speech" and logging acoustic energy to SQLite. Users are never informed that audio is captured, transmitted, and surveilled.
* **Reproduction Steps:**
  1. Review lines 800-815 of `student_room/frontend/index.html` and line 631-639 of `teacher_room/frontend/index.html`.
  2. Audio track is enabled by default upon granting browser media permission.
* **Recommended Fix:**  
  1. Default student microphone to muted (`audioTrack.enabled = false`) on join.
  2. Provide explicit, transparent disclosure in the UI regarding microphone capture and acoustic energy metrics.
  3. Allow students to opt out of microphone capture entirely if audio is not mandatory for classroom participation.

---

### BUG-12: False "1080p HD Broadcast" UI Claim (Actual Stream is 720p)
* **Severity:** LOW
* **Status:** VERIFIED
* **Affected Files:** `components/teacher_room/frontend/index.html` (lines 410, 509)
* **Description:**  
  The teacher broadcast panel header advertises `"1080p HD Broadcast"`. However, the hardware constraints passed to `getUserMedia` are:
  ```javascript
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
  ```
  1280x720 is 720p HD (Standard HD), not 1080p (Full HD).
* **Recommended Fix:**  
  Update constraints to `{ ideal: 1920 }, height: { ideal: 1080 }` if 1080p is intended, or correct the UI tag to `"720p HD Broadcast"`.

---

### BUG-13: Inconsistent Thresholds and Configuration Drift
* **Severity:** MEDIUM
* **Status:** VERIFIED
* **Affected Files:** `config.py`, `components/student_room/frontend/index.html`
* **Description:**  
  `config.py` specifies configuration constants:
  - `EAR_CONSEC_FRAMES = 2`
  - `TARGET_FPS = 30`
  - `TEMPORAL_WINDOW_SIZE = 30`  
  However, `student_room/frontend/index.html` ignores `config.py` entirely:
  - It hardcodes drowsiness threshold at 15 consecutive frames: `if (consecutiveClosedFrames >= 15)` and slight penalty at `> 4`.
  - It requests canvas capture at 25 FPS: `privacyCanvas.captureStream(25)`.
  - `TEMPORAL_WINDOW_SIZE` is never referenced anywhere in the codebase.
* **Recommended Fix:**  
  Pass configuration values from `config.py` into `student_room()` component parameters and inject them into the frontend via `args`.

---

### BUG-14: Missing SQLite Table Indexes Causing Full-Table Scans
* **Severity:** MEDIUM
* **Status:** VERIFIED (Confirmed via SQLite `EXPLAIN QUERY PLAN`)
* **Affected Files:** `core/db_manager.py` (lines 35-56)
* **Description:**  
  The database schema in `_init_db()` defines primary keys on `sessions(session_id)` and `telemetry(id)`. However, no indexes exist on foreign key `telemetry(session_id)` or filtered query column `sessions(room_id)`.  
  Running `EXPLAIN QUERY PLAN` on:
  ```sql
  SELECT * FROM sessions WHERE room_id = ?;
  SELECT * FROM telemetry WHERE session_id = ?;
  ```
  confirms `SCAN sessions` and `SCAN telemetry`. With 6,743 existing telemetry records, calculating `get_room_session_summary_ledger` results in $N$ sequential full-table scans.
* **Recommended Fix:**  
  Add indexes in `_init_db()`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id);
  CREATE INDEX IF NOT EXISTS idx_telemetry_session_id ON telemetry(session_id);
  CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp);
  ```

---

### BUG-15: Connection Leaks in SQLite Database Manager
* **Severity:** MEDIUM
* **Status:** VERIFIED (Reproduced in pytest teardown with `WinError 32: file is being used by another process`)
* **Affected Files:** `core/db_manager.py` (lines 28-32, 57-65, 66-79, 80-88, 89-107, 108-125, 126-138, 140-252)
* **Description:**  
  `DatabaseManager._get_connection()` returns a new `sqlite3.connect(...)` instance. Methods use:
  ```python
  with self._get_connection() as conn:
      ...
  ```
  In Python's `sqlite3`, using the connection as a context manager (`with conn:`) manages the **transaction** (commit/rollback); it **does not close the connection**. Because `conn.close()` is never invoked, database connections and file handles remain open indefinitely until garbage collected. On Windows, this causes file locking errors and memory bloat.
* **Recommended Fix:**  
  Use a context manager that guarantees closing, or explicitly wrap with `try ... finally: conn.close()`:
  ```python
  from contextlib import contextmanager

  @contextmanager
  def _get_connection(self):
      conn = sqlite3.connect(self.db_path, timeout=20.0, check_same_thread=False)
      conn.execute("PRAGMA journal_mode=WAL")
      conn.execute("PRAGMA synchronous=NORMAL")
      try:
          yield conn
      finally:
          conn.close()
  ```

---

### BUG-16: Nested `st.download_button` in `st.button` UI State Loss
* **Severity:** LOW
* **Status:** VERIFIED
* **Affected Files:** `app.py` (lines 249-260)
* **Description:**  
  In `app.py`:
  ```python
  if st.button("Generate CSV Report", type="primary"):
      csv_data = generate_csv_report(db, selected_session)
      if csv_data:
          st.success("Report Compiled!")
          st.download_button(
              label=f"⬇️ Download Session {selected_session} Telemetry CSV",
              data=csv_data,
              ...
          )
  ```
  In Streamlit, clicking `st.download_button` initiates a page rerun. On that rerun, `if st.button("Generate CSV Report")` evaluates to `False`. The download button can vanish or fail depending on Streamlit timing.
* **Recommended Fix:**  
  Persist report generation state in `st.session_state` or render the download button unconditionally when a session is selected.

---

### BUG-17: Rolling 100-Sample Window Distorts Final Session Average CEI
* **Severity:** LOW
* **Status:** VERIFIED
* **Affected Files:** `app.py` (lines 276, 329-332)
* **Description:**  
  When a student clicks `"Leave Classroom"`, `avg_cei` stored in `sessions` table is computed as:
  ```python
  avg_cei = float(np.mean(st.session_state.cei_history)) if len(st.session_state.cei_history) > 0 else 0.0
  ```
  However, line 330 limits `cei_history` to 100 items (`st.session_state.cei_history.pop(0)`). At 2.5s per dispatch, 100 items represents only the final 4.1 minutes of the lecture. For a 1-hour lecture, the stored average reflects only the final 4 minutes rather than the complete session.
* **Recommended Fix:**  
  Calculate the cumulative session average across all inserted telemetry records:
  ```python
  avg_cei = db.get_session_average_cei(st.session_state.active_session_id)
  ```

---

### BUG-18: External Public Cloud PeerJS Broker & Unpinned CDNs Without SRI
* **Severity:** HIGH
* **Status:** SUSPECTED RISK
* **Affected Files:** `components/student_room/frontend/index.html` (lines 8-15), `components/teacher_room/frontend/index.html` (line 8)
* **Description:**  
  1. `new Peer(id, { config: { iceServers: [...] } })` does not specify a private signaling server. By default, PeerJS connects to the public cloud server hosted at `0.peerjs.com`. All classroom room identifiers, student peer IDs, and WebRTC signaling exchange metadata are routed through external, third-party infrastructure.
  2. Scripts from `unpkg.com` and `jsdelivr.net` are loaded without Subresource Integrity (SRI) hashes (`integrity="..."`). If an upstream CDN account is compromised, malicious JavaScript could capture raw video frames directly from `rawWebcam` before canvas anonymization.
* **Recommended Fix:**  
  Self-host `peerjs-server` on the EduGuard backend or provide local static bundles for MediaPipe and PeerJS with verified SRI hashes.

---

### BUG-19: Unauthenticated Room Access & Student Impersonation
* **Severity:** MEDIUM
* **Status:** SUSPECTED RISK
* **Affected Files:** `app.py` (lines 122-141)
* **Description:**  
  Joining a room requires only a URL parameter `?room=EduGuard-Math101-abcd12` and any typed string for `student_name`. There are no tokens, student authentication, or uniqueness guarantees. An attacker or disruptive student can join under any peer's name, overwriting their state in `global_state` and contaminating telemetry logs.
* **Recommended Fix:**  
  Issue signed HMAC tokens in student join URLs or integrate standard LMS / LTI authentication.

---

### BUG-20: Disconnect Notification Gap on Teacher Session Termination
* **Severity:** LOW
* **Status:** SUSPECTED RISK
* **Affected Files:** `app.py` (lines 172-175)
* **Description:**  
  When a teacher clicks `"🛑 Logout / End Class Session"`, `st.session_state.session_ended = True` is updated only for the teacher's session. No signal is broadcast to connected students. Student browsers continue capturing webcam frames, running MediaPipe models, and attempting to transmit telemetry to a closed room.
* **Recommended Fix:**  
  Transmit a room closure signal via `telemetryDataChannel.send({ type: "room_closed" })` and set a room termination flag in `global_state`.

---

## 4. Automated Testing Framework

A testing framework has been established covering both Python backend logic and browser-side JavaScript kinematics:

### Framework Directory Structure:
```
Msa/
├── tests/
│   ├── __init__.py
│   ├── test_scoring.py                  # CEI mathematical bounds & weight verification
│   ├── test_global_state_concurrency.py # Multi-threaded concurrency race condition check
│   ├── test_db_manager.py               # SQLite lifecycle, empty session bug, evasion bug
│   ├── test_reporting.py                # CSV report generator edge cases
│   ├── test_config_sync.py              # Configuration drift detector
│   └── js/
│       ├── scoring.test.mjs             # JavaScript CEI formula ceiling & audio penalty tests
│       ├── kinematics.test.mjs          # computeEAR and pitch pose heuristic tests
│       └── webrtc_roster.test.mjs       # Peer ID parsing & watchdog heartbeat pruning tests
├── scripts/
│   └── lint_frontend.js                 # Node VM syntax and structural validator for inline HTML scripts
├── package.json                         # npm test runner definitions
└── AUDIT.md                             # Comprehensive audit report (this document)
```

### Execution Commands:
- **Run Python Test Suite:**
  ```bash
  pytest -v
  ```
- **Run Browser-Side JavaScript Test Suite:**
  ```bash
  npm run test:js
  # Or directly: node --test tests/js/*.test.mjs
  ```
- **Run Frontend Script Linting:**
  ```bash
  npm run lint:js
  ```
- **Run Python Flake8 Linter:**
  ```bash
  flake8 core/ config.py tests/ --statistics
  ```

### Test Results Summary:
- **Python Tests (`pytest`)**: 10 tests collected, **10 passed** (demonstrating and verifying defects).
- **JavaScript Tests (`node:test`)**: 7 tests collected, **7 passed** (demonstrating client-side defects).
- **Frontend Syntax Linter (`lint_frontend.js`)**: 2 HTML files evaluated, **0 syntax errors**.

---

## 5. Prioritized Remediation Roadmap

1. **Immediate (Sprint 1 - High Impact / Zero Architecture Risk):**
   - Correct the CEI scoring formula in `student_room/frontend/index.html` line 719 to allow full 100% score range.
   - Fix `db_manager.py` evasion keyword matching to prevent `"Mic Muted"` from branding polite students with `"Audio Evasion"`.
   - Add `threading.RLock()` to `core/global_state.py` to eliminate `RuntimeError: dictionary changed size during iteration`.
   - Add SQLite table indexes on `telemetry(session_id)` and `sessions(room_id)`.
   - Fix pitch ratio heuristic in `student_room` so looking UP is accurately labeled `"Looking Up"`.
2. **Intermediate (Sprint 2 - Data Integrity & Networking Reliability):**
   - Implement `virtualCanvasStream` readiness callback in `student_room` to prevent premature WebRTC calls.
   - Update `DatabaseManager` to explicitly close SQLite connections and prevent resource leaks.
   - Correct student peer ID generation with padded random integers or call metadata.
   - Synchronize `config.py` thresholds with frontend parameters.
3. **Long-Term (Sprint 3 - Security & Compliance):**
   - Replace default `admin123` with mandatory environment variable and constant-time string comparison.
   - Update UI disclosures to transparently state microphone audio streaming and acoustic energy tracking.
   - Deploy private `peerjs-server` signaling instance to eliminate third-party public cloud metadata leakage.
