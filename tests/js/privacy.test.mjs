import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPrivateStream} from '../../core/engagement.mjs';
import {sanitizeTelemetry} from '../../web/src/privacy.mjs';
const stream=tracks=>({getTracks:()=>tracks,getVideoTracks:()=>tracks.filter(t=>t.kind==='video')});
test('Raw, cloned, and unknown video tracks are denied; only canvas provenance is allowed',()=>{
 const raw=stream([{id:'camera',kind:'video'}]),allowed=new Set(['canvas']);
 assert.throws(()=>assertPrivateStream(raw,raw,'mesh',allowed));
 assert.throws(()=>assertPrivateStream(stream([{id:'mic',kind:'audio'}]),raw,'mesh',allowed));
 assert.throws(()=>assertPrivateStream(stream([{id:'clone',kind:'video'}]),raw,'mesh',allowed));
 assert.doesNotThrow(()=>assertPrivateStream(stream([{id:'canvas',kind:'video'}]),raw,'mesh',allowed));
 assert.throws(()=>assertPrivateStream(stream([{id:'canvas',kind:'video'}]),raw,'telemetry-only',allowed));
 assert.throws(()=>assertPrivateStream(stream([{id:'mic',kind:'audio'}]),raw,'telemetry-only',allowed));
 assert.doesNotThrow(()=>assertPrivateStream(stream([]),raw,'telemetry-only',allowed));
});
test('Bridge validates numeric values and reconstructs only known scalar fields',()=>{
 const value={sample_id:crypto.randomUUID(),is_unknown:false,status:'Attentive',cei_score:1,attentiveness:1,distraction:0,landmarks:[1],studentName:'unnecessary'};
 const safe=sanitizeTelemetry(value);assert.equal(safe.landmarks,undefined);assert.equal(safe.studentName,undefined);
 assert.throws(()=>sanitizeTelemetry({...value,cei_score:NaN}));assert.throws(()=>sanitizeTelemetry({...value,is_unknown:'false'}));
});

test('Peer telemetry ignores spoofed identity and rejects malformed values', async()=>{
 const {validatePeerTelemetry}=await import('../../core/roster.mjs');
 const data={type:'telemetry',status:'Attentive',cei_score:1,is_unknown:false,peerId:'someone-else',studentName:'unnecessary'};
 const safe=validatePeerTelemetry(data);assert.equal(safe.peerId,undefined);assert.equal(safe.studentName,undefined);
 assert.equal(validatePeerTelemetry({...data,cei_score:Infinity}),null);
});
