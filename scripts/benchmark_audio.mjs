import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {observeAudio} from '../core/engagement.mjs';
const dataset=JSON.parse(readFileSync(process.argv[2],'utf8'));
if(dataset.consentConfirmed!==true||!dataset.windows?.length)throw Error('Consented locally supplied windows required');
const times=[];let noise=0,activated=0;
for(const window of dataset.windows){
 if(!['noise','silence','vocal'].includes(window.label)||!Array.isArray(window.samples)||!window.samples.length||!window.samples.every(Number.isFinite))throw Error('Invalid labeled window');
 const start=performance.now();const result=observeAudio({optedIn:true,available:true,samples:window.samples});times.push(performance.now()-start);
 if(window.label!=='vocal'){noise++;if(result.energy==='elevated')activated++;}
}
times.sort((a,b)=>a-b);
console.log(JSON.stringify({windows:times.length,nonVocalEnergyActivationRate:noise?activated/noise:null,
 vocalFalsePositiveRate:null,reason:'No vocal classifier: speech remains unknown',
 computeLatencyP95Ms:times[Math.ceil(times.length*.95)-1],
 endToEndLatency:'Not measured; browser scheduling and capture excluded'},null,2));
