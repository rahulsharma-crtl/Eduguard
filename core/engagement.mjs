/**
 * EduGuard Engagement Engine & Facial Behavior Pipeline
 * =====================================================
 * Client-side MediaPipe facial behavior pipeline with calibrated geometric
 * 3D head-pose estimation, elapsed-time eye-closure tracking, individual EAR
 * calibration with Schmitt-trigger hysteresis, and robust observation quality assessment.
 *
 * Privacy Architecture:
 * ---------------------
 * All facial behavior and landmark computation executes 100% locally in the client
 * browser. Raw camera pixel frames are NEVER transmitted across WebRTC or logged to
 * servers. Only derived numerical telemetry or synthetic vector mesh drawings are shared.
 *
 * Mathematical Formulations & Algorithms:
 * ---------------------------------------
 * 1. Geometric 3D Head-Pose Estimation:
 *    Uses 3D facial landmarks (nose tip #1, chin #152, forehead #10, glabella #168,
 *    and bilateral outer eye corners #33, #263) to construct an orthonormal facial
 *    coordinate frame:
 *      V_x = P_left_eye - P_right_eye
 *      u_x = V_x / ||V_x||
 *      V_y_ortho = V_midline - (V_midline . u_x) u_x
 *      u_y = V_y_ortho / ||V_y_ortho||
 *      u_z = u_x x u_y  (facial normal vector pointing toward camera)
 *    Euler Angles (Tait-Bryan):
 *      Pitch = arctan2(u_z.y, sqrt(u_z.x^2 + u_z.z^2)) * (180 / pi)
 *      Yaw   = arctan2(u_z.x, u_z.z) * (180 / pi)
 *      Roll  = arctan2(u_x.y, u_x.x) * (180 / pi)
 *    Camera-Position Calibration:
 *      yaw_calibrated   = yaw_raw   - yaw_offset
 *      pitch_calibrated = pitch_raw - pitch_offset
 *      roll_calibrated  = roll_raw  - roll_offset
 *
 * 2. Elapsed-Time Eye-Closure & Individual EAR Calibration:
 *    - Replaces fixed frame counters with real elapsed time (milliseconds),
 *      ensuring identical temporal behavior across 10 FPS, 30 FPS, and 60 FPS.
 *    - Individual baseline EAR calibration:
 *        closeThreshold = baselineEAR * 0.72
 *        openThreshold  = baselineEAR * 0.85
 *    - Schmitt-trigger hysteresis eliminates high-frequency boundary chatter.
 *
 * 3. Behavioral State Separation:
 *    - Distinguishes NATURAL_BLINK (<400ms) from PROLONGED_EYE_CLOSURE (>=1000ms).
 *    - Distinguishes LOOKING_AWAY (|yaw| > 25 deg, sustained >= 1.5s) from brief saccades.
 *    - Distinguishes LOOKING_DOWN (pitch < -15 deg): In educational environments,
 *      looking down corresponds to reading notes or writing; it is labeled as an
 *      observable head-pose state and is NOT penalized as disengagement.
 *
 * 4. Normalized Composite Engagement Index (CEI):
 *      CEI_raw = clamp(w_p * P + w_a * A + w_d * (1 - D), 0, 1)
 *    Absence (P = 0) explicitly forces CEI = 0.0.
 *    Insufficient observation quality flags is_unknown = true without slashing scores.
 */

export const BEHAVIORAL_STATES = Object.freeze({
    ATTENTIVE: 'ATTENTIVE',
    NATURAL_BLINK: 'NATURAL_BLINK',
    PROLONGED_EYE_CLOSURE: 'PROLONGED_EYE_CLOSURE',
    LOOKING_AWAY: 'LOOKING_AWAY',
    LOOKING_DOWN: 'LOOKING_DOWN',
    LOOKING_UP: 'LOOKING_UP',
    HEAD_TILT: 'HEAD_TILT',
    FACE_NOT_DETECTED: 'FACE_NOT_DETECTED',
    INSUFFICIENT_QUALITY: 'INSUFFICIENT_QUALITY'
});

export const DEFAULT_CONFIG = Object.freeze({
    weights: Object.freeze({
        presence: 0.30,
        attentiveness: 0.45,
        distraction: 0.25
    }),
    thresholds: Object.freeze({
        // EAR & Eye-closure parameters
        earThreshold: 0.21,              // Fallback baseline threshold
        earCloseRatio: 0.72,             // Close threshold = baseline * earCloseRatio
        earOpenRatio: 0.85,              // Open threshold = baseline * earOpenRatio
        fallbackCloseThreshold: 0.19,
        fallbackOpenThreshold: 0.23,
        blinkMaxDurationMs: 400,         // Natural blinks typically 100-350ms
        drowsinessDurationMs: 1000,      // Sustained closure >= 1000ms triggers drowsiness alert
        drowsinessFrames: 15,            // Backward compatibility frame threshold
        microBlinkFrames: 4,

        // Head-pose limits (degrees)
        yawLimitDegrees: 25.0,           // |yaw| > 25° indicates looking away
        pitchLookingDownDegrees: -15.0,  // pitch < -15° indicates looking down (reading/writing)
        pitchLookingUpDegrees: 20.0,     // pitch > +20° indicates looking up
        rollLimitDegrees: 25.0,          // |roll| > 25° indicates head tilt
        gazeDeviationDurationMs: 1500,   // Sustained deviation required for looking away/down

        // Legacy 2D ratio thresholds (preserved for backward compatibility)
        yawMin: 0.40,
        yawMax: 2.30,
        pitchMin: 0.45,
        pitchMax: 2.30,

        // Pedagogical engagement rule: Looking down is an observable pose (note-taking/reading),
        // NOT disengagement. When false, looking down does not penalize attentiveness.
        penalizeLookingDown: false,
        penalizeHeadOrientation: false,

        // Quality and geometry thresholds
        minInterocularDistance: 15.0,    // Pixels in 640x480 coordinate space
        minFaceHeight: 20.0,
        minLandmarkCount: 468,
        boundaryClipMargin: 0.02,        // Frame edge proximity margin [0, 1]
        maxLandmarkJitter: 35.0          // Max RMS pixel jump before jitter warning
    }),
    calibration: Object.freeze({
        pitchOffset: 0.0,                // Accounts for laptop tilt (+pitch) or monitor (-pitch)
        yawOffset: 0.0,
        rollOffset: 0.0
    }),
    smoothing: Object.freeze({
        tauSeconds: 1.5,
        enabled: true
    }),
    dimensions: Object.freeze({
        width: 640,
        height: 480
    })
});

