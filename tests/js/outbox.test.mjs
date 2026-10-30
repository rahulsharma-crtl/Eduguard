import test from 'node:test';
import assert from 'node:assert/strict';
import {TelemetryOutbox} from '../../web/src/outbox.mjs';
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}}
test('Outbox survives upload failure and reload without duplicate samples',async()=>{
    const saved=storage();let failed=true;const received=[];
    const send=async batch=>{if(failed)throw Error('offline');received.push(...batch)};
    let queue=new TelemetryOutbox(saved,'session',send);
    queue.enqueue({sample_id:'1'});queue.enqueue({sample_id:'1'});
    await assert.rejects(queue.flush());assert.equal(queue.queue.length,1);
    queue=new TelemetryOutbox(saved,'session',send);failed=false;
    await queue.flush();assert.equal(received.length,1);assert.equal(queue.queue.length,0);
});
test('Enqueue during an in-flight upload is not dropped; flush calls share a request',async()=>{
    let release;const delivered=[];
    const queue=new TelemetryOutbox(storage(),'session',async batch=>{delivered.push(...batch);if(batch[0].sample_id==='1')await new Promise(resolve=>{release=resolve})});
    queue.enqueue({sample_id:'1'});const first=queue.flush();assert.equal(queue.flush(),first);
    queue.enqueue({sample_id:'2'});release();await first;
    assert.deepEqual(delivered.map(row=>row.sample_id),['1','2']);assert.equal(queue.queue.length,0);
});
