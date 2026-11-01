import test from 'node:test';
import assert from 'node:assert/strict';
import {validate,splitParticipants,checkSplit,metrics,clusterCI,compress,temporal,runClips,summarize,TASKS} from '../../evaluation/lib.mjs';
import {latexReport} from '../../evaluation/run.mjs';
const labels={face:'absent',eyes:null,closure:null,yaw:null,pitch:null,roll:null,quality:'absent'};
const fixture=()=>({schemaVersion:2,source:'real-video',consentConfirmed:true,testFixture:true,clips:Array.from({length:10},(_,i)=>({id:'clip'+i,participantId:'P'+i,consentRecord:'local-consent-'+i,annotationProtocol:'test-only',device:'test',conditions:['normal'],frames:[{timestampMs:100,phase:'evaluation',labels:{...labels},landmarks:null}]}))});
test('Evaluation rejects unconsented, legacy and synthetic empirical inputs',()=>{
 const d=fixture();assert.throws(()=>validate(d),/fixtures/);validate(d,{testFixture:true});assert.throws(()=>validate({...d,consentConfirmed:false}),/consented/);assert.throws(()=>validate({...d,schemaVersion:1}),/schemaVersion/);
 d.clips[0].frames[0].labels.face='attentive';assert.throws(()=>validate(d,{testFixture:true}),/face label/);
});
test('Splits are deterministic, participant-disjoint and hash-bound',()=>{
 const d=fixture(),s=splitParticipants(d,731,{testFixture:true});assert.deepEqual(s,splitParticipants(d,731,{testFixture:true}));assert.equal(s.train.length,6);assert.equal(s.validation.length,2);assert.equal(s.test.length,2);checkSplit(d,s);assert.throws(()=>checkSplit(d,{...s,test:[s.train[0],s.test[1]]}),/leakage/);d.clips[0].frames[0].timestampMs++;assert.throws(()=>checkSplit(d,s),/changed/);
});
test('Unknown predictions lower coverage and recall; zero is not fabricated; FPR denominators correct',()=>{
 const rows=[['present','present'],['present','unknown'],['absent','present'],['absent','absent']].map(([truth,prediction],i)=>({participant:'P'+i,labels:{face:truth},predictions:{face:prediction}}));
 const m=metrics(rows,'face');assert.equal(m.coverage,.75);assert.equal(m.accuracy,.5);assert.equal(m.perClass.present.recall,.5);assert.equal(m.perClass.present.precision,.5);assert.equal(m.perClass.present.falsePositiveRate,.5);assert.deepEqual(metrics(compress(rows,'face'),'face'),m);
 const ci=clusterCI(rows,r=>metrics(r,'face').accuracy,{replicates:200});assert.equal(ci.participants,4);assert.equal(ci.validReplicates,200);assert.ok(ci.low<=.5&&ci.high>=.5);assert.deepEqual(ci,clusterCI(rows,r=>metrics(r,'face').accuracy,{replicates:200}));assert.equal(clusterCI(rows.slice(0,1),()=>1).low,null);
});
test('Missing classes and empty strata are undefined rather than perfect results',()=>{
 const m=metrics([],'face');assert.equal(m.accuracy,null);assert.equal(m.macroF1,null);assert.equal(m.perClass.present.recall,null);assert.deepEqual(m.missingClasses,['absent','present']);
});
test('Temporal metrics count delayed, missed and censored events and avoid gap transitions',()=>{
 const make=(time,truth,pred,clip='a')=>({participant:'P1',clip,time,labels:Object.fromEntries(Object.keys(TASKS).map(t=>[t,t==='closure'?truth:null])),predictions:{closure:pred},angles:null,processingMs:1});
 const rows=[make(0,'no','no'),make(100,'yes','no'),make(200,'yes','yes'),make(300,'no','no'),make(400,'yes','no'),make(500,'no','no'),make(1000,'yes','no','b')];
 const m=temporal(rows);assert.equal(m.closureDetectedEvents,1);assert.equal(m.closureLatencyMs,100);assert.equal(m.closureMissedEvents,1);assert.equal(m.closureRightCensoredEvents,1);assert.equal(m.stability.closure.transitions,1);
});
test('Real engine replay handles missing/partial landmarks without inventing pose',()=>{
 const clip=fixture().clips[0];clip.frames.push({...clip.frames[0],timestampMs:200,landmarks:[{x:.5,y:.5}]});const rows=runClips([clip]);assert.equal(rows[0].predictions.face,'absent');assert.equal(rows[0].predictions.yaw,'unknown');assert.equal(rows[1].predictions.quality,'unusable');assert.equal(rows[1].missing,'partial');assert.equal(rows[1].calibrationApplied,false);
 const report=summarize(rows,200);assert.equal(report.temporal.angles.yaw.maeDegrees,null);assert.equal(report.tasks.eyes.total,0);
 const tex=latexReport({status:'measured-on-supplied-data',variants:{test_only:report},pairedDeltas:{}});assert.match(tex,/test\\_only/);assert.match(tex,/confusion matrix/);assert.match(tex,/---/);
});
test('No-data publication table explicitly reports unmeasured accuracy',()=>{const tex=latexReport({status:'unmeasured'});assert.match(tex,/Unmeasured/);assert.doesNotMatch(tex,/100\\%|1\.000/)});

test('Personal calibration uses only the neutral prefix and ablations retain engine configuration behavior',async()=>{
 const {readFileSync}=await import('node:fs');const {LANDMARK_INDICES}=await import('../../core/engagement.mjs');
 const source=readFileSync('tests/js/facial_behavior_benchmark.test.mjs','utf8');const fn=source.slice(source.indexOf('function generateSyntheticFace('),source.indexOf('// --- Metrics Calculator ---'));
 const generate=new Function('LANDMARK_INDICES',fn+';return generateSyntheticFace;')(LANDMARK_INDICES);
 const neutral={face:'present',eyes:'open',closure:'no',yaw:'neutral',pitch:'neutral',roll:'neutral',quality:'usable'};
 const clip={...fixture().clips[0],frames:Array.from({length:30},(_,i)=>({timestampMs:1+i*100,phase:'calibration',labels:{...neutral},landmarks:generate({ear:.25})}))};
 clip.frames.push({timestampMs:3001,phase:'evaluation',labels:{...neutral},landmarks:generate({ear:.25})});
 const rows=runClips([clip],{},{personalize:true});assert.equal(rows.length,1);assert.equal(rows[0].calibrationStatus.earApplied,true);assert.equal(rows[0].calibrationStatus.cameraApplied,true);assert.equal(rows[0].predictions.face,'present');
 assert.equal(runClips([clip],{},{personalize:true,noEAR:true})[0].calibrationStatus.earApplied,false);
 assert.equal(runClips([clip],{},{personalize:true,noCamera:true})[0].calibrationStatus.cameraApplied,false);
 const short={...clip,frames:clip.frames.slice(1)};assert.equal(runClips([short],{},{personalize:true})[0].calibrationApplied,false);
});

test('Compressed participant counts yield identical cluster bootstrap intervals to frame replay',()=>{
 const rows=[];for(let p=0;p<4;p++)for(let f=0;f<12;f++)rows.push({participant:'P'+p,labels:{face:f%2?'present':'absent'},predictions:{face:(f+p)%3?'present':'absent'}});
 assert.deepEqual(clusterCI(rows,r=>metrics(r,'face').macroF1,{replicates:200}),clusterCI(compress(rows,'face'),r=>metrics(r,'face').macroF1,{replicates:200}));
});
