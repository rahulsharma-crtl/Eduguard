import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TelemetryOutbox } from './outbox.mjs';
import './style.css';

const API = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '')).replace(/\/$/,'');
const percent = value => value == null ? '—' : `${(value*100).toFixed(1)}%`;
function restoreSession(){try{return JSON.parse(sessionStorage.getItem('eduguard-session'))}catch{return null}}
async function request(path,{token,body,raw=false,keepalive=false,signal}={}) {
    if (!API) throw Error('Set VITE_API_URL to the backend HTTPS address and redeploy the frontend.');
    const response=await fetch(`${API}${path}`,{method:body===undefined?'GET':'POST',
        headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
        body:body===undefined?undefined:JSON.stringify(body),keepalive,signal});
    if(!response.ok){const data=await response.json().catch(()=>({}));const error=Error(typeof data.detail==='string'?data.detail:`Request failed (${response.status})`);error.status=response.status;throw error;}
    return raw?response:response.json();
}

function Classroom({session,config,onTelemetry,onError}) {
    const iframe=useRef(null);
    const [height,setHeight]=useState(750);
    const args=useMemo(()=>({roomId:session.room_id,studentName:session.name,signaling:config.signaling}),[session.room_id,session.name,config]);
    const initialize=useCallback(()=>iframe.current?.contentWindow?.postMessage({type:'eduguard:init',args},location.origin),[args]);
    useEffect(()=>{
        const receive=event=>{
            if(event.origin!==location.origin||event.source!==iframe.current?.contentWindow)return;
            if(event.data?.type==='eduguard:ready')initialize();
            if(event.data?.type==='eduguard:resize'&&Number.isFinite(event.data.height))setHeight(Math.max(540,Math.min(5000,event.data.height)));
            if(event.data?.type==='eduguard:telemetry'&&session.role==='student'){
                try{onTelemetry(event.data.value)}catch(error){onError(error.message)}
            }
        };
        window.addEventListener('message',receive);
        const frame=iframe.current;
        return()=>{window.removeEventListener('message',receive);frame?.contentWindow?.postMessage({type:'eduguard:stop'},location.origin)};
    },[initialize,onTelemetry,onError,session.role]);
    return <iframe ref={iframe} title={`${session.role} live classroom`} src={`/classroom/${session.role}/index.html`}
        onLoad={initialize} allow="camera; microphone; autoplay; fullscreen" style={{height}} />;
}

