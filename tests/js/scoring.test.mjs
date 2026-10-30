import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EngagementEngine,
    calculateCEI,
    computeEAR,
    computeHeadPose,
    assessObservationQuality,
    applyTimeAwareEMA,
    DEFAULT_CONFIG,
    LANDMARK_INDICES
} from '../../core/engagement.mjs';

// --- Historical Defect Verification (Audit Reference) ---
function legacyComputeCEIScore(presence, attentiveness, distraction, isLecturerAudioSilenced = false) {
    attentiveness = Math.max(0.0, Math.min(1.0, attentiveness));
    distraction = Math.max(0.0, Math.min(1.0, distraction));
    const rawCEI = (0.30 * presence) + (0.45 * attentiveness) - (0.25 * distraction);
    let ceiScore = Math.max(0.0, Math.min(1.0, rawCEI));

    if (isLecturerAudioSilenced) {
        ceiScore = Math.max(0.0, ceiScore * 0.40);
        attentiveness = Math.max(0.0, attentiveness - 0.60);
        distraction = Math.min(1.0, distraction + 0.50);
    }

    return { ceiScore, attentiveness, distraction };
}

test('Historical Audit: Legacy CEI formula capped 100% focused student at 75%', () => {
    // Legacy formula: 0.30*1.0 + 0.45*1.0 - 0.25*0.0 = 0.75
    const result = legacyComputeCEIScore(1.0, 1.0, 0.0);
    assert.equal(result.ceiScore, 0.75);
    assert.notEqual(result.ceiScore, 1.0);
});

// Helper to create synthetic 468 MediaPipe landmarks
function createMockFaceLandmarks(overrides = {}) {
    const landmarks = [];
    for (let i = 0; i < 468; i++) {
        landmarks.push({ x: 0.5, y: 0.5, z: 0.0 });
    }

    // Default Attentive Geometry in normalized [0, 1] coords
    // Forehead: index 10, Nose: index 1, Chin: index 152
    landmarks[LANDMARK_INDICES.FOREHEAD] = { x: 0.50, y: 0.25, z: 0.0 };
    landmarks[LANDMARK_INDICES.NOSE_TIP] = { x: 0.50, y: 0.45, z: 0.0 };
    landmarks[LANDMARK_INDICES.CHIN] = { x: 0.50, y: 0.70, z: 0.0 };

    // Outer eye corners: right 33, left 263
    landmarks[LANDMARK_INDICES.RIGHT_EYE_OUTER] = { x: 0.35, y: 0.38, z: 0.0 };
    landmarks[LANDMARK_INDICES.LEFT_EYE_OUTER] = { x: 0.65, y: 0.38, z: 0.0 };

    // Right Eye: [33, 160, 158, 133, 153, 144]
    // p1=(0.35, 0.38), p4=(0.45, 0.38) -> h = 0.10 * 640 = 64px
    // p2=(0.38, 0.35), p6=(0.38, 0.41) -> v1 = 0.06 * 480 = 28.8px
    // p3=(0.42, 0.35), p5=(0.42, 0.41) -> v2 = 0.06 * 480 = 28.8px
    // EAR = (28.8 + 28.8) / (2 * 64) = 57.6 / 128 = 0.45 (open eyes, well above 0.21 threshold)
    landmarks[33] = { x: 0.35, y: 0.38, z: 0.0 };
    landmarks[160] = { x: 0.38, y: 0.35, z: 0.0 };
    landmarks[158] = { x: 0.42, y: 0.35, z: 0.0 };
    landmarks[133] = { x: 0.45, y: 0.38, z: 0.0 };
    landmarks[153] = { x: 0.42, y: 0.41, z: 0.0 };
    landmarks[144] = { x: 0.38, y: 0.41, z: 0.0 };

    // Left Eye: [362, 385, 387, 263, 373, 380]
    landmarks[362] = { x: 0.55, y: 0.38, z: 0.0 };
    landmarks[385] = { x: 0.58, y: 0.35, z: 0.0 };
    landmarks[387] = { x: 0.62, y: 0.35, z: 0.0 };
    landmarks[263] = { x: 0.65, y: 0.38, z: 0.0 };
    landmarks[373] = { x: 0.62, y: 0.41, z: 0.0 };
    landmarks[380] = { x: 0.58, y: 0.41, z: 0.0 };

    // Apply any explicit overrides
    for (const [idx, pt] of Object.entries(overrides)) {
        landmarks[Number(idx)] = { ...landmarks[Number(idx)], ...pt };
    }

    return landmarks;
}