// Canonical MediaPipe FaceMesh Landmark Indices (468/478 point topology)
export const LANDMARK_INDICES = Object.freeze({
    NOSE_TIP: 1,
    NOSE_BRIDGE: 168,
    FOREHEAD: 10,
    CHIN: 152,
    RIGHT_EYE_OUTER: 33,
    RIGHT_EYE_INNER: 133,
    LEFT_EYE_OUTER: 263,
    LEFT_EYE_INNER: 362,
    RIGHT_TEMPLE: 234,
    LEFT_TEMPLE: 454,
    RIGHT_MOUTH_CORNER: 61,
    LEFT_MOUTH_CORNER: 291,
    RIGHT_EYE: Object.freeze([33, 160, 158, 133, 153, 144]),
    LEFT_EYE: Object.freeze([362, 385, 387, 263, 373, 380])
});

/**
 * 2D Euclidean distance scaled to pixel space.
 */
export function ptDist(p1, p2, width = 640, height = 480) {
    if (!p1 || !p2) return 0.0;
    const dx = (p1.x - p2.x) * width;
    const dy = (p1.y - p2.y) * height;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 3D Euclidean distance in camera metric space.
 */
export function ptDist3D(p1, p2, width = 640, height = 480) {
    if (!p1 || !p2) return 0.0;
    const dx = (p1.x - p2.x) * width;
    const dy = (p1.y - p2.y) * height;
    const dz = ((p1.z || 0) - (p2.z || 0)) * width;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 6-Point Soukupová & Čech Eye Aspect Ratio (EAR).
 * EAR = (|p2 - p6| + |p3 - p5|) / (2 * |p1 - p4|)
 */
export function computeEAR(landmarks, indices, width = 640, height = 480) {
    if (!landmarks || !indices || indices.length < 6) return 0.0;
    for (let i = 0; i < 6; i++) {
        const pt = landmarks[indices[i]];
        if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number' ||
            Number.isNaN(pt.x) || Number.isNaN(pt.y) || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
            return 0.0;
        }
    }

    const p1 = landmarks[indices[0]];
    const p2 = landmarks[indices[1]];
    const p3 = landmarks[indices[2]];
    const p4 = landmarks[indices[3]];
    const p5 = landmarks[indices[4]];
    const p6 = landmarks[indices[5]];

    const v1 = ptDist(p2, p6, width, height);
    const v2 = ptDist(p3, p5, width, height);
    const h = ptDist(p1, p4, width, height);

    if (h < 1e-5) return 0.0;
    return (v1 + v2) / (2.0 * h);
}

/**
 * Calibrate individual baseline open-eye EAR.
 *
 * Humans naturally exhibit baseline EAR variations (e.g. 0.22 for smaller or hooded eyes,
 * 0.35 for large eyes; eyeglasses frames may also alter visible eyelid contour).
 *
 * @param {Array<number>} earSamples - Sequence of attentive, open-eye EAR measurements.
 * @param {Object} [config=DEFAULT_CONFIG.thresholds]
 * @returns {Object} Calibrated baseline and dynamic hysteresis thresholds.
 */
export function calibrateBaselineEAR(earSamples, config = DEFAULT_CONFIG.thresholds) {
    if (!earSamples || !Array.isArray(earSamples) || earSamples.length < 5) {
        return {
            baselineEAR: config.earThreshold ?? 0.21,
            closeThreshold: config.fallbackCloseThreshold ?? 0.19,
            openThreshold: config.fallbackOpenThreshold ?? 0.23,
            isCalibrated: false,
            sampleCount: earSamples ? earSamples.length : 0
        };
    }

    // Filter valid positive EAR values within plausible physiological range [0.15, 0.50]
    const valid = earSamples.filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0.15 && v <= 0.50);
    if (valid.length < 5) {
        return {
            baselineEAR: config.earThreshold ?? 0.21,
            closeThreshold: config.fallbackCloseThreshold ?? 0.19,
            openThreshold: config.fallbackOpenThreshold ?? 0.23,
            isCalibrated: false,
            sampleCount: valid.length
        };
    }

    valid.sort((a, b) => a - b);
    // Use median to reject transient blinks in the calibration sequence
    const mid = Math.floor(valid.length / 2);
    const medianEAR = (valid.length % 2 !== 0) ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2.0;

    const closeRatio = config.earCloseRatio ?? 0.72;
    const openRatio = config.earOpenRatio ?? 0.85;

    return {
        baselineEAR: parseFloat(medianEAR.toFixed(3)),
        closeThreshold: parseFloat((medianEAR * closeRatio).toFixed(3)),
        openThreshold: parseFloat((medianEAR * openRatio).toFixed(3)),
        isCalibrated: true,
        sampleCount: valid.length
    };
}

/**
 * Schmitt-Trigger Hysteresis Eye-Closure Evaluator.
 *
 * Prevents rapid oscillation (chatter) when the user's EAR fluctuates near the decision boundary.
 *
 * @param {number} ear - Current computed EAR.
 * @param {number} closeThreshold - Threshold below which eyes transition to closed.
 * @param {number} openThreshold - Threshold above which eyes transition to open (openThreshold > closeThreshold).
 * @param {boolean} currentState - Previous eye closed state.
 * @returns {boolean} New eye closed state.
 */
export function isEyeClosed(ear, closeThreshold, openThreshold, currentState = false) {
    if (typeof ear !== 'number' || Number.isNaN(ear)) return false;
    if (currentState) {
        // Eyes are currently closed: stay closed until EAR strictly exceeds openThreshold
        return ear <= openThreshold;
    } else {
        // Eyes are currently open: stay open until EAR strictly drops below closeThreshold
        return ear < closeThreshold;
    }
}

/**
 * Calibrated Geometric 3D Head-Pose Estimator.
 *
 * Constructs an orthonormal 3D facial coordinate frame from key MediaPipe FaceMesh landmarks:
 *   - Lateral Axis (X): Right eye corner (#33) to Left eye corner (#263)
 *   - Vertical Axis (Y): Chin (#152) to Forehead (#10) or Glabella (#168), orthogonalized
 *   - Normal Axis (Z): Facial normal vector pointing outward toward viewer
 *
 * If 3D coordinates (z) are flat or missing, it applies an anthropometric geometric
 * projection based on interocular span, nose protrusion, and facial midline ratios.
 *
 * @param {Array|Object} landmarks - FaceMesh landmarks (468 points).
 * @param {Object} [options={}] - Width, height, and calibration offsets.
 * @returns {Object} Yaw, pitch, roll in degrees, rotation matrix, and calibration status.
 */
