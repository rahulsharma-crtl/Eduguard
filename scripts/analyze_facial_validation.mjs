/** Local-only CSV analysis. No network access or database writes. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PLAN,PROTOCOL,PROTOCOL_V2,SUPPORTED_PROTOCOLS,LABELS,UNKNOWN,COLUMNS,parseCSV,timing,trialSummary,csvCell} from '../components/facial_validation/frontend/workflow.mjs';
import {clusterCI} from '../evaluation/lib.mjs';
export const CLASSES=Object.freeze([...new Set(PLAN.map(t=>t.expected))]);
const number=(value,name)=>{if(value===''||!Number.isFinite(Number(value))||Number(value)<0)throw Error(`Invalid ${name}`);return Number(value)};
const optionalNumber=(value,name)=>value===''?null:number(value,name);
export function validateExport(rows){
 const metadata=rows.filter(r=>r.record_type==='session');if(metadata.length!==1)throw Error('Each file must have exactly one session record.');
 const root=metadata[0];
 if(root.consent_confirmed!=='true'||root.observer_present!=='true')throw Error('Explicit consent and supervisor presence must be declared');
 if(!SUPPORTED_PROTOCOLS.includes(root.protocol_version)||!/^P-[a-zA-Z0-9-]{3,80}$/.test(root.participant_id)||!/^[a-zA-Z0-9-]{3,80}$/.test(root.session_id)||!['completed','interrupted'].includes(root.session_status))throw Error('Invalid session identity/protocol/status');
 if(root.session_status==='completed'&&(!Number.isFinite(Date.parse(root.started_at_utc))||!/^[a-f0-9]{64}$/.test(root.engine_sha256)))throw Error('Completed sessions require start time and engine hash');
 const summary=rows.filter(r=>r.record_type==='trial_summary'),windows=rows.filter(r=>r.record_type==='window_summary'),observations=rows.filter(r=>r.record_type==='observation');
 if(summary.length!==5||new Set(summary.map(r=>r.trial_id)).size!==5||windows.length!==40)throw Error('Requires five unique trial summaries and forty window records, including missing windows');
 const allowedPredictions=[...LABELS.filter(l=>l!=='INSUFFICIENT_QUALITY'),UNKNOWN];
 for(const row of rows){
  if(Object.keys(row).some(k=>!COLUMNS.includes(k))||!['session','trial_summary','window_summary','observation',...(root.protocol_version===PROTOCOL_V2?['phase_timing']:[])].includes(row.record_type))throw Error('Unsupported CSV columns/record type');
  for(const key of ['protocol_version','participant_id','session_id','session_status','consent_confirmed','observer_present','engine_sha256','conditions','device','started_at_utc'])if(row[key]!==root[key])throw Error(`Inconsistent session metadata: ${key}`);
  if(['session','phase_timing'].includes(row.record_type))continue;
  const trial=PLAN.find(t=>t.id===row.trial_id);
  if(!trial||trial.expected!==row.expected_behavior||!['confirmed','invalid','uncertain'].includes(row.observer_verification)||!allowedPredictions.includes(row.predicted_behavior))throw Error('Invalid trial label/observer verdict');
  if(row.engine_behavior&&!LABELS.includes(row.engine_behavior))throw Error('Unknown engine label');
  if(!['true','false'].includes(row.is_unknown)||!['known','unknown','missing'].includes(row.result_status))throw Error('Invalid unknown/result status');
  if((row.predicted_behavior===UNKNOWN)!==(row.is_unknown==='true'))throw Error('Unknown flag inconsistent with prediction');
 }
 const reconstructed={protocol:root.protocol_version,status:root.session_status,phases:[],observations:[],onsets:{},verifications:{}};
 if(root.protocol_version===PROTOCOL_V2){
  const phases=rows.filter(r=>r.record_type==='phase_timing');let previousEnd=0;
  const expected=[['preparation',''],...PLAN.flatMap(t=>[['instruction',t.id],['transition',t.id],['observation',t.id]])];
  if(phases.length>16||(root.session_status==='completed'&&phases.length!==16))throw Error('Missing/extra phase timing records');
  for(let i=0;i<phases.length;i++){
   const p=phases[i],start=number(p.window_start_ms,'phase start'),end=optionalNumber(p.window_end_ms,'phase end');
   if(p.phase!==expected[i][0]||p.trial_id!==expected[i][1]||start<previousEnd||end!==null&&end<start||!['complete','interrupted','open'].includes(p.result_status))throw Error('Invalid phase ordering/bounds');
   if(end===null&&i!==phases.length-1)throw Error('Open phase must be last');
   if(root.session_status==='completed'&&(end===null||p.result_status!=='complete'))throw Error('Completed session contains incomplete phase');
   if(p.result_status==='complete'&&(p.phase==='observation'&&Math.abs(end-start-8000)>.001||p.phase==='transition'&&end-start<5000||p.phase==='preparation'&&end-start<10000))throw Error('Phase duration violates protocol');
   if(p.phase==='instruction'&&!['spoken','muted','unavailable','error','timeout'].includes(p.quality_reason)&&p.result_status==='complete')throw Error('Missing narration outcome');
   reconstructed.phases.push({phase:p.phase,trialId:p.trial_id,start,end,deadline:p.phase==='observation'?start+8000:null,narration:p.quality_reason,outcome:p.result_status});previousEnd=end??start;
  }
  if(root.session_status==='completed'&&previousEnd>100000)throw Error('Completed session exceeds 100 seconds');
 }

 let last=-1;const frameIds=new Set();
 // Export groups observations by trial; captures must remain strictly chronological and unique.
 for(const row of observations){const capture=number(row.capture_rel_ms,'capture'),completed=number(row.completed_rel_ms,'completed');if(capture<=last||completed<capture||frameIds.has(row.frame_id))throw Error('Repeated/out-of-order camera observations');last=capture;frameIds.add(row.frame_id);const phase=timing(capture,reconstructed);if(phase.trial?.id!==row.trial_id||phase.phase!==row.phase)throw Error('Observation does not belong to its trial/phase');
  reconstructed.observations.push({trialId:row.trial_id,phase:row.phase,captureMs:capture,completedMs:completed,frameId:row.frame_id,predicted:row.predicted_behavior});
 }
 for(const trial of PLAN){
  const row=summary.find(r=>r.trial_id===trial.id);if(!row)throw Error('Missing trial');
  reconstructed.verifications[trial.id]=row.observer_verification;const onset=optionalNumber(row.observer_onset_ms,'observer onset');if(onset!==null)reconstructed.onsets[trial.id]=onset;
  const calculated=trialSummary(reconstructed,trial),ww=windows.filter(r=>r.trial_id===trial.id);
  if(ww.length!==8||new Set(ww.map(r=>r.window_index)).size!==8)throw Error('Duplicate/missing window index');
  for(const w of calculated.windows){const exported=ww.find(r=>r.window_index===String(w.index));if(!exported||optionalNumber(exported.window_start_ms,'window start')!==w.start||optionalNumber(exported.window_end_ms,'window end')!==w.end||exported.predicted_behavior!==w.prediction||exported.frame_id!==(w.sample?.frameId||'')||exported.capture_rel_ms!==(w.sample?String(w.sample.captureMs):''))throw Error('Window summaries disagree with underlying observations');}
  if(row.predicted_behavior!==calculated.prediction||row.reference_status!==calculated.reference||optionalNumber(row.window_start_ms,'trial start')!==calculated.start||optionalNumber(row.window_end_ms,'trial end')!==calculated.end)throw Error('Trial summary/validity disagrees with frozen protocol');
  if(optionalNumber(row.detection_latency_ms,'latency')!==calculated.latency||optionalNumber(row.cue_to_detection_ms,'cue latency')!==calculated.cueLatency||row.latency_status!==calculated.latencyStatus)throw Error('Latency disagrees with recorded onset/observations');
  for(const related of [...ww,...observations.filter(r=>r.trial_id===trial.id)])if(related.observer_verification!==row.observer_verification||related.reference_status!==row.reference_status)throw Error('Observer verification changed across records');
 }
 return{root,summary,windows};
}
export function trialMetrics(trials){
 const columns=[...LABELS.filter(l=>l!=='INSUFFICIENT_QUALITY'),UNKNOWN];
 const confusion=Object.fromEntries(CLASSES.map(c=>[c,Object.fromEntries(columns.map(p=>[p,0]))]));
 for(const row of trials)confusion[row.expected_behavior][row.predicted_behavior]++;
 const n=trials.length,correct=CLASSES.reduce((s,c)=>s+confusion[c][c],0),unknown=trials.filter(r=>r.predicted_behavior===UNKNOWN).length;
 const perClass=Object.fromEntries(columns.filter(c=>c!==UNKNOWN).map(c=>{
  const support=trials.filter(r=>r.expected_behavior===c).length,tp=trials.filter(r=>r.expected_behavior===c&&r.predicted_behavior===c).length,predicted=trials.filter(r=>r.predicted_behavior===c).length,fp=predicted-tp;
  return[c,{support,tp,fp,fn:support-tp,precision:predicted?tp/predicted:null,recall:support?tp/support:null,f1:support||predicted?2*tp/(support+predicted):null,falsePositiveRate:n-support?fp/(n-support):null}];
 }));
 const supported=CLASSES.filter(c=>perClass[c].support);
 return{n,correct,accuracy:n?correct/n:null,unknown,unknownRate:n?unknown/n:null,coverage:n?(n-unknown)/n:null,macroF1:supported.length?supported.reduce((s,c)=>s+perClass[c].f1,0)/supported.length:null,macroF1Classes:supported,missingClasses:CLASSES.filter(c=>!perClass[c].support),confusion,perClass};
}
const mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
export function analyzeExports(exports,{bootstrap=1000}={}){
 const seenPeople=new Set(),seenSessions=new Set(),all=[],eligible=[],participants=[];let engineHash=null,protocolVersion=null;
 for(const rows of exports){
  const data=validateExport(rows),root=data.root;
  if(protocolVersion!==null&&protocolVersion!==root.protocol_version)throw Error('Mixed protocol versions: analyze v1 and v2 separately');protocolVersion=root.protocol_version;
  if(seenPeople.has(root.participant_id)||seenSessions.has(root.session_id))throw Error('Duplicate participant or session: do not combine repeated attempts or duplicate downloads');
  seenPeople.add(root.participant_id);seenSessions.add(root.session_id);
  if(root.engine_sha256){if(engineHash!==null&&root.engine_sha256!==engineHash)throw Error('Mixed engine hashes: analyze versions separately');engineHash=root.engine_sha256}
  const accepted=data.summary.filter(r=>root.session_status==='completed'&&r.observer_verification==='confirmed');
  const acceptedIds=new Set(accepted.map(r=>r.trial_id));const acceptedWindows=data.windows.filter(r=>acceptedIds.has(r.trial_id));
  participants.push({participant_id:root.participant_id,session_id:root.session_id,status:root.session_status,eligibleTrials:accepted.length,invalidTrials:data.summary.filter(r=>r.observer_verification==='invalid').length,uncertainTrials:data.summary.filter(r=>r.observer_verification==='uncertain').length,excludedTrials:5-accepted.length,...trialMetrics(accepted),windowUnknownRate:acceptedWindows.length?acceptedWindows.filter(r=>r.predicted_behavior===UNKNOWN).length/acceptedWindows.length:null});
  all.push(...data.summary);eligible.push(...accepted);
 }
 const point=trialMetrics(eligible),clusterRows=eligible.map(r=>({...r,participant:r.participant_id}));
 const intervals=Object.fromEntries(['accuracy','macroF1','unknownRate'].map(key=>[key,clusterCI(clusterRows,r=>trialMetrics(r)[key],{replicates:bootstrap})]));
 const classIntervals=Object.fromEntries(CLASSES.map(c=>[c,Object.fromEntries(['precision','recall','f1','falsePositiveRate'].map(key=>[key,clusterCI(clusterRows,r=>trialMetrics(r).perClass[c][key],{replicates:bootstrap})]))]));
 const latency=eligible.filter(r=>r.detection_latency_ms!=='').map(r=>Number(r.detection_latency_ms));
 return{protocol:protocolVersion||PROTOCOL,status:eligible.length?'measured-on-supplied-CSV':'unmeasured-no-confirmed-completed-trials',unit:'one frozen summary per observer-confirmed trial; repeated inference observations are not independent trials',participants:participants.length,completedParticipants:participants.filter(p=>p.status==='completed').length,participantsWithEligibleTrials:participants.filter(p=>p.eligibleTrials>0).length,totalTrials:all.length,excludedTrials:all.length-eligible.length,engineHash,trialLevel:{...point,intervals,classIntervals},participantLevel:participants,participantMeanAccuracy:mean(participants.map(p=>p.accuracy).filter(Number.isFinite)),latency:{detectedTrials:latency.length,meanMs:mean(latency),observerMarkedTrials:eligible.filter(r=>r.observer_onset_ms!=='').length,notDetectedWithMarkedOnset:eligible.filter(r=>r.latency_status==='not_detected').length,note:'Conditional on a matched detection and observer-marked onset; cue time is not physical onset. Report misses and timing uncertainty.'},warnings:['Ten participants are a small clustered feasibility sample, not fifty independent people.','Two forward-facing trials create class imbalance (four true classes, not five).','Unknowns are retained as primary errors; observer-invalid/uncertain trials and all interrupted sessions are excluded with counts.','Additional engine labels remain confusion-matrix columns and count as incorrect; no relabeling to a desired class.','Bootstrap intervals can degenerate with zero errors; they do not establish a zero population error rate.','CSV provenance/consent and independent observer conduct require supervision; the software cannot verify honesty.']};
}
function table(headers,rows){return[headers.join(','),...rows.map(row=>row.map(csvCell).join(','))].join('\r\n')+'\r\n'}
export function main(args=process.argv.slice(2)){
 const index=args.indexOf('--out'),directory=index>=0?args[index+1]:'evaluation/results-local/facial-validation';
 const files=args.filter((_,i)=>index<0||i!==index&&i!==index+1);if(!files.length||!directory)throw Error('Usage: node scripts/analyze_facial_validation.mjs --out LOCAL_DIRECTORY participant1.csv ... participant10.csv');
 const report=analyzeExports(files.map(file=>parseCSV(readFileSync(file,'utf8'))));
 mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
 const predictions=Object.keys(report.trialLevel.confusion[CLASSES[0]]);
 writeFileSync(path.join(directory,'confusion.csv'),table(['expected_behavior',...predictions],CLASSES.map(c=>[c,...predictions.map(p=>report.trialLevel.confusion[c][p])])));
 writeFileSync(path.join(directory,'metrics.csv'),table(['class','support','precision','recall','f1','false_positive_rate'],Object.entries(report.trialLevel.perClass).map(([c,m])=>[c,m.support,m.precision,m.recall,m.f1,m.falsePositiveRate])));
 writeFileSync(path.join(directory,'participants.csv'),table(['participant_id','session_id','status','eligible_trials','excluded_trials','accuracy','unknown_rate','window_unknown_rate'],report.participantLevel.map(p=>[p.participant_id,p.session_id,p.status,p.eligibleTrials,p.excludedTrials,p.accuracy,p.unknownRate,p.windowUnknownRate])));
 console.log(JSON.stringify({status:report.status,participants:report.participants,completedParticipants:report.completedParticipants,eligibleTrials:report.trialLevel.n,accuracy:report.trialLevel.accuracy,macroF1:report.trialLevel.macroF1,unknownRate:report.trialLevel.unknownRate,output:directory,expectedSampleWarning:report.participants===10?null:'Planned sample is ten people; report the actual recruited/eligible counts.'},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main()}catch(error){console.error(error.message);process.exitCode=1}
