# GMC-9000 — Initial Development Brief

Status: specification only; no DSP or UI code implemented.

## Naming
The supplied master specification says GMC-2000, but the approved image and repository use GMC-9000. GMC-9000 is the working product name.

## Identity and visual reference
Cream/beige rounded vintage sampler chassis; green monochrome LCD, large data wheel, nine black pads in 3×3 grid (07–09 top, 04–06 middle, 01–03 bottom), amber selected-pad outline. Preserve the supplied mockup as visual reference.

## Core functionality
- Nine independent WAV playback engines; mono/stereo, independent sample lengths and positions.
- One-shot or loop, reverse, start/end, speed/pitch, basic pitch-preserving stretch.
- Independent PLAY repetitions (1–99) and REST intervals (0–99), each REST interval equal to that pad's sample duration; no global BPM required.
- Per-pad RND generates fixed PLAY 1–20 and REST 0–20 defaults; never alters audio content.
- Waveform edit, copy/paste, undo/redo, overdub; preserve original imported files.
- Genuine sample-rate and bit-depth degradation with 80s/90s/00s presets; global delay and reverb.
- Play/pause/stop/record, per-pad levels, session save/load.

## Integration later
- FREE and SYNC first, LOCK later; shared transport but independent loop lengths.
- Accept independent external one-shot triggers from DS-9 without interrupting existing PLAY/REST cycles.
- Preserve standalone use and future Sound Factory routing.

## First implementation milestones
1. Choose Windows audio/UI stack and confirm build environment.
2. Implement nine independent sample playback/cycle state machines with tests.
3. Add WAV import, editing, degradation and effects DSP.
4. Build the hardware-inspired UI and connect every control to working audio.
5. Add session persistence, tests, and packaging.

See the user's master specification for complete details; this file is a condensed starting brief.
