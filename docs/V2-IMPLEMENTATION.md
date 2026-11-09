# V2 implementation and validation report

## Scope and checkpoints

The initial audit is in V2-AUDIT.md. Baseline: build and 72 checks passed before changes. Development reuses `feature/midi-lane-editor` (84f2422), without assuming it was merged. Recoverable tags preserve the original development/review heads. Work remains on `feature/web-app-v2`; main, deployment branch, environment configuration and public website are unchanged.

- Stage 1 checkpoint `fe24a15`: sampling/editing, audio history, pad operations, explicit playback modes, character/effects and internal resampling.
- Stage 2 checkpoint `2bd20c2`: seconds timing, internal SYNC, duplication/swing, automation, scenes and arrangement.
- Stage 3 checkpoint: this report's commit. Versioned projects, complete-output rendering, offline support, touch/error/resource regressions and final workflow refinements.

## Delivered and reused components

Sampling uses the existing PCM AudioWorklet/input device manager, now shared with internal capture rather than duplicated. Hold/release capture, desktop REC, audio overdub and visible permission errors assign directly to pads. Original AudioBuffers stay immutable through edits; undo retains audio references. Sample copy/swap, original/edited WAV export and file drop complement legacy settings COPY/PASTE.

The existing Web Audio engine retains PLAY/REST scheduling. Native looping sources provide distinct continuous LOOP; ONE SHOT remains repeatedly triggerable. Legacy loop flags migrate to CYCLE. Probability/every-N decisions apply per full cycle. Granular prepared regions implement independent pitch/stretch, fades, reverse and boundary crossfade. Scene/source ownership prevents unrelated performance triggers from resetting CYCLE origins. Intentional cross-source overlap remains audible; voice budget is 128.

The original rate/bit worklet now supports amount/bypass, scheduled changes and stereo stutter. Global character filtering and parallel saturation supplement it; resonant filter, pitch, reverse, delay and reverb share one effects graph. Era controls establish meaningful defaults. Output capture taps the actual limited stereo output; capture nodes emit silence, preventing feedback. Empty destinations prevent accidental resampling overwrite.

The existing generic event core and nine-lane editor were extended, not replaced. New FREE clips use seconds, new SYNC clips can use standalone tempo, HOST remains optional. Legacy timing is migrated, new quantization defaults OFF. Pattern duplication, swing and exact edits reuse existing history and scheduling. No external instrument code or speculative clock protocol was added.

Scenes retain full pad/audio/settings, event and automation snapshots. Arrangement supports repeats, reordering, recall, transport, compatible-loop continuation and fades. Manual recall can wait for a bar or nearest active pad-cycle boundary. Automatic arrangement changes occur at the specified scene duration; use bars for bar-aligned songs. Effects tails share the original graph. Automation records supported FX/global controls in seconds and schedules actual AudioParams/worklet changes.

## Audio/export and session changes

Portable format version 2 retains SHA-256-addressed embedded Float32 WAV assets and adds V2 pad settings, FX, automation, scene assets and arrangement. Assets are deduplicated, including samples referenced only by captured scenes. Snapshotting precedes async serialization. Loading validates all state/assets and decodes into staging before replacing the live session. Version 1 and legacy settings remain accepted; old `loop:true` means CYCLE, not continuous LOOP. Existing IndexedDB latest/previous records and MIDI mappings are retained.

Complete song export captures the actual graph in real time, including independent playback, MIDI, automated DSP and transitions. It renders once plus effect tails, trims capture startup latency, downloads stereo Float32 WAV and restores the original session after completion/cancel. It explicitly rejects excessive memory or unavailable host timing rather than omitting playback sources. There is no simplified second renderer dropping worklet effects.

Production service worker caches versioned app assets, bundled fonts and worklets for offline startup after online loading. User audio stays in projects/IndexedDB, not network uploads. No native/Android dependencies were introduced.

## Verification

Results and screenshots are under `artifacts/`. Automated checks use actual Chromium Web Audio plus generated mono/stereo WAV input; MIDI hardware messages are simulated. Signal assertions verify PCM energy, effect tails, channels, worklet transformations and capture output, not just controls.

Final suite: 21 unit/DSP checks; 17 original playback checks; 20 input/MIDI checks; 22 editor/project checks; 18 V2 sampling/touch checks; 15 song/automation checks; 13 project/export checks; 9 production/offline/layout checks — **135 checks**. TypeScript/Vite production build passes.

Coverage includes hold capture, overdub, permission rejection, audio undo/copy/swap, waveform trim/touch, crossfade boundaries, granular original retention, LOOP vs CYCLE, probability, resampling content/destination safety, recorder disconnect, performance source isolation, FREE/SYNC, clip edits, scene continuity/one-shots, automation reaching DSP, song pause/advance/stop, complete WAV samples/tails/stereo, export cancel/restore, V1 migration, invalid-project atomic rejection, scene-only assets, IndexedDB recovery, twenty start/stop source-disconnection cycles, offline audio worklets and five viewport sizes.

One original phase check failed when it assumed a fixed wall-clock delay would land within a 150 ms audio phase window under executor load. Reproduction passed. The test now observes the required independent phases on the actual audio clock, with a bounded timeout; the unit test retains exact PLAY/REST boundary assertions. No playback logic was weakened to pass it.

## Limitations and manual acceptance

- Granular pitch/stretch is intentionally lightweight and can texture transients. Prepared buffers and undo consume RAM; long files/complex projects can be expensive. No claim of transparent stretch or measured unlimited endurance.
- Loop points share the edited start/end region; there is no separate inner sustain-loop marker pair. Crossfade smooths region boundaries without extending the region.
- Character is global; a separate per-pad era graph and chorus were not added. Existing delay/reverb are parallel sends with dry present. Reverse FX affects new voices; sample reverse can restart a loop.
- Automatic scene arrangement uses authored durations; next-bar/next-cycle queueing applies to manual recall. Only compatible independent loops retain phase; event clips restart on scene recall. Crossfades share one global FX graph rather than cloning an entire instrument.
- Export takes real time, requires foreground scheduling and has a 512 MiB capture budget. Extremely long/high-feedback tails use a conservative finite tail rather than infinite silence detection. Export excludes live unrecorded input monitoring and requires INTERNAL timing. Probability is stochastic, so separate renders may differ.
- Browser memory/storage quotas and background suspension remain constraints. Autosave snapshots are complete projects, not streamed asset storage. Keep portable backups. Severe main-thread stalls can miss scheduled events.
- Physical Windows interfaces/controllers, Safari/iOS, latency, feedback monitoring, human listening, long-duration CPU/memory endurance and background-device behavior require manual acceptance. Automated tests are not a claim that all hardware/browser combinations work.
- Gated playback, external MIDI output, SEQ-output-to-MIDI recording, Android packaging and real DM-848 integration are intentionally outside scope.

Run instructions and the complete user workflow are in V2-GUIDE.md and README.md. No deployment has been performed.
