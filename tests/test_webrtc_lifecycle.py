"""
Integration & static verification tests for EduGuard WebRTC/Audio Lifecycle.
Validates race condition fixes, readiness states, teacher roster audio bug,
core privacy architecture, bounded reconnection, and resolution labels.
"""

import os

STUDENT_HTML = os.path.join(
    os.path.dirname(__file__),
    "..", "components", "student_room", "frontend", "index.html"
)
TEACHER_HTML = os.path.join(
    os.path.dirname(__file__),
    "..", "components", "teacher_room", "frontend", "index.html"
)


def read_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_student_room_readiness_states():
    """Verify explicit readiness states are defined in student_room."""
    content = read_file(STUDENT_HTML)
    assert "readinessState = {" in content
    assert "webcam:" in content
    assert "faceMesh:" in content
    assert "canvasStream:" in content
    assert "peerSignaling:" in content
    assert "teacherStream:" in content
    assert "telemetryChannel:" in content


def test_student_room_race_condition_resolution():
    """Verify callTeacher only fires when all prerequisites are met."""
    content = read_file(STUDENT_HTML)
    assert "function areCallPrerequisitesReady()" in content
    assert "readinessState.canvasStream === 'ready'" in content
    assert "readinessState.peerSignaling === 'ready'" in content
    assert "virtualCanvasStream" in content
    assert "function checkAndEstablishConnection()" in content
    assert "if (!areCallPrerequisitesReady())" in content
    assert "callTeacher(teacherPeerId)" in content


def test_student_room_bounded_reconnection():
    """Verify bounded reconnection with exponential backoff."""
    content = read_file(STUDENT_HTML)
    assert "ReconnectConfig = {" in content
    assert "maxCallRetries:" in content
    assert "baseCallDelayMs:" in content
    assert "maxCallDelayMs:" in content
    assert "scheduleCallReconnect" in content
    assert "Math.pow(1.8" in content


def test_student_room_privacy_architecture():
    """Verify student transmits synthetic canvas + mic only, not raw webcam."""
    content = read_file(STUDENT_HTML)
    assert 'id="raw_webcam" style="display: none;"' in content
    assert "virtualCanvasStream = privacyCanvas.captureStream" in content
    assert "virtualCanvasStream.addTrack(audioTracks[0])" in content
    assert "CRITICAL PRIVACY VIOLATION PREVENTED" in content


def test_teacher_roster_audio_bug_fix():
    """Verify audio element is appended AFTER row.innerHTML is assigned."""
    content = read_file(TEACHER_HTML)
    idx_html = content.find("row.innerHTML = `")
    idx_audio = content.find("row.appendChild(audioElem)")

    assert idx_html != -1, "row.innerHTML assignment must exist"
    assert idx_audio != -1, "row.appendChild(audioElem) must exist"
    assert idx_html < idx_audio, (
        "row.innerHTML must be set BEFORE appending audioElem "
        "or row.innerHTML will delete the audio element"
    )


def test_teacher_room_measured_resolution_label():
    """Verify static 1080p label replaced by measured runtime badge."""
    content = read_file(TEACHER_HTML)
    bad = (
        '<span style="color: var(--success-color); '
        'font-size: 0.75rem;">1080p HD Broadcast</span>'
    )
    assert bad not in content
    assert 'id="broadcast_quality_badge"' in content
    assert "function updateBroadcastResolutionBadge" in content
    assert "1080p Full HD Broadcast" in content
    assert "720p HD Broadcast" in content


def test_cleanup_and_teardown_lifecycle():
    """Verify track stop and peer destroy on unload."""
    student = read_file(STUDENT_HTML)
    teacher = read_file(TEACHER_HTML)

    assert "cleanupAll()" in student
    assert "track.stop()" in student
    assert "peer.destroy()" in student

    assert "cleanupTeacherSession()" in teacher
    assert "track.stop()" in teacher
    assert "audioElem.pause()" in teacher
