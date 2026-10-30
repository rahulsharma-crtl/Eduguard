import test from 'node:test';
import assert from 'node:assert/strict';

// Logic from components/teacher_room/frontend/index.html lines 641-642:
function extractDisplayName(currentRoomId, peerId) {
    let displayName = peerId.replace(`${currentRoomId}-`, "").replace("student-", "");
    displayName = displayName.replace(/-[0-9]{3,5}$/, "") || "Student";
    return displayName;
}

test('extractDisplayName works for standard alphanumeric names', () => {
    const roomId = 'EduGuard-Math101-abcd12';
    const peerId = 'EduGuard-Math101-abcd12-student-Alice-8492';
    assert.equal(extractDisplayName(roomId, peerId), 'Alice');
});

test('extractDisplayName defect: small random number (<100) fails regex strip', () => {
    const roomId = 'EduGuard-Math101-abcd12';
    // Math.floor(Math.random() * 10000) can generate 2-digit numbers like 42
    const peerId = 'EduGuard-Math101-abcd12-student-Alice-42';
    const extracted = extractDisplayName(roomId, peerId);
    // VERIFIED DEFECT: 2-digit random suffix is not stripped because regex requires {3,5} digits
    assert.equal(extracted, 'Alice-42');
});

test('Watchdog prunes student after 8s if no DataChannel heartbeat received', () => {
    const connectedStudents = new Map();
    const peerId = 'EduGuard-test-student-Bob-1234';
    
    // Connected 9 seconds ago
    const nineSecondsAgo = Date.now() - 9000;
    connectedStudents.set(peerId, { lastSeen: nineSecondsAgo, studentName: 'Bob' });

    // Watchdog simulation
    const now = Date.now();
    for (const [id, student] of connectedStudents.entries()) {
        if (student.lastSeen && (now - student.lastSeen > 8000)) {
            connectedStudents.delete(id);
        }
    }

    assert.equal(connectedStudents.has(peerId), false);
});
