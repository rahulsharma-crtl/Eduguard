import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validate,splitParticipants,checkSplit,runClips,summarize,metrics,objective,candidates,hash,clusterCI,compress,TASKS,CONDITIONS,DEFAULT_CONFIG} from './lib.mjs';
const args=process.argv.slice(2),command=args.shift();
const arg=(key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1]};
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const write=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n')};
const engineHash=hash(readFileSync(new URL('../core/engagement.mjs',import.meta.url),'utf8'));
const evaluatorHash=hash(['./lib.mjs','./run.mjs','../benchmarks/capture.html'].map(file=>readFileSync(new URL(file,import.meta.url),'utf8')));
const fmt=n=>Number.isFinite(n)?n.toFixed(3):'---';
const escape=s=>String(s).replace(/[\\{}_%&#$]/g,c=>`\\${c}`);
export function latexReport(report){
 if(report.status==='unmeasured')return '\\begin{table}[t]\n\\centering\n\\caption{Real-world evaluation status. No consented labeled dataset was supplied.}\n\\begin{tabular}{ll}\\hline\nMeasure & Result \\\\\n\\hline\nAccuracy, macro-F1, FPR, latency & Unmeasured \\\\\n\\hline\\end{tabular}\n\\end{table}\n';
 let out='% Generated from genuine labeled input. Ratios in [0,1]; dashes mean undefined.\n';
 for(const [variant,value]of Object.entries(report.variants)){
 out+=`\\begin{table*}[t]\n\\centering\n\\caption{${escape(variant)}: held-out participant results. Parentheses show 95\\% participant-cluster bootstrap macro-F1 intervals.}\n\\begin{tabular}{lrrrr}\\hline\nTask & N & Coverage & Accuracy & Macro-F1 (95\\% CI) \\\\\n\\hline\n`;
 for(const [task,m]of Object.entries(value.tasks)){const ci=m.intervals.macroF1;out+=`${escape(task)} & ${m.total} & ${fmt(m.coverage)} & ${fmt(m.accuracy)} & ${fmt(m.macroF1)} (${fmt(ci.low)}, ${fmt(ci.high)}) \\\\\n`;}
 out+='\\hline\\end{tabular}\n\\end{table*}\n';
 const tm=value.temporal;
 out+=`\\begin{table}[t]\n\\centering\n\\caption{${escape(variant)} timing and pose error. Latency is conditional on detection; angles require independent references.}\n\\begin{tabular}{lr}\\hline\nMetric & Value \\\\\n\\hline\nClosure latency (ms) & ${fmt(tm.closureLatencyMs)} \\\\\nMissed closure events & ${tm.closureMissedEvents} \\\\\nNode replay (ms/frame) & ${fmt(tm.processingMs)} \\\\\nBrowser extraction (ms/frame) & ${fmt(tm.browserExtractionMs)} \\\\\n`;
 for(const axis of ['yaw','pitch','roll'])out+=`${axis} MAE (degrees) & ${fmt(tm.angles[axis].maeDegrees)} \\\\\n`;
 out+='\\hline\\end{tabular}\n\\end{table}\n';
 for(const [task,m]of Object.entries(value.tasks)){
 out+=`\\begin{table*}[t]\n\\centering\n\\caption{${escape(variant+' / '+task)}: per-class metrics. FPR is one-versus-rest per labeled frame.}\n\\begin{tabular}{lrrrrr}\\hline\nClass & Support & Precision & Recall & F1 & FPR (95\\% CI) \\\\\n\\hline\n`;
 for(const [c,p]of Object.entries(m.perClass))out+=`${escape(c)} & ${p.support} & ${fmt(p.precision)} & ${fmt(p.recall)} & ${fmt(p.f1)} & ${fmt(p.falsePositiveRate)} (${fmt(p.intervals.falsePositiveRate.low)}, ${fmt(p.intervals.falsePositiveRate.high)}) \\\\\n`;
 out+='\\hline\\end{tabular}\n\\end{table*}\n';
 const cols=[...TASKS[task],'unknown'];out+=`\\begin{table}[t]\n\\centering\n\\caption{${escape(variant+' / '+task)} confusion matrix; rows are truth, columns predictions.}\n\\resizebox{\\columnwidth}{!}{\\begin{tabular}{l${'r'.repeat(cols.length)}}\\hline\nTruth & ${cols.map(escape).join(' & ')} \\\\\n\\hline\n`;
 for(const [truth,counts]of Object.entries(m.confusion))out+=`${escape(truth)} & ${cols.map(c=>counts[c]).join(' & ')} \\\\\n`;
 out+='\\hline\\end{tabular}}\n\\end{table}\n';
 }
 }
 out+='\\begin{table*}[t]\n\\centering\n\\caption{Paired changes in macro-F1 versus current defaults on the same held-out participants (95\\% cluster bootstrap intervals).}\n\\begin{tabular}{llrrr}\\hline\nVariant & Task & Delta & Lower & Upper \\\\\n\\hline\n';
 for(const [name,tasks]of Object.entries(report.pairedDeltas))for(const [task,d]of Object.entries(tasks))out+=`${escape(name)} & ${task} & ${fmt(d.delta)} & ${fmt(d.interval.low)} & ${fmt(d.interval.high)} \\\\\n`;
 return out+'\\hline\\end{tabular}\n\\end{table*}\n';
}
export function main(){
 if(!command||command==='--help'){console.log('EduGuard local evaluation: status | merge --files a.json,b.json | split --dataset data.json | calibrate --dataset data.json --split split.json | evaluate --dataset data.json --split split.json --lock calibration.json. Use --out PATH. See evaluation/README.md.');return;}
 const output=arg('out','evaluation/results-local');
 if(command==='status'){
 const report={status:'unmeasured',reason:'No consented real-world labeled dataset supplied. Synthetic fixtures are tests only.',engineHash,evaluatorHash};write(output+'/status.json',report);write(output+'/tables.tex',latexReport(report));console.log(report);return;
 }
 if(command==='merge'){
 const files=arg('files','').split(',').filter(Boolean);if(!files.length)throw Error('Provide --files export1.json,export2.json');
 const datasets=files.map(file=>validate(read(file)));const merged={schemaVersion:2,source:'real-video',consentConfirmed:true,clips:datasets.flatMap(d=>d.clips)};validate(merged);write(output,merged);console.log('Merged validated exports:',output);return;
 }
 const data=validate(read(arg('dataset')));
 if(command==='split'){const split=splitParticipants(data,Number(arg('seed',731)));write(output,split);console.log('Participant-disjoint split frozen:',output);return;}
 const split=read(arg('split'));checkSplit(data,split);const pick=key=>data.clips.filter(c=>split[key].includes(c.participantId));
 if(command==='calibrate'){
 const ranked=candidates.map((config,index)=>({index,config,train:objective(runClips(pick('train'),config,{personalize:true}))})).filter(c=>Number.isFinite(c.train)).sort((a,b)=>b.train-a.train||a.index-b.index).slice(0,3);
 if(!ranked.length)throw Error('No scored training labels.');
 const selected=ranked.map(c=>({...c,validation:objective(runClips(pick('validation'),c.config,{personalize:true}))})).filter(c=>Number.isFinite(c.validation)).sort((a,b)=>b.validation-a.validation||a.index-b.index)[0];
 if(!selected)throw Error('No validation labels.');
 const lock={schemaVersion:1,datasetHash:hash(data),splitHash:hash(split),engineHash,evaluatorHash,candidateGrid:candidates,selection:'Top three training candidates; validation mean of available task macro-F1; deterministic ties.',shortlist:ranked,selected,createdAt:new Date().toISOString(),personalize:true};lock.lockHash=hash(lock);write(output,lock);console.log('Frozen calibration settings:',output);return;
 }
 if(command!=='evaluate')throw Error('Commands: status, split, calibrate, evaluate. See evaluation/README.md.');
 const lock=read(arg('lock')),lockHash=lock.lockHash;delete lock.lockHash;
 if(hash(lock)!==lockHash||lock.datasetHash!==hash(data)||lock.splitHash!==hash(split)||lock.engineHash!==engineHash||lock.evaluatorHash!==evaluatorHash)throw Error('Calibration lock, dataset, split or implementation changed.');
 if(existsSync(output+'/report.json')&&!args.includes('--repeat'))throw Error('Test report already exists; use --repeat only for an identical reproducibility run. Never tune on test.');
 const bootstrap=Number(arg('bootstrap',1000));if(!Number.isInteger(bootstrap)||bootstrap<200)throw Error('At least 200 bootstrap replicates required (1000 default).');
 const selected=lock.selected.config;
 const variants={current:{config:{}},current_personalized:{config:{},options:{personalize:true}},calibrated:{config:selected,options:{personalize:true}},without_camera_calibration:{config:selected,options:{personalize:true,noCamera:true}},without_EAR_calibration:{config:selected,options:{personalize:true,noEAR:true}},without_temporal_debounce:{config:{...selected,thresholds:{...selected.thresholds,drowsinessDurationMs:1,drowsinessFrames:1,gazeDeviationDurationMs:1}},options:{personalize:true}},without_smoothing:{config:{...selected,smoothing:{enabled:false}},options:{personalize:true}},without_jitter_gate:{config:{...selected,thresholds:{...selected.thresholds,maxLandmarkJitter:1e9}},options:{personalize:true}}};
 const predictions=Object.fromEntries(Object.entries(variants).map(([name,v])=>[name,runClips(pick('test'),v.config,v.options)]));
 const results=Object.fromEntries(Object.entries(predictions).map(([name,rows])=>[name,summarize(rows,bootstrap)]));
 const pairedDeltas={};for(const [name,rows]of Object.entries(predictions))if(name!=='current')pairedDeltas[name]=Object.fromEntries(Object.keys(TASKS).map(task=>{
 const paired=rows.map((row,i)=>({...row,baseline:predictions.current[i].predictions}));return[task,{delta:results[name].tasks[task].macroF1==null||results.current.tasks[task].macroF1==null?null:results[name].tasks[task].macroF1-results.current.tasks[task].macroF1,interval:clusterCI(compress(paired,task,true),r=>{const a=metrics(r,task).macroF1,b=metrics(r.map(x=>({...x,predictions:x.baseline})),task).macroF1;return a===null||b===null?null:a-b},{replicates:bootstrap})}]}));
 const strata={};for(const c of CONDITIONS)strata[c]=summarize(predictions.calibrated.filter(r=>r.conditions.includes(c)),bootstrap);const devices=Object.fromEntries([...new Set(predictions.calibrated.map(r=>r.device))].map(device=>[device,summarize(predictions.calibrated.filter(r=>r.device===device),bootstrap)]));
 let gitRevision='unavailable';try{gitRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}catch{}
 const report={status:'measured-on-supplied-data',createdAt:new Date().toISOString(),gitRevision,engineHash,evaluatorHash,datasetHash:hash(data),splitHash:hash(split),lockHash,bootstrapReplicates:bootstrap,bootstrapSeed:731,defaults:DEFAULT_CONFIG,variantConfigs:variants,variants:results,pairedDeltas,strata,devices,warnings:['Self-declared provenance/consent must be independently audited.','Cluster percentile intervals are unstable with few participants; missing classes are not evidence of accuracy.','Macro-F1 averages only truth-supported classes; inspect missingClasses before comparing studies.',
'No attention, learning or misconduct ground truth measured.','Ablations are diagnostic; no automatic production threshold changes.']};
 write(output+'/report.json',report);write(output+'/tables.tex',latexReport(report));console.log('Held-out report and IEEE-compatible LaTeX written:',output);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main()}catch(e){console.error(e.message);process.exitCode=1}
