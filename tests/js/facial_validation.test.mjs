import test from 'node:test';
import assert from 'node:assert/strict';
import {BEHAVIORAL_STATES} from '../../core/engagement.mjs';
import {PROTOCOL,PLAN,LABELS,TOTAL_MS,COLUMNS,timing,createSession,startSession,observe,markOnset,complete,interrupt,verify,lockVerification,toCSV,parseCSV,trialSummary} from '../../components/facial_validation/frontend/workflow.mjs';
import {analyzeExports,validateExport} from '../../scripts/analyze_facial_validation.mjs';
function fixture({id='one',wrong=[],missing=[],verdicts={},interrupted=false,hash='a'.repeat(64)}={}){
 const s=createSession({participantId:'P-'+id,sessionId:'session-'+id,engineHash:hash,conditions:'glasses, normal light',defaults:{testFixture:true},consentConfirmed:true,observerPresent:true});startSession(s,Date.UTC(2026,10,1));let frame=0;
 for(let i=0;i<5;i++){
  const t=PLAN[i],cue=10000+i*13000;markOnset(s,t.id,cue+100);
  for(let w=0;w<8;w++){if(missing.includes(t.id))continue;const time=cue+5500+w*1000;
   observe(s,{captureMs:time,completedMs:time+20,frameId:++frame,result:{behavioral_state:wrong.includes(t.id)?'LOOKING_UP':t.expected,is_unknown:false,quality:'valid',quality_reason:'ok'}});
  }
 }
 if(interrupted)interrupt(s,'test_interruption');else complete(s);
 for(const t of PLAN)verify(s,t.id,verdicts[t.id]||'confirmed');lockVerification(s);return s;
}
test('Protocol labels match production; five trials represent four classes and last 75 seconds',()=>{
 assert.deepEqual([...LABELS].sort(),Object.values(BEHAVIORAL_STATES).sort());assert.equal(TOTAL_MS,75000);assert.equal(new Set(PLAN.map(t=>t.expected)).size,4);
 assert.equal(timing(9999).phase,'preparation');assert.equal(timing(10000).phase,'transition');assert.equal(timing(14999).phase,'transition');assert.equal(timing(15000).phase,'observation');assert.equal(timing(75000).phase,'completed');
});
test('Fresh-frame deduplication, immutable observer verdicts and no prediction-based verification',()=>{
 const s=createSession({participantId:'P-test',sessionId:'test'});startSession(s,1000);
 const observation={captureMs:15500,completedMs:15520,frameId:1,result:{behavioral_state:'ATTENTIVE',is_unknown:false,quality:'valid'}};
 assert.equal(observe(s,observation),true);assert.equal(observe(s,{...observation,captureMs:15530}),false);assert.equal(observe(s,{...observation,frameId:2}),false);
 assert.deepEqual(s.verifications,{});assert.throws(()=>verify(s,'T1','confirmed'));assert.throws(()=>toCSV(s),/locked/);complete(s);assert.throws(()=>lockVerification(s));
 for(const t of PLAN)verify(s,t.id,'uncertain');lockVerification(s);assert.throws(()=>verify(s,'T1','confirmed'));assert.equal(s.verifications.T1,'uncertain');
});
test('CSV has one session/five summaries/forty windows plus genuine observations, no biometrics or CEI',()=>{
 const s=fixture();const rows=parseCSV(toCSV(s));assert.equal(rows.filter(r=>r.record_type==='session').length,1);assert.equal(rows.filter(r=>r.record_type==='trial_summary').length,5);assert.equal(rows.filter(r=>r.record_type==='window_summary').length,40);assert.equal(rows.filter(r=>r.record_type==='observation').length,40);
 assert.deepEqual(Object.keys(rows[0]),[...COLUMNS]);assert.equal(rows[0].protocol_version,PROTOCOL);assert.equal(rows[0].conditions,s.conditions);assert.ok(COLUMNS.every(c=>!/landmark|image|video|cei|attentiveness/.test(c)));assert.equal(toCSV(s),toCSV(s));validateExport(rows);
});
test('Fixed midpoint sampling does not reuse stale observations; unknown majority and wrong labels preserved',()=>{
 const s=fixture({wrong:['T2'],missing:['T3']});
 assert.equal(trialSummary(s,PLAN[1]).prediction,'LOOKING_UP');assert.equal(trialSummary(s,PLAN[2]).prediction,'UNKNOWN');
 const report=analyzeExports([parseCSV(toCSV(s))],{bootstrap:200});assert.equal(report.trialLevel.n,5);assert.equal(report.trialLevel.accuracy,.6);assert.equal(report.trialLevel.unknownRate,.2);assert.equal(report.trialLevel.confusion.PROLONGED_EYE_CLOSURE.LOOKING_UP,1);assert.equal(report.trialLevel.confusion.LOOKING_AWAY.UNKNOWN,1);
 const windows=parseCSV(toCSV(s)).filter(r=>r.trial_id==='T3'&&r.record_type==='window_summary');assert.ok(windows.every(r=>r.result_status==='missing'&&r.capture_rel_ms===''));
});
test('Unknown is not low engagement; invalid/uncertain and interrupted references are explicitly excluded',()=>{
 const s=fixture({missing:['T1'],verdicts:{T2:'invalid',T3:'uncertain'}}),r=analyzeExports([parseCSV(toCSV(s))],{bootstrap:200});assert.equal(r.excludedTrials,2);assert.equal(r.trialLevel.n,3);assert.equal(r.trialLevel.unknown,1);assert.equal(r.trialLevel.accuracy,2/3);assert.equal(r.participantLevel[0].invalidTrials,1);assert.equal(r.participantLevel[0].uncertainTrials,1);
 const incomplete=analyzeExports([parseCSV(toCSV(fixture({interrupted:true})))],{bootstrap:200});assert.equal(incomplete.trialLevel.n,0);assert.equal(incomplete.trialLevel.accuracy,null);assert.equal(incomplete.status,'unmeasured-no-confirmed-completed-trials');
});
test('Metric denominators, macro-F1, participant summaries and cluster CIs use trials rather than frame counts',()=>{
 const a=fixture({id:'one'}),b=fixture({id:'two',missing:['T3']});
 const r=analyzeExports([parseCSV(toCSV(a)),parseCSV(toCSV(b))],{bootstrap:200});assert.equal(r.participants,2);assert.equal(r.totalTrials,10);assert.equal(r.trialLevel.n,10);assert.equal(r.trialLevel.accuracy,.9);assert.equal(r.trialLevel.unknownRate,.1);assert.equal(r.trialLevel.perClass.LOOKING_AWAY.recall,.5);assert.equal(r.trialLevel.perClass.LOOKING_AWAY.precision,1);assert.equal(r.trialLevel.perClass.LOOKING_AWAY.f1,2/3);assert.equal(r.trialLevel.macroF1,(3+2/3)/4);assert.equal(r.trialLevel.intervals.accuracy.participants,2);
});
test('No onset means no invented latency; processing and observed onset latency are distinct',()=>{
 const s=fixture();delete s.onsets.T1;const rows=parseCSV(toCSV(s)),t=rows.find(r=>r.record_type==='trial_summary'&&r.trial_id==='T1');assert.equal(t.detection_latency_ms,'');assert.equal(t.latency_status,'onset_not_marked');assert.equal(Number(t.cue_to_detection_ms),5520);validateExport(rows);
});
test('CSV round trips quoted conditions, escapes formula cells and rejects tampering/duplicate sessions',()=>{
 const s=fixture();s.conditions='=test,"quoted"\ncondition';const rows=parseCSV(toCSV(s));assert.equal(rows[0].conditions,"'"+s.conditions);assert.throws(()=>parseCSV('x\n"unterminated'),/Unterminated/);
 assert.throws(()=>analyzeExports([rows,rows],{bootstrap:200}),/Duplicate participant/);
 const tampered=rows.map(r=>({...r}));tampered.find(r=>r.record_type==='trial_summary').predicted_behavior='LOOKING_AWAY';assert.throws(()=>validateExport(tampered));
 assert.throws(()=>analyzeExports([parseCSV(toCSV(fixture({id:'one'}))),parseCSV(toCSV(fixture({id:'two',hash:'b'.repeat(64)})))],{bootstrap:200}),/Mixed engine/);
});

test('CLI writes one combined report set from incomplete test CSV without inventing empirical accuracy',async()=>{
 const {mkdtemp,writeFile,readFile,unlink,rmdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const {execFileSync}=await import('node:child_process');
 const dir=await mkdtemp(path.join(tmpdir(),'eduguard-validation-cli-')),out=path.join(dir,'results'),input=path.join(dir,'incomplete.csv');
 try{await writeFile(input,toCSV(fixture({interrupted:true})));execFileSync(process.execPath,['scripts/analyze_facial_validation.mjs','--out',out,input],{stdio:'pipe'});
 const result=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));assert.equal(result.status,'unmeasured-no-confirmed-completed-trials');assert.equal(result.trialLevel.accuracy,null);assert.equal(result.excludedTrials,5);
 for(const f of ['confusion.csv','metrics.csv','participants.csv'])assert.ok((await readFile(path.join(out,f),'utf8')).length>0);
 }finally{for(const f of ['report.json','confusion.csv','metrics.csv','participants.csv'])await unlink(path.join(out,f)).catch(()=>{});await unlink(input).catch(()=>{});await rmdir(out).catch(()=>{});await rmdir(dir).catch(()=>{})}
});
