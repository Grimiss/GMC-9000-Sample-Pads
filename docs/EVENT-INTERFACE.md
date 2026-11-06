# Instrument-independent event contract — v1

Written before implementation. GMC-9000, Microseq and DS-9 are standalone instruments. DM-848 is a separate eight-track host (1–4 tape loops; 5–8 instruments/external inputs). This task changes GMC-9000 only. No Microseq runtime, transport or repository is imported.

## Assumptions and boundaries

The other repositories and any shared engine package have not been inspected. There is no verified cross-instrument API to import. `src/events` therefore defines a small dependency-free, reusable event/clip/clock core inside this repository. Its lane IDs are generic integers, not pitches; GMC validates its nine-pad range in its adapter. A future shared package can extract this core or provide a compatible adapter. No claim of integration with another instrument is made.

Time is expressed as fractional quarter-note beats, preserving unquantized timing; no instrument-specific tick resolution. A clip contains ID, positive loop length and stable-ID events with lane, onset beat, original onset beat, velocity (0–1), optional duration and original duration. Quantization affects onset only, not original recording timestamps. There is no gated playback.

## Host clock port

`HostClock.snapshot(audioTimeSeconds)` returns `{beat, bpm, running, revision}` at the caller's AudioContext time. BPM is constant inside a scheduling horizon. The host must increment revision on seek, discontinuity, or tempo change. Units and AudioContext time conversion are the adapter's responsibility; no postMessage or external MIDI transport is assumed. Only a supplied in-process trusted clock is supported in this phase.

FREE uses a local monotonic audio-clock anchor and local BPM. SYNC uses a supplied clock; without one it waits visibly and emits no MIDI playback. Host stop/disconnect cancels scheduled MIDI voices. Connection/seek/revision changes invalidate the old queue. Instrument clips retain independent lengths and wrap relative to beat zero. PLAY/REST remains sample-duration based, never converted to beats. Host clock integration does not alter the existing PLAY/REST transport; only MIDI clips follow the host in this phase.

## Scheduled voice port

`trigger({lane, when, velocity, owner, occurrence})` creates an independent one-shot at AudioContext time. `cancelOwner(owner, after?)` cancels only that source's voices. Sources are `seq`, `manual`, `performance`, `midi`. Every clip occurrence is unique by clip ID, event ID and loop iteration. Coincident events from different sources are intentional layers. Pad edits can still cancel pad voices as before, but starting a performance must not reset or cancel SEQ origins or voices. Velocity multiplies pad gain, never mutates pad level. Recorded note-offs close event metadata only.

## Recording/editing

MIDI REC temporarily routes live pointer/key/mapped-MIDI pad gestures to independent performance voices and the recorder. Generated SEQ output never reaches the recorder. Keyboard repeat is ignored; note-off, keyup and pointerup close durations. Gesture onset uses event timestamps converted to audio time. Overdub retains events; replace is an explicit take operation. One gesture/take is one undo command. Exact lane/onset collisions are prevented within the clip, not across playback sources. Grid painting uses cell membership; OFF permits fractional onset editing.

## Persistence and compatibility

Portable version-1 GMC project is JSON containing pad settings, base64 WAV assets keyed by SHA-256, clip and transport/effect settings. Float32 WAV export preserves decoded channel PCM, including imported and recorded audio, without an external compression dependency. Files are larger than compressed archives but portable. Load validates/hashes/decodes into staging before changing live state. Existing GMC settings JSON imports as a non-destructive legacy settings overlay, leaving current audio intact. Browser MIDI mapping storage is not replaced. Unknown future versions are rejected.

IndexedDB stores immutable complete project snapshots. Autosave keeps previous recovery data; recovery is explicit, not an automatic overwrite at startup. Quota/errors are visible, and export remains available. Audio data is local only. This version stores complete snapshots, not incremental asset records; very large projects have memory/storage limits.

## Review boundaries

Implementation stays on feature/midi-lane-editor. No merge into main, deployment, other-instrument modification, gated playback, external MIDI output or SEQ-to-clip recording. Real DM-848 clock integration requires a separately verified adapter and integration tests.
