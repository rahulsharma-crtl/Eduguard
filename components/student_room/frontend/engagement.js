/**
 * EduGuard Engagement Engine & Facial Behavior Pipeline (Browser / Universal Module)
 * ==================================================================================
 * Standalone, testable module for observation quality assessment, presence determination,
 * calibrated geometric 3D head-pose estimation, elapsed-time eye-closure tracking,
 * individual EAR baseline calibration with Schmitt-trigger hysteresis, and Composite
 * Engagement Index (CEI) inference.
 */

(function (global, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define(factory);
    } else {
        global = typeof globalThis !== 'undefined' ? globalThis : global || self;
        global.EduGuardEngagement = factory();
    }
})(this, function () {
    'use strict';

    const BEHAVIORAL_STATES = Object.freeze({
        ATTENTIVE: 'ATTENTIVE',
        NATURAL_BLINK: 'NATURAL_BLINK',
        PROLONGED_EYE_CLOSURE: 'PROLONGED_EYE_CLOSURE',
        LOOKING_AWAY: 'LOOKING_AWAY',
        LOOKING_DOWN: 'LOOKING_DOWN',
        LOOKING_UP: 'LOOKING_UP',
        FACE_NOT_DETECTED: 'FACE_NOT_DETECTED',
        INSUFFICIENT_QUALITY: 'INSUFFICIENT_QUALITY'
    });

    const DEFAULT_CONFIG = Object.freeze({
        weights: Object.freeze({
            presence: 0.30,
            attentiveness: 0.45,
            distraction: 0.25
        }),
        thresholds: Object.freeze({
            earThreshold: 0.21,
            earCloseRatio: 0.72,
            earOpenRatio: 0.85,
            fallbackCloseThreshold: 0.19,
            fallbackOpenThreshold: 0.23,
            blinkMaxDurationMs: 400,
            drowsinessDurationMs: 1000,
            drowsinessFrames: 15,
            microBlinkFrames: 4,
            yawLimitDegrees: 25.0,
            pitchLookingDownDegrees: -15.0,
            pitchLookingUpDegrees: 20.0,
            rollLimitDegrees: 25.0,
            gazeDeviationDurationMs: 1500,
            yawMin: 0.40,
            yawMax: 2.30,
            pitchMin: 0.45,
            pitchMax: 2.30,
            penalizeLookingDown: false,
            minInterocularDistance: 15.0,
            minFaceHeight: 20.0,
            minLandmarkCount: 468,
            boundaryClipMargin: 0.02,
            maxLandmarkJitter: 35.0
        }),
        calibration: Object.freeze({
            pitchOffset: 0.0,
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

    const LANDMARK_INDICES = Object.freeze({
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

    function ptDist(p1, p2, width, height) {
        width = width || 640;
        height = height || 480;
        if (!p1 || !p2) return 0.0;
        const dx = (p1.x - p2.x) * width;
        const dy = (p1.y - p2.y) * height;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function ptDist3D(p1, p2, width, height) {
        width = width || 640;
        height = height || 480;
        if (!p1 || !p2) return 0.0;
        const dx = (p1.x - p2.x) * width;
        const dy = (p1.y - p2.y) * height;
        const dz = ((p1.z || 0) - (p2.z || 0)) * width;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function computeEAR(landmarks, indices, width, height) {
        width = width || 640;
        height = height || 480;
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

    function calibrateBaselineEAR(earSamples, config) {
        config = config || DEFAULT_CONFIG.thresholds;
        if (!earSamples || !Array.isArray(earSamples) || earSamples.length < 5) {
            return {
                baselineEAR: config.earThreshold || 0.21,
                closeThreshold: config.fallbackCloseThreshold || 0.19,
                openThreshold: config.fallbackOpenThreshold || 0.23,
                isCalibrated: false,
                sampleCount: earSamples ? earSamples.length : 0
            };
        }

        const valid = earSamples.filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0.15 && v <= 0.50);
        if (valid.length < 5) {
            return {
                baselineEAR: config.earThreshold || 0.21,
                closeThreshold: config.fallbackCloseThreshold || 0.19,
                openThreshold: config.fallbackOpenThreshold || 0.23,
                isCalibrated: false,
                sampleCount: valid.length
            };
        }

        valid.sort((a, b) => a - b);
        const mid = Math.floor(valid.length / 2);
        const medianEAR = (valid.length % 2 !== 0) ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2.0;

        const closeRatio = config.earCloseRatio || 0.72;
        const openRatio = config.earOpenRatio || 0.85;

        return {
            baselineEAR: parseFloat(medianEAR.toFixed(3)),
            closeThreshold: parseFloat((medianEAR * closeRatio).toFixed(3)),
            openThreshold: parseFloat((medianEAR * openRatio).toFixed(3)),
            isCalibrated: true,
            sampleCount: valid.length
        };
    }

    function isEyeClosed(ear, closeThreshold, openThreshold, currentState) {
        currentState = Boolean(currentState);
        if (typeof ear !== 'number' || Number.isNaN(ear)) return false;
        if (currentState) {
            return ear <= openThreshold;
        } else {
            return ear < closeThreshold;
        }
    }

    function estimateHeadPose(landmarks, options) {
        options = options || {};
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

        const width = options.width || DEFAULT_CONFIG.dimensions.width;
        const height = options.height || DEFAULT_CONFIG.dimensions.height;
        const calibration = options.calibration || DEFAULT_CONFIG.calibration;

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

            const vx = {
                x: pLeftEye.x - pRightEye.x,
                y: pLeftEye.y - pRightEye.y,
                z: pLeftEye.z - pRightEye.z
            };
            const lenX = Math.sqrt(vx.x * vx.x + vx.y * vx.y + vx.z * vx.z) || 1e-6;
            const ux = { x: vx.x / lenX, y: vx.y / lenX, z: vx.z / lenX };

            const vy = {
                x: pForehead.x - pChin.x,
                y: pForehead.y - pChin.y,
                z: pForehead.z - pChin.z
            };
            const dotXY = vy.x * ux.x + vy.y * ux.y + vy.z * ux.z;
            const vy_ortho = {
                x: vy.x - dotXY * ux.x,
                y: vy.y - dotXY * ux.y,
                z: vy.z - dotXY * ux.z
            };
            const lenY = Math.sqrt(vy_ortho.x * vy_ortho.x + vy_ortho.y * vy_ortho.y + vy_ortho.z * vy_ortho.z) || 1e-6;
            const uy = { x: vy_ortho.x / lenY, y: vy_ortho.y / lenY, z: vy_ortho.z / lenY };

            const uz = {
                x: ux.y * uy.z - ux.z * uy.y,
                y: ux.z * uy.x - ux.x * uy.z,
                z: ux.x * uy.y - ux.y * uy.x
            };

            pitchRaw = Math.atan2(uz.y, Math.sqrt(uz.x * uz.x + uz.z * uz.z)) * toDeg;
            yawRaw = Math.atan2(uz.x, uz.z) * toDeg;
            rollRaw = Math.atan2(ux.y, ux.x) * toDeg;

            rotationMatrix = [
                [ux.x, uy.x, uz.x],
                [ux.y, uy.y, uz.y],
                [ux.z, uy.z, uz.z]
            ];
        } else {
            const eyeMidX = (leftEye.x + rightEye.x) / 2.0;
            const eyeDx = (leftEye.x - rightEye.x) * width;
            const eyeDy = (leftEye.y - rightEye.y) * height;
            const eyeSpan = Math.sqrt(eyeDx * eyeDx + eyeDy * eyeDy) || 1.0;

            rollRaw = Math.atan2(eyeDy, eyeDx) * toDeg;

            const noseOffset = (nose.x - eyeMidX) * width;
            const normalizedYawRatio = noseOffset / (eyeSpan * 0.35);
            yawRaw = Math.atan(normalizedYawRatio) * toDeg;

            const dTop = Math.abs(nose.y - forehead.y);
            const dBot = Math.abs(chin.y - nose.y);
            const pitchRatio = (dBot > 1e-5) ? (dTop / dBot) : 0.80;
            pitchRaw = -Math.atan((pitchRatio - 0.80) * 1.5) * toDeg;
        }

        const pitchOffset = calibration.pitchOffset || 0.0;
        const yawOffset = calibration.yawOffset || 0.0;
        const rollOffset = calibration.rollOffset || 0.0;

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
            rotationMatrix: rotationMatrix,
            is3D: hasZ,
            calibrationApplied: Boolean(pitchOffset || yawOffset || rollOffset)
        };
    }

    function calibrateCameraOffset(neutralSamples) {
        if (!neutralSamples || !Array.isArray(neutralSamples) || neutralSamples.length < 3) {
            return { pitchOffset: 0.0, yawOffset: 0.0, rollOffset: 0.0, sampleCount: 0 };
        }
        let sumPitch = 0, sumYaw = 0, sumRoll = 0, count = 0;
        for (let i = 0; i < neutralSamples.length; i++) {
            const s = neutralSamples[i];
            const raw = s.raw || s;
            if (typeof raw.pitch === 'number' && Number.isFinite(raw.pitch)) {
                sumPitch += raw.pitch;
                sumYaw += (raw.yaw || 0.0);
                sumRoll += (raw.roll || 0.0);
                count++;
            }
        }
        if (count === 0) return { pitchOffset: 0.0, yawOffset: 0.0, rollOffset: 0.0, sampleCount: 0 };
        return {
            pitchOffset: parseFloat((sumPitch / count).toFixed(2)),
            yawOffset: parseFloat((sumYaw / count).toFixed(2)),
            rollOffset: parseFloat((sumRoll / count).toFixed(2)),
            sampleCount: count
        };
    }

    function assessLandmarkConfidence(landmarks, options) {
        options = options || {};
        const width = options.width || DEFAULT_CONFIG.dimensions.width;
        const height = options.height || DEFAULT_CONFIG.dimensions.height;
        const minCount = options.minLandmarkCount || DEFAULT_CONFIG.thresholds.minLandmarkCount;
        const clipMargin = options.boundaryClipMargin || DEFAULT_CONFIG.thresholds.boundaryClipMargin;
        const prevLandmarks = options.prevLandmarks || null;
        const maxJitter = options.maxLandmarkJitter || DEFAULT_CONFIG.thresholds.maxLandmarkJitter;

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

        for (let i = 0; i < criticalIndices.length; i++) {
            const idx = criticalIndices[i];
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

        const isBoundaryClipped = (
            minX <= clipMargin || maxX >= (1.0 - clipMargin) ||
            minY <= clipMargin || maxY >= (1.0 - clipMargin)
        );

        let jitter = 0.0;
        if (prevLandmarks && Array.isArray(prevLandmarks) && prevLandmarks.length >= minCount) {
            let totalSqDist = 0;
            let evaluatedCount = 0;
            for (let i = 0; i < criticalIndices.length; i++) {
                const idx = criticalIndices[i];
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
            isConfidenceSufficient: isConfidenceSufficient,
            confidenceScore: isConfidenceSufficient ? 1.0 : 0.40,
            isBoundaryClipped: isBoundaryClipped,
            jitter: parseFloat(jitter.toFixed(2)),
            reason: isBoundaryClipped ? 'boundary_clipped' : (jitter > maxJitter ? 'excessive_jitter' : 'ok')
        };
    }

    function assessFacePresenceQuality(landmarks, width, height, options) {
        width = width || 640;
        height = height || 480;
        options = options || {};

        let primaryLandmarks = landmarks;
        let multipleFacesDetected = false;

        if (Array.isArray(landmarks) && landmarks.length > 0 && Array.isArray(landmarks[0])) {
            multipleFacesDetected = landmarks.length > 1;
            let maxArea = -1;
            for (let i = 0; i < landmarks.length; i++) {
                const face = landmarks[i];
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
                multipleFacesDetected: multipleFacesDetected,
                metrics: null
            };
        }

        const minCount = options.minLandmarkCount || DEFAULT_CONFIG.thresholds.minLandmarkCount;
        const minEyeDist = options.minInterocularDistance || DEFAULT_CONFIG.thresholds.minInterocularDistance;
        const minFaceH = options.minFaceHeight || DEFAULT_CONFIG.thresholds.minFaceHeight;

        if (primaryLandmarks.length < minCount) {
            return {
                status: 'insufficient',
                isValid: false,
                isAbsent: false,
                isUnknown: true,
                reason: 'insufficient_landmarks',
                multipleFacesDetected: multipleFacesDetected,
                metrics: { count: primaryLandmarks.length }
            };
        }

        const confidence = assessLandmarkConfidence(primaryLandmarks, { width: width, height: height, ...options });
        if (!confidence.isConfidenceSufficient) {
            return {
                status: 'insufficient',
                isValid: false,
                isAbsent: false,
                isUnknown: true,
                reason: confidence.reason,
                multipleFacesDetected: multipleFacesDetected,
                metrics: confidence
            };
        }

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
                multipleFacesDetected: multipleFacesDetected,
                metrics: { interocularDist: interocularDist, faceHeight: faceHeight }
            };
        }

        return {
            status: 'valid',
            isValid: true,
            isAbsent: false,
            isUnknown: false,
            reason: 'ok',
            multipleFacesDetected: multipleFacesDetected,
            metrics: {
                count: primaryLandmarks.length,
                interocularDist: interocularDist,
                faceHeight: faceHeight,
                confidence: confidence.confidenceScore
            }
        };
    }

    function assessObservationQuality(landmarks, width, height, options) {
        return assessFacePresenceQuality(landmarks, width, height, options);
    }

    function determinePresence(quality) {
        if (!quality || quality.isAbsent) return 0.0;
        if (quality.isValid) return 1.0;
        return null;
    }

    function computeHeadPose(landmarks, thresholds, options) {
        thresholds = thresholds || DEFAULT_CONFIG.thresholds;
        options = options || {};
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

        const pose3D = estimateHeadPose(landmarks, { ...options, thresholds: thresholds });

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

        const yawLimit = thresholds.yawLimitDegrees || 25.0;
        const isAwayAngle = Math.abs(pose3D.yaw) > yawLimit;
        const isAwayRatio = (yawRatio < (thresholds.yawMin || 0.40) || yawRatio > (thresholds.yawMax || 2.30));
        const isLookingAway = isAwayAngle || isAwayRatio;

        const isDownAngle = pose3D.pitch < (thresholds.pitchLookingDownDegrees || -15.0);
        const isDownRatio = (pitchRatio > (thresholds.pitchMax || 2.30));
        const isLookingDown = isDownAngle || isDownRatio;

        const isUpAngle = pose3D.pitch > (thresholds.pitchLookingUpDegrees || 20.0);
        const isUpRatio = (pitchRatio < (thresholds.pitchMin || 0.45));
        const isLookingUp = isUpAngle || isUpRatio;

        return {
            yaw: pose3D.yaw,
            pitch: pose3D.pitch,
            roll: pose3D.roll,
            yawRatio: yawRatio,
            pitchRatio: pitchRatio,
            isLookingAway: isLookingAway,
            isLookingDown: isLookingDown,
            isLookingUp: isLookingUp,
            isGazeDiverted: isLookingAway || isLookingDown || isLookingUp,
            rotationMatrix: pose3D.rotationMatrix,
            is3D: pose3D.is3D
        };
    }

    function classifyBehavioralState(context) {
        context = context || {};
        const quality = context.quality;
        if (!quality || quality.isAbsent) return BEHAVIORAL_STATES.FACE_NOT_DETECTED;
        if (!quality.isValid) return BEHAVIORAL_STATES.INSUFFICIENT_QUALITY;

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

        return BEHAVIORAL_STATES.ATTENTIVE;
    }

    function computeAttentionProxies(landmarks, quality, options, state, timestamp) {
        options = options || {};
        state = state || {};
        timestamp = timestamp || Date.now();

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

        const thresholds = { ...DEFAULT_CONFIG.thresholds, ...(options.thresholds || {}) };
        const width = options.width || DEFAULT_CONFIG.dimensions.width;
        const height = options.height || DEFAULT_CONFIG.dimensions.height;

        const rightEAR = computeEAR(landmarks, LANDMARK_INDICES.RIGHT_EYE, width, height);
        const leftEAR = computeEAR(landmarks, LANDMARK_INDICES.LEFT_EYE, width, height);
        const avgEAR = (rightEAR + leftEAR) / 2.0;

        const closeThresh = state.calibratedCloseThreshold || thresholds.fallbackCloseThreshold;
        const openThresh = state.calibratedOpenThreshold || thresholds.fallbackOpenThreshold;
        const prevClosedState = Boolean(state.isEyeClosed);
        const eyeCurrentlyClosed = isEyeClosed(avgEAR, closeThresh, openThresh, prevClosedState);
        state.isEyeClosed = eyeCurrentlyClosed;

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

        const isDrowsy = (closureDurationMs >= thresholds.drowsinessDurationMs) ||
                         (state.consecutiveClosedFrames >= thresholds.drowsinessFrames);
        const isNaturalBlink = eyeCurrentlyClosed && !isDrowsy && (closureDurationMs <= thresholds.blinkMaxDurationMs);

        const pose = computeHeadPose(landmarks, thresholds, options);

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

        const behavioralState = classifyBehavioralState({
            quality: quality,
            isEyeClosed: eyeCurrentlyClosed,
            closureDurationMs: closureDurationMs,
            drowsinessDurationMs: thresholds.drowsinessDurationMs,
            pose: pose,
            awayDurationMs: awayDurationMs,
            downDurationMs: downDurationMs,
            upDurationMs: upDurationMs,
            gazeDeviationDurationMs: thresholds.gazeDeviationDurationMs
        });

        let attentiveness = 1.0;
        let distraction = 0.0;

        if (isDrowsy) {
            attentiveness -= 0.50;
        } else if (state.consecutiveClosedFrames > thresholds.microBlinkFrames && !isNaturalBlink) {
            attentiveness -= 0.15;
        }

        if (pose.isLookingAway) {
            attentiveness -= 0.35;
            distraction += 0.30;
        }

        if (pose.isLookingDown) {
            if (thresholds.penalizeLookingDown) {
                attentiveness -= 0.25;
                distraction += 0.20;
            }
        }

        if (pose.isLookingUp) {
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
            closureDurationMs: closureDurationMs,
            isEyeClosed: eyeCurrentlyClosed,
            isNaturalBlink: isNaturalBlink,
            isDrowsy: isDrowsy,
            isLookingAway: pose.isLookingAway,
            isLookingDown: pose.isLookingDown,
            isLookingUp: pose.isLookingUp,
            isGazeDiverted: pose.isGazeDiverted,
            behavioralState: behavioralState,
            attentiveness: attentiveness,
            distraction: distraction,
            headPose: {
                yaw: pose.yaw,
                pitch: pose.pitch,
                roll: pose.roll
            }
        };
    }

    function calculateCEI(presence, attentiveness, distraction, weights) {
        if (presence === null || presence === undefined || presence <= 0.0) {
            return 0.0;
        }

        const P = Math.max(0.0, Math.min(1.0, presence));
        const A = Math.max(0.0, Math.min(1.0, attentiveness !== null && attentiveness !== undefined ? attentiveness : 0.0));
        const D = Math.max(0.0, Math.min(1.0, distraction !== null && distraction !== undefined ? distraction : 0.0));

        weights = weights || DEFAULT_CONFIG.weights;
        const wP = weights.presence !== undefined ? weights.presence : DEFAULT_CONFIG.weights.presence;
        const wA = weights.attentiveness !== undefined ? weights.attentiveness : DEFAULT_CONFIG.weights.attentiveness;
        const wD = weights.distraction !== undefined ? weights.distraction : DEFAULT_CONFIG.weights.distraction;

        const raw = (wP * P) + (wA * A) + (wD * (1.0 - D));
        return Math.max(0.0, Math.min(1.0, raw));
    }

    function applyTimeAwareEMA(currentSmoothed, rawValue, dtSeconds, tauSeconds) {
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
        const tau = Math.max(0.1, tauSeconds || DEFAULT_CONFIG.smoothing.tauSeconds);
        const alpha = 1.0 - Math.exp(-boundedDt / tau);

        const updated = currentSmoothed + alpha * (rawValue - currentSmoothed);
        return Math.max(0.0, Math.min(1.0, updated));
    }

    class EngagementEngine {
        constructor(userConfig) {
            userConfig = userConfig || {};
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

        setCameraCalibration(calibrationOffsets) {
            this.config.calibration = { ...this.config.calibration, ...(calibrationOffsets || {}) };
        }

        calibrateBaselineEARFromSamples(samples) {
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
            this.config.weights = { ...this.config.weights, ...(newWeights || {}) };
        }

        processFrame(landmarks, timestamp, audioContext) {
            timestamp = timestamp || Date.now();
            audioContext = audioContext || {};
            this.frameCount++;

            const quality = assessFacePresenceQuality(
                landmarks,
                this.config.dimensions.width,
                this.config.dimensions.height,
                { ...this.config.thresholds, prevLandmarks: this.prevLandmarks }
            );

            if (quality.isValid && landmarks) {
                this.prevLandmarks = landmarks;
            }

            const presence = determinePresence(quality);

            let dtSeconds = 0.033;
            if (this.lastTimestamp !== null && timestamp > this.lastTimestamp) {
                dtSeconds = (timestamp - this.lastTimestamp) / 1000.0;
            }
            this.lastTimestamp = timestamp;

            const isLecturerAudioMuted = Boolean(audioContext.isLecturerAudioMuted);
            const isMicMuted = Boolean(audioContext.isMicMuted);
            const isSpeechDetected = Boolean(audioContext.isSpeechDetected);

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
                    cei_score: this.smoothedCEI || 0.0,
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

            this.consecutiveClosedFrames = attentionState.consecutiveClosedFrames;
            this.eyeClosureStartTime = attentionState.eyeClosureStartTime;
            this.isEyeClosed = attentionState.isEyeClosed;
            this.lookingAwayStartTime = attentionState.lookingAwayStartTime;
            this.lookingDownStartTime = attentionState.lookingDownStartTime;
            this.lookingUpStartTime = attentionState.lookingUpStartTime;

            const attentiveness = proxies.attentiveness !== null ? proxies.attentiveness : 0.0;
            const distraction = proxies.distraction !== null ? proxies.distraction : 0.0;

            let rawCEI = 0.0;
            if (presence === 1.0) {
                rawCEI = calculateCEI(presence, attentiveness, distraction, this.config.weights);
            } else {
                rawCEI = 0.0;
            }

            if (this.config.smoothing.enabled) {
                this.smoothedCEI = applyTimeAwareEMA(this.smoothedCEI, rawCEI, dtSeconds, this.config.smoothing.tauSeconds);
                this.smoothedAttentiveness = applyTimeAwareEMA(this.smoothedAttentiveness, attentiveness, dtSeconds, this.config.smoothing.tauSeconds);
                this.smoothedDistraction = applyTimeAwareEMA(this.smoothedDistraction, distraction, dtSeconds, this.config.smoothing.tauSeconds);
            } else {
                this.smoothedCEI = rawCEI;
                this.smoothedAttentiveness = attentiveness;
                this.smoothedDistraction = distraction;
            }

            let statusStr = "Attentive";
            let isAudioEvasion = false;

            if (presence === 0.0) {
                statusStr = "Subject Absent";
            } else if (proxies.isDrowsy) {
                statusStr = "Drowsy (Eyes Closed)";
            } else if (isSpeechDetected && proxies.isGazeDiverted) {
                isAudioEvasion = true;
                statusStr = "Speaking (Gaze Diverted)";
            } else if (proxies.isLookingAway) {
                statusStr = "Looking Away";
            } else if (proxies.isLookingDown) {
                statusStr = "Looking Down";
            } else if (proxies.isLookingUp) {
                statusStr = "Looking Up";
            } else {
                statusStr = "Attentive";
            }

            return {
                quality: 'valid',
                is_quality_sufficient: true,
                is_unknown: false,
                presence: presence,
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
                audio_status: isLecturerAudioMuted ? "Lecturer Audio Muted" : (isMicMuted ? "Mic Muted" : (isSpeechDetected ? "Speaking" : "Quiet / Clean")),
                audio_evasion: isAudioEvasion,
                quality_reason: quality.reason,
                multiple_faces_detected: Boolean(quality.multipleFacesDetected)
            };
        }
    }

    return {
        BEHAVIORAL_STATES: BEHAVIORAL_STATES,
        DEFAULT_CONFIG: DEFAULT_CONFIG,
        LANDMARK_INDICES: LANDMARK_INDICES,
        ptDist: ptDist,
        ptDist3D: ptDist3D,
        computeEAR: computeEAR,
        calibrateBaselineEAR: calibrateBaselineEAR,
        isEyeClosed: isEyeClosed,
        estimateHeadPose: estimateHeadPose,
        calibrateCameraOffset: calibrateCameraOffset,
        assessLandmarkConfidence: assessLandmarkConfidence,
        assessFacePresenceQuality: assessFacePresenceQuality,
        assessObservationQuality: assessObservationQuality,
        determinePresence: determinePresence,
        computeHeadPose: computeHeadPose,
        classifyBehavioralState: classifyBehavioralState,
        computeAttentionProxies: computeAttentionProxies,
        calculateCEI: calculateCEI,
        applyTimeAwareEMA: applyTimeAwareEMA,
        EngagementEngine: EngagementEngine
    };
});
