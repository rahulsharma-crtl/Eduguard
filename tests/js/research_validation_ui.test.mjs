import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAN,PROTOCOL_V2,COLUMNS,createSession,startSession,observe,complete,verify,lockVerification,toCSV,parseCSV} from '../../components/facial_validation/frontend/workflow.mjs';
import {runGuidedProtocol} from '../../components/facial_validation/frontend/runner.mjs';
import {LocalNarrator} from '../../components/facial_validation/frontend/speech.mjs';
import {renderMesh} from '../../components/facial_validation/frontend/preview.mjs';
import {validateExport,analyzeExports} from '../../scripts/analyze_facial_validation.mjs';
async function v2Fixture(){
 const s=createSession({protocol:PROTOCOL_V2,participantId:'P-v2fixture',sessionId:'v2fixture',engineHash:'a'.repeat(64),consentConfirmed:true,observerPresent:true});startSession(s,Date.UTC(2026,10,2));let time=0,frame=0;
 await runGuidedProtocol(s,{clock:()=>time,delay:async ms=>{time+=ms},speak:async()=>{time+=2000;return'spoken'},onPhase:p=>{if(p.phase==='observation')for(let i=0;i<8;i++)observe(s,{captureMs:p.start+i*1000+500,completedMs:p.start+i*1000+520,frameId:++frame,result:{behavioral_state:PLAN.find(t=>t.id===p.trialId).expected,quality:'valid',is_unknown:false}})}});
 complete(s);for(const t of PLAN)verify(s,t.id,'confirmed');lockVerification(s);return s;
}
test('V2 speech completes before five-second settlement and eight-second actual observation windows',async()=>{
 const s=await v2Fixture();assert.equal(s.phases.length,16);assert.equal(s.phases.at(-1).end,85000);
 for(const trial of PLAN){const pp=s.phases.filter(p=>p.trialId===trial.id);assert.deepEqual(pp.map(p=>p.phase),['instruction','transition','observation']);assert.equal(pp[0].end-pp[0].start,2000);assert.equal(pp[1].start,pp[0].end);assert.equal(pp[1].end-pp[1].start,5000);assert.equal(pp[2].start,pp[1].end);assert.equal(pp[2].end-pp[2].start,8000)}
 const csv=parseCSV(toCSV(s));assert.deepEqual(Object.keys(csv[0]),[...COLUMNS]);assert.equal(csv.filter(r=>r.record_type==='phase_timing').length,16);validateExport(csv);assert.equal(analyzeExports([csv],{bootstrap:200}).trialLevel.n,5);
 const legacy=createSession({participantId:'P-v1fixture',sessionId:'v1fixture',engineHash:'a'.repeat(64),consentConfirmed:true,observerPresent:true});startSession(legacy,Date.UTC(2026,10,2));complete(legacy);for(const t of PLAN)verify(legacy,t.id,'confirmed');lockVerification(legacy);const oldRows=parseCSV(toCSV(legacy));validateExport(oldRows);assert.throws(()=>analyzeExports([csv,oldRows],{bootstrap:200}),/Mixed protocol/);
 const changed=csv.map(r=>({...r}));changed.find(r=>r.record_type==='phase_timing'&&r.phase==='observation').window_start_ms='1';assert.throws(()=>validateExport(changed));
});
test('Speech still active blocks all measurement windows; clock limit never silently shortens a trial',async()=>{
 const s=createSession({protocol:PROTOCOL_V2,participantId:'P-stalled',sessionId:'stalled'});startSession(s,0);let time=0;
 await assert.rejects(runGuidedProtocol(s,{clock:()=>time,delay:async ms=>{time+=ms},speak:async()=> 'spoken',isSpeaking:()=>true}),/Speech did not stop/);
 assert.equal(s.phases.filter(p=>p.phase==='observation').length,0);
 const excessive=createSession({protocol:PROTOCOL_V2,participantId:'P-long',sessionId:'long'});startSession(excessive,0);time=0;
 await assert.rejects(runGuidedProtocol(excessive,{clock:()=>time,delay:async ms=>{time+=ms},speak:async()=>{time+=30000;return'spoken'}}),/100 seconds/);
});
test('Narrator selects local English voices only and awaits actual end or explicit mute',async()=>{
 let utterance;const synth={speaking:false,getVoices:()=>[{lang:'en-US',localService:true}],speak:u=>{utterance=u;synth.speaking=true},cancel:()=>{synth.speaking=false}};
 const narrator=new LocalNarrator({synth,Utterance:class{constructor(text){this.text=text}}});let finished=false;const promise=narrator.speak('Face forward').then(v=>{finished=true;return v});await Promise.resolve();assert.equal(finished,false);assert.equal(utterance.lang,'en-US');synth.speaking=false;utterance.onend();assert.equal(await promise,'spoken');
 const muted=narrator.speak('Close eyes');narrator.setMuted(true);assert.equal(await muted,'muted');assert.equal(narrator.speaking,false);
 const remoteOnly=new LocalNarrator({synth:{getVoices:()=>[{lang:'en-US',localService:false}],speak:()=>assert.fail('Remote voice must not be used')},Utterance:class{}});assert.equal(await remoteOnly.speak('Local only'),'unavailable');
});
test('Narrator timeout cancels speech and falls back to text without pretending it completed',async()=>{
 const synth={speaking:false,getVoices:()=>[{lang:'en-GB',localService:true}],speak:()=>{synth.speaking=true},cancel:()=>{synth.speaking=false}};
 const narrator=new LocalNarrator({synth,Utterance:class{},timeoutMs:5});assert.equal(await narrator.speak('Test cue'),'timeout');assert.equal(narrator.muted,true);assert.equal(synth.speaking,false);
});
test('Mesh overlay is rendering-only and never mutates normalized inference landmarks',()=>{
 const calls=[],ctx={clearRect:()=>calls.push('clear')},canvas={width:640,height:480,getContext:()=>ctx};const landmarks=[{x:.2,y:.3,z:.1},{x:.4,y:.5,z:0}],before=structuredClone(landmarks);let draws=0;
 renderMesh(canvas,landmarks,{enabled:true,connections:[[0,1]],draw:(_ctx,points)=>{assert.equal(points,landmarks);draws++}});assert.equal(draws,1);assert.deepEqual(landmarks,before);
 renderMesh(canvas,landmarks,{enabled:false,connections:[[0,1]],draw:()=>draws++});assert.equal(draws,1);assert.equal(calls.length,2);
});


test('Failed later narration cannot silently open the next observation window',async()=>{
 const s=createSession({protocol:PROTOCOL_V2,participantId:'P-audio',sessionId:'audio'});startSession(s,0);let time=0,cues=0;
 await assert.rejects(runGuidedProtocol(s,{clock:()=>time,delay:async ms=>{time+=ms},speak:async()=>++cues===3?'timeout':'spoken'}),/Required narration failed/);
 assert.equal(s.phases.filter(p=>p.phase==='observation').length,1);
 assert.equal(s.phases.at(-1).trialId,'T2');
});