// ==========================================
// 1. Ideal Attention Test
// ==========================================
test('Ideal attention: Normalized CEI reaches 1.0 (100%) when student is fully attentive and present', () => {
    // 1. Direct mathematical formula check
    const directCEI = calculateCEI(1.0, 1.0, 0.0);
    assert.equal(directCEI, 1.0, 'clamp(0.30*1 + 0.45*1 + 0.25*(1-0)) must equal 1.0');

    // 2. Full engine pipeline with realistic mock face landmarks
    const engine = new EngagementEngine({ smoothing: { enabled: false } });
    const landmarks = createMockFaceLandmarks();
    const result = engine.processFrame(landmarks, 1000);

    assert.equal(result.is_quality_sufficient, true);
    assert.equal(result.presence, 1.0);
    assert.equal(result.attentiveness, 1.0);
    assert.equal(result.distraction, 0.0);
    assert.equal(result.raw_cei, 1.0, 'Raw CEI for ideal attentive student must be 1.0');
    assert.equal(result.cei_score, 1.0, 'CEI score for ideal attentive student must be 1.0 (100%)');
    assert.equal(result.status, 'Attentive');
});

// ==========================================
// 2. Absence Test
// ==========================================
test('Absence: CEI is explicitly forced to 0.0 when no face is detected', () => {
    // 1. Direct mathematical formula check
    assert.equal(calculateCEI(0.0, 1.0, 0.0), 0.0, 'CEI must be 0.0 when presence is 0');
    assert.equal(calculateCEI(null, 1.0, 0.0), 0.0, 'CEI must be 0.0 when presence is null');
    assert.equal(calculateCEI(undefined, 1.0, 0.0), 0.0, 'CEI must be 0.0 when presence is undefined');

    // 2. Engine pipeline with null / empty landmarks
    const engine = new EngagementEngine({ smoothing: { enabled: false } });
    const nullResult = engine.processFrame(null, 1000);
    assert.equal(nullResult.presence, 0.0);
    assert.equal(nullResult.raw_cei, 0.0, 'Raw CEI must be explicitly 0.0 when face is absent');
    assert.equal(nullResult.status, 'Subject Absent');

    const emptyResult = engine.processFrame([], 1000);
    assert.equal(emptyResult.presence, 0.0);
    assert.equal(emptyResult.raw_cei, 0.0);
    assert.equal(emptyResult.status, 'Subject Absent');
});

