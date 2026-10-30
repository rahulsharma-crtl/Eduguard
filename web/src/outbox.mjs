// Persist derived samples before transmission; the API deduplicates retries.
export class TelemetryOutbox {
    constructor(storage, key, send) {
        this.storage=storage; this.key=key; this.send=send; this.inFlight=null;
        const saved=storage.getItem(key);
        this.queue=saved ? JSON.parse(saved) : [];
        if (!Array.isArray(this.queue)) throw Error('Invalid saved telemetry queue');
    }
    enqueue(sample) {
        if (!this.queue.some(row => row.sample_id===sample.sample_id)) this.queue.push(sample);
        this.storage.setItem(this.key,JSON.stringify(this.queue));
    }
    flush() {
        if (this.inFlight) return this.inFlight;
        this.inFlight=(async()=>{
            while(this.queue.length) {
                const batch=this.queue.slice(0,100);
                await this.send(batch);
                const ids=new Set(batch.map(row=>row.sample_id));
                this.queue=this.queue.filter(row=>!ids.has(row.sample_id));
                this.storage.setItem(this.key,JSON.stringify(this.queue));
            }
        })().finally(()=>{this.inFlight=null;});
        return this.inFlight;
    }
}
