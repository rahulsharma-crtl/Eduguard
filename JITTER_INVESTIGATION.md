# Excessive jitter investigation — separate from the Research UI

Date: 2026-11-02. This is an implementation diagnostic, not participant-accuracy evidence. **The production engine and its thresholds have not been changed.** The first participant/pilot CSV was not supplied in this conversation; its specific cause cannot be confirmed from the report alone. Preserve that file and analyze it separately from the new versioned protocol.

## Evidence from current source

`core/engagement.mjs:assessLandmarkConfidence` calculates RMS x/y displacement of critical landmarks from `options.prevLandmarks`, scaled in the configured 640x480 coordinate space. The configured cutoff is 35 pixels. `EngagementEngine.processFrame` updates `this.prevLandmarks` only when `quality.isValid`. An excessive-jitter rejection therefore leaves the reference at the last accepted position. The quality gate measures displacement rather than a timestamp-normalized oscillation or velocity estimate.

A synthetic diagnostic using the actual unchanged engine:

1. Supply a valid neutral landmark fixture centered at x=0.50: accepted.
2. Translate the same fixture to x=0.65: excessive_jitter / INSUFFICIENT_QUALITY.
3. Supply that identical translated fixture repeatedly: still rejected, with reference retained at the original accepted fixture.

This reproduces a stale-reference lockout: a person may settle at a new location and still be compared with the old location. It is a demonstrated engine-state mechanism, not proof that all jitter warnings are false. Real rapid motion, blur, illumination, camera framing, normalized geometry and MediaPipe errors can also legitimately produce large displacement.

`tests/js/quality_jitter_diagnostic.test.mjs` pins this reproduction and asserts the existing threshold remains 35. It is intentionally a diagnostic regression, not a repaired behavior test or a field dataset.

## Adapter and frame handling reviewed

The validation adapter passes `results.multiFaceLandmarks[0]` directly to the existing engine. Mesh preview rendering consumes the same normalized points without transforming or mutating them. Only the drawing canvas scales rendering to the camera image; it is never used as the inference input. Inference receives the raw local video element, uses one in-flight send, processes only fresh presented frames and supplies increasing `performance.now()` timestamps. Camera-readiness inference and timed inference share one engine and the same absolute monotonic clock; changing the CSV origin does not rewind the engine's temporal clock.

There is no evidence in these reviewed paths of pixel coordinates being supplied where normalized coordinates are expected, of double mirroring, or of feeding a drawn mesh back into detection. The production engine's fixed geometry convention can still behave differently across camera positions/resolutions, and lower effective cadence may increase frame-to-frame displacement. The UI does not normalize those away to improve results.

## Proposed fix for a separate approval (NOT implemented)

Consider separating the immediately preceding **structurally valid observation** used for jitter measurement from the last accepted observation used for other state. After a finite, correctly sized, non-clipped geometry sample is rejected solely for excessive_jitter, advance only that diagnostic reference. A subsequent stationary sample would then have low displacement, while the sudden-motion frame remains rejected. Keep the same cutoff initially.

Before approving such an engine change, define behavior for missing/partial/corrupted points, clipping, small faces, long frame gaps, oscillating motion and multiple faces; verify that invalid inputs cannot poison the new reference. Separately review temporal eye-closure/head-duration state across unknown gaps. Add actual-engine recovery and false-acceptance tests, benchmark the fixed version against the original on independent labeled data, and retain a distinct engine hash/version. This is a candidate design, not a validated fix.

Do not implement a research-only `engine.reset()`, manually overwrite `prevLandmarks`, raise the jitter threshold, or smooth coordinates until the expected label appears. Those approaches would conceal the production behavior and undermine the comparison. Current research exports preserve every insufficient-quality result. Readiness is advisory; it does not exclude poorly tracked participants or certify reference actions.
