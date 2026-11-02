import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('components/student_room/frontend/index.html','utf8');
const handler=source.slice(source.indexOf('peer.on("disconnected",'),source.indexOf('peer.on("close",',source.indexOf('peer.on("disconnected",')));
function harness(){let listener,pending,calls=0;const peer={destroyed:false,disconnected:true,on:(_event,fn)=>listener=fn,reconnect:()=>calls++};const context={peer,signalingReconnectTimer:null,readinessState:{},console,setConnectionStatus:()=>{},clearTimeout:()=>{pending=null},setTimeout:(fn,ms)=>{assert.equal(ms,500);pending=fn;return 1}};runInNewContext(handler,context);return{context,disconnect:()=>listener(),tick:()=>pending?.(),calls:()=>calls};}
test('Actual student handler defers signaling registration until after disconnect cleanup',()=>{const h=harness();h.disconnect();assert.equal(h.calls(),0);h.tick();assert.equal(h.calls(),1)});
test('Delayed signaling callback cannot reconnect a replaced or destroyed classroom peer',()=>{for(const mode of ['replaced','destroyed','connected']){const h=harness();h.disconnect();if(mode==='replaced')h.context.peer={};if(mode==='destroyed')h.context.peer.destroyed=true;if(mode==='connected')h.context.peer.disconnected=false;h.tick();assert.equal(h.calls(),0)}});
