/** Public read-only smoke checks. Never supply passwords or dump ICE credentials. */
const frontend=process.env.VALIDATE_FRONTEND_URL||'https://eduguardapp.vercel.app';
const api=process.env.VALIDATE_API_URL||'https://eduguard-zt6a.onrender.com';
const signaling=process.env.VALIDATE_SIGNALING_URL||'https://eduguard-signaling.onrender.com';
async function probe(name,url,options={}){
 const start=performance.now();try{const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});const result={name,status:response.status,elapsedMs:Math.round(performance.now()-start),cors:response.headers.get('access-control-allow-origin')};
 if(name==='frontend'){result.nosniff=response.headers.get('x-content-type-options');result.permissionsPolicy=response.headers.get('permissions-policy')}
 if(name==='config'&&response.ok){const value=await response.json(),s=value.signaling;result.signaling={host:s?.host,port:s?.port,path:s?.path,secure:s?.secure,iceServerCount:s?.iceServers?.length,turnPresent:s?.iceServers?.some(server=>/turns?:/.test(JSON.stringify(server.urls)))}}return result;
 }catch(error){return{name,error:error.name,elapsedMs:Math.round(performance.now()-start)}}
}
const results=await Promise.all([probe('frontend',frontend),probe('health',api+'/health',{headers:{Origin:frontend}}),probe('config',api+'/config',{headers:{Origin:frontend}}),probe('signaling-http',signaling+'/eduguard/peerjs/id')]);
for(const allowed of [true,false])results.push(await probe(allowed?'cors-allowed':'cors-denied',api+'/rooms',{method:'OPTIONS',headers:{Origin:allowed?frontend:'https://untrusted.invalid','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}}));
const wsUrl=new URL(signaling);wsUrl.protocol=wsUrl.protocol==='https:'?'wss:':'ws:';wsUrl.pathname='/eduguard/peerjs';wsUrl.search=new URLSearchParams({key:'peerjs',id:'validation-'+crypto.randomUUID(),token:crypto.randomUUID(),version:'1.5.4'});
results.push(await new Promise(resolve=>{const start=performance.now(),socket=new WebSocket(wsUrl);let finished=false;const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);socket.close();resolve({name:'signaling-websocket',...value,elapsedMs:Math.round(performance.now()-start)})};const timer=setTimeout(()=>finish({error:'timeout'}),15000);socket.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.type==='OPEN')finish({result:'OPEN'})}catch{}};socket.onerror=()=>finish({error:'connection-error'})}));
console.log(JSON.stringify({checkedAt:new Date().toISOString(),scope:'Public read-only endpoints; no authenticated lifecycle or multi-device media validation',results},null,2));
if(results.some(r=>Boolean(r.error)||(r.name==='cors-denied'?r.cors!==null:r.status!==undefined&&r.status!==200)||(r.name==='cors-allowed'&&r.cors!==frontend)))process.exitCode=1;
