# Web V2 initial verified audit and execution plan

Checkpoint tags: checkpoint/pre-web-v2-development-4c5e310 and checkpoint/pre-web-v2-editor-84f2422. Working branch feature/web-app-v2 is based on the existing MIDI-editor review branch, not on the deployment branch. No deployment is authorised by this work.

Read: state, main/interface/style/viewport, all audio nodes/worklets, MIDI learn, event core/editor, portable project/IndexedDB, docs and existing tests. Baseline build + 13 unit + 17 playback + 20 I/O + 22 editor checks passed before implementation (72 checks).

| Area | Verified existing | Partial/defective or missing |
|---|---|---|
| Sampling | WAV, stereo input PCM capture, monitoring, REC | Menu prerequisite; empty-pad hold absent; no audio-buffer undo |
| Edits | Original buffer retained, region/reverse/rate, waveform | No drag/zoom/fades/pitch/stretch/crossfade |
| Pads | Settings copy/paste, CLEAR | CLEAR destroys audio without undo; no audio copy/swap/export/drop |
| Playback | Independent one-shots, PLAY/REST, source ownership | UI LOOP means CYCLE; no distinct continuous LOOP, probability/every-N |
| DSP | Real worklet rate/bit reduction, delay/convolution reverb | Presets are simple rate/bit defaults, no bandwidth/saturation/amount/bypass/filter/stutter |
| Resampling | External input recorder | No output tap/capture |
| Events | Reusable core, nine lanes, record/overdub/velocity/duration/undo | FREE still BPM based; default quantization ON; no swing/pattern duplicate |
| Sessions | Version 1 embedded Float32 WAV + hashes; transactional load; IDB latest/previous; legacy overlay | No V2 modes, scenes, arrangement, automation |
| Songs/automation | None | Entire feature absent |
| Mobile | Uniform visible-viewport sizing, pointer-compatible pads | Small LCD editing; no contextual four-screen workflow |

Stage 1: extend immutable pad settings and audio history; prepared region DSP; true LOOP/CYCLE; character/performance graph; reuse PCM recorder for output resampling; contextual SAMPLE/EDIT/PLAY panels.
Stage 2: extend (do not replace) event core with seconds-based clips, musical internal/optional host timing, swing/duplicate; add automation and scene/song controller; SONG panel.
Stage 3: V2 portable project migrations, complete audio assets including scenes, real-time complete-output WAV export (existing worklet/effects graph, no omitted DSP), recovery/offline support, regression and resource tests.

Other Sound Factory repositories/components are not present. No speculative host protocol or imported DSP is claimed. Existing verified optional HostClock port is retained only. No Android work. Optional granular pitch/stretch will be labelled as granular rather than transparent studio-quality stretching. Full song export may use real-time capture to preserve all worklet/effect behavior.
