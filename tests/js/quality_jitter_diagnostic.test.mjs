import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EngagementEngine,LANDMARK_INDICES} from '../../core/engagement.mjs';
test('Diagnostic: production engine safely recovers after a stable movement without accepting corrupt frames',()=>{
 const source=readFileSync('tests/js/facial_behavior_benchmark.test.mjs','utf8'),fn=source.slice(source.indexOf('function generateSyntheticFace('),source.indexOf('// --- Metrics Calculator ---'));const generate=new Function('LANDMARK_INDICES',fn+';return generateSyntheticFace;')(LANDMARK_INDICES);
 const engine=new EngagementEngine(),first=generate({ear:.25}),shifted=generate({ear:.25,center:{x:.65,y:.5}});
 assert.equal(engine.processFrame(first,1000).quality,'valid');
 for(let i=1;i<4;i++){const r=engine.processFrame(shifted,1000+i*100);assert.equal(r.quality_reason,'excessive_jitter');assert.equal(r.behavioral_state,'INSUFFICIENT_QUALITY');assert.equal(engine.prevLandmarks,first)}
 const recovered=engine.processFrame(shifted,1400);assert.equal(recovered.quality,'valid');assert.equal(engine.prevLandmarks,shifted);
 const clipped=shifted.map(point=>({...point}));clipped[LANDMARK_INDICES.NOSE_TIP].x=0;
 const corruptEngine=new EngagementEngine();corruptEngine.processFrame(first,1500);
 for(let i=0;i<4;i++)assert.equal(corruptEngine.processFrame(clipped,1600+i*100).quality,'insufficient');
 assert.equal(engine.config.thresholds.maxLandmarkJitter,35);
});