function App(){
    const roomFromLink=new URLSearchParams(location.search).get('room');
    const [session,setSession]=useState(()=>{const saved=restoreSession();return saved&&(!roomFromLink||saved.room_id===roomFromLink)?saved:null});
    const [config,setConfig]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    const [roster,setRoster]=useState([]),[closed,setClosed]=useState(false),[samples,setSamples]=useState([]),[pending,setPending]=useState(0);
    const [roomName,setRoomName]=useState(''),[studentName,setStudentName]=useState(''),[password,setPassword]=useState('');
    const [copyLabel,setCopyLabel]=useState('Copy invitation');
    const reportError=useCallback(message=>setError(message),[]);
    const outbox=useMemo(()=>session?.role==='student'?new TelemetryOutbox(sessionStorage,`eduguard-outbox:${session.session_id}`,
        rows=>request(`/rooms/${session.room_id}/telemetry`,{token:session.token,body:{samples:rows},keepalive:true})):null,[session]);
    useEffect(()=>{
        const controller=new AbortController();
        request('/config',{signal:controller.signal}).then(setConfig).catch(e=>{if(e.name!=='AbortError')setError(`Backend unavailable: ${e.message}. A sleeping service can take a minute to start.`)});
        return()=>controller.abort();
    },[]);
    useEffect(()=>{
        if(session)sessionStorage.setItem('eduguard-session',JSON.stringify(session));else sessionStorage.removeItem('eduguard-session');
    },[session]);
    useEffect(()=>{
        if(!session)return;
        let active=true;
        const poll=async()=>{
            try{
                if(session.role==='teacher'){
                    const data=await request(`/rooms/${session.room_id}/roster`,{token:session.token});
                    if(active){setRoster(data.students);setClosed(data.room.closed)}
                }else{
                    const room=await request(`/rooms/${session.room_id}`);
                    if(active)setClosed(room.closed);
                    if(!room.closed&&outbox){await outbox.flush();if(active)setPending(outbox.queue.length)}
                }
            }catch(e){if(active)setError(e.message)}
        };
        poll();const timer=setInterval(poll,5000);
        return()=>{active=false;clearInterval(timer)};
    },[session,outbox]);
    useEffect(()=>{
        if(!outbox)return;
        const flush=()=>outbox.flush().catch(()=>{});
        const hidden=()=>{if(document.visibilityState==='hidden')flush()};
        window.addEventListener('online',flush);window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);
        return()=>{window.removeEventListener('online',flush);window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden)};
    },[outbox]);
    const telemetry=useCallback(data=>{
        if(!outbox||closed)return;
        const sample={sample_id:data.sample_id,timestamp:Date.now()/1000,cei_score:data.cei_score,
            attentiveness:data.attentiveness,distraction:data.distraction,status:data.status,is_unknown:Boolean(data.is_unknown)};
        outbox.enqueue(sample);setPending(outbox.queue.length);
        setSamples(previous=>[...previous.slice(-99),sample]);
        outbox.flush().then(()=>setPending(outbox.queue.length)).catch(e=>setError(`Telemetry retained for retry: ${e.message}`));
    },[outbox,closed]);
    async function enter(event){
        event.preventDefault();setBusy(true);setError('');
        try{
            const next=roomFromLink?await request(`/rooms/${encodeURIComponent(roomFromLink)}/join`,{body:{name:studentName,client_id:crypto.randomUUID()}})
                :await request('/rooms',{body:{name:roomName,password}});
            setSession(next);setPassword('');setClosed(false);setSamples([]);setRoster([]);
            if(!config)setConfig(await request('/config'));
        }catch(e){setError(e.message)}finally{setBusy(false)}
    }
    async function exit(){
        setBusy(true);setError('');
        try{
            if(session.role==='teacher'&&!closed){await request(`/rooms/${session.room_id}/close`,{token:session.token,body:{}});setClosed(true);return;}
            if(session.role==='student'){
                if(!closed)await outbox.flush();
                await request(`/rooms/${session.room_id}/leave`,{token:session.token,body:{},keepalive:true});
            }
            setSession(null);setClosed(false);history.replaceState(null,'','/');location.assign('/');
        }catch(e){setError(`Could not finish leaving: ${e.message}. Your queued samples are retained.`)}finally{setBusy(false)}
    }
    async function download(){
        try{const response=await request(`/rooms/${session.room_id}/report.csv`,{token:session.token,raw:true});
            const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download='eduguard-telemetry.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(e){setError(e.message)}
    }
    const online=roster.filter(row=>row.online),known=online.filter(row=>row.latest?.cei!=null);
    const average=known.length?known.reduce((sum,row)=>sum+row.latest.cei,0)/known.length:null;
    const invitation=session?`${location.origin}/?room=${encodeURIComponent(session.room_id)}`:'';
    return <div className="app-shell">
        <header><a className="brand" href="/" aria-label="EduGuard home"><span className="brand-mark">E</span>EduGuard<span className="brand-cloud">CLASSROOM</span></a><span className="privacy-tag"><i/>Browser-based privacy</span></header>
        {error&&<div className="notice error" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
        {!session?<main className="welcome"><section className="intro"><p className="eyebrow">PRESENCE WITHOUT EXPOSURE</p><h1>A classroom built<br/>around <em>connection.</em></h1><p className="lede">Teach live. Understand participation. Keep raw student camera footage on their own devices.</p><div className="feature-row"><span>Local face analysis</span><span>Live lecture</span><span>Session reports</span></div><div className="privacy-note"><span className="shield">◇</span><div><strong>Your camera stays yours.</strong><p>Students share a synthetic facial mesh and derived engagement metrics. Microphone audio is streamed to the teacher while unmuted, and optional audio-energy analysis runs locally only if you opt in.</p></div></div></section>
            <section className="entry-card"><span className="step-label">{roomFromLink?'STUDENT ACCESS':'TEACHER ACCESS'}</span><h2>{roomFromLink?'Join your classroom':'Start a classroom'}</h2><p>{roomFromLink?'Enter your name to join the live session.':'Create a session and invite your students.'}</p>
                <form onSubmit={enter}>{roomFromLink?<label>Your full name<input required maxLength={100} autoComplete="name" value={studentName} onChange={e=>setStudentName(e.target.value)}/></label>:<><label>Classroom name<input required maxLength={100} placeholder="e.g. Mathematics · Grade 10" value={roomName} onChange={e=>setRoomName(e.target.value)}/></label><label>Administrator password<input required type="password" maxLength={256} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label></>}
                <button className="primary" disabled={busy||!config}>{busy?'Connecting…':roomFromLink?'Join classroom →':'Launch classroom →'}</button></form><p className="small">{!config?'Connecting to the classroom service…':'Camera and microphone permissions are requested after joining.'}</p>
            </section></main>:<main className="classroom"><div className="classroom-heading"><div><p className="eyebrow">{closed?'SESSION CONCLUDED':session.role==='teacher'?'TEACHER CONSOLE':'STUDENT CLASSROOM'}</p><h1>{session.name}</h1></div><button className="secondary" onClick={exit} disabled={busy}>{busy?'Saving…':session.role==='teacher'?(closed?'New classroom':'End classroom'):'Leave classroom'}</button></div>
            {session.role==='teacher'&&<div className="invitation"><div><span className="step-label">INVITE YOUR STUDENTS</span><code>{invitation}</code></div><button className="secondary" onClick={()=>navigator.clipboard.writeText(invitation).then(()=>setCopyLabel('Copied!')).catch(()=>setError('Copy the invitation text manually.'))}>{copyLabel}</button></div>}
            {!closed&&config&&<Classroom session={session} config={config} onTelemetry={telemetry} onError={reportError}/>}
            {closed&&<div className="notice">The teacher has ended this classroom. Camera and microphone capture have stopped.</div>}
            {session.role==='teacher'?<><section className="metric-grid"><div><span>Students online</span><strong>{online.length}</strong></div><div><span>Total joined</span><strong>{roster.length}</strong></div><div><span>Live engagement average</span><strong>{percent(average)}</strong></div></section><section className="report-panel"><div className="panel-heading"><div><p className="eyebrow">CLASSROOM ANALYTICS</p><h2>{closed?'Session summary':'Participation overview'}</h2></div><button className="secondary" onClick={download}>Download CSV ↓</button></div><div className="table-wrap"><table><thead><tr><th>Student</th><th>Presence</th><th>Latest observation</th><th>Session average</th><th>Summary</th><th>Duration</th><th>Samples</th></tr></thead><tbody>{roster.map(row=><tr key={row.id}><td>{row.name}</td><td><span className={row.online?'online':'offline'}>{row.online?'Online':'Offline'}</span></td><td>{row.latest?.status||'Awaiting observation'}</td><td>{percent(row.avg_cei)}</td><td>{row.primary_state}</td><td>{Math.floor(row.duration_seconds/60)}m {Math.floor(row.duration_seconds%60)}s</td><td>{row.total_samples}</td></tr>)}</tbody></table>{!roster.length&&<p className="empty">Your students will appear here when they join.</p>}</div></section></>:<section className="report-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR SESSION</p><h2>Engagement timeline</h2></div><span className="small">{pending?`${pending} samples waiting to sync`:'Delivered samples saved'}</span></div>{samples.length?<><div className="timeline" aria-label="Recent engagement scores">{samples.map(row=><div key={row.sample_id} title={`${row.status}: ${percent(row.cei_score)}`} style={{height:row.is_unknown?'4px':`${Math.max(3,row.cei_score*100)}%`}}/>)}</div><p className="small">Latest: {samples.at(-1)?.status}. Behavioral observations are estimates, not proof of attention.</p></>:<p className="empty">Waiting for your first camera observation.</p>}</section>}
        </main>}
        <footer>EduGuard · Local inference. Shared learning.<span>Raw student video stays on device.</span></footer>
    </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
