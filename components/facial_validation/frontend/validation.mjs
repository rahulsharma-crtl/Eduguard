import {PLAN,PROTOCOL_V2,SUPPORTED_PROTOCOLS,createSession,startSession,timing,observe,markOnset,interrupt,complete,verify,lockVerification,toCSV,trialSummary} from './workflow.mjs';
import {LocalNarrator} from './speech.mjs';
import {runGuidedProtocol} from './runner.mjs';
import {renderMesh} from './preview.mjs';
const el=id=>document.getElementById(id),KEY='eduguard-facial-validation:v1',narrator=new LocalNarrator();
let session=null,stream=null,mesh=null,engine=null,origin=0,generation=0,frameHandle=null,pollTimer=null,tickTimer=null,inFlight=null,finishing=false,lastFrame=null,lastCapture=-Infinity,downloadCSV=null,pendingFrame=null;
const status=message=>{el('status').textContent=message};
const visible=(id,show)=>{el(id).hidden=!show};
const now=()=>performance.now()-origin;
function persist(){try{sessionStorage.setItem(KEY,JSON.stringify(session))}catch{status('Recovery storage unavailable. Keep this tab open until the CSV is downloaded.')}}
function consent(){el('check-camera').disabled=!(el('consent').checked&&el('supervised').checked)}
el('consent').addEventListener('change',consent);el('supervised').addEventListener('change',consent);
function voiceUI(){el('voice').textContent=narrator.muted?'Unmute instructions':'Mute instructions';el('voice').setAttribute('aria-pressed',String(narrator.muted));el('speech-note').textContent=narrator.muted?'Instructions muted. Unmute before starting; missing narration interrupts the test.':narrator.voice()?'Local English narration available. No participant data is spoken.':'No local English voice is available yet. Spoken instructions are required to start.';}
voiceUI();globalThis.speechSynthesis?.addEventListener?.('voiceschanged',voiceUI);
el('voice').addEventListener('click',()=>{narrator.setMuted(!narrator.muted);voiceUI();if(session?.status==='running'&&!session.conditions.includes('voice toggled'))session.conditions+='; voice toggled during capture';persist()});
el('show-mesh').addEventListener('change',()=>{el('mesh-overlay').hidden=!el('show-mesh').checked;if(!el('show-mesh').checked)renderMesh(el('mesh-overlay'),null);if(session?.status==='running'&&!session.conditions.includes('mesh toggled'))session.conditions+='; mesh toggled during capture';persist()});
function stopCamera(){
 generation++;narrator.cancel();if(frameHandle!=null&&el('camera').cancelVideoFrameCallback)el('camera').cancelVideoFrameCallback(frameHandle);
 clearTimeout(pollTimer);clearInterval(tickTimer);stream?.getTracks().forEach(t=>t.stop());stream=null;el('camera').srcObject=null;renderMesh(el('mesh-overlay'),null);
}
async function releaseModel(){const previous=mesh;mesh=null;engine=null;pendingFrame=null;if(previous)try{await Promise.race([previous.close(),new Promise(r=>setTimeout(r,1000))])}catch{}}
function showReview(){
 visible('setup',false);visible('capture',false);visible('review',true);visible('reset-area',true);const container=el('verifications');container.replaceChildren();
 for(const trial of PLAN){const block=document.createElement('div');block.className='trial-review';const label=document.createElement('label');label.textContent=`${trial.id}: ${trial.instruction}`;const select=document.createElement('select');select.id='verify-'+trial.id;select.setAttribute('aria-label',`Observer verification ${trial.id}`);
  for(const [value,text]of [['','Choose an observer verdict'],['confirmed','Confirmed: performed correctly'],['invalid','Invalid: action not performed correctly'],['uncertain','Uncertain: reference cannot be established']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option)}
  select.value=session.verifications[trial.id]||'';select.addEventListener('change',()=>{if(select.value){verify(session,trial.id,select.value);persist()}});label.append(select);block.append(label);container.append(block);
 }
 status(session.status==='completed'?'Timed session complete. Observer: verify all five actions independently.':'Session incomplete. Preserved results remain available; this session is excluded from primary completed-session metrics.');
}
function showFinished(){visible('setup',false);visible('capture',false);visible('review',false);visible('finished',true);visible('reset-area',true);downloadCSV=toCSV(session);el('finish-heading').textContent=session.status==='completed'?'One session CSV is ready':'Incomplete-session CSV is ready';const known=PLAN.filter(t=>trialSummary(session,t).prediction!=='UNKNOWN').length;el('result-summary').textContent=`Participant ${session.participantId} · ${session.status}. ${known}/5 summaries have a known prediction. Incorrect/unknown results are preserved. This is not an accuracy estimate.`;status('Verification locked. Download one CSV and share it only as consented.');}
async function endCapture(reason=null){
 if(finishing||!session||session.locked)return;finishing=true;const pending=inFlight,endedAt=session.startedAt==null?null:now();stopCamera();
 if(pending)await Promise.race([pending.catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);
 if(reason)interrupt(session,reason,endedAt);else complete(session);persist();await releaseModel();showReview();finishing=false;
}
function tick(){
 if(!session||session.status!=='running'||finishing)return;const t=timing(now(),session);el('capture').dataset.phase=t.phase;el('phase-label').textContent=t.trial?`Trial ${PLAN.indexOf(t.trial)+1} of 5 · ${t.phase}`:t.phase;
 el('instruction').textContent=t.trial?t.trial.instruction:t.phase==='preparation'?'Preparation: face the camera with eyes open':'Preparing the next instruction';
 const remaining=t.end==null?Math.max(0,10-(now()-t.start)/1000):Math.max(0,(t.end-now())/1000);
 el('countdown').textContent=t.phase==='instruction'?`Speaking / text cue · up to ${Math.ceil(remaining)} s · not measuring`:t.phase==='waiting'?'Moving to the next phase · not measuring':`${t.phase==='observation'?'Observe and hold':t.phase==='transition'?'Settle into position':'Preparation'} · ${Math.ceil(remaining)} seconds`;
 el('onset').disabled=!t.trial||session.onsets[t.trial.id]!=null;el('onset').textContent=t.trial&&session.onsets[t.trial.id]!=null?'Observer onset recorded':'Observer: action started';
 const index=t.trial?PLAN.indexOf(t.trial):0;el('progress').value=index+(t.phase==='observation'?Math.min(1,(now()-t.start)/8000):0);el('progress').setAttribute('aria-valuetext',`${Math.floor(el('progress').value)} of 5 trials complete`);
}
function receive(result,pending,error=''){
 if(!session||session.locked)return;
 if(session.status==='ready'){
  el('face-status').textContent=`Face visibility estimate: ${pending.landmarksPresent?'face detected':'no face detected'}`;
  el('quality-status').textContent=`Tracking quality: ${error?'unavailable':result?.is_unknown?'unstable / insufficient':pending.landmarksPresent?'usable':'no face'}${result?.quality_reason?' ('+result.quality_reason+')':''}`;return;
 }
 if(session.status==='running'){observe(session,{captureMs:pending.absolute-origin,completedMs:now(),frameId:pending.id,result,error});persist()}
}
function scheduleFrames(run){
 const video=el('camera');
 const frame=(_time,metadata)=>{
  if(run!==generation||!session||!['ready','running'].includes(session.status)||finishing)return;
  const absolute=performance.now(),id=metadata?.presentedFrames??video.getVideoPlaybackQuality?.().totalVideoFrames;
  if(id==null){endCapture('fresh_frame_identification_unavailable');return}
  if(absolute-lastCapture>=100&&id!==lastFrame&&!inFlight&&video.readyState>=2){
   lastFrame=id;lastCapture=absolute;const pending={run,absolute,id,gotResult:false,landmarksPresent:false};pendingFrame=pending;const active=mesh;
   inFlight=(async()=>{try{await active.send({image:video});if(!pending.gotResult)receive(null,pending,'tracking_result_missing')}catch{receive(null,pending,'tracking_error')}finally{if(pendingFrame===pending)pendingFrame=null}})();const work=inFlight;work.finally(()=>{if(inFlight===work)inFlight=null});
  }
  if(run===generation&&!finishing){if(video.requestVideoFrameCallback)frameHandle=video.requestVideoFrameCallback(frame);else pollTimer=setTimeout(frame,25)}
 };
 if(video.requestVideoFrameCallback)frameHandle=video.requestVideoFrameCallback(frame);else frame();
}
el('check-camera').addEventListener('click',async()=>{
 if(!el('consent').checked||!el('supervised').checked||session)return;el('check-camera').disabled=true;visible('setup',false);visible('capture',true);status('Requesting local camera access and loading MediaPipe. No microphone is requested.');const run=++generation;
 session=createSession({protocol:PROTOCOL_V2,participantId:'P-'+crypto.randomUUID(),sessionId:crypto.randomUUID(),conditions:'mesh initially shown; '+el('conditions').value,device:el('device').value,consentConfirmed:true,observerPresent:true});persist();
 try{
  if(!navigator.mediaDevices?.getUserMedia||!globalThis.FaceMesh||!globalThis.EduGuardEngagement)throw Error('Camera/inference scripts unavailable');
  const captured=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,frameRate:{ideal:30}},audio:false});if(run!==generation){captured.getTracks().forEach(t=>t.stop());return}stream=captured;
  stream.getVideoTracks()[0].addEventListener('ended',()=>{if(['ready','running'].includes(session.status)&&!finishing)endCapture('camera_track_ended')});
  const video=el('camera');video.srcObject=stream;await video.play();const canvas=el('mesh-overlay');canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||480;
  engine=new EduGuardEngagement.EngagementEngine();session.defaults=engine.config;mesh=new FaceMesh({locateFile:file=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`});mesh.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:0.5,minTrackingConfidence:0.5});
  mesh.onResults(results=>{
   const pending=pendingFrame;if(!pending||(pending.run!==generation&&!finishing))return;pending.gotResult=true;const landmarks=results.multiFaceLandmarks?.[0]||null;pending.landmarksPresent=Boolean(landmarks);
   renderMesh(el('mesh-overlay'),landmarks,{enabled:el('show-mesh').checked});
   try{receive(engine?.processFrame(landmarks,pending.absolute),pending)}catch{receive(null,pending,'engine_error')}
  });
  await Promise.race([mesh.send({image:video}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Model initialization timed out')),30000))]);if(run!==generation)return;
  const source=await fetch('../student/engagement.js',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!source.ok)throw Error('Engine provenance unavailable');const bytes=await source.arrayBuffer();session.engineHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(run!==generation)return;
  session.status='ready';persist();el('permission-status').textContent='Camera permission: granted · preview is local';el('start').disabled=false;lastCapture=-Infinity;lastFrame=null;scheduleFrames(run);voiceUI();status('Camera readiness check. Tracking quality is advisory; predictions remain hidden. Click Start when the observer and participant are ready.');
 }catch(error){if(run!==generation)return;const denied=error.name==='NotAllowedError';stopCamera();interrupt(session,denied?'camera_permission_denied':'initialization_failure');persist();await releaseModel();showReview();status(denied?'Camera permission denied. No observations were measured.':'Camera/model initialization failed. No measurements were invented.');}
});
el('start').addEventListener('click',async()=>{
 if(session?.status!=='ready'||finishing)return;if(narrator.muted||!narrator.voice()){status('Spoken instructions are required. Unmute instructions and ensure a local English voice is available before starting.');return}el('start').disabled=true;visible('readiness',false);visible('guided',true);session.conditions+=`; mesh at timed start=${el('show-mesh').checked?'shown':'hidden'}; narration at timed start=${narrator.muted?'muted':'local-or-text'}`;origin=performance.now();startSession(session,Date.now());persist();status('Guided capture started. Narration finishes before settling and observation; predictions are hidden.');tick();tickTimer=setInterval(tick,100);const run=generation;
 try{await runGuidedProtocol(session,{clock:now,delay:ms=>new Promise(r=>setTimeout(r,ms)),speak:async text=>{const result=await narrator.speak(text);voiceUI();return result},isSpeaking:()=>narrator.speaking,isActive:()=>run===generation&&session.status==='running'&&!finishing,onPhase:()=>{persist();tick()}});if(run===generation&&!finishing)await endCapture();}
 catch(error){if(run===generation&&!finishing){await endCapture(error.message.includes('100 seconds')?'timing_limit_exceeded':'narration_or_timing_failure');status('Session stopped: a required spoken instruction or timing check failed. This is an incomplete attempt, not a completed test. Check audio before another participant starts.');}}
});
el('onset').addEventListener('click',()=>{const t=timing(now(),session);if(t.trial&&markOnset(session,t.trial.id,now())){persist();tick()}});
el('stop').addEventListener('click',()=>endCapture('observer_stopped'));
el('withdraw').addEventListener('click',async()=>{stopCamera();await releaseModel();session=null;sessionStorage.removeItem(KEY);location.reload()});
el('lock').addEventListener('click',()=>{try{lockVerification(session);persist();showFinished()}catch(error){status(error.message)}});
el('download').addEventListener('click',()=>{if(!session?.locked||downloadCSV==null)return;const url=URL.createObjectURL(new Blob([downloadCSV],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`eduguard-validation-${session.participantId}-${session.sessionId}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
el('reset').addEventListener('click',()=>{if(confirm('Clear this tab’s research record? Download it first if you need it. Do not repeat a participant to select a better result.')){sessionStorage.removeItem(KEY);location.reload()}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session&&['initializing','ready','running'].includes(session.status)&&!finishing)endCapture('page_hidden')});
window.addEventListener('pagehide',()=>{if(session&&['initializing','ready','running'].includes(session.status)){interrupt(session,'page_closed_or_refreshed',session.startedAt==null?null:now());persist()}stopCamera()});
try{const saved=JSON.parse(sessionStorage.getItem(KEY)||'null');if(saved){if(!SUPPORTED_PROTOCOLS.includes(saved.protocol))throw Error('Different protocol');session=saved;if(['initializing','ready','running'].includes(session.status))interrupt(session,'page_closed_or_refreshed');persist();if(session.locked)showFinished();else showReview()}}
catch{status('Local record recovery failed. No measurements were reconstructed. Clear only this tab’s research data before continuing.');visible('reset-area',true);el('check-camera').disabled=true;}
