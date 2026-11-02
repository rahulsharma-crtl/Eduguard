import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {LANDMARK_INDICES} from '../../core/engagement.mjs';
import {parseCSV} from '../../components/facial_validation/frontend/workflow.mjs';
import {analyzeExports} from '../../scripts/analyze_facial_validation.mjs';
async function browserHarness({denied=false,realModel=false,speechMs=1200,speechStall=false}={}){
 const root=path.resolve('dist'),server=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  let content=await readFile(file);if(!realModel&&pathname==='/classroom/validation/index.html')content=content.toString().replace(/ integrity="[^"]+"/g,'');
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':'text/css');res.end(content);
 }catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;if(!executablePath&&process.platform==='win32'){try{await access('C:/Program Files/Google/Chrome/Application/chrome.exe');executablePath='C:/Program Files/Google/Chrome/Application/chrome.exe'}catch{}}
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--autoplay-policy=no-user-gesture-required']});const context=await browser.newContext({acceptDownloads:true});
 const traffic=[];context.on('request',r=>traffic.push({url:r.url(),method:r.method()}));
 await context.addInitScript(({denied,realModel,speechMs,speechStall})=>{
  window.__studyAudit={captures:[],tracks:[],peerConnections:0,websockets:0,utterances:[]};
  let voiceTimer;
  const fakeSpeech={speaking:false,getVoices:()=>speechMs||speechStall?[{lang:'en-US',localService:true}]:[],addEventListener(){},speak(u){this.speaking=true;const entry={text:u.text,start:performance.now(),end:null};window.__studyAudit.utterances.push(entry);if(!speechStall)voiceTimer=setTimeout(()=>{entry.end=performance.now();this.speaking=false;u.onend?.()},speechMs)},cancel(){clearTimeout(voiceTimer);this.speaking=false}};
  Object.defineProperty(window,'speechSynthesis',{value:fakeSpeech,configurable:true});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};
  const NativePC=window.RTCPeerConnection;window.RTCPeerConnection=class extends NativePC{constructor(...args){super(...args);window.__studyAudit.peerConnections++}};
  const NativeWS=window.WebSocket;window.WebSocket=class extends NativeWS{constructor(...args){super(...args);window.__studyAudit.websockets++}};
  navigator.mediaDevices.getUserMedia=async constraints=>{
   window.__studyAudit.captures.push(constraints);if(denied)throw new DOMException('Synthetic denial','NotAllowedError');
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.getContext('2d').fillRect(0,0,640,480);if(realModel){let n=0;setInterval(()=>{const ctx=canvas.getContext('2d');ctx.fillStyle=n++%2?'#102030':'#304050';ctx.fillRect(0,0,640,480)},40)}const stream=canvas.captureStream(30);window.__studyAudit.tracks.push(...stream.getTracks());return stream;
  };
  if(!realModel){
   // Minimal connector fixture for rendering tests; real-model test loads MediaPipe's own topology.
   window.FACEMESH_TESSELATION=[[33,133],[133,362],[362,263],[263,33]];
   HTMLMediaElement.prototype.play=async()=>{};
   Object.defineProperty(HTMLMediaElement.prototype,'readyState',{get:()=>4});
   let frames=0;HTMLVideoElement.prototype.requestVideoFrameCallback=function(callback){return setTimeout(()=>callback(performance.now(),{presentedFrames:++frames}),100)};
   HTMLVideoElement.prototype.cancelVideoFrameCallback=function(id){clearTimeout(id)};
  }
 },{denied,realModel,speechMs,speechStall});
 if(!realModel){
  const source=await readFile('tests/js/facial_behavior_benchmark.test.mjs','utf8'),fn=source.slice(source.indexOf('function generateSyntheticFace('),source.indexOf('// --- Metrics Calculator ---'));
  await context.route('**/face_mesh.js',r=>r.fulfill({contentType:'text/javascript',body:`const LANDMARK_INDICES=${JSON.stringify(LANDMARK_INDICES)};${fn};window.FaceMesh=class{setOptions(){}onResults(fn){this.callback=fn}async send(){const s=JSON.parse(sessionStorage.getItem('eduguard-facial-validation:v1')||'null');const elapsed=s?.startedAt?Date.now()-s.startedAt:0;const active=s?.phases?.at(-1)?.trialId;const trial=active?Number(active.slice(1))-1:Math.floor((elapsed-10000)/13000);if(trial===3)throw Error('Synthetic tracking failure');const face=trial===4?null:generateSyntheticFace({ear:trial===1?.05:.25,yaw:trial===2?40:0});this.callback({multiFaceLandmarks:face?[face]:[]})}async close(){}}` }));
 }
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));const base=`http://127.0.0.1:${server.address().port}`;
 return{page,context,traffic,base,errors,close:async()=>{await browser.close();await new Promise(r=>server.close(r))}};
}
async function ready(page,base){await page.goto(base+'/classroom/validation/index.html',{waitUntil:'domcontentloaded'});await page.getByLabel(/I am 18 or older/).check();await page.getByLabel(/A supervising observer/).check();await page.getByRole('button',{name:'Check camera readiness',exact:true}).click()}
async function start(page,base){await ready(page,base);await page.getByRole('button',{name:'Start one validation session',exact:true}).click()}
async function verdicts(page,values={}){for(let i=1;i<=5;i++)await page.getByLabel(`Observer verification T${i}`,{exact:true}).selectOption(values['T'+i]||'confirmed');await page.getByRole('button',{name:'Lock verification and prepare CSV',exact:true}).click()}
async function downloadRows(page){const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV',exact:true}).click();const file=await event,stream=await file.createReadStream(),parts=[];for await(const chunk of stream)parts.push(chunk);return{rows:parseCSV(Buffer.concat(parts).toString('utf8')),name:file.suggestedFilename()}}
function assertLocal(traffic){assert.ok(traffic.every(r=>r.method==='GET'));assert.ok(traffic.every(r=>!r.url.includes('/rooms')&&!r.url.includes('/config')&&!r.url.includes('/peerjs')))}
test('Narrated v2 protocol: actual timing, hidden predictions, one local-only CSV',{timeout:90000},async()=>{
 const h=await browserHarness({speechMs:1200});try{
  await h.page.clock.install();await ready(h.page,h.base);
  await h.page.getByText('Camera permission: granted · preview is local',{exact:true}).waitFor();await h.page.clock.runFor(1000);
  assert.ok(await h.page.evaluate(()=>{const c=document.getElementById('mesh-overlay');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((value,i)=>i%4===3&&value>0)}),'Visible overlay draws without modifying inference input');
  assert.equal(await h.page.getByRole('button',{name:'Download CSV',exact:true}).isVisible(),false);
  const before=await h.page.evaluate(()=>JSON.parse(sessionStorage.getItem('eduguard-facial-validation:v1')).observations.length);assert.equal(before,0);
  await h.page.getByRole('button',{name:'Start one validation session',exact:true}).click();
  await h.page.getByText('Guided capture started.',{exact:false}).waitFor();
  // Advance actual phase-driven timing; narration may extend the old fixed schedule.
  const marked=new Set();let overlayToggled=false;
  for(let second=0;second<105;second++){
   const saved=await h.page.evaluate(()=>JSON.parse(sessionStorage.getItem('eduguard-facial-validation:v1')));
   const phase=saved.phases.at(-1);
   if(phase?.trialId&&!marked.has(phase.trialId)&&await h.page.getByRole('button',{name:'Observer: action started',exact:true}).isEnabled()){await h.page.getByRole('button',{name:'Observer: action started',exact:true}).click();marked.add(phase.trialId)}
   if(!overlayToggled&&phase?.phase==='observation'){await h.page.getByLabel('Show local facial mesh',{exact:true}).uncheck();overlayToggled=true;assert.equal(await h.page.locator('#mesh-overlay').isVisible(),false)}
   await h.page.clock.runFor(1000);
   if(await h.page.getByRole('heading',{name:'Independent observer verification',exact:true}).isVisible())break;
  }
  await h.page.getByRole('heading',{name:'Independent observer verification',exact:true}).waitFor();
  assert.equal(await h.page.getByText('PROLONGED_EYE_CLOSURE',{exact:true}).count(),0);
  assert.equal(await h.page.getByRole('button',{name:'Download CSV',exact:true}).isVisible(),false);
  const audit=await h.page.evaluate(()=>({captures:window.__studyAudit.captures,states:window.__studyAudit.tracks.map(t=>t.readyState),peerConnections:window.__studyAudit.peerConnections,websockets:window.__studyAudit.websockets,record:sessionStorage.getItem('eduguard-facial-validation:v1')}));
  assert.ok(audit.captures.every(c=>c.audio===false));assert.ok(audit.states.every(s=>s==='ended'));assert.equal(audit.peerConnections,0);assert.equal(audit.websockets,0);assert.ok(JSON.parse(audit.record).observations.every(o=>!['landmarks','image','cei_score','attentiveness'].some(key=>key in o)));
  await verdicts(h.page,{T2:'uncertain',T3:'invalid'});const csv=await downloadRows(h.page);assert.match(csv.name,/^eduguard-validation-P-.*\.csv$/);
  assert.equal(csv.rows.filter(r=>r.record_type==='trial_summary').length,5);assert.equal(csv.rows.filter(r=>r.record_type==='window_summary').length,40);assert.ok(csv.rows.some(r=>r.record_type==='observation'));
  const report=analyzeExports([csv.rows],{bootstrap:200});assert.equal(report.trialLevel.n,3);assert.equal(report.excludedTrials,2);assert.ok(report.trialLevel.unknown>=1,'Tracking failures retained as unknown trial, not dropped');assertLocal(h.traffic);assert.deepEqual(h.errors,[]);
  const phases=csv.rows.filter(r=>r.record_type==='phase_timing');assert.equal(phases.length,16);
  const spoken=await h.page.evaluate(()=>window.__studyAudit.utterances);assert.ok(spoken.length>=6);assert.ok(spoken.every(u=>u.end!==null));
  for(const trial of ['T1','T2','T3','T4','T5']){const p=phases.filter(r=>r.trial_id===trial);assert.ok(Number(p[2].window_start_ms)>=Number(p[0].window_end_ms)+5000);assert.ok(Math.abs(Number(p[2].window_end_ms)-Number(p[2].window_start_ms)-8000)<.001)}
  const id=csv.rows[0].session_id;await h.page.reload({waitUntil:'domcontentloaded'});await h.page.getByRole('button',{name:'Download CSV',exact:true}).waitFor();const again=await downloadRows(h.page);assert.equal(again.rows[0].session_id,id);assert.deepEqual(again.rows,csv.rows);assert.equal(await h.page.evaluate(()=>window.__studyAudit.captures.length),0);
 }finally{await h.close()}
});
test('Camera denial and refresh never fabricate or restart measurements',{timeout:45000},async()=>{
 const denied=await browserHarness({denied:true});try{await ready(denied.page,denied.base);await denied.page.getByText(/Camera permission denied. No observations were measured./).waitFor();await verdicts(denied.page);const csv=await downloadRows(denied.page);assert.equal(csv.rows[0].session_status,'interrupted');assert.equal(csv.rows.filter(r=>r.record_type==='observation').length,0);assert.equal(analyzeExports([csv.rows],{bootstrap:200}).trialLevel.accuracy,null);assertLocal(denied.traffic)}finally{await denied.close()}
 const h=await browserHarness();try{await h.page.clock.install();await start(h.page,h.base);await h.page.getByText('Guided capture started.',{exact:false}).waitFor();await h.page.clock.runFor(16000);await h.page.reload({waitUntil:'domcontentloaded'});await h.page.getByRole('heading',{name:'Independent observer verification',exact:true}).waitFor();assert.equal(await h.page.evaluate(()=>window.__studyAudit.captures.length),0);await verdicts(h.page);const csv=await downloadRows(h.page);assert.equal(csv.rows[0].session_status,'interrupted');assert.equal(analyzeExports([csv.rows],{bootstrap:200}).trialLevel.n,0);assertLocal(h.traffic)}finally{await h.close()}
});


test('Real pinned MediaPipe assets initialize on the isolated page without backend or media upload',{timeout:75000},async()=>{
 const h=await browserHarness({realModel:true});try{
  await start(h.page,h.base);await h.page.getByText('Guided capture started.',{exact:false}).waitFor({timeout:45000});
  assert.ok(await h.page.evaluate(()=>typeof drawConnectors==='function'&&FACEMESH_TESSELATION.length>100),'Pinned production drawing helpers and mesh topology loaded');
  await h.page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('eduguard-facial-validation:v1')).observations.length>0,{},{timeout:10000});
  await h.page.getByRole('button',{name:'Stop and keep incomplete record',exact:true}).click();await h.page.getByRole('heading',{name:'Independent observer verification',exact:true}).waitFor();
  assert.ok(await h.page.evaluate(()=>window.__studyAudit.tracks.every(t=>t.readyState==='ended')));
  await verdicts(h.page);const csv=await downloadRows(h.page);assert.equal(csv.rows[0].session_status,'interrupted');assertLocal(h.traffic);
 }finally{await h.close()}
});


test('Required narration timeout stops capture without opening an observation window',{timeout:60000},async()=>{
 const h=await browserHarness({speechStall:true});try{
  await h.page.clock.install();await ready(h.page,h.base);await h.page.getByText('Camera permission: granted · preview is local',{exact:true}).waitFor();
  await h.page.getByRole('button',{name:'Mute instructions',exact:true}).click();
  await h.page.getByRole('button',{name:'Start one validation session',exact:true}).click();
  assert.equal(await h.page.locator('#readiness').isVisible(),true);
  await h.page.getByRole('button',{name:'Unmute instructions',exact:true}).click();
  await h.page.getByRole('button',{name:'Start one validation session',exact:true}).click();
  await h.page.clock.runFor(14000);await h.page.getByRole('heading',{name:'Independent observer verification',exact:true}).waitFor();
  await verdicts(h.page);const csv=await downloadRows(h.page);
  assert.equal(csv.rows[0].session_status,'interrupted');
  assert.equal(csv.rows.filter(r=>r.record_type==='phase_timing'&&r.phase==='observation').length,0);
  assert.equal(analyzeExports([csv.rows],{bootstrap:200}).trialLevel.n,0);assertLocal(h.traffic);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});
