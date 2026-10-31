import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root=path.resolve('dist');
async function reservePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
for (const privacyMode of ['mesh','telemetry-only']) test(`Student receives lecture with verified private outbound tracks: ${privacyMode}`, {timeout:120000}, async()=>{
    const signalPort=await reservePort();
    const signal=spawn(process.execPath,['signaling/server.cjs'],{env:{...process.env,PORT:String(signalPort)},stdio:'pipe'});
    const room='media-test-'+crypto.randomUUID();
    const options={host:'127.0.0.1',port:signalPort,path:'/eduguard',secure:false};
    const server=createServer(async(req,res)=>{
        try{
            const url=new URL(req.url,'http://localhost');
            if(url.pathname==='/harness'){
                const role=url.searchParams.get('role')==='teacher'?'teacher':'student';
                res.setHeader('Content-Type','text/html');
                res.end(`<!doctype html><iframe id="room" src="/classroom/${role}/index.html" allow="camera; microphone; autoplay" style="width:100%;height:100vh"></iframe><script>window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='eduguard:ready')document.getElementById('room').contentWindow.postMessage({type:'eduguard:init',args:{roomId:${JSON.stringify(room)},studentName:'Synthetic Student',consent:true,privacyMode:${JSON.stringify(privacyMode)},signaling:${JSON.stringify(options)}}},location.origin)})</script>`);
                return;
            }
            const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
            if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
            res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream');
            res.end(await readFile(file));
        }catch{res.writeHead(404).end();}
    });
    let browser;
    try{
        for(let i=0;i<100;i++){
            try{const response=await fetch(`http://127.0.0.1:${signalPort}/eduguard/peerjs/id`);if(response.ok)break;}catch{}
            await delay(50);
        }
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const base=`http://127.0.0.1:${server.address().port}`;
        let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
        if(!executablePath&&process.platform==='win32'){
            const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
            try{await access(chrome);executablePath=chrome}catch{}
        }
        browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),
            args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
        const context=await browser.newContext({permissions:['camera','microphone']});
        await context.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());
        await context.addInitScript(() => {
            window.__mediaAudit={raw:[],canvas:[],connections:[],captures:[]};
            navigator.mediaDevices.getUserMedia=async constraints=>{
                window.__mediaAudit.captures.push(constraints);
                const stream=new MediaStream();
                if(constraints.video){
                    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
                    const ctx=canvas.getContext('2d');let frame=0;
                    const draw=()=>{ctx.fillStyle=frame++%2?'#2580a0':'#a08025';ctx.fillRect(0,0,640,480)};
                    draw();setInterval(draw,40);
                    canvas.captureStream(25).getVideoTracks().forEach(track=>stream.addTrack(track));
                }
                if(constraints.audio){
                    const audio=new AudioContext();const destination=audio.createMediaStreamDestination();
                    const oscillator=audio.createOscillator();const gain=audio.createGain();gain.gain.value=0;
                    oscillator.connect(gain).connect(destination);oscillator.start();
                    destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
                }
                window.__mediaAudit.raw.push(...stream.getVideoTracks().map(t=>t.id));return stream;
            };
            const canvas=HTMLCanvasElement.prototype.captureStream;
            HTMLCanvasElement.prototype.captureStream=function(...args){const stream=canvas.apply(this,args);window.__mediaAudit.canvas.push(...stream.getVideoTracks().map(t=>t.id));return stream};
            const Native=window.RTCPeerConnection;
            window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);window.__mediaAudit.connections.push(this)}};
        });
        const teacher=await context.newPage(),student=await context.newPage();
        const uploads=[];
        student.on('request',request=>{if(['POST','PUT','PATCH'].includes(request.method()))uploads.push(request.url())});
        const logs=[];
        for(const page of [teacher,student]){
            page.on('console',message=>logs.push(message.text()));
            page.on('pageerror',error=>logs.push(error.message));
        }
        await teacher.goto(base+'/harness?role=teacher',{waitUntil:'domcontentloaded'});
        const teacherFrame=await teacher.waitForSelector('iframe').then(handle=>handle.contentFrame());
        await teacherFrame.waitForFunction(()=>document.getElementById('teacher_video')?.videoWidth>0,{},{timeout:45000});
        await student.goto(base+'/harness?role=student',{waitUntil:'domcontentloaded'});
        const studentFrame=await student.waitForSelector('iframe').then(handle=>handle.contentFrame());
        try{
            await studentFrame.waitForFunction(()=>document.getElementById('teacher_feed')?.videoWidth>0,{},{timeout:45000});
            const media=await studentFrame.evaluate(()=>{const video=document.getElementById('teacher_feed');return {width:video.videoWidth,height:video.videoHeight,state:video.readyState,tracks:video.srcObject?.getVideoTracks().length}});
            assert.ok(media.width>0&&media.height>0&&media.state>=2&&media.tracks>0,JSON.stringify(media));
            await studentFrame.locator('input[type="checkbox"]').check();
            await studentFrame.waitForFunction(()=>window.__mediaAudit.captures.some(c=>c.audio===true&&c.video===false));
            const audit=await studentFrame.evaluate(()=>({raw:window.__mediaAudit.raw,canvas:window.__mediaAudit.canvas,
                sent:window.__mediaAudit.connections.flatMap(pc=>pc.getSenders().map(s=>s.track).filter(Boolean).map(t=>({id:t.id,kind:t.kind})))}));
            assert.ok(audit.sent.every(t=>t.kind!=='video'||(!audit.raw.includes(t.id)&&audit.canvas.includes(t.id))));
            if(privacyMode==='telemetry-only')assert.equal(audit.sent.length,0);
            else assert.ok(audit.sent.some(t=>t.kind==='video'));
            await studentFrame.locator('input[type="checkbox"]').uncheck();
            assert.ok(audit.sent.every(t=>t.kind!=='audio'));
            assert.deepEqual(uploads,[], 'No HTTP media uploads from standalone student capture');
            console.log('Verified media tracks:',{mode:privacyMode,decoded:media.width,sent:audit.sent});
        }catch(error){throw Error(error.message+'\nBrowser diagnostics:\n'+logs.join('\n'))}
    }finally{
        if(browser)await browser.close();
        if(server.listening)await new Promise(resolve=>server.close(resolve));
        signal.kill();
    }
});
