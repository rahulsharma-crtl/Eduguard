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

export function validatePeerTelemetry(data) {
    if (!data || typeof data !== 'object' || data.type !== 'telemetry' ||
        typeof data.status !== 'string' || data.status.length > 120 ||
        typeof data.is_unknown !== 'boolean' ||
        !(data.is_unknown && data.cei_score === null) &&
        (!Number.isFinite(data.cei_score) || data.cei_score < 0 || data.cei_score > 1)) return null;
    return {status:data.status,cei_score:data.cei_score,is_unknown:data.is_unknown,
        is_looking_down:data.is_looking_down===true,is_looking_away:data.is_looking_away===true,
        is_drowsy:data.is_drowsy===true};
}
