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
test('A student receives decoded teacher video frames through real PeerJS media calls', {timeout:120000}, async()=>{
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
                res.end(`<!doctype html><iframe id="room" src="/classroom/${role}/index.html" allow="camera; microphone; autoplay" style="width:100%;height:100vh"></iframe><script>window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='eduguard:ready')document.getElementById('room').contentWindow.postMessage({type:'eduguard:init',args:{roomId:${JSON.stringify(room)},studentName:'Synthetic Student',signaling:${JSON.stringify(options)}}},location.origin)})</script>`);
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
        const teacher=await context.newPage(),student=await context.newPage();
        const logs=[];
        for(const page of [teacher,student]){
            page.on('console',message=>logs.push(message.text()));
            page.on('pageerror',error=>logs.push(error.message));
        }
        await teacher.goto(base+'/harness?role=teacher');
        const teacherFrame=await teacher.waitForSelector('iframe').then(handle=>handle.contentFrame());
        await teacherFrame.waitForFunction(()=>document.getElementById('teacher_video')?.videoWidth>0,{},{timeout:45000});
        await student.goto(base+'/harness?role=student');
        const studentFrame=await student.waitForSelector('iframe').then(handle=>handle.contentFrame());
        try{
            await studentFrame.waitForFunction(()=>document.getElementById('teacher_feed')?.videoWidth>0,{},{timeout:45000});
            const media=await studentFrame.evaluate(()=>{const video=document.getElementById('teacher_feed');return {width:video.videoWidth,height:video.videoHeight,state:video.readyState,tracks:video.srcObject?.getVideoTracks().length}});
            assert.ok(media.width>0&&media.height>0&&media.state>=2&&media.tracks>0,JSON.stringify(media));
            console.log('Decoded student lecture:',media);
        }catch(error){throw Error(error.message+'\nBrowser diagnostics:\n'+logs.join('\n'))}
    }finally{
        if(browser)await browser.close();
        if(server.listening)await new Promise(resolve=>server.close(resolve));
        signal.kill();
    }
});
