import test from 'node:test';
import assert from 'node:assert/strict';
import {observeAudio,multimodalObservation} from '../../core/engagement.mjs';
test('Audio requires opt-in and never equates loud background noise with speech',()=>{
 const samples=new Float32Array(2048).fill(.5);
 assert.equal(observeAudio({available:true,samples}).rms,null);
 const noise=observeAudio({optedIn:true,available:true,samples});
 assert.equal(noise.energy,'elevated');assert.equal(noise.vocal_activity,'unknown');
});
test('Silent room, unavailable permission, and intentional mute stay distinct',()=>{
 const samples=new Float32Array(2048);
 assert.equal(observeAudio({optedIn:true,available:true,samples}).energy,'low');
 assert.equal(observeAudio({optedIn:true,available:false}).microphone,'unavailable');
 const muted=observeAudio({optedIn:true,available:true,micMuted:true,lecturerMuted:true,samples});
 assert.equal(muted.microphone,'muted');assert.equal(muted.lecturer,'muted');assert.equal(muted.rms,null);
});
test('Missing/corrupt observations are unknown rather than silent or inattentive',()=>{
 assert.equal(observeAudio({optedIn:true,available:true,samples:[NaN]}).energy,'unknown');
 const observation=multimodalObservation({is_unknown:true},observeAudio());
 assert.equal(observation.face_presence,'unknown');assert.equal(observation.head_orientation,null);
});
