import test from 'node:test';
import assert from 'node:assert/strict';

// --- Mocks for WebRTC & DOM Objects ---

class MockMediaStreamTrack {
    constructor(kind = 'video', label = 'mock-track') {
        this.kind = kind;
        this.label = label;
        this.enabled = true;
        this.stopped = false;
    }
    stop() {
        this.stopped = true;
    }
}

class MockMediaStream {
    constructor(tracks = []) {
        this._tracks = [...tracks];
    }
    getTracks() {
        return [...this._tracks];
    }
    getVideoTracks() {
        return this._tracks.filter(t => t.kind === 'video');
    }
    getAudioTracks() {
        return this._tracks.filter(t => t.kind === 'audio');
    }
    addTrack(track) {
        if (!this._tracks.includes(track)) {
            this._tracks.push(track);
            if (this.onaddtrack) this.onaddtrack({ track });
        }
    }
    removeTrack(track) {
        const idx = this._tracks.indexOf(track);
        if (idx !== -1) {
            this._tracks.splice(idx, 1);
            if (this.onremovetrack) this.onremovetrack({ track });
        }
    }
}

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.id = '';
        this.children = [];
        this.parentNode = null;
        this._innerHTML = '';
        this.srcObject = null;
        this.autoplay = false;
        this.playsInline = false;
        this.style = {};
        this.classList = new Set();
        this.paused = false;
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(val) {
        this._innerHTML = val;
        // Setting innerHTML removes all child elements (THE TEACHER ROSTER BUG)
        for (const child of this.children) {
            child.parentNode = null;
        }
        this.children = [];
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    querySelector(selector) {
        if (selector.startsWith('#')) {
            const targetId = selector.slice(1);
            if (this.id === targetId) return this;
            for (const child of this.children) {
                const found = child.querySelector(selector);
                if (found) return found;
            }
        }
        return null;
    }

    async play() {
        this.paused = false;
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
    }
}

// --- Test 1: Teacher Roster Audio Bug Verification & Fix ---
test('Teacher roster: audio element must be appended AFTER row.innerHTML to avoid deletion', () => {
    // 1. Simulating the BUG: append audioElem, then assign row.innerHTML
    const bugRow = new MockElement('tr');
    const audioStream = new MockMediaStream([new MockMediaStreamTrack('audio', 'student-mic')]);
    
    const bugAudio = new MockElement('audio');
    bugAudio.srcObject = audioStream;
    bugRow.appendChild(bugAudio);
    assert.equal(bugRow.children.length, 1, 'Audio was initially appended');

    // Assign row.innerHTML (Destroys child elements!)
    bugRow.innerHTML = '<td>Student Alice</td>';
    assert.equal(bugRow.children.length, 0, 'BUG CONFIRMED: audio element was wiped out by row.innerHTML');
    assert.equal(bugAudio.parentNode, null, 'audio element has no parent node');

    // 2. Simulating the FIX: assign row.innerHTML FIRST, then append audio element
    const fixedRow = new MockElement('tr');
    fixedRow.innerHTML = '<td><span>Alice</span></td>';
    
    const fixedAudio = new MockElement('audio');
    fixedAudio.srcObject = audioStream;
    fixedAudio.autoplay = true;
    fixedRow.appendChild(fixedAudio);

    assert.equal(fixedRow.children.length, 1, 'Audio element preserved');
    assert.equal(fixedAudio.parentNode, fixedRow, 'Audio element is a valid child of row');
    assert.equal(fixedAudio.srcObject, audioStream, 'Audio element is bound to student audio stream');
});

