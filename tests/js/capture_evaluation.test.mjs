import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync('benchmarks/capture.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function harness(){
 const nodes=new Map(),downloads=[],sent=[];let meshClosed=false,revoked=[];
 const element=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,files:[],checked:false});return nodes.get(id)};
 const video=element('video');Object.defineProperties(video,{src:{set(){queueMicrotask(()=>video.onloadedmetadata())}},duration:{get:()=>.35},videoWidth:{get:()=>640},videoHeight:{get:()=>480},currentTime:{set(value){this.time=value;queueMicrotask(()=>video.onseeked())},get(){return this.time}}});video.removeAttribute=()=>{};video.load=()=>{};
 class Mesh{setOptions(){}onResults(fn){this.results=fn}async send(data){sent.push(data);this.results({multiFaceLandmarks:[]})}async close(){meshClosed=true}}
 const context={document:{getElementById:element,createElement:()=>({click(){downloads.push(this)}})},FaceMesh:Mesh,URL:{createObjectURL:()=> 'blob:local-test',revokeObjectURL:u=>revoked.push(u)},crypto:{randomUUID:()=> 'pseudonymous-clip'},Blob,performance,setTimeout:fn=>fn()};vm.createContext(context);vm.runInContext(script,context);
 return{element,context,downloads,sent,get closed(){return meshClosed},revoked};
}
test('Local capture requires consent and metadata before media processing',async()=>{
 const h=harness();await h.element('run').onclick();assert.match(h.element('status').textContent,/consented/);assert.equal(h.sent.length,0);assert.equal(h.element('run').disabled,false);
 h.element('consent').checked=true;h.element('file').files=[{name:'private-name.mp4'}];h.element('labels').value='[]';await h.element('run').onclick();assert.match(h.element('status').textContent,/pseudonymous/);assert.equal(h.sent.length,0);
});
test('Capture exports schema v2 labels and missing observations, cleans resources and excludes video filename',async()=>{
 const h=harness();h.element('consent').checked=true;h.element('file').files=[{name:'private-name.mp4'}];for(const [id,value]of Object.entries({participant:'P001',consentRecord:'C001',annotationProtocol:'two-rater',device:'laptop',conditions:'normal,device-laptop'}))h.element(id).value=value;
 h.element('labels').value=JSON.stringify([{startMs:0,endMs:350,phase:'evaluation',labels:{face:'present',eyes:null,closure:null,yaw:null,pitch:null,roll:null,quality:'unusable'}}]);
 let exported;h.context.URL.createObjectURL=value=>{if(value instanceof Blob)exported=value;return 'blob:local-test'};await h.element('run').onclick();
 const data=JSON.parse(await exported.text());assert.equal(data.schemaVersion,2);assert.equal(data.clips[0].participantId,'P001');assert.equal(data.clips[0].frames.length,4);assert.equal(data.clips[0].frames[0].landmarks,null);assert.equal(data.clips[0].frames[0].labels.face,'present');assert.ok(!JSON.stringify(data).includes('private-name'));assert.equal(h.closed,true);assert.equal(h.element('run').disabled,false);assert.equal(h.revoked.length,2);
});
