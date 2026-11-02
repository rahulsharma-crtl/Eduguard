// Study orchestration and export only. Detection is performed by the unmodified production engine.
export const PROTOCOL = 'eduguard-facial-validation-v1';
export const PROTOCOL_V2 = 'eduguard-facial-validation-v2';
export const SUPPORTED_PROTOCOLS = Object.freeze([PROTOCOL,PROTOCOL_V2]);
export const PREPARATION_MS = 10000;
export const TRANSITION_MS = 5000;
export const OBSERVATION_MS = 8000;
export const TOTAL_MS = PREPARATION_MS + 5 * (TRANSITION_MS + OBSERVATION_MS);
export const LABELS = Object.freeze(['ATTENTIVE','NATURAL_BLINK','PROLONGED_EYE_CLOSURE','LOOKING_AWAY','LOOKING_DOWN','LOOKING_UP','HEAD_TILT','FACE_NOT_DETECTED','INSUFFICIENT_QUALITY']);
export const UNKNOWN = 'UNKNOWN';
export const PLAN = Object.freeze([
 {id:'T1',expected:'ATTENTIVE',instruction:'Face the camera with eyes open. Keep your head comfortably straight.'},
 {id:'T2',expected:'PROLONGED_EYE_CLOSURE',instruction:'Keep your face forward and close both eyes gently. The observer will tell you when to open them.'},
 {id:'T3',expected:'LOOKING_AWAY',instruction:'Open your eyes and turn your head sideways, roughly 35–45 degrees. Hold comfortably.'},
 {id:'T4',expected:'ATTENTIVE',instruction:'Return to face the camera with eyes open.'},
 {id:'T5',expected:'FACE_NOT_DETECTED',instruction:'Move your entire face outside the camera view and remain there.'}
].map(Object.freeze));
export const COLUMNS = Object.freeze(['protocol_version','record_type','participant_id','session_id','session_status','consent_confirmed','observer_present','trial_id','expected_behavior','predicted_behavior','engine_behavior','phase','window_index','window_start_ms','window_end_ms','capture_rel_ms','observation_utc','completed_rel_ms','frame_id','observer_verification','reference_status','validity','result_status','is_unknown','quality','quality_reason','processing_ms','observer_onset_ms','detection_latency_ms','cue_to_detection_ms','latency_status','conditions','device','engine_sha256','prediction_counts','interruption_reason','started_at_utc','engine_defaults_json']);
export function bounds(session,trial){
 if(session.protocol!==PROTOCOL_V2){const i=PLAN.indexOf(trial),cue=PREPARATION_MS+i*(TRANSITION_MS+OBSERVATION_MS);return{cue,start:cue+TRANSITION_MS,end:cue+TRANSITION_MS+OBSERVATION_MS}}
 const instruction=session.phases.find(p=>p.trialId===trial.id&&p.phase==='instruction'),observation=session.phases.find(p=>p.trialId===trial.id&&p.phase==='observation');
 return{cue:instruction?.start??null,start:observation?.start??null,end:observation?.end??null};
}
export function beginPhase(session,phase,trialId,start,duration=null){
 if(session.protocol!==PROTOCOL_V2||session.status!=='running'||!['preparation','instruction','transition','observation'].includes(phase)||!Number.isFinite(start)||start<0||session.phases.some(p=>p.end===null))throw Error('Invalid phase start');
 const last=session.phases.at(-1);if(last&&start<last.end)throw Error('Overlapping phase');
 const record={phase,trialId,start,end:null,deadline:duration==null?null:start+duration,narration:'',outcome:'open'};session.phases.push(record);return record;
}
export function endPhase(session,end,{narration='',interrupted=false}={}){
 const phase=session.phases.at(-1);if(!phase||phase.end!==null||!Number.isFinite(end)||end<phase.start)throw Error('Invalid phase end');
 phase.end=phase.phase==='observation'&&phase.deadline!=null?Math.min(end,phase.deadline):end;phase.narration=narration;phase.outcome=interrupted?'interrupted':'complete';return phase;
}
export function timing(elapsed,session=null){
 if(session?.protocol===PROTOCOL_V2){
  const phase=session.phases.find(p=>elapsed>=p.start&&elapsed<(p.end??p.deadline??Infinity));
  if(!phase)return{phase:session.status==='completed'?'completed':'waiting',trial:null};
  const trial=PLAN.find(t=>t.id===phase.trialId)||null;
  return{phase:phase.phase,trial,start:phase.start,end:phase.end??phase.deadline,cue:trial?bounds(session,trial).cue:null};
 }
 if(elapsed<PREPARATION_MS)return{phase:'preparation',trial:null};
 if(elapsed>=TOTAL_MS)return{phase:'completed',trial:null};
 const index=Math.floor((elapsed-PREPARATION_MS)/(TRANSITION_MS+OBSERVATION_MS));
 const cue=PREPARATION_MS+index*(TRANSITION_MS+OBSERVATION_MS);
 return{phase:elapsed<cue+TRANSITION_MS?'transition':'observation',trial:PLAN[index],cue,start:cue+TRANSITION_MS,end:cue+TRANSITION_MS+OBSERVATION_MS};
}
export function createSession({participantId,sessionId,conditions='',device='desktop',engineHash='',defaults={},consentConfirmed=false,observerPresent=false,protocol=PROTOCOL}){
 return{protocol,phases:[],consentConfirmed,observerPresent,participantId,sessionId,conditions:conditions.slice(0,200),device,engineHash,defaults,startedAt:null,status:'initializing',reason:'',observations:[],onsets:{},verifications:{},locked:false};
}
export function startSession(session,epochMs){session.startedAt=epochMs;session.status='running';}
export function observe(session,{captureMs,completedMs,frameId,result=null,error=''}){
 if(session.status!=='running'||session.locked||!Number.isFinite(captureMs)||captureMs<0||(session.protocol!==PROTOCOL_V2&&captureMs>=TOTAL_MS)||!Number.isFinite(completedMs)||completedMs<captureMs)return false;
 const previous=session.observations.at(-1);
 if(previous&&(captureMs<=previous.captureMs||String(frameId)===previous.frameId))return false;
 const t=timing(captureMs,session);if(['waiting','completed'].includes(t.phase))return false;const raw=typeof result?.behavioral_state==='string'?result.behavioral_state:'';
 const unknown=!result||result.is_unknown===true||!LABELS.includes(raw)||raw==='INSUFFICIENT_QUALITY';
 session.observations.push({captureMs,completedMs,frameId:String(frameId),trialId:t.trial?.id||'',phase:t.phase,raw,predicted:unknown?UNKNOWN:raw,unknown,quality:result?.quality||'unavailable',reason:error||result?.quality_reason||'',processingMs:completedMs-captureMs});
 return true;
}
export function markOnset(session,trialId,time){
 const trial=PLAN.find(t=>t.id===trialId);if(!trial)return false;const {cue,end}=bounds(session,trial);
 if(session.status!=='running'||session.onsets[trialId]!=null||cue==null||!Number.isFinite(time)||time<cue||(end!=null&&time>=end))return false;
 session.onsets[trialId]=time;return true;
}
export function interrupt(session,reason,time=null){if(session.locked)return;if(session.protocol===PROTOCOL_V2&&session.phases.at(-1)?.end===null&&time!=null)endPhase(session,time,{interrupted:true});session.status='interrupted';session.reason=reason;}
export function complete(session){if(session.status==='running')session.status='completed';}
export function verify(session,trialId,status){
 if(session.locked||!['completed','interrupted'].includes(session.status)||!PLAN.some(t=>t.id===trialId)||!['confirmed','invalid','uncertain'].includes(status))throw Error('Invalid observer verification');
 session.verifications[trialId]=status;
}
export function lockVerification(session){
 if(!['completed','interrupted'].includes(session.status)||PLAN.some(t=>!session.verifications[t.id]))throw Error('Select an independent observer verdict for all five trials.');
 session.locked=true;
}
const strictMajority=predictions=>{
 const counts={};for(const prediction of predictions)counts[prediction]=(counts[prediction]||0)+1;
 const winner=Object.entries(counts).find(([,n])=>n>predictions.length/2);
 return{prediction:winner?.[0]||UNKNOWN,counts};
};
export function windowSummaries(session,trial){
 const {start,end}=bounds(session,trial);
 return Array.from({length:8},(_,index)=>{
  const begin=start==null?null:start+index*1000,target=begin==null?null:begin+500,finish=begin==null||end==null||begin>=end?null:Math.min(begin+1000,end);
  // One predeclared point per second: first fresh frame in [midpoint, midpoint+250ms).
  const sample=finish==null||target>=finish?null:session.observations.find(o=>o.trialId===trial.id&&o.phase==='observation'&&o.captureMs>=target&&o.captureMs<Math.min(target+250,finish));
  return{index,start:finish==null?null:begin,end:finish,sample:sample||null,prediction:sample?.predicted||UNKNOWN};
 });
}
export function trialSummary(session,trial){
 const windows=windowSummaries(session,trial),majority=strictMajority(windows.map(w=>w.prediction));
 const {cue,start,end}=bounds(session,trial);
 const onset=session.onsets[trial.id];
 const match=session.observations.find(o=>o.trialId===trial.id&&o.captureMs>=(onset??cue)&&o.predicted===trial.expected);
 const cueMatch=session.observations.find(o=>o.trialId===trial.id&&o.predicted===trial.expected);
 const verification=session.verifications[trial.id]||'unreviewed';
 const reference=session.status!=='completed'||verification==='invalid'?'invalid':verification==='confirmed'?'valid':'uncertain';
 return{windows,prediction:majority.prediction,counts:majority.counts,reference,verification,start,end,onset:onset??null,
  latency:onset!=null&&match?match.completedMs-onset:null,cueLatency:cueMatch?cueMatch.completedMs-cue:null,
  latencyStatus:reference!=='valid'?'invalid_reference':onset==null?'onset_not_marked':match?'detected':'not_detected'};
}
const iso=(epoch,relative)=>epoch==null||relative==null?'':new Date(epoch+relative).toISOString();
export function exportRows(session){
 if(!session.locked)throw Error('Observer verification must be locked before exporting predictions.');
 const base={protocol_version:session.protocol,participant_id:session.participantId,session_id:session.sessionId,session_status:session.status,consent_confirmed:session.consentConfirmed,observer_present:session.observerPresent,conditions:session.conditions,device:session.device,engine_sha256:session.engineHash,interruption_reason:session.reason,started_at_utc:iso(session.startedAt,0)};
 const rows=[{...base,record_type:'session',engine_defaults_json:JSON.stringify(session.defaults)}];
 if(session.protocol===PROTOCOL_V2)for(const phase of session.phases){const trial=PLAN.find(t=>t.id===phase.trialId);rows.push({...base,record_type:'phase_timing',trial_id:phase.trialId,expected_behavior:trial?.expected||'',phase:phase.phase,window_start_ms:phase.start,window_end_ms:phase.end??'',quality_reason:phase.narration,result_status:phase.outcome});}
 for(const trial of PLAN){
  const s=trialSummary(session,trial);
  const shared={...base,trial_id:trial.id,expected_behavior:trial.expected,observer_verification:s.verification,reference_status:s.reference,observer_onset_ms:s.onset??''};
  const validity=prediction=>s.reference==='invalid'?'invalid':s.reference!=='valid'||prediction===UNKNOWN?'unknown':'valid';
  rows.push({...shared,record_type:'trial_summary',predicted_behavior:s.prediction,phase:'observation',window_start_ms:s.start??'',window_end_ms:s.end??'',observation_utc:iso(session.startedAt,s.start),validity:validity(s.prediction),result_status:s.prediction===UNKNOWN?'unknown':'known',is_unknown:s.prediction===UNKNOWN,detection_latency_ms:s.latency??'',cue_to_detection_ms:s.cueLatency??'',latency_status:s.latencyStatus,prediction_counts:JSON.stringify(s.counts)});
  for(const w of s.windows){const o=w.sample;rows.push({...shared,record_type:'window_summary',phase:'observation',window_index:w.index,window_start_ms:w.start??'',window_end_ms:w.end??'',predicted_behavior:w.prediction,engine_behavior:o?.raw||'',capture_rel_ms:o?.captureMs??'',completed_rel_ms:o?.completedMs??'',observation_utc:iso(session.startedAt,o?.captureMs),frame_id:o?.frameId||'',validity:validity(w.prediction),result_status:!o?'missing':o.unknown?'unknown':'known',is_unknown:!o||o.unknown,quality:o?.quality||'unavailable',quality_reason:o?.reason||(!o?'no_fresh_frame_in_sampling_window':''),processing_ms:o?.processingMs??''});}
  for(const o of session.observations.filter(o=>o.trialId===trial.id))rows.push({...shared,record_type:'observation',phase:o.phase,predicted_behavior:o.predicted,engine_behavior:o.raw,capture_rel_ms:o.captureMs,completed_rel_ms:o.completedMs,observation_utc:iso(session.startedAt,o.captureMs),frame_id:o.frameId,validity:validity(o.predicted),result_status:o.unknown?'unknown':'known',is_unknown:o.unknown,quality:o.quality,quality_reason:o.reason,processing_ms:o.processingMs});
 }
 return rows;
}
export function csvCell(value){const s=String(value??'');const safe=/^[\s]*[=+@-]/.test(s)?"'"+s:s;return '"'+safe.replaceAll('"','""')+'"';}
export function toCSV(session){return[COLUMNS.join(','),...exportRows(session).map(row=>COLUMNS.map(key=>csvCell(row[key])).join(','))].join('\r\n')+'\r\n';}
export function parseCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"'){if(cell)throw Error('Malformed CSV quoting');quoted=true;}else if(c===','){row.push(cell);cell='';}else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('Unterminated CSV field');if(cell||row.length){row.push(cell);rows.push(row)}
 if(!rows.length)throw Error('Empty CSV');const columns=rows.shift();if(new Set(columns).size!==columns.length||COLUMNS.some(c=>!columns.includes(c)))throw Error('Missing/duplicate facial validation CSV columns');
 return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==columns.length)throw Error('CSV column count mismatch');return Object.fromEntries(columns.map((key,i)=>[key,r[i]]))});
}
