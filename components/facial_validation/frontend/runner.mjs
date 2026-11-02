import {PLAN,PREPARATION_MS,TRANSITION_MS,OBSERVATION_MS,beginPhase,endPhase} from './workflow.mjs';
export const SPOKEN_CUES=Object.freeze([
 'Face the camera. Keep your eyes open.',
 'Close both eyes gently. Keep your head straight.',
 'Open your eyes. Turn your head to the side.',
 'Face the camera again. Keep your eyes open.',
 'Move your whole face outside the camera view.'
]);
export const MAX_SESSION_MS=100000;
// Orchestration only: no detection thresholds, quality gates or engine state changes.
export async function runGuidedProtocol(session,{clock,delay,speak,isSpeaking=()=>false,isActive=()=>true,onPhase=()=>{}}){
 const check=()=>{if(!isActive())throw Error('Session stopped');if(clock()>MAX_SESSION_MS)throw Error('Session exceeded 100 seconds; timing preserved as incomplete')};
 const waitUntil=async end=>{while(clock()<end){check();await delay(Math.min(100,Math.max(1,end-clock())))}check()};
 const silence=async()=>{const deadline=clock()+1000;while(isSpeaking()){check();if(clock()>=deadline)throw Error('Speech did not stop; no new measurement window opened');await delay(50)}};
 const open=(phase,trialId='',duration=null)=>{check();const p=beginPhase(session,phase,trialId,clock(),duration);onPhase(p);return p};
 const preparation=open('preparation','',PREPARATION_MS);
 const narration=await Promise.all([speak('Prepare. Face the camera with your eyes open.'),waitUntil(preparation.deadline)]);check();await silence();endPhase(session,clock(),{narration:narration[0]});if(narration[0]!=='spoken')throw Error('Required narration failed: '+narration[0]);
 for(let i=0;i<PLAN.length;i++){
  const trial=PLAN[i];open('instruction',trial.id);const spoken=await speak(SPOKEN_CUES[i]);check();await silence();endPhase(session,clock(),{narration:spoken});if(spoken!=='spoken')throw Error('Required narration failed: '+spoken);
  const transition=open('transition',trial.id,TRANSITION_MS);await waitUntil(transition.deadline);endPhase(session,clock());
  check();await silence();const observation=open('observation',trial.id,OBSERVATION_MS);await waitUntil(observation.deadline);endPhase(session,observation.deadline);
 }
 return session;
}