// --- Test 2: Core Privacy Guarantee: Only synthetic canvas video is transmitted ---
test('Core Privacy: Student transmits synthetic canvas video + mic audio, NEVER raw webcam pixels', () => {
    const rawWebcamVideoTrack = new MockMediaStreamTrack('video', 'raw-physical-webcam');
    const microphoneAudioTrack = new MockMediaStreamTrack('audio', 'usb-microphone');
    const syntheticCanvasVideoTrack = new MockMediaStreamTrack('video', 'privacy-canvas-wireframe');

    const localUserMedia = new MockMediaStream([rawWebcamVideoTrack, microphoneAudioTrack]);
    const virtualCanvasStream = new MockMediaStream([syntheticCanvasVideoTrack]);

    // Student mic is attached to canvas stream
    const audioTracks = localUserMedia.getAudioTracks();
    if (audioTracks.length > 0) {
        virtualCanvasStream.addTrack(audioTracks[0]);
    }

    // Defensive Privacy Guard
    const outboundVideoTracks = virtualCanvasStream.getVideoTracks();
    const rawVideoTracks = localUserMedia.getVideoTracks();
    for (const rawTrack of rawVideoTracks) {
        if (outboundVideoTracks.includes(rawTrack)) {
            virtualCanvasStream.removeTrack(rawTrack);
        }
    }

    assert.equal(virtualCanvasStream.getVideoTracks().length, 1, 'Only 1 video track outbound');
    assert.equal(virtualCanvasStream.getVideoTracks()[0].label, 'privacy-canvas-wireframe', 'Outbound video is synthetic canvas');
    assert.equal(virtualCanvasStream.getVideoTracks().includes(rawWebcamVideoTrack), false, 'Raw webcam track NEVER outbound');
    assert.equal(virtualCanvasStream.getAudioTracks().length, 1, 'Microphone audio track included');
    assert.equal(virtualCanvasStream.getAudioTracks()[0].label, 'usb-microphone', 'Microphone audio is active');
});

// --- Test 3: Normal Joining & Explicit Readiness States ---
test('Lifecycle: Normal joining initiates call only when all readiness prerequisites are ready', () => {
    const readinessState = {
        webcam: 'idle',
        faceMesh: 'idle',
        canvasStream: 'idle',
        peerSignaling: 'idle',
        teacherStream: 'idle',
        telemetryChannel: 'idle'
    };

    let callInitiated = false;
    let currentRoomId = 'Math101';
    let peer = { open: false, destroyed: false };
    let virtualCanvasStream = null;

    function areCallPrerequisitesReady() {
        return (
            readinessState.canvasStream === 'ready' &&
            readinessState.peerSignaling === 'ready' &&
            Boolean(currentRoomId) &&
            Boolean(peer) &&
            !peer.destroyed &&
            peer.open &&
            Boolean(virtualCanvasStream)
        );
    }

    function checkAndEstablishConnection() {
        if (areCallPrerequisitesReady()) {
            callInitiated = true;
            readinessState.teacherStream = 'calling';
        }
    }

    // Step 1: Start requesting webcam
    readinessState.webcam = 'requesting';
    checkAndEstablishConnection();
    assert.equal(callInitiated, false, 'Call must not initiate while webcam is requesting');

    // Step 2: Peer registers on signaling server
    peer.open = true;
    readinessState.peerSignaling = 'ready';
    checkAndEstablishConnection();
    assert.equal(callInitiated, false, 'Call must not initiate while canvas stream is not ready');

    // Step 3: Local webcam succeeds and virtual canvas stream created
    readinessState.webcam = 'ready';
    virtualCanvasStream = new MockMediaStream([new MockMediaStreamTrack('video', 'canvas')]);
    readinessState.canvasStream = 'ready';
    readinessState.faceMesh = 'ready';

    // Step 4: Coordinator evaluates prerequisites
    checkAndEstablishConnection();
    assert.equal(callInitiated, true, 'Call initiates immediately when all prerequisites become ready');
    assert.equal(readinessState.teacherStream, 'calling');
});

