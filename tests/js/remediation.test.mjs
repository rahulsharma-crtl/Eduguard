import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { classifyBehavioralState, BEHAVIORAL_STATES, estimateHeadPose, calibrateCameraOffset, EngagementEngine } from '../../core/engagement.mjs';
import { evaluate } from '../../scripts/benchmark_video.mjs';
test('Roll is an observable head tilt without overriding absence or eye closure', () => {
    const context = {quality:{isValid:true}, pose:{roll:26}};
    assert.equal(classifyBehavioralState(context), BEHAVIORAL_STATES.HEAD_TILT);
    assert.equal(classifyBehavioralState({...context, quality:{isAbsent:true}}), BEHAVIORAL_STATES.FACE_NOT_DETECTED);
    assert.equal(classifyBehavioralState({...context,isEyeClosed:true,closureDurationMs:1200}), BEHAVIORAL_STATES.PROLONGED_EYE_CLOSURE);
    assert.equal(classifyBehavioralState({...context,pose:{roll:25}}), BEHAVIORAL_STATES.ATTENTIVE);
});
test('Generated browser engine behaves like the canonical module', () => {
    const context = {};
    vm.runInNewContext(readFileSync('components/student_room/frontend/engagement.js','utf8'),context);
    assert.equal(context.EduGuardEngagement.calculateCEI(1,1,0),1);
    assert.equal(context.EduGuardEngagement.classifyBehavioralState({quality:{isValid:true},pose:{roll:-30}}),BEHAVIORAL_STATES.HEAD_TILT);
});
test('Production call guard requires canvas and signaling in either initialization order', () => {
    const html = readFileSync('components/student_room/frontend/index.html','utf8');
    const functionText = html.match(/function areCallPrerequisitesReady\(\) \{[\s\S]*?\n        \}/)[0];
    const context = {readinessState:{canvasStream:'idle',peerSignaling:'ready'},currentRoomId:'room',peer:{open:true,destroyed:false},virtualCanvasStream:null};
    vm.createContext(context); vm.runInContext(functionText,context);
    assert.equal(context.areCallPrerequisitesReady(),false);
    context.readinessState.canvasStream='ready'; context.virtualCanvasStream={};
    assert.equal(context.areCallPrerequisitesReady(),true);
    context.peer.open=false;
    assert.equal(context.areCallPrerequisitesReady(),false);
});
test('Real-video benchmark refuses synthetic input and reports missing class coverage', () => {
    assert.throws(()=>evaluate({source:'synthetic'}));
    const report = evaluate({source:'real-video',consentConfirmed:true,clips:[{frames:[{timestampMs:1,label:'FACE_NOT_DETECTED',landmarks:null}]}]});
    assert.equal(report.accuracy,1);
    assert.ok(report.missingClasses.includes('HEAD_TILT'));
});

test('Blocked audible autoplay retries muted and exposes the audio gesture control', async () => {
    const html=readFileSync('components/student_room/frontend/index.html','utf8');
    const code=html.match(/async function playTeacherStream\(stream\) \{[\s\S]*?\n        \}/)[0];
    let attempts=0;
    const context={teacherFeed:{muted:false,play:async()=>{if(++attempts===1)throw Error('NotAllowedError')}},
        resumeLectureBtn:{hidden:true},setConnectionStatus:()=>{}};
    vm.createContext(context);vm.runInContext(code,context);
    const stream={};await context.playTeacherStream(stream);
    assert.equal(context.teacherFeed.srcObject,stream);
    assert.equal(attempts,2);assert.equal(context.teacherFeed.muted,true);
    assert.equal(context.resumeLectureBtn.hidden,false);
});
test('Allowed playback keeps the lecture audio control out of the way', async () => {
    const html=readFileSync('components/student_room/frontend/index.html','utf8');
    const code=html.match(/async function playTeacherStream\(stream\) \{[\s\S]*?\n        \}/)[0];
    const context={teacherFeed:{muted:false,play:async()=>{}},resumeLectureBtn:{hidden:false},setConnectionStatus:()=>{}};
    vm.createContext(context);vm.runInContext(code,context);await context.playTeacherStream({});
    assert.equal(context.teacherFeed.muted,false);assert.equal(context.resumeLectureBtn.hidden,true);
});

test('Repeated stream events preserve the teacher media call instead of closing it', () => {
    const html=readFileSync('components/teacher_room/frontend/index.html','utf8');
    const code=html.slice(html.indexOf('function renderStudentRoster('),html.indexOf('function removeStudentRoster('));
    let closes=0,plays=0;
    const call={close:()=>closes++};
    const oldStream={},newStream={};
    const row={call,stream:oldStream,lastSeen:0,audioElem:{srcObject:oldStream,play:()=>{plays++;return Promise.resolve()}}};
    const context={connectedStudents:new Map([['Alice',row]]),removeStudentRoster:()=>{closes++}};
    vm.createContext(context);vm.runInContext(code,context);
    context.renderStudentRoster('Alice',newStream,call);
    context.renderStudentRoster('Alice',newStream,call);
    assert.equal(closes,0);assert.equal(plays,2);assert.equal(row.stream,newStream);
});
test('Closing a teacher roster entry tolerates synchronous call close callbacks', () => {
    const html=readFileSync('components/teacher_room/frontend/index.html','utf8');
    const code=html.slice(html.indexOf('function removeStudentRoster('),html.indexOf('// Dynamic Badge Telemetry Updater'));
    let closes=0;
    const context={connectedStudents:new Map(),emptyRosterRow:{style:{}},updateStudentCount:()=>{},resizeIframe:()=>{}};
    vm.createContext(context);vm.runInContext(code,context);
    context.connectedStudents.set('Alice',{call:{close:()=>{closes++;context.removeStudentRoster('Alice')}}});
    context.removeStudentRoster('Alice');
    assert.equal(closes,1);assert.equal(context.connectedStudents.size,0);
});
