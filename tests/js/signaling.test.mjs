import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
test('Private signaling service responds on configured path', async () => {
    const child = spawn(process.execPath, ['signaling/server.cjs'], {env:{...process.env,PORT:'19091'},stdio:'pipe'});
    let output=''; child.stderr.on('data',data=>{output+=data});
    try {
        let response;
        for(let attempt=0;attempt<100;attempt++) {
            if(child.exitCode !== null) throw Error(output || 'Server exited');
            try {response=await fetch('http://127.0.0.1:19091/eduguard/peerjs/id'); if(response.ok)break;} catch {}
            await delay(50);
        }
        assert.ok(response?.ok,output || 'Signaling service did not start');
        assert.match(await response.text(), /^[a-zA-Z0-9-]+$/);
    } finally {child.kill();}
});
