// components/edge_tracker/frontend/main.js

const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const statusText = document.getElementById('status_text');
const fpsText = document.getElementById('fps_text');

// Off-screen canvas for generating ultra-lightweight JPEG snapshots (240x180)
const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = 240;
thumbCanvas.height = 180;
const thumbCtx = thumbCanvas.getContext('2d');

let studentName = "Unknown";
let isRunning = false;

// AI State Variables
let objectModel = null;
let currentAttentionScore = 100;
let currentHeadStatus = "Attentive";
let currentObjectStatus = "Clear";
let objectPenalty = 0;
let latestSnapshotBase64 = "";

// FPS Counter
let frameCount = 0;
let lastFpsTime = Date.now();

function sendHeight() {
    // Set frame height to cleanly fit the 640x480 canvas + status bar
    Streamlit.setFrameHeight(530);
}

function onRender(event) {
    if (!window.rendered) {
        studentName = event.detail.args.student_name;
        statusText.innerText = `🛡️ Privacy Active: ${studentName}`;
        window.rendered = true;
        sendHeight();
        
        if (!isRunning) {
            startEdgeAI();
            isRunning = true;
        }
    }
}
Streamlit.events.addEventListener(Streamlit.RENDER_EVENT, onRender);
Streamlit.setComponentReady();

// Helper: Calculate Euclidean distance
function calcDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Helper: Calculate Eye Aspect Ratio (EAR)
function calculateEAR(landmarks, eyeIndices) {
    const p1 = landmarks[eyeIndices[0]]; 
    const p2 = landmarks[eyeIndices[1]]; 
    const p3 = landmarks[eyeIndices[2]]; 
    const p4 = landmarks[eyeIndices[3]]; 
    const v1 = calcDistance(p2, p3);
    const h = calcDistance(p1, p4);
    return v1 / (h + 1e-6);
}

// 1. MediaPipe Callback: Renders Black Canvas Privacy Mesh at 30+ FPS
function onFaceResults(results) {
    // Measure FPS
    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
        fpsText.innerText = `${frameCount} FPS`;
        frameCount = 0;
        lastFpsTime = now;
    }
    
    // Clear Canvas to SOLID BLACK (Absolute Privacy: No Raw Video Frame is Ever Drawn)
    canvasCtx.save();
    canvasCtx.fillStyle = '#000000';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
    
    let score = 100;
    let status = "Attentive";
    
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        
        // Draw Face Mesh Connectors on Black Background
        // Main Mesh Tessellation (Neon Green / Cyan)
        drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELLATION, {color: '#00FF99', lineWidth: 0.8});
        drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYE, {color: '#00E5FF', lineWidth: 1.5});
        drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYE, {color: '#00E5FF', lineWidth: 1.5});
        drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYEBROW, {color: '#58A6FF', lineWidth: 1.2});
        drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYEBROW, {color: '#58A6FF', lineWidth: 1.2});
        drawConnectors(canvasCtx, landmarks, FACEMESH_FACE_OVAL, {color: '#BC8CFF', lineWidth: 1.5});
        drawConnectors(canvasCtx, landmarks, FACEMESH_LIPS, {color: '#FF7B72', lineWidth: 1.2});
        
        // Compute Spatial Analytics (EAR & Yaw)
        const leftEar = calculateEAR(landmarks, [33, 159, 145, 133]);
        const rightEar = calculateEAR(landmarks, [362, 386, 374, 263]);
        const avgEar = (leftEar + rightEar) / 2.0;
        
        const nose = landmarks[1];
        const leftEdge = landmarks[234];
        const rightEdge = landmarks[454];
        const distLeft = calcDistance(nose, leftEdge);
        const distRight = calcDistance(nose, rightEdge);
        const yawRatio = distLeft / (distRight + 1e-6);
        
        if (avgEar < 0.20) {
            score -= 60;
            status = "Drowsy / Eyes Closed";
        } else if (yawRatio > 2.5 || yawRatio < 0.4) {
            score -= 40;
            status = "Distracted (Looking Away)";
        }
    } else {
        score = 0;
        status = "No Face Detected";
        // Render text overlay on black canvas if face is absent
        canvasCtx.fillStyle = '#ff7b72';
        canvasCtx.font = '20px Inter, sans-serif';
        canvasCtx.fillText('⚠️ SUBJECT ABSENT / NO FACE DETECTED', 140, 240);
    }
    
    canvasCtx.restore();
    
    currentAttentionScore = score;
    currentHeadStatus = status;
}

// 2. Periodic Object Detection Loop (1 FPS)
async function runObjectDetection() {
    if (objectModel && videoElement.readyState === 4) {
        try {
            const predictions = await objectModel.detect(videoElement);
            
            let phoneDetected = false;
            let personCount = 0;
            
            predictions.forEach(pred => {
                if (pred.class === "cell phone") phoneDetected = true;
                if (pred.class === "person") personCount++;
            });
            
            objectPenalty = 0;
            currentObjectStatus = "Clear";
            
            if (phoneDetected) {
                objectPenalty += 50;
                currentObjectStatus = "Cell Phone Detected!";
            }
            if (personCount > 1) {
                objectPenalty += 30;
                currentObjectStatus += (phoneDetected ? " & " : "") + "Extra Person Detected!";
            }
        } catch (e) {
            console.warn("Object detection skip:", e);
        }
    }
    setTimeout(runObjectDetection, 1000);
}

// 3. Ultra-Lightweight Telemetry & Snapshot Dispatch Loop (1 FPS)
function dispatchToStreamlit() {
    // Generate lightweight 240x180 JPEG thumbnail of the black wireframe canvas
    thumbCtx.drawImage(canvasElement, 0, 0, 240, 180);
    // Low quality JPEG compression (0.4) keeps snapshot size ~3KB per second!
    latestSnapshotBase64 = thumbCanvas.toDataURL('image/jpeg', 0.4);
    
    let finalScore = currentAttentionScore - objectPenalty;
    let finalStatus = currentHeadStatus;
    
    if (objectPenalty > 0) {
        finalStatus = currentObjectStatus;
    }
    
    // Dispatch lightweight JSON payload back to Streamlit
    Streamlit.setComponentValue({
        cei_score: Math.max(0, finalScore),
        status: finalStatus,
        wireframe_img: latestSnapshotBase64
    });
    
    setTimeout(dispatchToStreamlit, 1000);
}

async function startEdgeAI() {
    try {
        statusText.innerText = "Requesting Webcam Access...";
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        videoElement.srcObject = stream;
        
        statusText.innerText = "Loading AI Models...";
        
        // Load COCO-SSD
        objectModel = await cocoSsd.load();
        
        // Load MediaPipe FaceMesh
        const faceMesh = new FaceMesh({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
        }});
        
        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        faceMesh.onResults(onFaceResults);
        
        const camera = new Camera(videoElement, {
            onFrame: async () => {
                await faceMesh.send({image: videoElement});
            },
            width: 640,
            height: 480
        });
        camera.start();
        
        statusText.innerText = `🛡️ Privacy Active: ${studentName}`;
        
        runObjectDetection();
        dispatchToStreamlit();
        
    } catch (err) {
        console.error("Webcam or model failure:", err);
        statusText.innerText = "Error: Webcam access denied.";
        statusText.style.color = "#ff7b72";
    }
}