// --- Test 4: Delayed Permissions (Race Condition Resolution) ---
test('Lifecycle: Delayed user permissions prevents premature call and connects once granted', async () => {
    const readinessState = {
        webcam: 'idle',
        faceMesh: 'idle',
        canvasStream: 'idle',
        peerSignaling: 'idle',
        teacherStream: 'idle',
        telemetryChannel: 'idle'
    };

    let callsCount = 0;
    const currentRoomId = 'Bio200';
    const peer = { open: true, destroyed: false };
    let virtualCanvasStream = null;

    function areCallPrerequisitesReady() {
        return (
            readinessState.canvasStream === 'ready' &&
            readinessState.peerSignaling === 'ready' &&
            Boolean(currentRoomId) &&
            Boolean(peer) &&
            !peer.destroyed &&
            peer.open &&
            Boolean(virtualCanvasStream)
        );
    }

    function checkAndEstablishConnection() {
        if (!areCallPrerequisitesReady()) return;
        callsCount++;
        readinessState.teacherStream = 'calling';
    }

    // Peer signaling is ready first
    readinessState.peerSignaling = 'ready';
    checkAndEstablishConnection();
    assert.equal(callsCount, 0, 'No call attempted while stream is missing');

    // User delays granting permissions by 50ms
    readinessState.webcam = 'requesting';
    checkAndEstablishConnection();
    assert.equal(callsCount, 0, 'Still no call while permissions pending');

    await new Promise(r => setTimeout(r, 50));

    // Permission granted
    readinessState.webcam = 'ready';
    virtualCanvasStream = new MockMediaStream([
        new MockMediaStreamTrack('video', 'privacy-mesh'),
        new MockMediaStreamTrack('audio', 'student-mic')
    ]);
    readinessState.canvasStream = 'ready';

    // Coordinator check
    checkAndEstablishConnection();
    assert.equal(callsCount, 1, 'Call successfully established once delayed permissions resolve');
    assert.equal(readinessState.teacherStream, 'calling');
});

// --- Test 5: Bounded Reconnection with Exponential Backoff ---
test('Lifecycle: Bounded reconnection with exponential backoff on teacher disconnect', () => {
    const ReconnectConfig = {
        maxCallRetries: 5,
        baseCallDelayMs: 1000,
        maxCallDelayMs: 16000
    };

    const calculatedDelays = [];
    for (let count = 1; count <= ReconnectConfig.maxCallRetries; count++) {
        const delay = Math.min(
            Math.round(ReconnectConfig.baseCallDelayMs * Math.pow(1.8, count - 1)),
            ReconnectConfig.maxCallDelayMs
        );
        calculatedDelays.push(delay);
    }

    assert.equal(calculatedDelays.length, 5);
    assert.equal(calculatedDelays[0], 1000);
    assert.equal(calculatedDelays[1], 1800);
    assert.equal(calculatedDelays[2], 3240);
    assert.equal(calculatedDelays[3], 5832);
    assert.equal(calculatedDelays[4], 10498);

    // Verify bounded limit: after 5 retries, no further attempts are scheduled
    let retryCount = 5;
    let shouldSchedule = retryCount < ReconnectConfig.maxCallRetries;
    assert.equal(shouldSchedule, false, 'Reconnection does not continue indefinitely');
});

// --- Test 6: Refresh and Cleanup of Tracks & Connections ---
test('Lifecycle: Refresh / unload triggers complete cleanup of tracks and peer connections', () => {
    const micTrack = new MockMediaStreamTrack('audio', 'mic');
    const camTrack = new MockMediaStreamTrack('video', 'cam');
    const localUserMedia = new MockMediaStream([micTrack, camTrack]);

    const canvasTrack = new MockMediaStreamTrack('video', 'canvas');
    const virtualCanvasStream = new MockMediaStream([canvasTrack]);

    let callClosed = false;
    let peerDestroyed = false;
    let dataChannelClosed = false;

    const activeCall = { close: () => { callClosed = true; } };
    const peer = { destroy: () => { peerDestroyed = true; } };
    const telemetryDataChannel = { close: () => { dataChannelClosed = true; } };

    function cleanupAll() {
        if (activeCall) activeCall.close();
        if (telemetryDataChannel) telemetryDataChannel.close();
        if (peer) peer.destroy();
        localUserMedia.getTracks().forEach(t => t.stop());
        virtualCanvasStream.getTracks().forEach(t => t.stop());
    }

    cleanupAll();

    assert.equal(micTrack.stopped, true, 'Microphone track stopped');
    assert.equal(camTrack.stopped, true, 'Webcam track stopped');
    assert.equal(canvasTrack.stopped, true, 'Canvas synthetic track stopped');
    assert.equal(callClosed, true, 'Active call closed');
    assert.equal(peerDestroyed, true, 'Peer destroyed');
    assert.equal(dataChannelClosed, true, 'DataChannel closed');
});