export function estimateHeadPose(landmarks, options = {}) {
    if (!landmarks) {
        return {
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            raw: { yaw: 0.0, pitch: 0.0, roll: 0.0 },
            rotationMatrix: null,
            is3D: false,
            calibrationApplied: false
        };
    }

    const width = options.width ?? DEFAULT_CONFIG.dimensions.width;
    const height = options.height ?? DEFAULT_CONFIG.dimensions.height;
    const calibration = options.calibration ?? DEFAULT_CONFIG.calibration;

    const nose = landmarks[LANDMARK_INDICES.NOSE_TIP];
    const chin = landmarks[LANDMARK_INDICES.CHIN];
    const forehead = landmarks[LANDMARK_INDICES.FOREHEAD];
    const leftEye = landmarks[LANDMARK_INDICES.LEFT_EYE_OUTER];
    const rightEye = landmarks[LANDMARK_INDICES.RIGHT_EYE_OUTER];

    if (!nose || !chin || !forehead || !leftEye || !rightEye) {
        return {
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            raw: { yaw: 0.0, pitch: 0.0, roll: 0.0 },
            rotationMatrix: null,
            is3D: false,
            calibrationApplied: false
        };
    }

    // Check if landmarks possess true 3D depth variation
    const hasZ = Boolean(
        typeof nose.z === 'number' && typeof leftEye.z === 'number' && typeof chin.z === 'number' &&
        (Math.abs(nose.z - leftEye.z) > 1e-4 || Math.abs(nose.z - chin.z) > 1e-4)
    );

    let yawRaw = 0.0;
    let pitchRaw = 0.0;
    let rollRaw = 0.0;
    let rotationMatrix = null;
    const toDeg = 180.0 / Math.PI;

    if (hasZ) {
        // --- 1. Full 3D Orthonormal Basis in Camera Metric Space ---
        // MediaPipe convention: x in [0, 1] right, y in [0, 1] down, z negative towards camera
        // Transform to camera metric space: X right (+), Y up (+), Z forward toward camera (+)
        const toCam = pt => ({
            x: (pt.x - 0.5) * width,
            y: -(pt.y - 0.5) * height,
            z: -(pt.z || 0.0) * width
        });

        const pNose = toCam(nose);
        const pChin = toCam(chin);
        const pForehead = toCam(forehead);
        const pLeftEye = toCam(leftEye);
        const pRightEye = toCam(rightEye);

        // Lateral Axis X: right eye to left eye
        const vx = {
            x: pLeftEye.x - pRightEye.x,
            y: pLeftEye.y - pRightEye.y,
            z: pLeftEye.z - pRightEye.z
        };
        const lenX = Math.sqrt(vx.x * vx.x + vx.y * vx.y + vx.z * vx.z) || 1e-6;
        const ux = { x: vx.x / lenX, y: vx.y / lenX, z: vx.z / lenX };

        // Vertical Axis Y: chin to forehead
        const vy = {
            x: pForehead.x - pChin.x,
            y: pForehead.y - pChin.y,
            z: pForehead.z - pChin.z
        };
        // Gram-Schmidt orthogonalization: project vy onto ux and subtract
        const dotXY = vy.x * ux.x + vy.y * ux.y + vy.z * ux.z;
        const vy_ortho = {
            x: vy.x - dotXY * ux.x,
            y: vy.y - dotXY * ux.y,
            z: vy.z - dotXY * ux.z
        };
        const lenY = Math.sqrt(vy_ortho.x * vy_ortho.x + vy_ortho.y * vy_ortho.y + vy_ortho.z * vy_ortho.z) || 1e-6;
        const uy = { x: vy_ortho.x / lenY, y: vy_ortho.y / lenY, z: vy_ortho.z / lenY };

        // Normal Axis Z: cross product ux x uy (right-handed system)
        const uz = {
            x: ux.y * uy.z - ux.z * uy.y,
            y: ux.z * uy.x - ux.x * uy.z,
            z: ux.x * uy.y - ux.y * uy.x
        };

        // Tait-Bryan Euler Angles
        pitchRaw = Math.atan2(uz.y, Math.sqrt(uz.x * uz.x + uz.z * uz.z)) * toDeg;
        yawRaw = Math.atan2(uz.x, uz.z) * toDeg;
        rollRaw = Math.atan2(ux.y, ux.x) * toDeg;

        rotationMatrix = [
            [ux.x, uy.x, uz.x],
            [ux.y, uy.y, uz.y],
            [ux.z, uy.z, uz.z]
        ];
    } else {
        // --- 2. Anthropometric Geometric Projection (2D Fallback) ---
        const eyeMidX = (leftEye.x + rightEye.x) / 2.0;
        const eyeMidY = (leftEye.y + rightEye.y) / 2.0;
        const eyeDx = (leftEye.x - rightEye.x) * width;
        const eyeDy = (leftEye.y - rightEye.y) * height;
        const eyeSpan = Math.sqrt(eyeDx * eyeDx + eyeDy * eyeDy) || 1.0;

        // Roll: angle of the interpupillary line
        rollRaw = Math.atan2(eyeDy, eyeDx) * toDeg;

        // Yaw: lateral deviation of nose tip relative to facial midline
        const noseOffset = (nose.x - eyeMidX) * width;
        const normalizedYawRatio = noseOffset / (eyeSpan * 0.35);
        yawRaw = Math.atan(normalizedYawRatio) * toDeg;

        // Pitch: vertical offset of nose tip relative to neutral eye-to-chin balance
        // In neutral facial anatomy (forehead ~0.25, nose ~0.45, chin ~0.70), dTop/dBot ~ 0.80
        const dTop = Math.abs(nose.y - forehead.y);
        const dBot = Math.abs(chin.y - nose.y);
        const pitchRatio = (dBot > 1e-5) ? (dTop / dBot) : 0.80;
        pitchRaw = -Math.atan((pitchRatio - 0.80) * 1.5) * toDeg;
    }

    // Apply Camera-Position Calibration Offsets
    const pitchOffset = calibration.pitchOffset ?? 0.0;
    const yawOffset = calibration.yawOffset ?? 0.0;
    const rollOffset = calibration.rollOffset ?? 0.0;

    const calibratedYaw = yawRaw - yawOffset;
    const calibratedPitch = pitchRaw - pitchOffset;
    const calibratedRoll = rollRaw - rollOffset;

    return {
        yaw: parseFloat(calibratedYaw.toFixed(2)),
        pitch: parseFloat(calibratedPitch.toFixed(2)),
        roll: parseFloat(calibratedRoll.toFixed(2)),
        raw: {
            yaw: parseFloat(yawRaw.toFixed(2)),
            pitch: parseFloat(pitchRaw.toFixed(2)),
            roll: parseFloat(rollRaw.toFixed(2))
        },
        rotationMatrix,
        is3D: hasZ,
        calibrationApplied: Boolean(pitchOffset || yawOffset || rollOffset)
    };
}

/**
 * Calibrate Camera Position & Angle from Neutral Head-Pose Samples.
 *
 * Webcams mounted on laptops typically tilt upward (+10° to +15°), while external
 * monitors mounted above eye level tilt downward (-10° to -15°).
 *
 * @param {Array<Object>} neutralSamples - Sequence of raw pose objects { yaw, pitch, roll }.
 * @returns {Object} Camera calibration offset dictionary.
 */