// ==========================================
// 3. Distraction Test (Looking Away / Down / Up)
// ==========================================
test('Distraction: Diverted gaze (yaw/pitch) increases distraction and penalizes attentiveness', () => {
    const engine = new EngagementEngine({ smoothing: { enabled: false } });

    // Scenario A: Looking Away (Horizontal Yaw asymmetry)
    // Shift nose tip heavily to the left: dL = |0.65 - 0.38| = 0.27; dR = |0.38 - 0.35| = 0.03 -> yawRatio = 9.0 (> 2.30)
    const lookingAwayLandmarks = createMockFaceLandmarks({
        [LANDMARK_INDICES.NOSE_TIP]: { x: 0.38, y: 0.45, z: 0.0 }
    });
    const awayResult = engine.processFrame(lookingAwayLandmarks, 1000);

    assert.equal(awayResult.is_looking_away, true);
    assert.equal(awayResult.status, 'Looking Away');
    assert.equal(awayResult.attentiveness, 0.65, 'Attentiveness reduced from 1.0 to 0.65 (-0.35)');
    assert.equal(awayResult.distraction, 0.30, 'Distraction increased from 0.0 to 0.30 (+0.30)');
    // CEI = 0.30*1.0 + 0.45*0.65 + 0.25*(1 - 0.30) = 0.30 + 0.2925 + 0.175 = 0.7675
    assert.equal(awayResult.raw_cei, 0.7675);

    // Scenario B: Looking Down (Pitch asymmetry)
    // Nose close to chin: dTop = |0.65 - 0.25| = 0.40; dBot = |0.70 - 0.65| = 0.05 -> pitchRatio = 8.0 (> 2.30)
    const lookingDownLandmarks = createMockFaceLandmarks({
        [LANDMARK_INDICES.NOSE_TIP]: { x: 0.50, y: 0.65, z: 0.0 }
    });
    const downResult = engine.processFrame(lookingDownLandmarks, 2000);

    assert.equal(downResult.is_looking_down, true);
    assert.equal(downResult.status, 'Looking Down');
    // Pedagogical Rule: Do not equate looking down with disengagement (observable head-pose state)
    assert.equal(downResult.attentiveness, 1.0, 'Looking down does not penalize attentiveness by default');
    assert.equal(downResult.distraction, 0.0, 'Looking down does not register as distraction by default');

    // Scenario C: Configurable legacy penalty mode when penalizeLookingDown is enabled
    const penalizedEngine = new EngagementEngine({
        smoothing: { enabled: false },
        thresholds: { penalizeLookingDown: true }
    });
    const penalizedDownResult = penalizedEngine.processFrame(lookingDownLandmarks, 3000);
    assert.equal(penalizedDownResult.attentiveness, 0.75, 'Attentiveness reduced by -0.25 when penalizeLookingDown is enabled');
    assert.equal(penalizedDownResult.distraction, 0.20, 'Distraction increased by +0.20 when penalizeLookingDown is enabled');
});

// ==========================================
// 4. Drowsiness Test (EAR & Sustained Closure)
// ==========================================
test('Drowsiness: Sustained eye closure triggers drowsiness alert while micro-blinks are debounced', () => {
    const engine = new EngagementEngine({ smoothing: { enabled: false } });

    // Create closed eyes landmarks (y coordinates collapsed so EAR ~ 0)
    const closedEyeLandmarks = createMockFaceLandmarks({
        33: { x: 0.35, y: 0.38, z: 0.0 },
        160: { x: 0.38, y: 0.38, z: 0.0 }, // collapsed to 0.38
        158: { x: 0.42, y: 0.38, z: 0.0 },
        133: { x: 0.45, y: 0.38, z: 0.0 },
        153: { x: 0.42, y: 0.38, z: 0.0 },
        144: { x: 0.38, y: 0.38, z: 0.0 },

        362: { x: 0.55, y: 0.38, z: 0.0 },
        385: { x: 0.58, y: 0.38, z: 0.0 },
        387: { x: 0.62, y: 0.38, z: 0.0 },
        263: { x: 0.65, y: 0.38, z: 0.0 },
        373: { x: 0.62, y: 0.38, z: 0.0 },
        380: { x: 0.58, y: 0.38, z: 0.0 }
    });

    // Feed 3 consecutive closed frames: natural micro-blink (< 4 frames) -> NOT drowsy, 0 penalty
    for (let f = 1; f <= 3; f++) {
        const res = engine.processFrame(closedEyeLandmarks, f * 33);
        assert.equal(res.is_drowsy, false);
        assert.equal(res.attentiveness, 1.0, 'Natural micro-blink must not penalize attentiveness');
    }

    // Continue feeding up to frame 15: reaches drowsiness threshold
    let lastRes = null;
    for (let f = 4; f <= 15; f++) {
        lastRes = engine.processFrame(closedEyeLandmarks, f * 33);
    }

    assert.equal(lastRes.is_drowsy, true, 'At 15 consecutive closed frames, student must be flagged as drowsy');
    assert.equal(lastRes.status, 'Drowsy (Eyes Closed)');
    assert.equal(lastRes.attentiveness, 0.50, 'Attentiveness receives -0.50 drowsiness deduction');
});

