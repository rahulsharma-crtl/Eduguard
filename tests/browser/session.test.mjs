import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdtemp,access,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
async function eventually(read,check){for(let i=0;i<100;i++){const value=await read();if(check(value))return value;await delay(100)}throw Error('Timed out waiting for lifecycle state')}
test('Browser-close recovery retains events and one attendance identity; End Class finalizes it',{timeout:90000},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'eduguard-session-'));const database=path.join(directory,'test.db');
 const apiPort=await port();let browser;let processLog='';
 const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve('dist','.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(path.resolve('dist')+path.sep)){res.writeHead(403).end();return}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file))}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const frontend=`http://127.0.0.1:${server.address().port}`,api=`http://127.0.0.1:${apiPort}`;
 const python=process.env.TEST_PYTHON||(process.platform==='win32'?'.venv/Scripts/python.exe':'python');
 const child=spawn(python,['-m','uvicorn','backend.app:app','--host','127.0.0.1','--port',String(apiPort)],{env:{...process.env,DATABASE_URL:'sqlite:///'+database,TEACHER_ADMIN_PASSWORD:'browser-test-only-password',AUTH_SIGNING_KEY:'test-only-signing-key-'.repeat(3),ALLOWED_ORIGINS:frontend},stdio:'pipe'});
 child.stderr.on('data',data=>processLog+=data.toString());
 child.stdout.on('data',()=>{});
 try{
  await eventually(async()=>{try{return (await fetch(api+'/health')).status}catch{return 0}},status=>status===200);
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if(!executablePath&&process.platform==='win32'){try{await access('C:/Program Files/Google/Chrome/Application/chrome.exe');executablePath='C:/Program Files/Google/Chrome/Application/chrome.exe'}catch{}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});const context=await browser.newContext();
  await context.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());
        await context.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic permission denial','NotAllowedError')}});
  let offline=false;
  await context.route('http://localhost:8000/**',async route=>{
   if(offline){await route.abort('connectionfailed');return}
   const response=await route.fetch({url:route.request().url().replace('http://localhost:8000',api)});await route.fulfill({response});
  });
  const teacher=await context.newPage();await teacher.goto(frontend,{waitUntil:'domcontentloaded'});
  await teacher.getByRole('button',{name:'Create account',exact:true}).click();
  await teacher.getByLabel('Teacher username',{exact:true}).fill('browser_teacher');await teacher.getByLabel('New teacher password',{exact:true}).fill('browser teacher unique password');await teacher.getByLabel('Confirm password',{exact:true}).fill('browser teacher unique password');
  assert.equal(await teacher.getByLabel('New teacher password',{exact:true}).getAttribute('autocomplete'),'new-password');
  await teacher.getByRole('button',{name:'Create teacher account',exact:true}).click();await teacher.locator('.recovery-code').waitFor();const recovery=await teacher.locator('.recovery-code').textContent();
  await teacher.getByRole('button',{name:"I've saved my recovery code",exact:true}).click();await teacher.getByRole('button',{name:'Sign out',exact:true}).click();
  await teacher.getByLabel('Teacher password',{exact:true}).fill('wrong-password');await teacher.getByRole('button',{name:'Sign in as teacher',exact:true}).click();await teacher.getByRole('alert').filter({hasText:'Incorrect username or password'}).waitFor();
  await teacher.getByRole('button',{name:'Reset password',exact:true}).click();await teacher.getByLabel('Recovery code',{exact:true}).fill(recovery);await teacher.getByLabel('New teacher password',{exact:true}).fill('new browser teacher passphrase');await teacher.getByLabel('Confirm password',{exact:true}).fill('new browser teacher passphrase');await teacher.getByRole('button',{name:'Reset teacher password',exact:true}).click();await teacher.locator('.recovery-code').waitFor();
  await teacher.getByRole('button',{name:"I've saved my recovery code",exact:true}).click();await teacher.getByRole('button',{name:'Sign out',exact:true}).click();await teacher.getByRole('button',{name:'Sign in',exact:true}).click();
  await teacher.getByLabel('Teacher password',{exact:true}).fill('new browser teacher passphrase');await teacher.getByRole('button',{name:'Sign in as teacher',exact:true}).click();
  await teacher.getByLabel('Classroom name',{exact:true}).fill('Lifecycle test');await teacher.getByRole('button',{name:/Launch classroom/}).click();
  assert.equal(await teacher.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('new browser teacher passphrase')),false);
  await teacher.locator('.invitation code').waitFor();const invitation=await teacher.locator('.invitation code').textContent();
  const credentials=await teacher.evaluate(()=>JSON.parse(localStorage.getItem('eduguard-teacher-session')));
  const roster=async()=>{const response=await fetch(`${api}/rooms/${credentials.room_id}/roster`,{headers:{Authorization:`Bearer ${credentials.token}`}});return response.json()};
  let student=await context.newPage();await student.goto(invitation,{waitUntil:'domcontentloaded'});
  await student.getByLabel('Display alias (avoid your full name)',{exact:true}).fill('Alias');await student.getByRole('checkbox').check();
  await student.getByRole('button',{name:/Join classroom/}).click();await student.locator('iframe').waitFor();
  const first=await eventually(roster,data=>data.students?.length===1);const id=first.students[0].id;
  async function inject(page){const frame=await page.locator('iframe').elementHandle().then(h=>h.contentFrame());await frame.waitForFunction(()=>location.protocol==='http:');await frame.evaluate(data=>parent.postMessage({type:'eduguard:telemetry',value:data},location.origin),{sample_id:crypto.randomUUID(),cei_score:0,attentiveness:0,distraction:1,status:'Observed',is_unknown:false})}
  await inject(student);await eventually(roster,data=>data.students[0].total_samples===1);
  offline=true;await inject(student);await student.getByText(/1 samples waiting to sync/).waitFor();await student.close();
  offline=false;student=await context.newPage();await student.goto(invitation,{waitUntil:'domcontentloaded'});
  const recovered=await eventually(roster,data=>data.students[0].total_samples===2);
  assert.equal(recovered.students.length,1);assert.equal(recovered.students[0].id,id);
  await teacher.getByRole('button',{name:'End classroom',exact:true}).click();
  const completed=await eventually(roster,data=>data.room.closed&&data.students[0].status==='completed');
  assert.equal(completed.students[0].online,false);
  await student.getByText('The teacher has ended this classroom. Camera and microphone capture have stopped.').waitFor({timeout:15000});
  const downloaded=teacher.waitForEvent('download');await teacher.getByRole('button',{name:/Download CSV/}).click();const report=await downloaded;assert.equal(report.suggestedFilename(),'eduguard-telemetry.csv');
  await student.getByRole('button',{name:'Withdraw and delete my session data'}).click();await eventually(roster,data=>data.students.length===0);
  await teacher.getByRole('button',{name:'End and delete this classroom’s data'}).click();
  await eventually(async()=>{const response=await fetch(`${api}/rooms/${credentials.room_id}`,{headers:{Authorization:`Bearer ${credentials.token}`}});return response.status},status=>status===401);
  console.log('Verified invalid/valid login, durable recovery, stable attendance, global closure, report download and student/room deletion.');
 }catch(error){throw Error(error.message+'\nAPI process diagnostics:\n'+processLog)}
 finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  child.kill();if(child.exitCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),delay(5000)]);
  for(const file of [database,database+'-wal',database+'-shm'])await unlink(file).catch(()=>{});await rmdir(directory).catch(()=>{});
 }
});
