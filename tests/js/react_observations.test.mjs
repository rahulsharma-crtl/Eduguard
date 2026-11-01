import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const compiled=await build({entryPoints:['web/src/observations.jsx'],bundle:true,write:false,platform:'node',format:'esm',external:['react']});
// Resolve React from this repository while loading the compiled JSX in memory.
const code=compiled.outputFiles[0].text.replaceAll('from "react"',`from ${JSON.stringify(new URL('../../node_modules/react/index.js',import.meta.url).href)}`);
const ui=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('Unknown, zero and neutral labels stay distinct',()=>{
 assert.equal(ui.percent(null),'Unknown');assert.equal(ui.percent(0),'0.0%');
 assert.equal(ui.observationLabel('Attentive'),'Face oriented toward camera');
 assert.equal(ui.observationLabel('Attentive',true),'Observation unavailable');
 assert.equal(ui.observationLabel('Drowsy (Eyes Closed)'),'Eyes closed');
});
test('React trend excludes unknown scores and exposes accessible table',()=>{
 const html=renderToStaticMarkup(React.createElement(ui.Trend,{samples:[{sample_id:'a',timestamp:1,cei_score:0,status:'Eyes closed'},{sample_id:'b',timestamp:2,cei_score:1,is_unknown:true}]}));
 assert.match(html,/1 measured · 1 unknown/);assert.match(html,/average: 0.0%/);assert.match(html,/<caption>/);assert.match(html,/Observation unavailable/);assert.match(html,/class="unknown"/);
});
test('React guidance describes privacy and calibration for both modes',()=>{
 for(const mode of ['mesh','telemetry-only']){const html=renderToStaticMarkup(React.createElement(ui.StudentGuidance,{mode}));assert.match(html,/30 valid frames/);assert.match(html,/never sent/);assert.match(html,/consent again/)}
 assert.match(renderToStaticMarkup(React.createElement(ui.ObservationGuide)),/cannot establish attention/);
});
