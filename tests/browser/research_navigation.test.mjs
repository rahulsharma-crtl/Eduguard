import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {access,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {build} from 'esbuild';
test('Research navigation flag is off by default and never replaces classroom/invitation flows',{timeout:45000},async()=>{
 const variants={},css=await readFile('web/src/style.css','utf8');
 for(const [name,enabled]of [['off',false],['on',true]]){const result=await build({entryPoints:['web/src/main.jsx'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'},define:{'import.meta.env.VITE_API_URL':JSON.stringify('http://localhost:8000'),'import.meta.env.DEV':'false','import.meta.env.VITE_RESEARCH_VALIDATION_ENABLED':enabled?'"true"':'"false"'}});variants['/'+name+'.js']=result.outputFiles[0].text;}
 const server=createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return}if(variants[pathname]){res.setHeader('Content-Type','text/javascript');res.end(variants[pathname]);return}if(pathname.startsWith('/classroom/')){res.end('<p>Classroom placeholder</p>');return}res.setHeader('Content-Type','text/html');res.end(`<link rel="stylesheet" href="/style.css"><div id="root"></div><script src="${pathname==='/off'?'/off.js':'/on.js'}"></script>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;if(!executablePath&&process.platform==='win32'){try{await access('C:/Program Files/Google/Chrome/Application/chrome.exe');executablePath='C:/Program Files/Google/Chrome/Application/chrome.exe'}catch{}}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});const context=await browser.newContext({viewport:{width:320,height:900}});await context.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await context.route('http://localhost:8000/**',route=>route.fulfill({json:route.request().url().endsWith('/config')?{retention_days:7,signaling:{}}:{room:{closed:false},students:[]},headers:{'Access-Control-Allow-Origin':'*'}}));const page=await context.newPage(),base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/off');await page.getByRole('heading',{name:'Start a classroom',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Research Validation',exact:true}).count(),0);
 await page.goto(base+'/on');const link=page.getByRole('link',{name:'Research Validation',exact:true});await link.waitFor();assert.equal(await link.getAttribute('href'),'/classroom/validation/index.html');assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.getByRole('button',{name:'Sign in as teacher',exact:true}).waitFor();
 await page.goto(base+'/on?room=room-test#invite=example');await page.getByRole('heading',{name:'Join your classroom',exact:true}).waitFor();assert.equal(await link.count(),0);
 await page.evaluate(()=>localStorage.setItem('eduguard-teacher-session',JSON.stringify({role:'teacher',name:'Active class',room_id:'room-test',peer_room:'private',token:'disposable'})));await page.goto(base+'/on');await page.getByRole('button',{name:'End classroom',exact:true}).waitFor();assert.equal(await link.count(),0);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
});
