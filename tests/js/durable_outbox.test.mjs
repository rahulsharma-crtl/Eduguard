import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {DurableTelemetryOutbox} from '../../web/src/durable_outbox.mjs';
test('Pending events survive database reopen and failed transmission',async()=>{
 const factory=new IDBFactory();let failed=true;const sent=[];
 const send=async rows=>{if(failed)throw Error('offline');sent.push(...rows)};
 const first=new DurableTelemetryOutbox('session',send,factory);
 await first.enqueue({sample_id:'1'});await first.enqueue({sample_id:'1'});
 await assert.rejects(first.flush());await first.close();
 const restored=new DurableTelemetryOutbox('session',send,factory);failed=false;
 await restored.flush();assert.equal(sent.length,1);assert.equal((await restored.rows()).length,0);await restored.close();
});
test('Concurrent tabs cannot overwrite each other or remove newly queued events',async()=>{
 const factory=new IDBFactory();let release;const sent=[];
 const one=new DurableTelemetryOutbox('s',async rows=>{sent.push(...rows);if(rows[0].sample_id==='1')await new Promise(resolve=>release=resolve)},factory);
 const two=new DurableTelemetryOutbox('s',async rows=>sent.push(...rows),factory);
 await Promise.all([one.enqueue({sample_id:'1'}),two.enqueue({sample_id:'2'})]);
 assert.equal((await one.rows()).length,2);
 const flushing=one.flush();while(!release)await new Promise(resolve=>setImmediate(resolve));
 await two.enqueue({sample_id:'3'});release();await flushing;
 assert.deepEqual(sent.map(r=>r.sample_id).sort(),['1','2','3']);await one.close();await two.close();
});
test('Expired local events follow retention; explicit deletion clears the session',async()=>{
 const queue=new DurableTelemetryOutbox('s',async()=>{},new IDBFactory());await queue.enqueue({sample_id:'1'});
 await queue.transaction('readwrite',store=>store.put({key:'s:1',session:'s',queuedAt:0,payload:{sample_id:'1'}}));
 assert.equal((await queue.rows()).length,0);await queue.enqueue({sample_id:'2'});await queue.clear();assert.equal((await queue.rows()).length,0);await queue.close();
});

test('Participant identities are stable per room and expire without name-based matching',async()=>{
 const {participantId}=await import('../../web/src/identity.mjs');const values=new Map();
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 const first=participantId(storage,'room');assert.equal(participantId(storage,'room'),first);
 assert.notEqual(participantId(storage,'other-room'),first);
 storage.setItem('eduguard-participant:room',JSON.stringify({id:first,expiresAt:1}));
 assert.notEqual(participantId(storage,'room'),first);
});
