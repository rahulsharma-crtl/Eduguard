import { participantId, purgeExpiredCredentials } from './identity.mjs';
import { sanitizeTelemetry } from './privacy.mjs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DurableTelemetryOutbox } from './durable_outbox.mjs';
import './style.css';

const API = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '')).replace(/\/$/,'');
const percent = value => value == null ? '—' : `${(value*100).toFixed(1)}%`;
function restoreSession(room){try{
 purgeExpiredCredentials(localStorage);
 const key=room?`eduguard-student-session:${room}`:'eduguard-teacher-session';
 const saved=JSON.parse(localStorage.getItem(key)||sessionStorage.getItem('eduguard-session'));
 if(saved?.local_expires_at&&saved.local_expires_at<Date.now()){localStorage.removeItem(key);return null}
 return saved&&saved.role===(room?'student':'teacher')?saved:null;
}catch{return null}}

async function request(path,{token,body,raw=false,keepalive=false,signal}={}) {
    if (!API) throw Error('Set VITE_API_URL to the backend HTTPS address and redeploy the frontend.');
    const response=await fetch(`${API}${path}`,{method:body===undefined?'GET':'POST',
        headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
        body:body===undefined?undefined:JSON.stringify(body),keepalive,signal:signal||AbortSignal.timeout(20000)});
    if(!response.ok){const data=await response.json().catch(()=>({}));const error=Error(typeof data.detail==='string'?data.detail:`Request failed (${response.status})`);error.status=response.status;throw error;}
    return raw?response:response.json();
}

