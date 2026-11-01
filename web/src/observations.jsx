import React from 'react';

export const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Unknown';
export const duration = value => Number.isFinite(value) ? `${Math.floor(value / 60)}m ${Math.floor(value % 60)}s` : 'Unknown';
export function observationLabel(status, unknown = false) {
    if (unknown || !status) return 'Observation unavailable';
    return String(status).replace(/Drowsy \(Eyes Closed\)/gi, 'Eyes closed')
        .replace(/Subject Absent/gi, 'Face not detected').replace(/Mainly Attentive|Attentive/gi, 'Face oriented toward camera')
        .replace(/High Drowsiness/gi, 'Repeated eye closure').replace(/Frequent Distractions/gi, 'Repeated head turns')
        .replace(/Frequent Absences/gi, 'Face repeatedly not detected').replace(/Low Engagement|Moderate Attention/gi, 'Mixed visual observations')
        .replace(/No Scored Observations/gi, 'Observation unavailable');
}
export function ObservationGuide() {
    return <details className="guidance"><summary>How to interpret observations</summary><p>Eye closure, head orientation and face detection are camera estimates. They cannot establish attention, learning, presence in the room or misconduct. Lighting, camera angle, disability and movement can affect them.</p><p>Unknown means usable data is missing. A measured zero is a recorded heuristic value, not missing data. Connected time is validated by heartbeats; unobserved time is shown separately.</p></details>;
}
export function Trend({samples, title = 'Recent observation trend'}) {
    const known = samples.filter(row => !row.is_unknown && Number.isFinite(row.cei_score));
    const average = known.length ? known.reduce((sum, row) => sum + row.cei_score, 0) / known.length : null;
    return <section aria-label={title}>
        <p>{known.length} measured · {samples.length - known.length} unknown · Heuristic average: {percent(average)}</p>
        <p className="small">Recent in-browser samples only; gaps are not evidence of low attention. CSV contains the stored session history.</p>
        <div className="timeline" aria-hidden="true">{samples.map(row => {
            const unknown = row.is_unknown || !Number.isFinite(row.cei_score);
            return <div key={row.sample_id} className={unknown ? 'unknown' : ''} title={unknown ? 'Unknown' : percent(row.cei_score)} style={{height: unknown ? '100%' : `${Math.max(3, row.cei_score * 100)}%`}}/>;
        })}</div>
        <details><summary>Read recent observations as a table</summary><div className="table-wrap" tabIndex={0}><table><caption>{title}</caption><thead><tr><th scope="col">Time (UTC)</th><th scope="col">Observation</th><th scope="col">Heuristic</th></tr></thead><tbody>{samples.slice(-20).map(row => <tr key={row.sample_id}><td>{new Date(row.timestamp * 1000).toISOString().slice(11,19)}</td><td>{observationLabel(row.status,row.is_unknown)}</td><td>{row.is_unknown ? 'Unknown' : percent(row.cei_score)}</td></tr>)}</tbody></table></div></details>
    </section>;
}
export function StudentGuidance({mode}) {
    return <aside className="guidance" aria-label="Privacy and calibration guidance"><strong>{mode === 'mesh' ? 'Sharing synthetic facial mesh video' : 'Telemetry only — no student video sent'}</strong><p>Raw camera frames stay on this device. Derived observations can reveal sensitive behavior. Student microphone audio is never sent.</p><details><summary>Camera setup and privacy controls</summary><ol><li>Face the camera in even lighting. Keep one face visible.</li><li>In the classroom panel, choose Calibrate camera and hold a comfortable neutral pose for 30 valid frames. Recalibrate after moving the camera.</li><li>Microphone energy analysis is optional and local. It does not identify speech. Teacher audio mute is a separate playback control.</li></ol><p>To change sharing mode, leave and rejoin using your invitation, review the mode, and consent again. Withdraw and delete removes your stored session data.</p></details></aside>;
}