export function calibrateCameraOffset(neutralSamples) {
    if (!neutralSamples || !Array.isArray(neutralSamples) || neutralSamples.length < 3) {
        return {
            pitchOffset: 0.0,
            yawOffset: 0.0,
            rollOffset: 0.0,
            sampleCount: 0
        };
    }

    let sumPitch = 0, sumYaw = 0, sumRoll = 0, count = 0;
    for (const s of neutralSamples) {
        const raw = s.raw || s;
        if (typeof raw.pitch === 'number' && Number.isFinite(raw.pitch)) {
            sumPitch += raw.pitch;
            sumYaw += (raw.yaw || 0.0);
            sumRoll += (raw.roll || 0.0);
            count++;
        }
    }

    if (count === 0) {
        return { pitchOffset: 0.0, yawOffset: 0.0, rollOffset: 0.0, sampleCount: 0 };
    }

    return {
        pitchOffset: parseFloat((sumPitch / count).toFixed(2)),
        yawOffset: parseFloat((sumYaw / count).toFixed(2)),
        rollOffset: parseFloat((sumRoll / count).toFixed(2)),
        sampleCount: count
    };
}

/**
 * Assess landmark confidence, coordinate stability, and edge clipping.
 */
export function assessLandmarkConfidence(landmarks, options = {}) {
    const width = options.width ?? DEFAULT_CONFIG.dimensions.width;
    const height = options.height ?? DEFAULT_CONFIG.dimensions.height;
    const minCount = options.minLandmarkCount ?? DEFAULT_CONFIG.thresholds.minLandmarkCount;
    const clipMargin = options.boundaryClipMargin ?? DEFAULT_CONFIG.thresholds.boundaryClipMargin;
    const prevLandmarks = options.prevLandmarks ?? null;
    const maxJitter = options.maxLandmarkJitter ?? DEFAULT_CONFIG.thresholds.maxLandmarkJitter;

    if (!landmarks || !Array.isArray(landmarks) || landmarks.length === 0) {
        return {
            isConfidenceSufficient: false,
            confidenceScore: 0.0,
            isBoundaryClipped: false,
            jitter: 0.0,
            reason: 'no_landmarks'
        };
    }

    if (landmarks.length < minCount) {
        return {
            isConfidenceSufficient: false,
            confidenceScore: landmarks.length / minCount,
            isBoundaryClipped: false,
            jitter: 0.0,
            reason: 'insufficient_landmarks'
        };
    }

    // Verify key landmark coordinates are finite and non-NaN
    const criticalIndices = [
        LANDMARK_INDICES.NOSE_TIP,
        LANDMARK_INDICES.FOREHEAD,
        LANDMARK_INDICES.CHIN,
        LANDMARK_INDICES.RIGHT_EYE_OUTER,
        LANDMARK_INDICES.LEFT_EYE_OUTER,
        ...LANDMARK_INDICES.RIGHT_EYE,
        ...LANDMARK_INDICES.LEFT_EYE
    ];

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const idx of criticalIndices) {
        const pt = landmarks[idx];
        if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number' ||
            Number.isNaN(pt.x) || Number.isNaN(pt.y) || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
            return {
                isConfidenceSufficient: false,
                confidenceScore: 0.0,
                isBoundaryClipped: false,
                jitter: 0.0,
                reason: 'coordinate_corruption'
            };
        }
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
    }

    // Boundary Clipping: Check if face touches outer sensor border
    const isBoundaryClipped = (
        minX <= clipMargin || maxX >= (1.0 - clipMargin) ||
        minY <= clipMargin || maxY >= (1.0 - clipMargin)
    );

    // Coordinate Jitter Detection (rapid tracking oscillation from lighting changes or blur)
    let jitter = 0.0;
    if (prevLandmarks && Array.isArray(prevLandmarks) && prevLandmarks.length >= minCount) {
        let totalSqDist = 0;
        let evaluatedCount = 0;
        for (const idx of criticalIndices) {
            const pNow = landmarks[idx];
            const pPrev = prevLandmarks[idx];
            if (pNow && pPrev) {
                const dx = (pNow.x - pPrev.x) * width;
                const dy = (pNow.y - pPrev.y) * height;
                totalSqDist += (dx * dx + dy * dy);
                evaluatedCount++;
            }
        }
        if (evaluatedCount > 0) {
            jitter = Math.sqrt(totalSqDist / evaluatedCount);
        }
    }

    const isConfidenceSufficient = !isBoundaryClipped && (jitter <= maxJitter);

    return {
        isConfidenceSufficient,
        confidenceScore: isConfidenceSufficient ? 1.0 : 0.40,
        isBoundaryClipped,
        jitter: parseFloat(jitter.toFixed(2)),
        reason: isBoundaryClipped ? 'boundary_clipped' : (jitter > maxJitter ? 'excessive_jitter' : 'ok')
    };
}

/**
 * Stage 1: Face Presence & Observation Quality Assessment.
 *
 * Separates quality from engagement so missing/corrupted data or partial occlusion
 * is marked as "Unknown" rather than assigning a low engagement penalty.
 */
export function assessFacePresenceQuality(landmarks, width = 640, height = 480, options = {}) {
    // Support multi-face arrays conservatively
    let primaryLandmarks = landmarks;
    let multipleFacesDetected = false;

    if (Array.isArray(landmarks) && landmarks.length > 0 && Array.isArray(landmarks[0])) {
        // Multi-face output received: select dominant primary face by bounding box area
        multipleFacesDetected = landmarks.length > 1;
        let maxArea = -1;
        for (const face of landmarks) {
            if (face && face.length >= 468) {
                const le = face[LANDMARK_INDICES.LEFT_EYE_OUTER];
                const re = face[LANDMARK_INDICES.RIGHT_EYE_OUTER];
                const chin = face[LANDMARK_INDICES.CHIN];
                const forehead = face[LANDMARK_INDICES.FOREHEAD];
                const w = Math.abs((le.x - re.x) * width);
                const h = Math.abs((chin.y - forehead.y) * height);
                const area = w * h;
                if (area > maxArea) {
                    maxArea = area;
                    primaryLandmarks = face;
                }
            }
        }
    }

    if (!primaryLandmarks || !Array.isArray(primaryLandmarks) || primaryLandmarks.length === 0) {
        return {
            status: 'absent',
            isValid: false,
            isAbsent: true,
            isUnknown: false,
            reason: 'no_face_detected',
            multipleFacesDetected,
            metrics: null
        };
    }

    const minCount = options.minLandmarkCount ?? DEFAULT_CONFIG.thresholds.minLandmarkCount;
    const minEyeDist = options.minInterocularDistance ?? DEFAULT_CONFIG.thresholds.minInterocularDistance;
    const minFaceH = options.minFaceHeight ?? DEFAULT_CONFIG.thresholds.minFaceHeight;

    if (primaryLandmarks.length < minCount) {
        return {
            status: 'insufficient',
            isValid: false,
            isAbsent: false,
            isUnknown: true,
            reason: 'insufficient_landmarks',
            multipleFacesDetected,
            metrics: { count: primaryLandmarks.length }
        };
    }

    const confidence = assessLandmarkConfidence(primaryLandmarks, { width, height, ...options });
    if (!confidence.isConfidenceSufficient) {
        return {
            status: 'insufficient',
            isValid: false,
            isAbsent: false,
            isUnknown: true,
            reason: confidence.reason,
            multipleFacesDetected,
            metrics: confidence
        };
    }

    // Geometry scale checks: interocular distance & face height
    const leftEye = primaryLandmarks[LANDMARK_INDICES.LEFT_EYE_OUTER];
    const rightEye = primaryLandmarks[LANDMARK_INDICES.RIGHT_EYE_OUTER];
    const forehead = primaryLandmarks[LANDMARK_INDICES.FOREHEAD];
    const chin = primaryLandmarks[LANDMARK_INDICES.CHIN];

    const interocularDist = ptDist(leftEye, rightEye, width, height);
    const faceHeight = ptDist(forehead, chin, width, height);

    if (interocularDist < minEyeDist || faceHeight < minFaceH) {
        return {
            status: 'insufficient',
            isValid: false,
            isAbsent: false,
            isUnknown: true,
            reason: 'face_too_small',
            multipleFacesDetected,
            metrics: { interocularDist, faceHeight }
        };
    }

    return {
        status: 'valid',
        isValid: true,
        isAbsent: false,
        isUnknown: false,
        reason: 'ok',
        multipleFacesDetected,
        metrics: {
            count: primaryLandmarks.length,
            interocularDist,
            faceHeight,
            confidence: confidence.confidenceScore
        }
    };
}