// ==========================================
// 5. Missing Landmarks & Insufficient Quality Test
// ==========================================
test('Insufficient quality: Missing or corrupt landmarks are marked as Unknown, NOT low engagement', () => {
    const engine = new EngagementEngine();

    // 1. Partial array (< 468 landmarks)
    const partialLandmarks = new Array(200).fill({ x: 0.5, y: 0.5, z: 0.0 });
    const partialResult = engine.processFrame(partialLandmarks, 1000);

    assert.equal(partialResult.is_quality_sufficient, false);
    assert.equal(partialResult.is_unknown, true);
    assert.equal(partialResult.raw_cei, null, 'Raw CEI must be null for insufficient observation');
    assert.equal(partialResult.status, 'Observation Insufficient');

    // 2. Critical landmarks containing NaN / missing coordinates
    const corruptLandmarks = createMockFaceLandmarks({
        [LANDMARK_INDICES.NOSE_TIP]: { x: NaN, y: 0.45, z: 0.0 }
    });
    const corruptResult = engine.processFrame(corruptLandmarks, 1033);

    assert.equal(corruptResult.is_quality_sufficient, false);
    assert.equal(corruptResult.is_unknown, true);
    assert.equal(corruptResult.status, 'Observation Insufficient');

    // 3. Face too small / distant (interocular distance < 15px)
    const tinyFaceLandmarks = createMockFaceLandmarks({
        [LANDMARK_INDICES.RIGHT_EYE_OUTER]: { x: 0.495, y: 0.38, z: 0.0 },
        [LANDMARK_INDICES.LEFT_EYE_OUTER]: { x: 0.505, y: 0.38, z: 0.0 }, // distance = 0.01 * 640 = 6.4px (< 15px)
        [LANDMARK_INDICES.FOREHEAD]: { x: 0.50, y: 0.48, z: 0.0 },
        [LANDMARK_INDICES.CHIN]: { x: 0.50, y: 0.50, z: 0.0 }
    });
    const tinyResult = engine.processFrame(tinyFaceLandmarks, 1066);

    assert.equal(tinyResult.is_quality_sufficient, false);
    assert.equal(tinyResult.is_unknown, true);
    assert.equal(tinyResult.status, 'Observation Insufficient');
});

// ==========================================
// 6. Score Bounds Test (Clamping)
// ==========================================
test('Score bounds: CEI is strictly clamped to [0.0, 1.0] under extreme values', () => {
    // Extreme positive values
    assert.equal(calculateCEI(5.0, 10.0, -2.0), 1.0);
    // Extreme negative values with absent presence
    assert.equal(calculateCEI(-1.0, -10.0, 20.0), 0.0);
    // Boundary zeros
    assert.equal(calculateCEI(0.0, 0.0, 0.0), 0.0);
    // Boundary ones
    assert.equal(calculateCEI(1.0, 1.0, 0.0), 1.0);
    // Fully distracted (presence=1, attentiveness=0, distraction=1)
    assert.equal(calculateCEI(1.0, 0.0, 1.0), 0.30); // 0.30*1 + 0.45*0 + 0.25*(1-1) = 0.30
});

// ==========================================
// 7. Configurable Weights Test
// ==========================================
test('Configurable weights: Allows custom heuristic starting weights and updates inference', () => {
    const customWeights = {
        presence: 0.20,
        attentiveness: 0.50,
        distraction: 0.30
    };

    // Calculate with custom weights:
    // P=1.0, A=1.0, D=0.0 -> 0.20(1) + 0.50(1) + 0.30(1) = 1.0
    assert.equal(calculateCEI(1.0, 1.0, 0.0, customWeights), 1.0);

    // P=1.0, A=0.5, D=0.2 -> 0.20(1) + 0.50(0.5) + 0.30(0.8) = 0.20 + 0.25 + 0.24 = 0.69
    assert.equal(Math.round(calculateCEI(1.0, 0.5, 0.2, customWeights) * 100), 69);

    // Verify engine accepts custom weights via constructor and setWeights
    const engine = new EngagementEngine({ weights: customWeights, smoothing: { enabled: false } });
    assert.deepEqual(engine.getWeights(), customWeights);

    engine.setWeights({ presence: 0.40, attentiveness: 0.40, distraction: 0.20 });
    assert.equal(engine.getWeights().presence, 0.40);
});

