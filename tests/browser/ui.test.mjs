import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
test('React classroom handles mobile consent, attendance filters, unknown data and report failures',{timeout:45000},async()=>{
 const root=path.resolve('dist');const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file))}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let browser;
 try{
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;if(!executablePath&&process.platform==='win32'){try{await access('C:/Program Files/Google/Chrome/Application/chrome.exe');executablePath='C:/Program Files/Google/Chrome/Application/chrome.exe'}catch{}}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await context.route('**/classroom/**',r=>r.fulfill({contentType:'text/html',body:'<p>Media panel stub</p>'}));
 await context.route('http://localhost:8000/**',async route=>{const url=new URL(route.request().url());let data={};let status=200;
 if(url.pathname==='/config')data={retention_days:7,signaling:{}};
 else if(url.pathname==='/rooms')data={role:'teacher',room_id:'room-test',name:'UI classroom',token:'test',peer_room:'private',invitation:'invite'};
 else if(url.pathname.endsWith('/roster'))data={room:{closed:false},students:[{id:'1',name:'Unknown alias',online:true,latest:{is_unknown:true,cei:1,status:'Attentive'},avg_cei:null,duration_seconds:20,unobserved_seconds:20,disconnected_seconds:0,total_samples:1,primary_state:'No Scored Observations'},{id:'2',name:'Measured alias',online:false,latest:{cei:0,status:'Drowsy (Eyes Closed)'},avg_cei:0,duration_seconds:40,unobserved_seconds:0,disconnected_seconds:10,total_samples:2,primary_state:'High Drowsiness'}]};
 else if(url.pathname.endsWith('/report.csv')){status=503;data={detail:'Report temporarily unavailable'}}
 await route.fulfill({status,json:data});});
 const page=await context.newPage();await page.goto(base+'/?room=test',{waitUntil:'domcontentloaded'});await page.getByRole('alert').filter({hasText:'invitation is incomplete'}).waitFor();assert.equal(await page.getByRole('button',{name:/Join classroom/}).isDisabled(),true);
 await page.goto(base+'/?room=test#invite=valid',{waitUntil:'domcontentloaded'});await page.getByLabel('Display alias (avoid your full name)',{exact:true}).fill('Alias');assert.equal(await page.getByLabel('Student privacy mode').inputValue(),'telemetry-only');assert.equal(await page.getByRole('button',{name:/Join classroom/}).isDisabled(),true);await page.getByRole('checkbox').check();await page.getByRole('button',{name:/Join classroom/}).waitFor();assert.equal(await page.getByRole('button',{name:/Join classroom/}).isEnabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByLabel('Classroom name',{exact:true}).fill('UI classroom');await page.getByLabel('Administrator password').fill('disposable');await page.getByRole('button',{name:/Launch classroom/}).click();await page.getByText('Unknown alias',{exact:true}).waitFor();await page.getByRole('cell',{name:'Eyes closed',exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'Class attendance'}).getByText('Observation unavailable',{exact:true}).count(),2);
 await page.getByLabel('Find alias').fill('Measured');assert.equal(await page.getByRole('cell',{name:'Unknown alias',exact:true}).count(),0);await page.getByLabel('Connection filter',{exact:true}).selectOption('online');await page.getByText('No participants match these filters.').waitFor();await page.getByRole('button',{name:/Download CSV/}).click();await page.getByRole('alert').filter({hasText:'Report temporarily unavailable'}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'dist/ui-mobile-check.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
});