/**
 * Backward compatibility alias for assessFacePresenceQuality.
 */
export function assessObservationQuality(landmarks, width = 640, height = 480, options = {}) {
    return assessFacePresenceQuality(landmarks, width, height, options);
}

/**
 * Stage 2: Determine presence.
 */
export function determinePresence(quality) {
    if (!quality || quality.isAbsent) {
        return 0.0;
    }
    if (quality.isValid) {
        return 1.0;
    }
    return null; // Insufficient observation: presence ambiguous
}

/**
 * Compute head pose with both calibrated geometric 3D angles and legacy ratio proxies.
 */
export function computeHeadPose(landmarks, thresholds = DEFAULT_CONFIG.thresholds, options = {}) {
    if (!landmarks) {
        return {
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            yawRatio: 1.0,
            pitchRatio: 1.0,
            isLookingAway: false,
            isLookingDown: false,
            isLookingUp: false,
            isGazeDiverted: false
        };
    }

    const nose = landmarks[LANDMARK_INDICES.NOSE_TIP];
    const eyeLeft = landmarks[LANDMARK_INDICES.LEFT_EYE_OUTER];
    const eyeRight = landmarks[LANDMARK_INDICES.RIGHT_EYE_OUTER];
    const forehead = landmarks[LANDMARK_INDICES.FOREHEAD];
    const chin = landmarks[LANDMARK_INDICES.CHIN];

    // 1. Calibrated Geometric 3D Pose Estimator
    const pose3D = estimateHeadPose(landmarks, { ...options, thresholds });

    // 2. Legacy Ratios (Preserved for backward compatibility)
    let yawRatio = 1.0;
    let pitchRatio = 1.0;
    if (nose && eyeLeft && eyeRight && forehead && chin) {
        const dL = Math.abs(eyeLeft.x - nose.x);
        const dR = Math.abs(nose.x - eyeRight.x);
        yawRatio = (dR > 1e-5) ? (dL / dR) : 1.0;

        const dTop = Math.abs(nose.y - forehead.y);
        const dBot = Math.abs(chin.y - nose.y);
        pitchRatio = (dBot > 1e-5) ? (dTop / dBot) : 1.0;
    }

    // Determine directional flags using calibrated angles or legacy ratios
    const yawLimit = thresholds.yawLimitDegrees ?? 25.0;
    const isAwayAngle = Math.abs(pose3D.yaw) > yawLimit;
    const isAwayRatio = (yawRatio < (thresholds.yawMin ?? 0.40) || yawRatio > (thresholds.yawMax ?? 2.30));
    const hasCalibration = Object.values(options.calibration || {}).some(value => value !== 0);
    const useLegacyRatios = !pose3D.is3D && !hasCalibration;
    const isLookingAway = isAwayAngle || (useLegacyRatios && isAwayRatio);

    const isDownAngle = pose3D.pitch < (thresholds.pitchLookingDownDegrees ?? -15.0);
    const isDownRatio = (pitchRatio > (thresholds.pitchMax ?? 2.30));
    const isLookingDown = isDownAngle || (useLegacyRatios && isDownRatio);

    const isUpAngle = pose3D.pitch > (thresholds.pitchLookingUpDegrees ?? 20.0);
    const isUpRatio = (pitchRatio < (thresholds.pitchMin ?? 0.45));
    const isLookingUp = isUpAngle || (useLegacyRatios && isUpRatio);

    return {
        yaw: pose3D.yaw,
        pitch: pose3D.pitch,
        roll: pose3D.roll,
        yawRatio,
        pitchRatio,
        isLookingAway,
        isLookingDown,
        isLookingUp,
        isGazeDiverted: isLookingAway || isLookingDown || isLookingUp,
        rotationMatrix: pose3D.rotationMatrix,
        is3D: pose3D.is3D
    };
}

/**
 * Classify facial behavioral state from observations and temporal durations.
 */
export function classifyBehavioralState(context = {}) {
    const quality = context.quality;
    if (!quality || quality.isAbsent) {
        return BEHAVIORAL_STATES.FACE_NOT_DETECTED;
    }
    if (!quality.isValid) {
        return BEHAVIORAL_STATES.INSUFFICIENT_QUALITY;
    }

    const isEyeClosed = Boolean(context.isEyeClosed);
    const closureDurationMs = context.closureDurationMs || 0;
    const drowsinessThresholdMs = context.drowsinessDurationMs || DEFAULT_CONFIG.thresholds.drowsinessDurationMs;

    if (isEyeClosed) {
        if (closureDurationMs >= drowsinessThresholdMs) {
            return BEHAVIORAL_STATES.PROLONGED_EYE_CLOSURE;
        }
        return BEHAVIORAL_STATES.NATURAL_BLINK;
    }

    const pose = context.pose || { isLookingAway: false, isLookingDown: false, isLookingUp: false };
    const awayDurationMs = context.awayDurationMs || 0;
    const downDurationMs = context.downDurationMs || 0;
    const upDurationMs = context.upDurationMs || 0;
    const gazeDurationThreshold = context.gazeDeviationDurationMs || 0;

    if (pose.isLookingAway && awayDurationMs >= gazeDurationThreshold) {
        return BEHAVIORAL_STATES.LOOKING_AWAY;
    }
    if (pose.isLookingDown && downDurationMs >= gazeDurationThreshold) {
        return BEHAVIORAL_STATES.LOOKING_DOWN;
    }
    if (pose.isLookingUp && upDurationMs >= gazeDurationThreshold) {
        return BEHAVIORAL_STATES.LOOKING_UP;
    }

    if (Math.abs(pose.roll || 0) > (context.rollLimitDegrees ?? DEFAULT_CONFIG.thresholds.rollLimitDegrees)) {
        return BEHAVIORAL_STATES.HEAD_TILT;
    }
    return BEHAVIORAL_STATES.ATTENTIVE;
}