// ==========================================
// 8. Time-Aware Temporal Smoothing (EMA) Test
// ==========================================
test('Temporal smoothing: Time-aware EMA smoothly bridges frames while preserving raw and smoothed scores', () => {
    const tau = 1.5; // 1.5 seconds smoothing window

    // Initial frame at t=0s, raw=1.0
    let smoothed = applyTimeAwareEMA(null, 1.0, 0, tau);
    assert.equal(smoothed, 1.0, 'First frame initializes immediately without lag');

    // Second frame 33ms later (~30fps) with sudden drop raw=0.0
    const dt = 0.033;
    const alpha = 1.0 - Math.exp(-dt / tau); // ~0.0217
    smoothed = applyTimeAwareEMA(smoothed, 0.0, dt, tau);

    // Expect smoothed to drop only slightly (~0.978)
    assert.ok(smoothed > 0.95 && smoothed < 0.99, `Expected smoothed around 0.978, got ${smoothed}`);

    // Verify full engine preserves both raw_cei and smoothed_cei
    const engine = new EngagementEngine({ smoothing: { enabled: true, tauSeconds: 1.5 } });
    const landmarks = createMockFaceLandmarks();

    const frame1 = engine.processFrame(landmarks, 1000);
    assert.equal(frame1.raw_cei, 1.0);
    assert.equal(frame1.smoothed_cei, 1.0);

    // Student momentarily turns away (raw drops to ~0.7675)
    const turnAway = createMockFaceLandmarks({
        [LANDMARK_INDICES.NOSE_TIP]: { x: 0.38, y: 0.45, z: 0.0 }
    });
    const frame2 = engine.processFrame(turnAway, 1033);

    assert.equal(frame2.raw_cei, 0.7675, 'Raw score immediately reflects instantaneous distraction');
    assert.ok(frame2.smoothed_cei > 0.95, 'Smoothed score gracefully buffers momentary glance away');
    assert.notEqual(frame2.raw_cei, frame2.smoothed_cei);
});

// ==========================================
// 9. Separate Audio Muting State Test
// ==========================================
test('Audio separation: Muting lecturer audio is tracked as separate state and does NOT penalize visual CEI', () => {
    const engine = new EngagementEngine({ smoothing: { enabled: false } });
    const landmarks = createMockFaceLandmarks();

    // Student has lecturer audio unmuted
    const unmuted = engine.processFrame(landmarks, 1000, { isLecturerAudioMuted: false });
    assert.equal(unmuted.cei_score, 1.0);
    assert.equal(unmuted.attentiveness, 1.0);
    assert.equal(unmuted.distraction, 0.0);
    assert.equal(unmuted.is_lecturer_audio_muted, false);

    // Student mutes lecturer audio:
    // MUST NOT penalize attentiveness or CEI! Muted audio is tracked separately.
    const muted = engine.processFrame(landmarks, 2000, { isLecturerAudioMuted: true });
    assert.equal(muted.cei_score, 1.0, 'CEI must remain 1.0; muting audio does not penalize visual engagement');
    assert.equal(muted.attentiveness, 1.0, 'Attentiveness must remain 1.0');
    assert.equal(muted.distraction, 0.0, 'Distraction must remain 0.0');
    assert.equal(muted.is_lecturer_audio_muted, true, 'is_lecturer_audio_muted must be true');
    assert.equal(muted.audio_status, 'Lecturer Audio Muted');
});
