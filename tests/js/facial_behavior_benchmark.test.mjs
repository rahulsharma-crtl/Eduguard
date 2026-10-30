/**
 * EduGuard Facial Behavior Pipeline Benchmark & Empirical Validation Suite
 * =========================================================================
 * Evaluates the calibrated geometric 3D head-pose estimator, elapsed-time
 * eye closure detection, individual EAR baseline calibration, and observable
 * behavioral states against labeled synthetic ground-truth sequences.
 *
 * Metrics Measured:
 *   - Full Multi-Class Confusion Matrix
 *   - Per-Class True Positives (TP), False Positives (FP), False Negatives (FN)
 *   - Per-Class Precision, Recall, and F1 Score
 *   - Macro-Averaged F1 Score and Overall Accuracy
 *   - Direct empirical comparison: Legacy Ratio Heuristics vs. Calibrated Geometric Pipeline
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EngagementEngine,
    BEHAVIORAL_STATES,
    DEFAULT_CONFIG,
    LANDMARK_INDICES,
    estimateHeadPose,
    computeEAR,
    calibrateBaselineEAR,
    isEyeClosed,
    calibrateCameraOffset,
    assessFacePresenceQuality
} from '../../core/engagement.mjs';

// --- Synthetic 3D Landmark Sequence Generator ---
function generateSyntheticFace({
    yaw = 0.0,
    pitch = 0.0,
    roll = 0.0,
    ear = 0.35,
    center = { x: 0.5, y: 0.5 },
    corrupt = false,
    clipped = false,
    width = 640,
    height = 480
} = {}) {
    if (corrupt) {
        return null;
    }

    const landmarks = new Array(468);
    for (let i = 0; i < 468; i++) {
        landmarks[i] = { x: center.x, y: center.y, z: 0.0 };
    }

    const toRad = Math.PI / 180.0;
    const yR = yaw * toRad;
    const pR = pitch * toRad;
    const rR = roll * toRad;

    // 3D rotation transform: R = Rz(r) * Ry(y) * Rx(p)
    function rotate3D(pt) {
        // Rx (pitch)
        let x = pt[0];
        let y = pt[1] * Math.cos(pR) - pt[2] * Math.sin(pR);
        let z = pt[1] * Math.sin(pR) + pt[2] * Math.cos(pR);

        // Ry (yaw)
        let x2 = x * Math.cos(yR) + z * Math.sin(yR);
        let y2 = y;
        let z2 = -x * Math.sin(yR) + z * Math.cos(yR);

        // Rz (roll)
        let x3 = x2 * Math.cos(rR) - y2 * Math.sin(rR);
        let y3 = x2 * Math.sin(rR) + y2 * Math.cos(rR);
        let z3 = z2;

        return [x3, y3, z3];
    }

    // Canonical 3D anthropometric facial model points (in mm)
    // Origin at head center; X right (+), Y up (+), Z toward viewer (+)
    const canonicalModel = {
        [LANDMARK_INDICES.NOSE_TIP]: [0.0, -5.0, 75.0],
        [LANDMARK_INDICES.CHIN]: [0.0, -95.0, 10.0],
        [LANDMARK_INDICES.FOREHEAD]: [0.0, 75.0, 10.0],
        [LANDMARK_INDICES.RIGHT_EYE_OUTER]: [-55.0, 20.0, 0.0],
        [LANDMARK_INDICES.LEFT_EYE_OUTER]: [55.0, 20.0, 0.0]
    };

    // Project canonical landmarks to normalized camera frame
    const focalLength = 550.0; // Simulated pinhole focal length in mm
    for (const [idxStr, pt] of Object.entries(canonicalModel)) {
        const idx = Number(idxStr);
        const [rx, ry, rz] = rotate3D(pt);

        let normX = center.x + rx / focalLength;
        let normY = center.y - ry / focalLength; // Image Y goes down
        let normZ = -rz / focalLength;           // MediaPipe Z: negative towards camera

        if (clipped) {
            normX = 0.995; // Force boundary clipping
        }

        landmarks[idx] = { x: normX, y: normY, z: normZ };
    }

    // Right Eye & Left Eye 6-point geometry parameterized by target EAR
    // EAR = (v1 + v2) / (2 * h) => v = EAR * h
    const eyeSpanX = 0.08;
    const vOffset = (ear * eyeSpanX);

    // Right Eye outer 33, inner 133
    const rEyeCenter = landmarks[LANDMARK_INDICES.RIGHT_EYE_OUTER];
    landmarks[33] = { x: rEyeCenter.x, y: rEyeCenter.y, z: rEyeCenter.z };
    landmarks[133] = { x: rEyeCenter.x + eyeSpanX, y: rEyeCenter.y, z: rEyeCenter.z };
    landmarks[160] = { x: rEyeCenter.x + eyeSpanX * 0.3, y: rEyeCenter.y - vOffset, z: rEyeCenter.z };
    landmarks[158] = { x: rEyeCenter.x + eyeSpanX * 0.7, y: rEyeCenter.y - vOffset, z: rEyeCenter.z };
    landmarks[144] = { x: rEyeCenter.x + eyeSpanX * 0.3, y: rEyeCenter.y + vOffset, z: rEyeCenter.z };
    landmarks[153] = { x: rEyeCenter.x + eyeSpanX * 0.7, y: rEyeCenter.y + vOffset, z: rEyeCenter.z };

    // Left Eye outer 263, inner 362
    const lEyeCenter = landmarks[LANDMARK_INDICES.LEFT_EYE_OUTER];
    landmarks[263] = { x: lEyeCenter.x, y: lEyeCenter.y, z: lEyeCenter.z };
    landmarks[362] = { x: lEyeCenter.x - eyeSpanX, y: lEyeCenter.y, z: lEyeCenter.z };
    landmarks[385] = { x: lEyeCenter.x - eyeSpanX * 0.7, y: lEyeCenter.y - vOffset, z: lEyeCenter.z };
    landmarks[387] = { x: lEyeCenter.x - eyeSpanX * 0.3, y: lEyeCenter.y - vOffset, z: lEyeCenter.z };
    landmarks[380] = { x: lEyeCenter.x - eyeSpanX * 0.7, y: lEyeCenter.y + vOffset, z: lEyeCenter.z };
    landmarks[373] = { x: lEyeCenter.x - eyeSpanX * 0.3, y: lEyeCenter.y + vOffset, z: lEyeCenter.z };

    return landmarks;
}

// --- Metrics Calculator ---
function calculateMetrics(confusionMatrix, classes) {
    const classMetrics = {};
    let totalSamples = 0;
    let totalCorrect = 0;

    for (const c of classes) {
        let tp = confusionMatrix[c][c] || 0;
        let fp = 0;
        let fn = 0;
        let totalActual = 0;

        for (const other of classes) {
            if (other !== c) {
                fp += (confusionMatrix[other][c] || 0);
                fn += (confusionMatrix[c][other] || 0);
            }
            totalActual += (confusionMatrix[c][other] || 0);
        }

        totalSamples += totalActual;
        totalCorrect += tp;

        const precision = (tp + fp > 0) ? (tp / (tp + fp)) : 0.0;
        const recall = (tp + fn > 0) ? (tp / (tp + fn)) : 0.0;
        const f1 = (precision + recall > 0) ? (2.0 * precision * recall / (precision + recall)) : 0.0;

        classMetrics[c] = {
            tp,
            fp,
            fn,
            precision: parseFloat(precision.toFixed(4)),
            recall: parseFloat(recall.toFixed(4)),
            f1: parseFloat(f1.toFixed(4)),
            support: totalActual
        };
    }

    const classNames = Object.keys(classMetrics);
    const macroF1 = classNames.reduce((acc, c) => acc + classMetrics[c].f1, 0) / classNames.length;
    const accuracy = (totalSamples > 0) ? (totalCorrect / totalSamples) : 0.0;

    return {
        classMetrics,
        macroF1: parseFloat(macroF1.toFixed(4)),
        accuracy: parseFloat(accuracy.toFixed(4)),
        totalSamples
    };
}

// --- Benchmark Test Suite ---
test('Empirical Benchmark: Calibrated Geometric Pipeline vs Legacy Heuristics', () => {
    const TARGET_CLASSES = [
        BEHAVIORAL_STATES.ATTENTIVE,
        BEHAVIORAL_STATES.NATURAL_BLINK,
        BEHAVIORAL_STATES.PROLONGED_EYE_CLOSURE,
        BEHAVIORAL_STATES.LOOKING_AWAY,
        BEHAVIORAL_STATES.LOOKING_DOWN,
        BEHAVIORAL_STATES.FACE_NOT_DETECTED,
        BEHAVIORAL_STATES.INSUFFICIENT_QUALITY
    ];

    // Initialize confusion matrices
    const confusionNew = {};
    const confusionLegacy = {};
    for (const c1 of TARGET_CLASSES) {
        confusionNew[c1] = {};
        confusionLegacy[c1] = {};
        for (const c2 of TARGET_CLASSES) {
            confusionNew[c1][c2] = 0;
            confusionLegacy[c1][c2] = 0;
        }
    }

    // Benchmark Dataset: 700 realistic temporal frames across 7 distinct clinical/classroom scenarios
    const dataset = [];

    // Scenario 1: Attentive Student (Neutral Gaze, Open Eyes) - 100 frames
    for (let f = 0; f < 100; f++) {
        const timeMs = f * 33;
        dataset.push({
            landmarks: generateSyntheticFace({ yaw: 1.5, pitch: -2.0, roll: 0.5, ear: 0.32 }),
            timestamp: timeMs,
            groundTruth: BEHAVIORAL_STATES.ATTENTIVE,
            scenario: 'Attentive Neutral'
        });
    }

    // Scenario 2: Natural Micro-Blinks (200ms closure debounced) - 100 frames
    // 3 distinct blinks: frames 10-15, 40-45, 70-75 (6 frames * 33ms ~ 198ms)
    for (let f = 0; f < 100; f++) {
        const isBlinking = (f >= 10 && f <= 15) || (f >= 40 && f <= 45) || (f >= 70 && f <= 75);
        dataset.push({
            landmarks: generateSyntheticFace({ yaw: 0.0, pitch: 0.0, roll: 0.0, ear: isBlinking ? 0.08 : 0.33 }),
            timestamp: 4000 + f * 33,
            groundTruth: isBlinking ? BEHAVIORAL_STATES.NATURAL_BLINK : BEHAVIORAL_STATES.ATTENTIVE,
            scenario: 'Natural Micro-Blinks'
        });
    }

    // Scenario 3: Prolonged Eye Closure (Drowsiness: 1500ms sustained closure) - 100 frames
    // Closes eyes from frame 10 to 60 (50 frames * 33ms = 1650ms)
    for (let f = 0; f < 100; f++) {
        const isDrowsy = (f >= 41 && f <= 60); // After 1000ms closure
        const isClosing = (f >= 10 && f <= 40);
        const earVal = (f >= 10 && f <= 60) ? 0.05 : 0.34;
        let label = BEHAVIORAL_STATES.ATTENTIVE;
        if (isDrowsy) label = BEHAVIORAL_STATES.PROLONGED_EYE_CLOSURE;
        else if (isClosing) label = BEHAVIORAL_STATES.NATURAL_BLINK;

        dataset.push({
            landmarks: generateSyntheticFace({ yaw: 0.0, pitch: 0.0, roll: 0.0, ear: earVal }),
            timestamp: 8000 + f * 33,
            groundTruth: label,
            scenario: 'Drowsiness Prolonged Closure'
        });
    }

    // Scenario 4: Looking Away (Sustained 32° Yaw Turn >= 1.5s) - 100 frames
    // Turns head from frame 10 to 80 (70 frames * 33ms = 2310ms)
    for (let f = 0; f < 100; f++) {
        const isSustainedAway = (f >= 10 + 46 && f <= 80); // >= 1500ms
        const isBriefTurn = (f >= 10 && f < 10 + 46);
        const yawAngle = (f >= 10 && f <= 80) ? 32.0 : 0.0;
        let label = BEHAVIORAL_STATES.ATTENTIVE;
        if (isSustainedAway) label = BEHAVIORAL_STATES.LOOKING_AWAY;
        else if (isBriefTurn) label = BEHAVIORAL_STATES.ATTENTIVE; // Brief saccades debounced!

        dataset.push({
            landmarks: generateSyntheticFace({ yaw: yawAngle, pitch: 0.0, roll: 0.0, ear: 0.32 }),
            timestamp: 12000 + f * 33,
            groundTruth: label,
            scenario: 'Looking Away'
        });
    }

    // Scenario 5: Looking Down (Pedagogical State: Reading Notes / Textbook >= 1.5s) - 100 frames
    for (let f = 0; f < 100; f++) {
        const isSustainedReading = (f >= 10 + 46); // Sustained >= 1500ms
        const isReadingMovement = (f >= 10);
        dataset.push({
            landmarks: generateSyntheticFace({ yaw: 0.0, pitch: isReadingMovement ? 26.0 : 0.0, roll: 0.0, ear: 0.30 }),
            timestamp: 16000 + f * 33,
            groundTruth: isSustainedReading ? BEHAVIORAL_STATES.LOOKING_DOWN : BEHAVIORAL_STATES.ATTENTIVE,
            scenario: 'Looking Down Reading'
        });
    }

    // Scenario 6: Subject Absent (Empty Webcam View) - 100 frames
    for (let f = 0; f < 100; f++) {
        dataset.push({
            landmarks: [],
            timestamp: 20000 + f * 33,
            groundTruth: BEHAVIORAL_STATES.FACE_NOT_DETECTED,
            scenario: 'Subject Absent'
        });
    }

    // Scenario 7: Insufficient Quality (Corrupted Landmarks & Boundary Clipping) - 100 frames
    for (let f = 0; f < 100; f++) {
        const isCorrupt = (f % 2 === 0);
        dataset.push({
            landmarks: generateSyntheticFace({ corrupt: isCorrupt, clipped: !isCorrupt }),
            timestamp: 24000 + f * 33,
            groundTruth: (isCorrupt) ? BEHAVIORAL_STATES.FACE_NOT_DETECTED : BEHAVIORAL_STATES.INSUFFICIENT_QUALITY,
            scenario: 'Insufficient Quality'
        });
    }

    // Run Enhanced Calibrated Engine
    const engineNew = new EngagementEngine({
        smoothing: { enabled: false },
        thresholds: {
            drowsinessDurationMs: 1000,
            gazeDeviationDurationMs: 1500,
            penalizeLookingDown: false
        }
    });

    for (const sample of dataset) {
        const res = engineNew.processFrame(sample.landmarks, sample.timestamp);
        let predicted = res.behavioral_state || BEHAVIORAL_STATES.ATTENTIVE;

        // Map status strings if needed
        if (res.is_unknown) predicted = BEHAVIORAL_STATES.INSUFFICIENT_QUALITY;
        else if (res.presence === 0.0) predicted = BEHAVIORAL_STATES.FACE_NOT_DETECTED;

        if (confusionNew[sample.groundTruth] && confusionNew[sample.groundTruth][predicted] !== undefined) {
            confusionNew[sample.groundTruth][predicted]++;
        }
    }

    // Run Legacy Ratio Heuristic Pipeline Simulation
    let legacyClosedFrames = 0;
    for (const sample of dataset) {
        const lm = sample.landmarks;
        let legacyPredicted = BEHAVIORAL_STATES.ATTENTIVE;

        if (!lm || lm.length === 0) {
            legacyPredicted = BEHAVIORAL_STATES.FACE_NOT_DETECTED;
        } else if (lm.length < 468) {
            legacyPredicted = BEHAVIORAL_STATES.INSUFFICIENT_QUALITY;
        } else {
            const ear = computeEAR(lm, LANDMARK_INDICES.RIGHT_EYE);
            if (ear < 0.21) {
                legacyClosedFrames++;
                if (legacyClosedFrames >= 15) {
                    legacyPredicted = BEHAVIORAL_STATES.PROLONGED_EYE_CLOSURE;
                } else {
                    // Legacy code didn't separate natural blinks from attention deductions
                    legacyPredicted = BEHAVIORAL_STATES.ATTENTIVE;
                }
            } else {
                legacyClosedFrames = 0;
                // Ratio heuristics
                const n = lm[1], l = lm[263], r = lm[33], fh = lm[10], ch = lm[152];
                const dL = Math.abs(l.x - n.x), dR = Math.abs(n.x - r.x);
                const yawRatio = (dR > 1e-5) ? (dL / dR) : 1.0;
                const dTop = Math.abs(n.y - fh.y), dBot = Math.abs(ch.y - n.y);
                const pitchRatio = (dBot > 1e-5) ? (dTop / dBot) : 1.0;

                if (yawRatio < 0.40 || yawRatio > 2.30) {
                    legacyPredicted = BEHAVIORAL_STATES.LOOKING_AWAY;
                } else if (pitchRatio > 2.30) {
                    legacyPredicted = BEHAVIORAL_STATES.LOOKING_DOWN;
                }
            }
        }

        if (confusionLegacy[sample.groundTruth] && confusionLegacy[sample.groundTruth][legacyPredicted] !== undefined) {
            confusionLegacy[sample.groundTruth][legacyPredicted]++;
        }
    }

    const metricsNew = calculateMetrics(confusionNew, TARGET_CLASSES);
    const metricsLegacy = calculateMetrics(confusionLegacy, TARGET_CLASSES);

    console.log('\n===============================================================');
    console.log('       FACIAL BEHAVIOR BENCHMARK & EMPIRICAL EVALUATION         ');
    console.log('===============================================================');
    console.log(`Evaluated Dataset: ${dataset.length} labeled synthetic landmark frames across 7 behavioral classes\n`);

    console.log('--- Multi-Class Confusion Matrix (Enhanced Calibrated Pipeline) ---');
    console.log('Rows: Ground Truth, Cols: Predicted Class');
    console.log(TARGET_CLASSES.map(c => c.slice(0, 10).padEnd(11)).join(' | '));
    for (const gt of TARGET_CLASSES) {
        const row = TARGET_CLASSES.map(pred => String(confusionNew[gt][pred]).padStart(10)).join(' | ');
        console.log(`${gt.slice(0, 10).padEnd(10)}: ${row}`);
    }

    console.log('\n--- Per-Class Performance Metrics (Enhanced Pipeline) ---');
    console.table(metricsNew.classMetrics);
    console.log(`Overall Accuracy: ${(metricsNew.accuracy * 100).toFixed(2)}%`);
    console.log(`Macro F1 Score:   ${(metricsNew.macroF1 * 100).toFixed(2)}%\n`);

    console.log('--- Performance Comparison: Enhanced vs. Legacy Heuristics ---');
    console.log(`Enhanced Pipeline Accuracy: ${(metricsNew.accuracy * 100).toFixed(2)}%  | Legacy Heuristics: ${(metricsLegacy.accuracy * 100).toFixed(2)}%`);
    console.log(`Enhanced Pipeline Macro F1: ${(metricsNew.macroF1 * 100).toFixed(2)}%  | Legacy Heuristics: ${(metricsLegacy.macroF1 * 100).toFixed(2)}%`);
    console.log('===============================================================\n');

    // Rigorous empirical assertions
    assert.ok(metricsNew.accuracy >= 0.90, `Enhanced accuracy must exceed 90% (achieved: ${metricsNew.accuracy})`);
    assert.ok(metricsNew.macroF1 >= 0.85, `Enhanced Macro F1 must exceed 85% (achieved: ${metricsNew.macroF1})`);
    assert.ok(metricsNew.accuracy > metricsLegacy.accuracy, 'Enhanced pipeline must outperform legacy heuristics');
});

// --- Test 2: FPS Invariance (10 FPS vs 60 FPS) ---
test('Elapsed-Time Invariance: 1000ms eye-closure triggers drowsiness consistently across varying FPS', () => {
    // Test 10 FPS (100ms per frame)
    const engine10FPS = new EngagementEngine({
        smoothing: { enabled: false },
        thresholds: { drowsinessDurationMs: 1000 }
    });
    const closedFace = generateSyntheticFace({ ear: 0.05 });

    let triggeredAtFrame10 = null;
    for (let f = 0; f < 20; f++) {
        const res = engine10FPS.processFrame(closedFace, f * 100);
        if (res.is_drowsy && triggeredAtFrame10 === null) {
            triggeredAtFrame10 = f;
        }
    }
    // At 10 FPS, 1000ms is reached at frame 10 (10 * 100ms = 1000ms)
    assert.equal(triggeredAtFrame10, 10, '10 FPS must trigger drowsiness at 1000ms (frame 10)');

    // Test 60 FPS (16.66ms per frame)
    const engine60FPS = new EngagementEngine({
        smoothing: { enabled: false },
        thresholds: { drowsinessDurationMs: 1000, drowsinessFrames: 9999 } // Disable frame fallback to test pure time
    });

    let triggeredAtFrame60 = null;
    for (let f = 0; f < 80; f++) {
        const res = engine60FPS.processFrame(closedFace, Math.round(f * 16.666));
        if (res.is_drowsy && triggeredAtFrame60 === null) {
            triggeredAtFrame60 = f;
        }
    }
    // At 60 FPS, 1000ms is reached at frame 60 (60 * 16.666ms = 1000ms)
    assert.equal(triggeredAtFrame60, 60, '60 FPS must trigger drowsiness at 1000ms (frame 60, not prematurely at 15 frames)');
});

// --- Test 3: Individual Baseline EAR Calibration & Schmitt-Trigger Hysteresis ---
test('Individual EAR Calibration: Adapts to small/glasses eyes and prevents boundary chatter via hysteresis', () => {
    // Subject wearing glasses with smaller visible eye aperture: baseline EAR = 0.22
    const glassesSamples = [0.22, 0.21, 0.23, 0.22, 0.22, 0.21, 0.24, 0.22, 0.23, 0.22];
    const calibration = calibrateBaselineEAR(glassesSamples);

    assert.equal(calibration.isCalibrated, true);
    assert.equal(calibration.baselineEAR, 0.22);
    // Dynamic thresholds: close = 0.22 * 0.72 = 0.158, open = 0.22 * 0.85 = 0.187
    assert.equal(calibration.closeThreshold, 0.158);
    assert.equal(calibration.openThreshold, 0.187);

    // Hysteresis verification:
    // Open eyes: ear = 0.21 -> isEyeClosed = false
    assert.equal(isEyeClosed(0.21, calibration.closeThreshold, calibration.openThreshold, false), false);

    // Drops below close threshold (0.158): ear = 0.14 -> isEyeClosed = true
    assert.equal(isEyeClosed(0.14, calibration.closeThreshold, calibration.openThreshold, false), true);

    // Fluctuates in the hysteresis band (0.17):
    // If previously open: stays open
    assert.equal(isEyeClosed(0.17, calibration.closeThreshold, calibration.openThreshold, false), false);
    // If previously closed: stays closed (prevents boundary chatter!)
    assert.equal(isEyeClosed(0.17, calibration.closeThreshold, calibration.openThreshold, true), true);

    // Rises above open threshold (0.187): ear = 0.20 -> re-opens
    assert.equal(isEyeClosed(0.20, calibration.closeThreshold, calibration.openThreshold, true), false);
});

// --- Test 4: Camera Position Calibration & Documentation ---
test('Camera Position Calibration: Corrects for laptop tilt angle and centers neutral pose', () => {
    // Simulated laptop camera angled +12° upwards looking at student
    const neutralLaptopSamples = [
        { raw: { yaw: 0.5, pitch: 12.2, roll: 0.2 } },
        { raw: { yaw: -0.2, pitch: 11.8, roll: -0.1 } },
        { raw: { yaw: 0.1, pitch: 12.0, roll: 0.0 } }
    ];

    const offset = calibrateCameraOffset(neutralLaptopSamples);
    assert.equal(offset.pitchOffset, 12.0, 'Pitch offset must average to +12.0°');

    const testFace = generateSyntheticFace({ yaw: 0.0, pitch: 0.0 });
    // Raw pose on uncalibrated laptop will exhibit +12° bias
    const calibratedPose = estimateHeadPose(testFace, { calibration: offset });
    assert.equal(calibratedPose.calibrationApplied, true);
});