/**
 * Stage 3: Compute attention proxies from facial kinematics.
 *
 * Supports elapsed-time-based eye closure detection, individual EAR baseline calibration,
 * Schmitt-trigger hysteresis, and distinct observable head-pose states.
 */
export function computeAttentionProxies(landmarks, quality, options = {}, state = {}, timestamp = Date.now()) {
    if (!quality || !quality.isValid || !landmarks) {
        return {
            avgEAR: 0.0,
            rightEAR: 0.0,
            leftEAR: 0.0,
            consecutiveClosedFrames: 0,
            closureDurationMs: 0,
            isDrowsy: false,
            isEyeClosed: false,
            isNaturalBlink: false,
            isLookingAway: false,
            isLookingDown: false,
            isLookingUp: false,
            isGazeDiverted: false,
            behavioralState: quality && quality.isAbsent ? BEHAVIORAL_STATES.FACE_NOT_DETECTED : BEHAVIORAL_STATES.INSUFFICIENT_QUALITY,
            attentiveness: quality && quality.isAbsent ? 0.0 : null,
            distraction: quality && quality.isAbsent ? 0.0 : null,
            headPose: { yaw: 0.0, pitch: 0.0, roll: 0.0 }
        };
    }

    const thresholds = { ...DEFAULT_CONFIG.thresholds, ...options.thresholds };
    const width = options.width ?? DEFAULT_CONFIG.dimensions.width;
    const height = options.height ?? DEFAULT_CONFIG.dimensions.height;

    // 1. EAR Calculation
    const rightEAR = computeEAR(landmarks, LANDMARK_INDICES.RIGHT_EYE, width, height);
    const leftEAR = computeEAR(landmarks, LANDMARK_INDICES.LEFT_EYE, width, height);
    const avgEAR = (rightEAR + leftEAR) / 2.0;

    // 2. Individual EAR Thresholds with Schmitt Trigger Hysteresis
    const closeThresh = state.calibratedCloseThreshold ?? thresholds.fallbackCloseThreshold;
    const openThresh = state.calibratedOpenThreshold ?? thresholds.fallbackOpenThreshold;
    const prevClosedState = Boolean(state.isEyeClosed);
    const eyeCurrentlyClosed = isEyeClosed(avgEAR, closeThresh, openThresh, prevClosedState);
    state.isEyeClosed = eyeCurrentlyClosed;

    // 3. Elapsed-Time-Based Eye-Closure Detection (Invariant across FPS)
    let closureDurationMs = 0;
    if (eyeCurrentlyClosed) {
        if (state.eyeClosureStartTime === null || state.eyeClosureStartTime === undefined) {
            state.eyeClosureStartTime = timestamp;
        }
        closureDurationMs = Math.max(0, timestamp - state.eyeClosureStartTime);
        state.consecutiveClosedFrames = (state.consecutiveClosedFrames || 0) + 1;
    } else {
        state.eyeClosureStartTime = null;
        state.consecutiveClosedFrames = 0;
    }

    // Prolonged closure (drowsiness) triggers if elapsed time >= 1000ms OR frame threshold met
    const isDrowsy = (closureDurationMs >= thresholds.drowsinessDurationMs) ||
                     (state.consecutiveClosedFrames >= thresholds.drowsinessFrames);
    const isNaturalBlink = eyeCurrentlyClosed && !isDrowsy && (closureDurationMs <= thresholds.blinkMaxDurationMs);

    // 4. Calibrated Geometric Head Pose & Temporal Duration Filtering
    const pose = computeHeadPose(landmarks, thresholds, options);

    // Track sustained durations for head movements to debounce brief saccades
    let awayDurationMs = 0;
    if (pose.isLookingAway) {
        if (!state.lookingAwayStartTime) state.lookingAwayStartTime = timestamp;
        awayDurationMs = Math.max(0, timestamp - state.lookingAwayStartTime);
    } else {
        state.lookingAwayStartTime = null;
    }

    let downDurationMs = 0;
    if (pose.isLookingDown) {
        if (!state.lookingDownStartTime) state.lookingDownStartTime = timestamp;
        downDurationMs = Math.max(0, timestamp - state.lookingDownStartTime);
    } else {
        state.lookingDownStartTime = null;
    }

    let upDurationMs = 0;
    if (pose.isLookingUp) {
        if (!state.lookingUpStartTime) state.lookingUpStartTime = timestamp;
        upDurationMs = Math.max(0, timestamp - state.lookingUpStartTime);
    } else {
        state.lookingUpStartTime = null;
    }

    // Classify Behavioral State
    const behavioralState = classifyBehavioralState({
        quality,
        isEyeClosed: eyeCurrentlyClosed,
        closureDurationMs,
        drowsinessDurationMs: thresholds.drowsinessDurationMs,
        pose,
        awayDurationMs,
        downDurationMs,
        upDurationMs,
        rollLimitDegrees: thresholds.rollLimitDegrees,
        gazeDeviationDurationMs: thresholds.gazeDeviationDurationMs
    });

    // 5. Compute Attentiveness and Distraction Metrics
    let attentiveness = 1.0;
    let distraction = 0.0;

    if (isDrowsy) {
        attentiveness -= 0.50;
    } else if (state.consecutiveClosedFrames > thresholds.microBlinkFrames && !isNaturalBlink) {
        attentiveness -= 0.15;
    }

    if (thresholds.penalizeHeadOrientation && pose.isLookingAway) {
        attentiveness -= 0.35;
        distraction += 0.30;
    }

    // Engagement Rule: Do not equate looking down with disengagement!
    // In education, looking down corresponds to reading notes, textbook, or writing.
    // Labeled as an observable state without slashing engagement unless explicitly configured.
    if (pose.isLookingDown) {
        if (thresholds.penalizeLookingDown) {
            attentiveness -= 0.25;
            distraction += 0.20;
        }
    }

    if (thresholds.penalizeHeadOrientation && pose.isLookingUp) {
        attentiveness -= 0.25;
        distraction += 0.20;
    }

    attentiveness = Math.max(0.0, Math.min(1.0, attentiveness));
    distraction = Math.max(0.0, Math.min(1.0, distraction));

    return {
        avgEAR: parseFloat(avgEAR.toFixed(3)),
        rightEAR: parseFloat(rightEAR.toFixed(3)),
        leftEAR: parseFloat(leftEAR.toFixed(3)),
        consecutiveClosedFrames: state.consecutiveClosedFrames,
        closureDurationMs,
        isEyeClosed: eyeCurrentlyClosed,
        isNaturalBlink,
        isDrowsy,
        isLookingAway: pose.isLookingAway,
        isLookingDown: pose.isLookingDown,
        isLookingUp: pose.isLookingUp,
        isGazeDiverted: pose.isGazeDiverted,
        behavioralState,
        attentiveness,
        distraction,
        headPose: {
            yaw: pose.yaw,
            pitch: pose.pitch,
            roll: pose.roll
        }
    };
}

