// Historical copied-function fixtures; these do not import the current engine.
// The old pitch defect below is intentionally reproduced, not a current bug claim.
import test from 'node:test';
import assert from 'node:assert/strict';

// Historical copied EAR helper from an earlier student frontend:
function ptDist(p1, p2) {
    const dx = (p1.x - p2.x) * 640;
    const dy = (p1.y - p2.y) * 480;
    return Math.sqrt(dx * dx + dy * dy);
}

function computeEAR(landmarks, indices) {
    const p1 = landmarks[indices[0]];
    const p2 = landmarks[indices[1]];
    const p3 = landmarks[indices[2]];
    const p4 = landmarks[indices[3]];
    const p5 = landmarks[indices[4]];
    const p6 = landmarks[indices[5]];

    const v1 = ptDist(p2, p6);
    const v2 = ptDist(p3, p5);
    const h = ptDist(p1, p4);

    if (h < 1e-5) return 0.0;
    return (v1 + v2) / (2.0 * h);
}

// Historical copied pitch-ratio helper from an earlier student frontend:
function computePitchPose(forehead, nose, chin) {
    const dTop = Math.abs(nose.y - forehead.y);
    const dBot = Math.abs(chin.y - nose.y);
    const pitchRatio = (dBot > 0) ? (dTop / dBot) : 1.0;
    let isLookingDown = false;
    let statusStr = "Attentive";

    if (pitchRatio < 0.45 || pitchRatio > 2.3) {
        isLookingDown = true;
        statusStr = "Looking Down";
    }

    return { pitchRatio, isLookingDown, statusStr };
}

test('Historical copied computeEAR handles zero eye width gracefully without NaN or ZeroDivisionError', () => {
    const landmarks = {
        0: { x: 0.5, y: 0.5 },
        1: { x: 0.5, y: 0.5 },
        2: { x: 0.5, y: 0.5 },
        3: { x: 0.5, y: 0.5 },
        4: { x: 0.5, y: 0.5 },
        5: { x: 0.5, y: 0.5 }
    };
    const ear = computeEAR(landmarks, [0, 1, 2, 3, 4, 5]);
    assert.equal(ear, 0.0);
});

test('Historical copied pitch defect: Looking UP triggers isLookingDown = true and status "Looking Down"', () => {
    // Looking up: forehead moves up and back; nose is high close to forehead; chin is far below
    // forehead.y = 0.20, nose.y = 0.24, chin.y = 0.60
    // dTop = |0.24 - 0.20| = 0.04
    // dBot = |0.60 - 0.24| = 0.36
    // pitchRatio = 0.04 / 0.36 = 0.111 (< 0.45)
    const result = computePitchPose(
        { x: 0.5, y: 0.20 }, // forehead
        { x: 0.5, y: 0.24 }, // nose
        { x: 0.5, y: 0.60 }  // chin
    );

    assert.ok(result.pitchRatio < 0.45);
    // Historical fixture defect: Pitch ratio < 0.45 means looking UP, but code flags isLookingDown = true!
    assert.equal(result.isLookingDown, true);
    assert.equal(result.statusStr, "Looking Down");
});
