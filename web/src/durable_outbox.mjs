// IndexedDB transactions persist individual events before transmission.
const result=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
export class DurableTelemetryOutbox {
 constructor(sessionId,send,factory=globalThis.indexedDB,retentionMs=7*86400000){
  this.sessionId=sessionId;this.send=send;this.queue=[];this.inFlight=null;this.retentionMs=retentionMs;
  this.db=new Promise((resolve,reject)=>{if(!factory){reject(Error('IndexedDB unavailable: telemetry cannot be queued durably'));return}
   const request=factory.open('eduguard-telemetry-v1',1);
   request.onupgradeneeded=()=>{const store=request.result.createObjectStore('events',{keyPath:'key'});store.createIndex('session','session')};
   request.onsuccess=()=>{
    const db=request.result;const tx=db.transaction('events','readwrite');const cursor=tx.objectStore('events').openCursor();
    cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;if((entry.value.expiresAt||entry.value.queuedAt+7*86400000)<Date.now())entry.delete();entry.continue()};
    tx.oncomplete=()=>resolve(db);tx.onerror=()=>reject(tx.error);
   };request.onerror=()=>reject(request.error);
  });
 }
 async transaction(mode,operation){const db=await this.db;return new Promise((resolve,reject)=>{
  const tx=db.transaction('events',mode,{durability:'strict'});let value;
  try{value=operation(tx.objectStore('events'))}catch(error){tx.abort();reject(error);return}
  tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Queue transaction aborted'));
 })}
 async rows(){const db=await this.db;const rows=await result(db.transaction('events').objectStore('events').index('session').getAll(this.sessionId));
  const expired=rows.filter(row=>Date.now()>(row.expiresAt||row.queuedAt+this.retentionMs));
  if(expired.length)await this.transaction('readwrite',store=>{for(const row of expired)store.delete(row.key)});
  const valid=rows.filter(row=>Date.now()<=(row.expiresAt||row.queuedAt+this.retentionMs));this.queue=valid.map(row=>row.payload);return valid;
 }
 async enqueue(payload){const key=this.sessionId+':'+payload.sample_id;
  await this.transaction('readwrite',store=>{const request=store.get(key);request.onsuccess=()=>{if(!request.result)store.put({key,session:this.sessionId,queuedAt:Date.now(),expiresAt:Date.now()+this.retentionMs,payload})}});
  await this.rows();
 }
 async migrateLegacy(storage,key){const saved=storage?.getItem(key);if(!saved)return;const rows=JSON.parse(saved);
  if(!Array.isArray(rows))throw Error('Invalid legacy queue');
  for(const payload of rows)await this.enqueue(payload);
  storage.removeItem(key);
 }
 flush(){if(this.inFlight)return this.inFlight;
  this.inFlight=(async()=>{let rows;while((rows=await this.rows()).length){const batch=rows.slice(0,100);await this.send(batch.map(row=>row.payload));
   await this.transaction('readwrite',store=>{for(const row of batch)store.delete(row.key)});
  }})().finally(()=>{this.inFlight=null});return this.inFlight;
 }
 async clear(){const rows=await this.rows();await this.transaction('readwrite',store=>{for(const row of rows)store.delete(row.key)});this.queue=[]}
 async close(){(await this.db).close()}
}