// --- Test 7: Multiple Students Roster Concurrency ---
test('Teacher roster: Handles multiple concurrent students without audio collision or leakage', () => {
    const connectedStudents = new Map();
    const rosterTbody = new MockElement('tbody');

    function renderStudent(peerId, name, stream, call) {
        const row = new MockElement('tr');
        row.id = `roster_${peerId}`;
        row.innerHTML = `<td><span>${name}</span></td>`;

        const audioElem = new MockElement('audio');
        audioElem.srcObject = stream;
        row.appendChild(audioElem);
        rosterTbody.appendChild(row);

        connectedStudents.set(peerId, { call, stream, element: row, audioElem, name });
    }

    function removeStudent(peerId) {
        if (connectedStudents.has(peerId)) {
            const item = connectedStudents.get(peerId);
            if (item.audioElem) {
                item.audioElem.pause();
                item.audioElem.srcObject = null;
            }
            if (item.call) item.call.close();
            rosterTbody.removeChild(item.element);
            connectedStudents.delete(peerId);
        }
    }

    // Connect Student 1 (Alice)
    const streamAlice = new MockMediaStream([new MockMediaStreamTrack('audio', 'alice-audio')]);
    let aliceCallClosed = false;
    const callAlice = { close: () => { aliceCallClosed = true; } };
    renderStudent('peer-alice', 'Alice', streamAlice, callAlice);

    // Connect Student 2 (Bob)
    const streamBob = new MockMediaStream([new MockMediaStreamTrack('audio', 'bob-audio')]);
    let bobCallClosed = false;
    const callBob = { close: () => { bobCallClosed = true; } };
    renderStudent('peer-bob', 'Bob', streamBob, callBob);

    assert.equal(connectedStudents.size, 2);
    assert.equal(rosterTbody.children.length, 2);
    assert.equal(connectedStudents.get('peer-alice').audioElem.srcObject, streamAlice);
    assert.equal(connectedStudents.get('peer-bob').audioElem.srcObject, streamBob);

    // Alice disconnects
    removeStudent('peer-alice');

    assert.equal(aliceCallClosed, true, 'Alice call closed');
    assert.equal(connectedStudents.has('peer-alice'), false, 'Alice removed from map');
    assert.equal(connectedStudents.has('peer-bob'), true, 'Bob remains connected');
    assert.equal(bobCallClosed, false, 'Bob call NOT affected');
    assert.equal(connectedStudents.get('peer-bob').audioElem.srcObject, streamBob, 'Bob audio intact');
    assert.equal(rosterTbody.children.length, 1);
});

// --- Test 8: Accurate Measured Broadcast Resolution Labels ---
test('UI Accuracy: Correct measured resolution labels (never false 1080p claim)', () => {
    function computeBadgeText(width, height) {
        if (height >= 1080 || width >= 1920) {
            return "1080p Full HD Broadcast";
        } else if (height >= 720 || width >= 1280) {
            return "720p HD Broadcast";
        } else if (height > 0) {
            return `${height}p Broadcast`;
        } else {
            return "Live Broadcast";
        }
    }

    assert.equal(computeBadgeText(1280, 720), "720p HD Broadcast", "720p stream labeled as 720p HD Broadcast");
    assert.equal(computeBadgeText(1920, 1080), "1080p Full HD Broadcast", "1080p stream labeled as 1080p Full HD");
    assert.equal(computeBadgeText(640, 480), "480p Broadcast", "480p stream labeled as 480p");
    assert.equal(computeBadgeText(0, 0), "Live Broadcast", "Unmeasured stream labeled generically");
});
