// Generic English cues only; no participant data is sent to a speech service.
export class LocalNarrator {
 constructor({synth=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,timeoutMs=10000}={}){this.synth=synth;this.Utterance=Utterance;this.timeoutMs=timeoutMs;this.muted=false;this.active=null;this.utterance=null;}
 voice(){try{return this.synth?.getVoices().find(v=>v.localService===true&&/^en(?:-|$)/i.test(v.lang))||null}catch{return null}}
 get speaking(){return Boolean(this.synth?.speaking)}
 setMuted(muted){this.muted=muted;if(muted)this.cancel('muted');}
 cancel(reason='cancelled'){const finish=this.active;finish?.(reason);try{this.synth?.cancel()}catch{}}
 speak(text){
  if(this.muted)return Promise.resolve('muted');
  const voice=this.voice();if(!voice||!this.Utterance)return Promise.resolve('unavailable');
  return new Promise(resolve=>{
   const utterance=new this.Utterance(text);this.utterance=utterance;utterance.lang=voice.lang;utterance.voice=voice;utterance.rate=1;let settled=false;
   const finish=status=>{if(settled)return;settled=true;clearTimeout(timer);if(this.active===finish)this.active=null;this.utterance=null;resolve(status)};
   const timer=setTimeout(()=>{this.muted=true;this.cancel('timeout')},this.timeoutMs);
   this.active=finish;utterance.onend=()=>finish('spoken');utterance.onerror=()=>{if(settled)return;this.muted=true;this.cancel('error')};
   try{this.synth.speak(utterance)}catch{this.muted=true;this.cancel('error')}
  });
 }
}