function Classroom({session,config,onTelemetry,onError}) {
    const iframe=useRef(null);
    const [height,setHeight]=useState(750);
    const args=useMemo(()=>({roomId:session.peer_room,studentName:session.name,signaling:config.signaling,consent:true,privacyMode:session.privacy_mode}),[session.peer_room,session.name,session.privacy_mode,config]);
    const initialize=useCallback(()=>iframe.current?.contentWindow?.postMessage({type:'eduguard:init',args},location.origin),[args]);
    useEffect(()=>{
        const receive=event=>{
            if(event.origin!==location.origin||event.source!==iframe.current?.contentWindow)return;
            if(event.data?.type==='eduguard:ready')initialize();
            if(event.data?.type==='eduguard:resize'&&Number.isFinite(event.data.height))setHeight(Math.max(540,Math.min(5000,event.data.height)));
            if(event.data?.type==='eduguard:telemetry'&&session.role==='student'){
                try{Promise.resolve(onTelemetry(sanitizeTelemetry(event.data.value))).catch(error=>onError(error.message))}catch(error){onError(error.message)}
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
    const invitationToken=new URLSearchParams(location.hash.slice(1)).get('invite');
    const [consent,setConsent]=useState(false),[privacyMode,setPrivacyMode]=useState('telemetry-only');
    const [session,setSession]=useState(()=>{const saved=restoreSession(roomFromLink);return saved&&saved.peer_room&&(!roomFromLink||saved.room_id===roomFromLink)?saved:null});
    const [config,setConfig]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    const [roster,setRoster]=useState([]),[closed,setClosed]=useState(false),[samples,setSamples]=useState([]),[pending,setPending]=useState(0);
    const [roomName,setRoomName]=useState(''),[studentName,setStudentName]=useState(''),[password,setPassword]=useState('');
    const [verified,setVerified]=useState(false);
    const [copyLabel,setCopyLabel]=useState('Copy invitation');
    const reportError=useCallback(message=>setError(message),[]);
    const clockOffsetRef=useRef(0);
    const tokenRef=useRef(null);tokenRef.current=session?.token;
    const resumeRef=useRef(null);resumeRef.current=session?.resume_ticket;
    const outbox=useMemo(()=>session?.role==='student'?new DurableTelemetryOutbox(session.session_id,
        async rows=>{
            try{return await request(`/rooms/${session.room_id}/telemetry`,{token:tokenRef.current,body:{samples:rows},keepalive:true})}
            catch(error){
                if(![401,403,409].includes(error.status)||!resumeRef.current)throw error;
                const result=await request(`/rooms/${session.room_id}/recover-telemetry`,{body:{samples:rows,resume_ticket:resumeRef.current},keepalive:true});
                if(result.rejected_event_ids?.length)setError(`${result.rejected_event_ids.length} observations outside the session cutoff were not retained.`);
                return result;
            }
        },
        globalThis.indexedDB,(config?.retention_days||7)*86400000):null,[session?.session_id,config?.retention_days]);
    useEffect(()=>{
        if(!outbox||!session)return;
        const key=`eduguard-outbox:${session.session_id}`;
        Promise.resolve().then(()=>outbox.migrateLegacy(localStorage,key)).then(()=>outbox.migrateLegacy(sessionStorage,key))
          .catch(e=>setError(`Queue recovery failed: ${e.message}`));
    },[outbox]);
    useEffect(()=>{
        const controller=new AbortController();
        request('/config',{signal:controller.signal}).then(setConfig).catch(e=>{if(e.name!=='AbortError')setError(`Backend unavailable: ${e.message}. A sleeping service can take a minute to start.`)});
        return()=>controller.abort();
    },[]);
    useEffect(()=>{
        if(!session || session.role!=='student')return;
        let active=true;
        (async()=>{
            let ticket=session.resume_ticket;
            if(!ticket){ticket=(await request(`/rooms/${session.room_id}/resume-ticket`,{token:session.token,body:{}})).resume_ticket;resumeRef.current=ticket}
            const resumed=await request(`/rooms/${session.room_id}/resume`,{body:{resume_ticket:ticket}});return {...resumed,resume_ticket:ticket};
        })()
            .then(data=>{if(active){if(Number.isFinite(data.server_utc))clockOffsetRef.current=data.server_utc-Date.now()/1000;setSession(previous=>({...previous,token:data.token,resume_ticket:data.resume_ticket}));setVerified(true);setClosed(false)}})
            .catch(e=>{if(active){setClosed(true);setError(`Session could not resume: ${e.message}`);outbox?.flush().catch(()=>{});if(e.status===401){localStorage.removeItem(`eduguard-student-session:${session.room_id}`);sessionStorage.removeItem('eduguard-session');setSession(null);setVerified(false)}}});
        return()=>{active=false};
    },[session?.session_id]);
    useEffect(()=>{
        if(session)localStorage.setItem(session.role==='student'?`eduguard-student-session:${session.room_id}`:'eduguard-teacher-session',JSON.stringify({...session,local_expires_at:session.local_expires_at||Date.now()+(config?.retention_days||7)*86400000}));
    },[session]);
    useEffect(()=>{
        if(!session)return;
        let active=true;
        let lastVerified=Date.now();
        const poll=async()=>{
            try{
                if(session.role==='teacher'){
                    const data=await request(`/rooms/${session.room_id}/roster`,{token:session.token});
                    if(active){setRoster(data.students);setClosed(data.room.closed)}
                }else{
                    const room=await request(`/rooms/${session.room_id}`,{token:session.token});
                    lastVerified=Date.now();
                    if(active)setClosed(room.closed);
                    if(outbox&&verified){if(!room.closed){const beat=await request(`/rooms/${session.room_id}/heartbeat`,{token:session.token,body:{}});if(Number.isFinite(beat.server_utc))clockOffsetRef.current=beat.server_utc-Date.now()/1000;}await outbox.flush();if(active)setPending(outbox.queue.length)}
                }
            }catch(e){if(active){setError(e.message);if(e.status===401||e.status===404||Date.now()-lastVerified>30000)setClosed(true)}}
        };
        poll();const timer=setInterval(poll,closed?30000:5000);
        return()=>{active=false;clearInterval(timer)};
    },[session,outbox,verified,closed]);
    useEffect(()=>{
        if(!outbox)return;
        const flush=()=>outbox.flush().catch(()=>{});
        const hidden=()=>{if(document.visibilityState==='hidden')flush()};
        window.addEventListener('online',flush);window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);
        return()=>{window.removeEventListener('online',flush);window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden)};
    },[outbox]);
    const telemetry=useCallback(async data=>{
        if(!outbox||closed)return;
        const sample={sample_id:data.sample_id,timestamp:Date.now()/1000+clockOffsetRef.current,cei_score:data.cei_score,
            attentiveness:data.attentiveness,distraction:data.distraction,status:data.status,is_unknown:Boolean(data.is_unknown)};
        await outbox.enqueue(sample);setPending(outbox.queue.length);
        setSamples(previous=>[...previous.slice(-99),sample]);
        outbox.flush().then(()=>setPending(outbox.queue.length)).catch(e=>setError(`Telemetry retained for retry: ${e.message}`));
    },[outbox,closed]);
    async function enter(event){
        event.preventDefault();setBusy(true);setError('');
        try{
            const next=roomFromLink?await request(`/rooms/${encodeURIComponent(roomFromLink)}/join`,{body:{name:studentName,client_id:participantId(localStorage,roomFromLink,(config?.retention_days||7)*86400000),invitation:invitationToken,consent,privacy_mode:privacyMode}})
                :await request('/rooms',{body:{name:roomName,password}});
            if(Number.isFinite(next.server_utc))clockOffsetRef.current=next.server_utc-Date.now()/1000;
            next.local_expires_at=Date.now()+(config?.retention_days||7)*86400000;setVerified(true);setSession(next);setPassword('');setClosed(false);setSamples([]);setRoster([]);
            if(!config)setConfig(await request('/config'));
        }catch(e){setError(e.message)}finally{setBusy(false)}
    }
    async function exit(){
        setBusy(true);setError('');
        try{
            if(session.role==='teacher'&&!closed){await request(`/rooms/${session.room_id}/close`,{token:session.token,body:{}});setClosed(true);return;}
            if(session.role==='student'){
                if(!closed)await outbox.flush();
                if(!closed)await request(`/rooms/${session.room_id}/leave`,{token:session.token,body:{},keepalive:true});
            }
            localStorage.removeItem(session.role==='student'?`eduguard-student-session:${session.room_id}`:'eduguard-teacher-session');
            sessionStorage.removeItem('eduguard-session');
            setSession(null);setClosed(false);history.replaceState(null,'','/');location.assign('/');
        }catch(e){setError(`Could not finish leaving: ${e.message}. Your queued samples are retained.`)}finally{setBusy(false)}
    }
    async function eraseData(){
        setBusy(true);
        try{
            await request(`/rooms/${session.room_id}/delete-data`,{token:session.token,body:{}});
            localStorage.removeItem(`eduguard-outbox:${session.session_id}`);
            localStorage.removeItem(session.role==='student'?`eduguard-student-session:${session.room_id}`:'eduguard-teacher-session');
            sessionStorage.removeItem('eduguard-session');
            if(outbox)await outbox.clear();
            if(session.role==='student')localStorage.removeItem(`eduguard-participant:${session.room_id}`);
            location.assign('/');
        }catch(e){setError(e.message);setBusy(false)}
    }
    async function download(){
        try{const response=await request(`/rooms/${session.room_id}/report.csv`,{token:session.token,raw:true});
            const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download='eduguard-telemetry.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(e){setError(e.message)}
    }
    const online=roster.filter(row=>row.online),known=online.filter(row=>row.latest?.cei!=null);
    const average=known.length?known.reduce((sum,row)=>sum+row.latest.cei,0)/known.length:null;
    const invitation=session?`${location.origin}/?room=${encodeURIComponent(session.room_id)}#invite=${encodeURIComponent(session.invitation)}`:'';
    return <div className="app-shell">
        <header><a className="brand" href="/" aria-label="EduGuard home"><span className="brand-mark">E</span>EduGuard<span className="brand-cloud">CLASSROOM</span></a><span className="privacy-tag"><i/>Browser-based privacy</span></header>
        {error&&<div className="notice error" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
        {!session?<main className="welcome"><section className="intro"><p className="eyebrow">PRESENCE WITHOUT EXPOSURE</p><h1>A classroom built<br/>around <em>connection.</em></h1><p className="lede">Teach live. Understand participation. Keep raw student camera footage on their own devices.</p><div className="feature-row"><span>Local face analysis</span><span>Live lecture</span><span>Session reports</span></div><div className="privacy-note"><span className="shield">◇</span><div><strong>Your camera stays yours.</strong><p>Students choose telemetry-only or synthetic mesh sharing. Derived data can still identify people or reveal sensitive behavior. Optional microphone analysis stays local; no student microphone audio is transmitted.</p></div></div></section>
            <section className="entry-card"><span className="step-label">{roomFromLink?'STUDENT ACCESS':'TEACHER ACCESS'}</span><h2>{roomFromLink?'Join your classroom':'Start a classroom'}</h2><p>{roomFromLink?'Enter your name to join the live session.':'Create a session and invite your students.'}</p>
                <form onSubmit={enter}>{roomFromLink?<label>Display alias (avoid your full name)<input required maxLength={100} autoComplete="off" value={studentName} onChange={e=>setStudentName(e.target.value)}/></label>:<><label>Classroom name<input required maxLength={100} placeholder="e.g. Mathematics · Grade 10" value={roomName} onChange={e=>setRoomName(e.target.value)}/></label><label>Administrator password<input required type="password" maxLength={256} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label></>}
                {roomFromLink&&<><label>Student privacy mode<select value={privacyMode} onChange={e=>setPrivacyMode(e.target.value)}><option value="telemetry-only">Telemetry only — no student media transmitted</option><option value="mesh">Synthetic facial mesh video shared</option></select></label><p className="small">Landmarks, mesh and identifiable telemetry can reveal sensitive behavior. This is not anonymous. Data is retained for up to {config?.retention_days || 7} days; you can delete your session. No raw webcam video is shared. Optional mic analysis stays local.</p><label><input type="checkbox" required checked={consent} onChange={e=>setConsent(e.target.checked)}/> I consent to local camera analysis and sharing derived observations in my selected mode.</label></>}
                <button className="primary" disabled={busy||!config||(Boolean(roomFromLink)&&!consent)}>{busy?'Connecting…':roomFromLink?'Join classroom →':'Launch classroom →'}</button></form><p className="small">{!config?'Connecting to the classroom service…':'Camera and microphone permissions are requested after joining.'}</p>
            </section></main>:<main className="classroom"><div className="classroom-heading"><div><p className="eyebrow">{closed?'SESSION CONCLUDED':session.role==='teacher'?'TEACHER CONSOLE':'STUDENT CLASSROOM'}</p><h1>{session.name}</h1></div><button className="secondary" onClick={exit} disabled={busy}>{busy?'Saving…':session.role==='teacher'?(closed?'New classroom':'End classroom'):'Leave classroom'}</button></div>
            {session.role==='teacher'&&<div className="invitation"><div><span className="step-label">INVITE YOUR STUDENTS</span><code>{invitation}</code></div><button className="secondary" onClick={()=>navigator.clipboard.writeText(invitation).then(()=>setCopyLabel('Copied!')).catch(()=>setError('Copy the invitation text manually.'))}>{copyLabel}</button></div>}
            {!closed&&config&&(session.role==='teacher'||verified)&&<Classroom session={session} config={config} onTelemetry={telemetry} onError={reportError}/>}
            {closed&&<div className="notice">The teacher has ended this classroom. Camera and microphone capture have stopped.</div>}
            {session.role==='teacher'?<><section className="metric-grid"><div><span>Students online</span><strong>{online.length}</strong></div><div><span>Total joined</span><strong>{roster.length}</strong></div><div><span>Live engagement average</span><strong>{percent(average)}</strong></div></section><section className="report-panel"><div className="panel-heading"><div><p className="eyebrow">CLASSROOM ANALYTICS</p><h2>{closed?'Session summary':'Participation overview'}</h2></div><button className="secondary" onClick={download}>Download CSV ↓</button></div><div className="table-wrap"><table><thead><tr><th>Student</th><th>Presence</th><th>Latest observation</th><th>Session average</th><th>Summary</th><th>Validated presence</th><th>Unobserved while connected</th><th>Disconnected gaps</th><th>Samples</th></tr></thead><tbody>{roster.map(row=><tr key={row.id}><td>{row.name}</td><td><span className={row.online?'online':'offline'}>{row.online?'Online':'Offline'}</span></td><td>{row.latest?.status||'Awaiting observation'}</td><td>{percent(row.avg_cei)}</td><td>{row.primary_state}</td><td>{Math.floor(row.duration_seconds/60)}m {Math.floor(row.duration_seconds%60)}s</td><td>{Math.round(row.unobserved_seconds)}s</td><td>{Math.round(row.disconnected_seconds)}s</td><td>{row.total_samples}</td></tr>)}</tbody></table>{!roster.length&&<p className="empty">Your students will appear here when they join.</p>}</div></section></>:<section className="report-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR SESSION</p><h2>Engagement timeline</h2></div><span className="small">{pending?`${pending} samples waiting to sync`:'Delivered samples saved'}</span></div>{samples.length?<><div className="timeline" aria-label="Recent engagement scores">{samples.map(row=><div key={row.sample_id} title={`${row.status}: ${percent(row.cei_score)}`} style={{height:row.is_unknown?'4px':`${Math.max(3,row.cei_score*100)}%`}}/>)}</div><p className="small">Latest: {samples.at(-1)?.status}. Behavioral observations are estimates, not proof of attention.</p></>:<p className="empty">Waiting for your first camera observation.</p>}</section>}
        </main>}
        {session&&<button className="secondary" disabled={busy} onClick={eraseData}>{session.role==='teacher'?'End and delete this classroom’s data':'Withdraw and delete my session data'}</button>}
        <footer>EduGuard · Local inference. Shared learning.<span>Raw student video stays on device.</span></footer>
    </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
