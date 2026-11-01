import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EngagementEngine, BEHAVIORAL_STATES } from '../core/engagement.mjs';

export function evaluate(dataset) {
    if(dataset.schemaVersion===2)throw Error('Schema v2 requires the participant-disjoint workflow: --rigorous evaluate --dataset ... --split ... --lock ... (see evaluation/README.md).');
    if (dataset.source !== 'real-video' || dataset.consentConfirmed !== true || !dataset.clips?.length)
        throw new Error('Provide consented real-video clips, not synthetic landmarks.');
    const classes = Object.values(BEHAVIORAL_STATES);
    const confusion = Object.fromEntries(classes.map(c => [c, Object.fromEntries(classes.map(p => [p, 0]))]));
    let total = 0, correct = 0;
    for (const clip of dataset.clips) {
        const engine = new EngagementEngine({ calibration: clip.calibration || {} });
        let last = -1;
        if (!clip.frames?.length) throw new Error('Empty clip');
        for (const frame of clip.frames) {
            if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= last || !classes.includes(frame.label))
                throw new Error('Frames need increasing timestamps and known labels.');
            last = frame.timestampMs;
            const prediction = engine.processFrame(frame.landmarks, frame.timestampMs).behavioral_state;
            confusion[frame.label][prediction]++;
            total++;
            if (frame.label === prediction) correct++;
        }
    }
    const perClass = Object.fromEntries(classes.map(c => {
        const tp = confusion[c][c];
        const support = Object.values(confusion[c]).reduce((a,b) => a+b, 0);
        const predicted = classes.reduce((sum, truth) => sum + confusion[truth][c], 0);
        const precision = predicted ? tp/predicted : 0;
        const recall = support ? tp/support : 0;
        return [c, { support, precision, recall, f1: precision+recall ? 2*precision*recall/(precision+recall) : 0 }];
    }));
    const supported = Object.values(perClass).filter(c => c.support);
    return { source: 'real-video', total, accuracy: correct/total,
        macroF1: supported.reduce((sum,c) => sum+c.f1,0)/supported.length,
        missingClasses: classes.filter(c => !perClass[c].support), confusion, perClass };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv[2] === '--rigorous') {
        process.argv.splice(2,1);
        const {main}=await import('../evaluation/run.mjs'); main();
    } else {
    if (!process.argv[2]) throw new Error('Usage: npm run benchmark:video -- dataset.json [report.json]');
    const report = evaluate(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
}
