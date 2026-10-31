# Optional audio observations

Analysis is unchecked by default. Opting in resumes a local Web Audio analyser; opting out suspends it and stops reading samples. Time-domain RMS reports low/elevated energy, never speech or misconduct. No recorder, transcription, audio upload or audio-sample persistence is added. Existing live microphone transmission to the teacher while unmuted is independent of analysis consent.

Microphone available/muted/unavailable, lecturer muted/audible, analysis enabled/disabled, energy and unknown vocal activity are distinct. Missing or corrupt data remains unknown. The multimodal payload includes face presence, prolonged eye closure, head orientation, optional audio, uncertainty and an explicit non-inference statement. Head orientation and audio do not automatically reduce the default heuristic score. Visual scores remain estimates, not proof of attention.

A VAD model is intentionally not introduced without validated noise-domain samples. Energy alone cannot distinguish a fan, keyboard, music or another speaker from the student's voice.

## Measurements pending consented data

No consented audio dataset has been supplied. No real-world false-positive rate or capture-to-result latency is claimed. Synthetic tests cover silence, loud noise, unavailable permission state, mute, opt-out and corrupt input.

For independent consented local windows, run `node scripts/benchmark_audio.mjs path/to/private.json`. Format: `{ "consentConfirmed": true, "windows": [{"label":"noise", "samples":[0.01,-0.01]}] }`; labels are noise, silence or vocal. The script prints only aggregate energy-activation rate on nonvocal windows and compute latency. It never writes samples. The activation rate is not a speech false-positive rate. End-to-end browser latency requires separate browser capture instrumentation. Keep private samples outside version control.
