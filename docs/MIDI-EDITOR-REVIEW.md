# GMC-9000 MIDI editor — review build

Branch: `feature/midi-lane-editor`. Nothing is merged to main or deployed. No DM-848, Microseq or DS-9 code is modified. Read EVENT-INTERFACE.md for the interface written before implementation and the unverified integration assumptions.

## Review workflow

Run `npm ci`, `npm run dev`, then use the existing sampler. The hardware canvas/pad layout is unchanged. A small strip below it adds MIDI REC, MIDI EDIT and SEQ/MIDI/BOTH. Audio REC still records the chosen audio input.

1. Start a pad's PLAY/REST cycle, then arm MIDI REC. Perform on pads or numeric keys. These create independent one-shots and record clip events without restarting the existing cycle. MIDI learn pad mappings work identically, with incoming velocity; note-off/key-up/pointer-up closes duration metadata. One-shots do not gate on note-off. Disarm before editing or switching takes.
2. Open MIDI EDIT. Lane order follows the physical reading order: 07/08/09, 04/05/06, 01/02/03. Permanent IDs remain independent of current sample names, which update on assignment changes. Empty pads show PAD n. No pitch axis is used.
3. Drag empty grid to paint. Ctrl-drag erases. Drag a trigger to move it, including to another lane. Use the event selector and beat/velocity fields for exact changes. The event list also provides a keyboard-accessible alternative to canvas selection. One drag is one undo operation; Undo/Redo cover MIDI clip/settings changes separately from existing pad-setting undo.
4. Recording quantization/snap: OFF, 1/4, 1/8, 1/16, 1/32. Original onset and duration remain in the data. Precise beat entry bypasses grid snap. QUANTIZE ORIGINAL TIMING reapplies the current division, retaining colliding events at their previous positions rather than deleting them. Grid collisions are prevented within a lane/clip; different playback sources intentionally layer.
5. Choose OVERDUB or REPLACE CLIP before arming. Replace clears the active clip within the take's undo checkpoint. Generated PLAY/REST repetitions are never recorded. NEW CLIP retains previous clips; each clip has its own length/name/events, with one active clip per sampler. Events beyond a shortened loop are retained and become audible again if length is increased.
6. SEQ plays existing PLAY/REST; MIDI plays the active clip; BOTH layers them. Manual input is still possible. MIDI mode mutes/cancels SEQ-owned voices while keeping pad configurations. Cycle origins/counters retain their independent sample-based timing. Starting/stopping a cycle does not cancel MIDI/performance voices. Explicit whole-pad operations such as CLEAR or replacing sample audio can cancel that pad's voices.
7. FREE uses local BPM and local transport. SYNC waits visibly for a supplied host clock. The current adapter is `midiSession.connectHostClock(clockOrNull)` exported from src/main.ts. The HostClock contract lives in src/events/core.ts. A future DM-848 adapter must map timestamps into this AudioContext's seconds and supply beat/BPM/running/revision. Host clock changes invalidate scheduled MIDI events. The host drives MIDI clips only; PLAY/REST remains independently sample-timed. No real host connection is implemented or claimed.

## Saving and recovery

The editor's EXPORT PROJECT + AUDIO creates portable `.gmc` JSON: versioned manifest, sample settings, sample audio encoded as lossless Float32 WAV, SHA-256 asset identifiers, all clips, raw/edited timings, velocities, durations, clip lengths, BPM, synchronization/playback mode and global effects/master settings. Duplicate sample buffers/content deduplicate in the asset table. Imported audio is retained as decoded PCM rather than original file metadata. Recorded audio is included the same way. No file paths or browser handles are required for restoration. Transport is stopped on load.

LOAD PROJECT accepts this format and the earlier `GMC-9000-settings.json`. A portable file is validated, integrity-checked and fully decoded before live pads change. Missing/corrupt samples and unknown versions reject the load. Legacy settings apply over current audio/MIDI clips; old settings-only exports cannot recover audio they never contained. Existing SAVE continues to export legacy settings, and LOAD continues to import WAVs. Browser MIDI mappings remain in their existing localStorage key.

IndexedDB autosaves complete projects approximately every four seconds after changes, except during an armed take or project operation. It retains a previous snapshot. Startup does not replace current pads automatically or overwrite existing recovery: open the editor to recover latest/previous, or explicitly KEEP CURRENT / ENABLE AUTOSAVE. This last option rotates the existing latest to previous on the next save. Errors are shown in project status; use portable export for durable backups. Finishing an audio recording before project load is required.

## Limits and deliberate exclusions

- No dependency on another instrument. The other codebases/shared packages were not available for verification; the generic core is reusable but not yet extracted into a published package or integrated with DM-848.
- No gated playback, external MIDI output, controller-automation recording, or recording of PLAY/REST output into clips.
- UI/voice/recording state is per standalone app instance. Two event-engine instances are unit-tested; a multi-instrument host embedding several GMC user interfaces is not implemented.
- Audio scheduling uses audio-clock timestamps with a 120 ms lookahead filled every 25 ms. Severe stalls/background suspension can miss intervals; this phase does not claim audio-thread sequencing or long-duration background reliability.
- Float32 WAV/base64 project export and full IndexedDB snapshots consume memory/storage. Large sample sets may exceed browser quotas; failures are surfaced. A compressed/streaming archive and incremental asset database are future improvements.
- One active MIDI clip per sampler; there is no song arranger, multi-clip launch matrix or editor zoom. Long clips remain editable through exact timing fields.
- Device hardware and actual DM-848 integration need user/integration testing. Automated MIDI input, host clock and recording input use controlled substitutes.

## Validation

Run:

```sh
npm run build
npm test
# With Vite running and /usr/bin/chromium available:
npm run test:browser
npm run test:io
npm run test:editor
```

Pure tests cover timing, quantization, collisions, undo/redo, recording duration, non-echoed live takes, optional host clock/revisions, loop boundaries, pause ownership and independent instances. Browser tests cover existing DSP/audio I/O plus real editor gestures, live pointer/key/mapped-MIDI recording over SEQ, velocity, SEQ/MIDI overlap, MIDI pause tails, pad-cycle source isolation, portable audio roundtrip, corrupted/future files, legacy data and IndexedDB recovery. Results are in artifacts/*-results.json. The editor screenshot is artifacts/MIDI-editor.png.
