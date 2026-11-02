import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EngagementEngine,LANDMARK_INDICES} from '../../core/engagement.mjs';
test('Diagnostic: production quality gate retains old reference after movement; no research workaround applied',()=>{
 const source=readFileSync('tests/js/facial_behavior_benchmark.test.mjs','utf8'),fn=source.slice(source.indexOf('function generateSyntheticFace('),source.indexOf('// --- Metrics Calculator ---'));const generate=new Function('LANDMARK_INDICES',fn+';return generateSyntheticFace;')(LANDMARK_INDICES);
 const engine=new EngagementEngine(),first=generate({ear:.25}),shifted=generate({ear:.25,center:{x:.65,y:.5}});
 assert.equal(engine.processFrame(first,1000).quality,'valid');
 for(let i=1;i<4;i++){const r=engine.processFrame(shifted,1000+i*100);assert.equal(r.quality_reason,'excessive_jitter');assert.equal(r.behavioral_state,'INSUFFICIENT_QUALITY');assert.equal(engine.prevLandmarks,first)}
 assert.equal(engine.config.thresholds.maxLandmarkJitter,35);
});
