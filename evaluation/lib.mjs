import {createHash} from 'node:crypto';
import {EngagementEngine, DEFAULT_CONFIG, computeEAR, LANDMARK_INDICES, estimateHeadPose, calibrateCameraOffset, assessFacePresenceQuality} from '../core/engagement.mjs';
export const TASKS={face:['absent','present'],eyes:['open','closed'],closure:['no','yes'],yaw:['neutral','turned'],pitch:['down','neutral','up'],roll:['neutral','tilted'],quality:['absent','unusable','usable']};
export const CONDITIONS=['normal','low-light','glasses','head-motion','occlusion','camera-high','camera-low','camera-side','device-laptop','device-phone','device-external'];
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function rng(seed=731){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
export function validate(data,{testFixture=false}={}){
 if(data.schemaVersion!==2||data.source!=='real-video'||data.consentConfirmed!==true||!data.clips?.length)throw Error('Requires schemaVersion 2, consented real-video data and clips.');
 if(data.testFixture&&!testFixture)throw Error('Synthetic test fixtures cannot produce empirical reports.');
 const ids=new Set();
 for(const clip of data.clips){
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(clip.participantId||'')||!clip.id||ids.has(clip.id)||!clip.consentRecord||!clip.annotationProtocol||!clip.device||!clip.conditions?.length||clip.conditions.some(c=>!CONDITIONS.includes(c))||!clip.frames?.length)throw Error('Clip requires unique ID, pseudonymous participantId, consentRecord, annotationProtocol, device, conditions and frames.');
  ids.add(clip.id);let last=-1;let evaluationSeen=false;
  for(const f of clip.frames){
   if(!Number.isFinite(f.timestampMs)||f.timestampMs<0||f.timestampMs<=last||!['calibration','evaluation'].includes(f.phase)||!f.labels||f.landmarks!==null&&!Array.isArray(f.landmarks))throw Error('Invalid frame timestamp, phase, landmarks or labels.');
   if(f.phase==='evaluation')evaluationSeen=true;else if(evaluationSeen)throw Error('Calibration must be a prefix, never interleaved with evaluation.');
   for(const [task,classes]of Object.entries(TASKS))if(f.labels[task]!==null&&!classes.includes(f.labels[task]))throw Error(`Invalid ${task} label (use null for unlabelable).`);
   if(f.referenceAngles!=null)for(const axis of ['yaw','pitch','roll'])if(f.referenceAngles[axis]!=null&&!Number.isFinite(f.referenceAngles[axis]))throw Error('Invalid reference angle');
   last=f.timestampMs;
  }
 }
 return data;
}
export function splitParticipants(data,seed=731,validationOptions={}){
 validate(data,validationOptions);const people=[...new Set(data.clips.map(c=>c.participantId))].sort();if(people.length<6)throw Error('At least six participants required for nonempty disjoint splits; substantially more recommended.');
 const random=rng(seed);for(let i=people.length-1;i;i--){const j=Math.floor(random()*(i+1));[people[i],people[j]]=[people[j],people[i]]}
 const nTrain=Math.max(2,Math.floor(people.length*.6)),nVal=Math.max(1,Math.floor(people.length*.2));
 return {schemaVersion:1,seed,datasetHash:hash(data),train:people.slice(0,nTrain),validation:people.slice(nTrain,nTrain+nVal),test:people.slice(nTrain+nVal)};
}
export function checkSplit(data,split){
 if(split.datasetHash!==hash(data))throw Error('Dataset changed since split; create a new version and split.');
 const all=[...split.train,...split.validation,...split.test],people=new Set(data.clips.map(c=>c.participantId));
 if(!split.train.length||!split.validation.length||!split.test.length||new Set(all).size!==all.length||all.length!==people.size||all.some(p=>!people.has(p)))throw Error('Participant leakage, missing participants or empty split.');
}
export function runClips(clips,config={},options={}){
 const rows=[];
 for(const clip of clips){
  const engine=new EngagementEngine(config);const warmup=clip.frames.filter(f=>f.phase==='calibration'&&f.labels.quality==='usable'&&f.labels.face==='present'&&f.labels.eyes==='open'&&f.labels.yaw==='neutral'&&f.labels.pitch==='neutral'&&f.labels.roll==='neutral');
  if(options.personalize&&warmup.length>=30){
   const valid=warmup.filter(f=>assessFacePresenceQuality(f.landmarks).isValid);
   if(valid.length>=30){if(!options.noCamera)engine.setCameraCalibration(calibrateCameraOffset(valid.map(f=>estimateHeadPose(f.landmarks))));if(!options.noEAR)engine.calibrateBaselineEARFromSamples(valid.map(f=>(computeEAR(f.landmarks,LANDMARK_INDICES.LEFT_EYE)+computeEAR(f.landmarks,LANDMARK_INDICES.RIGHT_EYE))/2));}
  }
  let previous=null;const calibrationStatus={requested:Boolean(options.personalize),eligibleFrames:warmup.length,earApplied:engine.isCalibratedEAR,cameraApplied:Boolean(options.personalize&&!options.noCamera&&warmup.filter(f=>assessFacePresenceQuality(f.landmarks).isValid).length>=30)};
  for(const f of clip.frames){
   if(f.phase!=='evaluation')continue;
   const start=performance.now(),result=engine.processFrame(f.landmarks,f.timestampMs),processingMs=performance.now()-start;
   const absent=result.presence===0,usable=!result.is_unknown&&!absent;
   const pose=result.head_pose,t=engine.config.thresholds;
   const predictions={face:result.is_unknown?'unknown':absent?'absent':'present',eyes:usable?(engine.isEyeClosed?'closed':'open'):'unknown',closure:usable?(result.is_drowsy?'yes':'no'):'unknown',yaw:usable?(Math.abs(pose.yaw)>t.yawLimitDegrees?'turned':'neutral'):'unknown',pitch:usable?(pose.pitch<t.pitchLookingDownDegrees?'down':pose.pitch>t.pitchLookingUpDegrees?'up':'neutral'):'unknown',roll:usable?(Math.abs(pose.roll)>t.rollLimitDegrees?'tilted':'neutral'):'unknown',quality:absent?'absent':result.is_unknown?'unusable':'usable'};
   rows.push({participant:clip.participantId,clip:clip.id,conditions:clip.conditions,device:clip.device,time:f.timestampMs,labels:f.labels,predictions,angles:usable?pose:null,rawScore:result.is_unknown?null:result.raw_cei,smoothedScore:result.is_unknown?null:result.smoothed_cei,behavioralState:result.behavioral_state,referenceAngles:f.referenceAngles||null,processingMs,extractionMs:Number.isFinite(f.extractionMs)?f.extractionMs:null,calibrationStatus,calibrationApplied:Boolean(calibrationStatus.cameraApplied||calibrationStatus.earApplied),missing:f.landmarks===null?'missing':f.landmarks.length<468?'partial':'complete',deltaMs:previous===null?null:f.timestampMs-previous});previous=f.timestampMs;
  }
 }
 return rows;
}
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function metrics(rows,task){
 const classes=TASKS[task],matrix=Object.fromEntries(classes.map(c=>[c,Object.fromEntries([...classes,'unknown'].map(p=>[p,0]))]));let excluded=0;
 for(const r of rows){const truth=r.labels[task];if(truth==null){excluded+=r.weight||1;continue}matrix[truth][r.predictions[task]]+=r.weight||1;}
 const total=Object.values(matrix).flatMap(Object.values).reduce((s,n)=>s+n,0);
 const perClass=Object.fromEntries(classes.map(c=>{const tp=matrix[c][c],support=Object.values(matrix[c]).reduce((s,n)=>s+n,0),fp=classes.filter(x=>x!==c).reduce((s,x)=>s+matrix[x][c],0),predicted=tp+fp,negatives=total-support;const precision=predicted?tp/predicted:null,recall=support?tp/support:null;return[c,{support,tp,fp,precision,recall,f1:support?(2*tp/(support+predicted)):null,falsePositiveRate:negatives?fp/negatives:null}]}));
 const known=total-classes.reduce((s,c)=>s+matrix[c].unknown,0),correct=classes.reduce((s,c)=>s+matrix[c][c],0);
 return{total,excluded,coverage:total?known/total:null,accuracy:total?correct/total:null,macroF1:mean(Object.values(perClass).map(v=>v.f1).filter(v=>v!==null)),missingClasses:classes.filter(c=>!perClass[c].support),perClass,confusion:matrix};
}
export function temporal(rows){
 const stability=Object.fromEntries(Object.keys(TASKS).map(t=>[t,{transitions:0,stableMs:0}]));
 const events=[];let missed=0,leftCensored=0,rightCensored=0,active=null,prev=null;const stableScoreSteps=[];
 const finish=(right=false)=>{if(active){if(right&&active.latency===null)rightCensored++;else if(active.censored)leftCensored++;else if(active.latency===null)missed++;else events.push(active.latency)}active=null};
 for(const row of rows){
  const same=prev&&prev.clip===row.clip&&row.time>prev.time&&row.time-prev.time<=250;
  if(!same||row.labels.closure!=='yes')finish(!same||row.labels.closure===null);
  for(const t of Object.keys(TASKS))if(same&&row.labels[t]!=null&&row.labels[t]===prev.labels[t]){stability[t].stableMs+=row.time-prev.time;if(row.predictions[t]!==prev.predictions[t])stability[t].transitions++;}
  if(same&&Object.keys(TASKS).every(t=>row.labels[t]===prev.labels[t])&&Number.isFinite(row.smoothedScore)&&Number.isFinite(prev.smoothedScore))stableScoreSteps.push((row.smoothedScore-prev.smoothedScore)**2);
  if(row.labels.closure==='yes'){
   if(!active)active={onset:row.time,censored:!same||prev.labels.closure==null,latency:null};
   if(active.latency===null&&row.predictions.closure==='yes')active.latency=row.time-active.onset;
  }
  prev=row;
 }
 finish(true);const angles={};
 for(const axis of ['yaw','pitch','roll']){const errors=rows.filter(r=>r.angles&&Number.isFinite(r.referenceAngles?.[axis])).map(r=>{const d=r.angles[axis]-r.referenceAngles[axis];return Math.abs(((d+180)%360+360)%360-180)});angles[axis]={n:errors.length,maeDegrees:mean(errors)};}
 return{stableScoreStepRMS:stableScoreSteps.length?Math.sqrt(mean(stableScoreSteps)):null,stability:Object.fromEntries(Object.entries(stability).map(([t,v])=>[t,{...v,transitionsPerMinute:v.stableMs?v.transitions/(v.stableMs/60000):null}])),closureDetectedEvents:events.length,closureMissedEvents:missed,closureLeftCensoredEvents:leftCensored,closureRightCensoredEvents:rightCensored,closureLatencyMs:mean(events),angles,processingMs:mean(rows.map(r=>r.processingMs)),browserExtractionMs:mean(rows.map(r=>r.extractionMs).filter(Number.isFinite)),note:'Transitions include entry/exit from unknown; only contiguous frames <=250ms with unchanged truth count. Node replay processing time excludes extraction. Latency is relative to labeled prolonged-closure onset, conditional on detection; left-censored events excluded.'};
}
export function clusterCI(rows,statistic,{replicates=1000,seed=731}={}){
 const people=[...new Set(rows.map(r=>r.participant))];if(people.length<2)return{low:null,high:null,validReplicates:0,participants:people.length};
 const random=rng(seed),groups=new Map(people.map(p=>[p,rows.filter(r=>r.participant===p)])),values=[];
 for(let b=0;b<replicates;b++){const sample=[];for(let i=0;i<people.length;i++){for(const row of groups.get(people[Math.floor(random()*people.length)]))sample.push(row)};const value=statistic(sample);if(Number.isFinite(value))values.push(value)}
 values.sort((a,b)=>a-b);return{low:values.length?values[Math.floor((values.length-1)*.025)]:null,high:values.length?values[Math.floor((values.length-1)*.975)]:null,validReplicates:values.length,participants:people.length,warning:people.length<10?'Fewer than ten contributing participants; interval may be unstable.':values.length&&values[0]===values.at(-1)?'Degenerate bootstrap distribution; does not establish absence of rare errors.':null};
}
// Exact sufficient counts preserve participant clusters without resampling every video frame for classification CIs.
export function compress(rows,task,paired=false){
 const groups=new Map();for(const row of rows){const key=JSON.stringify([row.participant,row.labels[task],row.predictions[task],paired?row.baseline[task]:null]);if(!groups.has(key))groups.set(key,{participant:row.participant,labels:{[task]:row.labels[task]},predictions:{[task]:row.predictions[task]},baseline:paired?{[task]:row.baseline[task]}:undefined,weight:0});groups.get(key).weight+=row.weight||1;}return [...groups.values()];
}
export function summarize(rows,bootstrap=1000){
 const tasks=Object.fromEntries(Object.keys(TASKS).map(task=>{const m=metrics(rows,task),counts=compress(rows.filter(r=>r.labels[task]!==null),task);m.intervals=Object.fromEntries(['macroF1','accuracy','coverage'].map(key=>[key,clusterCI(counts,r=>metrics(r,task)[key],{replicates:bootstrap})]));for(const c of TASKS[task])m.perClass[c].intervals=Object.fromEntries(['precision','recall','f1','falsePositiveRate'].map(key=>[key,clusterCI(counts,r=>metrics(r,task).perClass[c][key],{replicates:bootstrap})]));return[task,m]}));
 return{frames:rows.length,participants:new Set(rows.map(r=>r.participant)).size,tasks,temporal:temporal(rows),temporalIntervals:{closureLatencyMs:clusterCI(rows,r=>temporal(r).closureLatencyMs,{replicates:bootstrap}),poseMAE:Object.fromEntries(['yaw','pitch','roll'].map(axis=>[axis,clusterCI(rows,r=>temporal(r).angles[axis].maeDegrees,{replicates:bootstrap})]))},landmarkAvailability:Object.fromEntries(['complete','partial','missing'].map(k=>[k,rows.filter(r=>r.missing===k).length])),calibrationFramesApplied:rows.filter(r=>r.calibrationApplied).length,calibrationByClip:Object.fromEntries(rows.map(r=>[r.clip,r.calibrationStatus]))};
}
export const candidates=[{},...[.68,.76].map(earCloseRatio=>({thresholds:{earCloseRatio}})),...[.82,.9].map(earOpenRatio=>({thresholds:{earOpenRatio}})),...[20,30].map(yawLimitDegrees=>({thresholds:{yawLimitDegrees}})),...[-10,-20].map(pitchLookingDownDegrees=>({thresholds:{pitchLookingDownDegrees}})),...[15,25].map(pitchLookingUpDegrees=>({thresholds:{pitchLookingUpDegrees}})),...[20,30].map(rollLimitDegrees=>({thresholds:{rollLimitDegrees}})),...[800,1200].map(drowsinessDurationMs=>({thresholds:{drowsinessDurationMs}})),...[.17,.21].map(fallbackCloseThreshold=>({thresholds:{fallbackCloseThreshold,fallbackOpenThreshold:fallbackCloseThreshold+.04}})),...[10,20].map(minInterocularDistance=>({thresholds:{minInterocularDistance}}))];
export function objective(rows){return mean(Object.keys(TASKS).map(t=>metrics(rows,t).macroF1).filter(Number.isFinite));}
export {DEFAULT_CONFIG};
