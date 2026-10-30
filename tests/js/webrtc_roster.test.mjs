import test from 'node:test';
import assert from 'node:assert/strict';
import { displayName, shouldPrune } from '../../core/roster.mjs';
test('Roster uses metadata and strips only the random suffix', () => {
    assert.equal(displayName('room','room-student-Alice-42'), 'Alice');
    assert.equal(displayName('room','room-student-Classroom-101-0'), 'Classroom-101');
    assert.equal(displayName('room','room-student-Alice-42',{studentName:'Alice Smith 101'}), 'Alice Smith 101');
});
test('Watchdog preserves live media without a data channel and prunes disconnected peers', () => {
    const student = { lastSeen: 0, call: {peerConnection: {connectionState:'connected'}} };
    assert.equal(shouldPrune(student, 20000), false);
    student.call.peerConnection = {iceConnectionState:'completed'};
    assert.equal(shouldPrune(student, 20000), false);
    student.call.peerConnection = {connectionState:'disconnected'};
    assert.equal(shouldPrune(student, 33000), true);
    assert.equal(shouldPrune({...student, lastSeen:19000}, 20000), false);
});
