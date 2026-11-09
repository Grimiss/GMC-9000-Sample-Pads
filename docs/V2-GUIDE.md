# GMC-9000 V2 operating guide

## Start and retain your work

Use the existing hardware panel or the SAMPLE / EDIT / PLAY / SONG strip. The panel scales to the visible viewport; contextual screens scroll independently. Nine demo samples are supplied. Number-row and numpad 1–9 trigger the matching permanent pad numbers; physical arrangement remains 7–9 / 4–6 / 1–3. Cursor controls select a pad without triggering it.

SAVE downloads a complete versioned project with actual audio. SAMPLE → LOAD PROJECT or MIDI EDIT imports it. Shift+SAVE and EXPORT LEGACY SETTINGS retain the old settings-only format. IndexedDB keeps latest/previous recovery records; older recovery data is protected until recovered or KEEP CURRENT is chosen. Browser storage can be evicted or fill up: portable exports are the durable backup. No sample is uploaded.

## Record, edit and manage pads

Clear a pad (undoable), then hold that empty hardware pad to record input; release to finish. Grant microphone permission if asked. On desktop, select a pad and press REC, then REC or STOP to finish. MENU selects interface/input/output and monitoring; monitoring defaults off. Browser/OS support determines available channels and output devices. OVERDUB records input over the selected sample; original audio is recoverable with UNDO.

SAMPLE offers WAV import, audio duplication/copy/swap, clear, edited WAV and original WAV export. Drop WAV files directly on hardware pads. Hardware COPY/PASTE still copies settings only. Audio copy/swap retains the permanent pad numbering. Undo retains original buffer references in memory.

EDIT provides draggable start/end markers, zoom/scroll, sample reverse, speed, independent pitch, granular stretch, fades and loop crossfade. Original samples remain intact. SPEED changes pitch and duration together; PITCH changes pitch independently; STRETCH changes duration independently using granular overlap-add. Granular processing can produce audible texture, particularly on transients; it is not transparent studio time stretching. Audition edits immediately; UNDO/REDO restores pad/audio edits.

## Playback and effects

ONE SHOT plays the region once. Retriggers can layer or replace within their source ownership. LOOP continuously repeats the selected region with native audio looping. CYCLE preserves independent sample-length-based PLAY/REST counts; probability and every-N affect complete cycles. Old loop-enabled projects become CYCLE, retaining their behaviour. Pad loops remain independent of musical BPM. Up to 128 voices are allowed; excess voices fade the oldest out.

Use hardware PLAY/PAUSE/STOP or Space. Shift+pad/number fires an independent performance hit. MIDI REC-armed pad/key/MIDI performances record into the clip without resetting existing CYCLE playback. Note durations are retained when available but do not gate sample playback. BOTH preserves intentional overlap between independent playback and event clips.

FX exposes character intensity/bypass, resonant filter/bypass, saturation, delay time/feedback/wet, reverb wet, stutter and pitch/reverse performance controls. Dry output remains present with delay/reverb wet sends. 80s selects 26 kHz/12-bit with darker bandwidth/saturation; 90s selects 44.1 kHz/16-bit and subtle colour; 00s selects 48 kHz/24-bit and clean saturation. SR/BITS remain adjustable. These are creative profiles. Reverse FX affects new voices; sample REV restarts an active pad with its reversed region.

RESAMPLE records the actual stereo output including effects and live movements. Select an **empty** destination, start capture, perform/play sources, then finish/assign. It never feeds the capture back into the output or overwrites occupied source pads. To capture one pad, stop other audible sources. Resample again to another empty pad for additional generations.

## Performance clips and automation

MIDI EDIT uses the existing nine named lanes. Paint triggers, Ctrl-drag erase, move events and edit velocity/exact timing. Sample names update with assignments. Quantization defaults OFF for new patterns. Duplicate patterns and set independent lengths. FREE lengths are seconds (60 seconds = one minute), independent of BPM; SYNC uses beats/tempo with swing and optional quantization. INTERNAL runs standalone; HOST requires an actual supplied clock. No other instrument runtime is required. Legacy clips retain their original timing.

SEQ / MIDI / BOTH selects independent pad cycles, event clips or both. MIDI recording records live performance, not the PLAY/REST output. Existing MIDI learn remains in MENU, with numeric FX targets added.

RECORD FX MOVEMENTS is available in FX and SONG. Choose automation loop seconds and overdub/replace in SONG; record movements, stop recording, then PLAY / LOOP. Automation is timestamped against audio time and stored separately from samples. STOP AUTOMATION disables it; CLEAR removes its events. Capturing a scene includes its automation.

## Scenes, songs and export

Build a performance, then CAPTURE SCENE without interrupting audio. SONG provides rename, duration (seconds or bars), duplicate/delete, recall and SAVE CURRENT CHANGES. Captures retain audio references, active pads, pad settings, patterns, effects, timing and automation. Changes after capture require SAVE CURRENT CHANGES. ADD TO SONG creates an arrangement entry. Drag entries to reorder, or use arrow buttons on touch; set repeats, remove or jump.

Choose immediate, next-bar, next-pad-cycle or crossfade transitions, with optional compatible-loop continuation. Bar duration follows each scene's captured tempo. Effects tails continue through the shared graph. SONG PLAY, PAUSE/RESUME, STOP, previous/next and loop scene/song control the arrangement. Hardware STOP also stops song scheduling.

EXPORT FULL STEREO WAV renders the arrangement once in real time using the actual audio graph; loop toggles are ignored and effect tails included. Keep the tab foreground. Input monitoring is muted during export; record external input to a pad first. Export restores the original project on completion/cancel. Long exports exceeding the 512 MiB capture budget are rejected before recording. Supplied-host scenes must be changed to INTERNAL for standalone export. WAV is stereo Float32; some older players may require conversion. Do not close the page during capture or restoration.

## Offline and remaining checks

Production builds cache the shell, bundled fonts and worklets after a successful online load. Reload once online before testing offline. Portable projects and browser recovery retain user audio separately. The development server does not install the service worker.

Chrome/Edge are the verified engine family. Physical interface routing, MIDI hardware, headphones/monitoring latency, Safari/iOS permissions, human audio quality, long background playback and memory endurance still need device testing. Browser background suspension can interrupt scheduling/export. No Android build, external MIDI output, gated playback, per-pad character engine or speculative Sound Factory host protocol is included.
