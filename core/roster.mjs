export function displayName(room, peerId, metadata = {}) {
    if (typeof metadata.studentName === 'string' && metadata.studentName.trim()) return metadata.studentName;
    const prefix = `${room}-student-`;
    return (peerId.startsWith(prefix) ? peerId.slice(prefix.length) : peerId).replace(/-[0-9]+$/, '') || 'Student';
}
export function shouldPrune(student, now, timeoutMs = 12000) {
    const pc = student.call?.peerConnection;
    const connected = pc && (pc.connectionState === 'connected' || ['connected', 'completed'].includes(pc.iceConnectionState));
    if (connected) { student.lastSeen = now; return false; }
    return Number.isFinite(student.lastSeen) && now - student.lastSeen > timeoutMs;
}