/**
 * Stage 4: Normalized CEI Formula.
 * CEI = clamp(w_p * P + w_a * A + w_d * (1 - D), 0, 1)
 * Explicitly forces CEI to 0.0 when presence is 0 (no face detected).
 */
export function calculateCEI(presence, attentiveness, distraction, weights = DEFAULT_CONFIG.weights) {
    if (presence === null || presence === undefined || presence <= 0.0) {
        return 0.0;
    }

    const P = Math.max(0.0, Math.min(1.0, presence));
    const A = Math.max(0.0, Math.min(1.0, attentiveness ?? 0.0));
    const D = Math.max(0.0, Math.min(1.0, distraction ?? 0.0));

    const wP = weights.presence ?? DEFAULT_CONFIG.weights.presence;
    const wA = weights.attentiveness ?? DEFAULT_CONFIG.weights.attentiveness;
    const wD = weights.distraction ?? DEFAULT_CONFIG.weights.distraction;

    const raw = (wP * P) + (wA * A) + (wD * (1.0 - D));
    return Math.max(0.0, Math.min(1.0, raw));
}

/**
 * Time-aware Exponential Moving Average (EMA).
 * alpha = 1 - exp(-dt / tau)
 * S_t = S_{t-1} + alpha * (X_t - S_{t-1})
 */
export function applyTimeAwareEMA(currentSmoothed, rawValue, dtSeconds, tauSeconds = DEFAULT_CONFIG.smoothing.tauSeconds) {
    if (rawValue === null || rawValue === undefined || Number.isNaN(rawValue)) {
        return currentSmoothed;
    }
    if (currentSmoothed === null || currentSmoothed === undefined || Number.isNaN(currentSmoothed)) {
        return rawValue;
    }
    if (dtSeconds <= 0) {
        return currentSmoothed;
    }

    const boundedDt = Math.min(5.0, Math.max(0.001, dtSeconds));
    const tau = Math.max(0.1, tauSeconds);
    const alpha = 1.0 - Math.exp(-boundedDt / tau);

    const updated = currentSmoothed + alpha * (rawValue - currentSmoothed);
    return Math.max(0.0, Math.min(1.0, updated));
}

/**
 * Stateful Engagement Engine class managing temporal smoothing, frame tracking,
 * camera calibration, individual EAR calibration, and audio state representation.
 */
export class EngagementEngine {
    constructor(userConfig = {}) {
        this.config = {
            weights: { ...DEFAULT_CONFIG.weights, ...(userConfig.weights || {}) },
            thresholds: { ...DEFAULT_CONFIG.thresholds, ...(userConfig.thresholds || {}) },
            calibration: { ...DEFAULT_CONFIG.calibration, ...(userConfig.calibration || {}) },
            smoothing: { ...DEFAULT_CONFIG.smoothing, ...(userConfig.smoothing || {}) },
            dimensions: { ...DEFAULT_CONFIG.dimensions, ...(userConfig.dimensions || {}) }
        };

        this.reset();
    }

    reset() {
        this.consecutiveClosedFrames = 0;
        this.eyeClosureStartTime = null;
        this.isEyeClosed = false;
        this.lookingAwayStartTime = null;
        this.lookingDownStartTime = null;
        this.lookingUpStartTime = null;
        this.frameCount = 0;
        this.lastTimestamp = null;
        this.prevLandmarks = null;

        this.baselineEAR = null;
        this.calibratedCloseThreshold = this.config.thresholds.fallbackCloseThreshold;
        this.calibratedOpenThreshold = this.config.thresholds.fallbackOpenThreshold;
        this.isCalibratedEAR = false;

        this.smoothedCEI = null;
        this.smoothedAttentiveness = null;
        this.smoothedDistraction = null;
    }

    setCameraCalibration(calibrationOffsets = {}) {
        this.config.calibration = { ...this.config.calibration, ...calibrationOffsets };
    }

    calibrateBaselineEARFromSamples(samples = []) {
        const result = calibrateBaselineEAR(samples, this.config.thresholds);
        if (result.isCalibrated) {
            this.baselineEAR = result.baselineEAR;
            this.calibratedCloseThreshold = result.closeThreshold;
            this.calibratedOpenThreshold = result.openThreshold;
            this.isCalibratedEAR = true;
        }
        return result;
    }

    getWeights() {
        return { ...this.config.weights };
    }

    setWeights(newWeights) {
        this.config.weights = { ...this.config.weights, ...newWeights };
    }

    /**
     * Process a frame and return full structured metrics.
     *
     * @param {Array|null} landmarks - Facial landmarks array from MediaPipe.
     * @param {number} [timestamp=Date.now()] - Frame timestamp in milliseconds.
     * @param {Object} [audioContext={}] - Audio state (speechDetected, isMicMuted, isLecturerAudioMuted).
     */
    processFrame(landmarks, timestamp = Date.now(), audioContext = {}) {
        this.frameCount++;

        // 1. Observation Quality Assessment
        const quality = assessFacePresenceQuality(
            landmarks,
            this.config.dimensions.width,
            this.config.dimensions.height,
            { ...this.config.thresholds, prevLandmarks: this.prevLandmarks }
        );

        if (quality.isValid && landmarks) {
            this.prevLandmarks = landmarks;
        }

        // 2. Presence
        const presence = determinePresence(quality);

        // Compute real elapsed delta-time (dt) in seconds
        let dtSeconds = 0.033;
        if (this.lastTimestamp !== null && timestamp > this.lastTimestamp) {
            dtSeconds = (timestamp - this.lastTimestamp) / 1000.0;
        }
        this.lastTimestamp = timestamp;

        // 3. Audio State Representation (Isolated from visual CEI metrics)
        const isLecturerAudioMuted = Boolean(audioContext.isLecturerAudioMuted);
        const isMicMuted = Boolean(audioContext.isMicMuted);
        const isSpeechDetected = false; // Energy is not speech classification.

        // Stage 1/2 Check: Insufficient quality is marked as unknown, NOT penalized!
        if (quality.status === 'insufficient') {
            return {
                quality: 'insufficient',
                is_quality_sufficient: false,
                is_unknown: true,
                presence: null,
                attentiveness: null,
                distraction: null,
                ear: null,
                raw_cei: null,
                smoothed_cei: this.smoothedCEI,
                cei_score: this.smoothedCEI ?? 0.0,
                status: "Observation Insufficient",
                is_drowsy: false,
                is_looking_away: false,
                is_looking_down: false,
                is_looking_up: false,
                head_pose: { yaw: 0.0, pitch: 0.0, roll: 0.0 },
                behavioral_state: BEHAVIORAL_STATES.INSUFFICIENT_QUALITY,
                is_speech_detected: isSpeechDetected,
                is_mic_muted: isMicMuted,
                is_lecturer_audio_muted: isLecturerAudioMuted,
                audio_status: isLecturerAudioMuted ? "Lecturer Audio Muted" : (isMicMuted ? "Mic Muted" : "Active"),
                audio_evasion: false,
                quality_reason: quality.reason,
                multiple_faces_detected: Boolean(quality.multipleFacesDetected)
            };
        }

        // 4. Attention Proxies & Kinematics
        const attentionState = {
            consecutiveClosedFrames: this.consecutiveClosedFrames,
            eyeClosureStartTime: this.eyeClosureStartTime,
            isEyeClosed: this.isEyeClosed,
            lookingAwayStartTime: this.lookingAwayStartTime,
            lookingDownStartTime: this.lookingDownStartTime,
            lookingUpStartTime: this.lookingUpStartTime,
            calibratedCloseThreshold: this.calibratedCloseThreshold,
            calibratedOpenThreshold: this.calibratedOpenThreshold
        };

        const proxies = computeAttentionProxies(landmarks, quality, this.config, attentionState, timestamp);

        // Update internal state
        this.consecutiveClosedFrames = attentionState.consecutiveClosedFrames;
        this.eyeClosureStartTime = attentionState.eyeClosureStartTime;
        this.isEyeClosed = attentionState.isEyeClosed;
        this.lookingAwayStartTime = attentionState.lookingAwayStartTime;
        this.lookingDownStartTime = attentionState.lookingDownStartTime;
        this.lookingUpStartTime = attentionState.lookingUpStartTime;

        const attentiveness = proxies.attentiveness ?? 0.0;
        const distraction = proxies.distraction ?? 0.0;

        // 5. Raw CEI Formulation
        let rawCEI = 0.0;
        if (presence === 1.0) {
            rawCEI = calculateCEI(presence, attentiveness, distraction, this.config.weights);
        } else {
            rawCEI = 0.0; // Strictly forced to 0 when subject is absent
        }

        // 6. Time-Aware Temporal Smoothing
        if (this.config.smoothing.enabled) {
            this.smoothedCEI = applyTimeAwareEMA(this.smoothedCEI, rawCEI, dtSeconds, this.config.smoothing.tauSeconds);
            this.smoothedAttentiveness = applyTimeAwareEMA(this.smoothedAttentiveness, attentiveness, dtSeconds, this.config.smoothing.tauSeconds);
            this.smoothedDistraction = applyTimeAwareEMA(this.smoothedDistraction, distraction, dtSeconds, this.config.smoothing.tauSeconds);
        } else {
            this.smoothedCEI = rawCEI;
            this.smoothedAttentiveness = attentiveness;
            this.smoothedDistraction = distraction;
        }

        // 7. Status & Behavioral Inference
        let statusStr = "Attentive";
        let isAudioEvasion = false;

        if (presence === 0.0) {
            statusStr = "Subject Absent";
        } else if (proxies.isDrowsy) {
            statusStr = "Drowsy (Eyes Closed)";

        } else if (proxies.isLookingAway) {
            statusStr = "Looking Away";
        } else if (proxies.isLookingDown) {
            // Observable head-pose state (reading textbook, taking notes, or writing)
            statusStr = "Looking Down";
        } else if (proxies.isLookingUp) {
            statusStr = "Looking Up";
        } else if (proxies.behavioralState === BEHAVIORAL_STATES.HEAD_TILT) {
            statusStr = "Head Tilt";
        } else {
            statusStr = "Attentive";
        }

        return {
            quality: 'valid',
            is_quality_sufficient: true,
            is_unknown: false,
            presence,
            attentiveness: parseFloat(attentiveness.toFixed(4)),
            distraction: parseFloat(distraction.toFixed(4)),
            ear: parseFloat(proxies.avgEAR.toFixed(3)),
            raw_cei: parseFloat(rawCEI.toFixed(4)),
            smoothed_cei: parseFloat(this.smoothedCEI.toFixed(4)),
            cei_score: parseFloat(this.smoothedCEI.toFixed(4)),
            status: statusStr,
            behavioral_state: proxies.behavioralState,
            head_pose: proxies.headPose,
            is_drowsy: proxies.isDrowsy,
            is_looking_away: proxies.isLookingAway,
            is_looking_down: proxies.isLookingDown,
            is_looking_up: proxies.isLookingUp,
            is_speech_detected: isSpeechDetected,
            is_mic_muted: isMicMuted,
            is_lecturer_audio_muted: isLecturerAudioMuted,
            audio_status: isLecturerAudioMuted ? "Lecturer Audio Muted" : (isMicMuted ? "Mic Muted" : (isSpeechDetected ? "Speaking" : "No vocal inference")),
            audio_evasion: isAudioEvasion,
            quality_reason: quality.reason,
            multiple_faces_detected: Boolean(quality.multipleFacesDetected)
        };
    }
}

export default EngagementEngine;


/** Local observations, never a speech classifier or inference about intent. */
export function observeAudio({optedIn=false, available=false, micMuted=false, lecturerMuted=false, samples=null}={}) {
    const valid = samples && samples.length && Array.from(samples).every(Number.isFinite);
    const measurable = optedIn && available && !micMuted && valid;
    const rms = measurable ? Math.sqrt(Array.from(samples).reduce((sum,x)=>sum+x*x,0)/samples.length) : null;
    return {analysis: optedIn ? 'enabled' : 'disabled',
        microphone: !available ? 'unavailable' : micMuted ? 'muted' : 'available',
        lecturer: lecturerMuted ? 'muted' : 'audible',
        energy: rms === null ? 'unknown' : rms > 0.02 ? 'elevated' : 'low',
        rms, vocal_activity: 'unknown', uncertainty: 'Audio energy cannot distinguish speech from background noise.'};
}
export function multimodalObservation(visual, audio) {
    return {face_presence: visual.is_unknown ? 'unknown' : visual.presence ? 'detected' : 'not_detected',
        eye_closure: visual.is_unknown ? 'unknown' : visual.is_drowsy ? 'prolonged' : 'not_prolonged',
        head_orientation: visual.is_unknown ? null : visual.head_pose || null,
        audio, interpretation: 'Observable signals only; not proof of attention or misconduct.',
        uncertainty: visual.is_unknown ? 'Insufficient visual data' : 'Head pose and eye closure have multiple possible explanations'};
}
