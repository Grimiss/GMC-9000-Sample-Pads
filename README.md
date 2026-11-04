# GRIMISS GMC-9000 Sample Pads

A standalone desktop-browser loop sampler in TypeScript, Vite and Web Audio. Its uniformly scaled 1536 × 1024 hardware panel follows the approved reference. The original checkout contained only a one-line README; no `docs/DEVELOPMENT_BRIEF.md` was present.

## Run

Use Node.js 22.18+ (validated with 24.22.1).

```sh
npm ci
npm run dev
```

Open the development server in a desktop browser. Web Audio needs a secure context (localhost or HTTPS) and a user gesture. No accounts, API keys, backend, or external audio assets are required. Fonts are bundled with their license.

## Operate

- Select a pad with the cursor keys, then LOAD one or more mono/stereo WAV files. Multiple files fill successive pads, wrapping at nine. Samples stay in memory until the page closes; there is no artificial duration limit, but decoded audio uses RAM.
- Click a loaded pad or press 1–9 on the number row or numeric keypad (also with Num Lock off) to arm/disarm its independent loop. PLAY starts the armed pads, or all loaded pads when none are armed. Shift-click / Shift+number fires a separate one-shot over the existing cycle. LOOP switches the selected pad between cyclic and one-shot triggering.
- Set PLAY (1–99) and REST (0–99) on the LCD. A pad plays its edited region PLAY times, then rests REST region-length intervals. Each pad has its own duration and origin; no BPM or alignment. RND generates fixed PLAY 1–20 / REST 0–20 values. Click pad P/R fields to focus the corresponding LCD editor. Scroll the data wheel to change PLAY, or click it to select the next pad.
- PAUSE freezes the AudioContext, including effects and scheduled voices; PLAY resumes it. STOP cancels voices and resets cycle origins, retaining sample assignments and armed selections. Space toggles play/pause. Editing counts or region settings restarts that pad's cycle.
- START/END trim non-destructively. SPEED changes duration and pitch. F2 toggles reverse. The waveform shows region boundaries and playback position. MENU exposes the selected pad's independent level. The vertical fader controls master volume.
- 80s: 12 kHz / 10-bit; 90s: 22.05 kHz / 12-bit; 00s: 44.1 kHz / 16-bit. SR and BITS directly control the sample-and-hold / quantization AudioWorklet. They affect the mixed dry signal and effect sends.
- Delay and reverb each have ON and amount controls. Delay uses 310 ms with feedback; reverb uses a generated stereo impulse response.
- COPY/PASTE and UNDO/REDO cover pad settings, not audio buffers. CLEAR removes the selected sample immediately and cannot undo audio removal. SAVE exports settings JSON only; session/sample restoration is not implemented.

## Validation

```sh
npm run build
npm test
# With the Vite server running and Chromium installed:
npm run test:browser
```

The browser test uses `/usr/bin/chromium` (adjust the executable path on other systems), imports generated mono and stereo WAV files, verifies nine concurrent voices and nonzero rendered audio, independent PLAY/REST phases, pause/resume, stop/reset, random ranges, worklet PCM reduction, actual delay/reverb tails, trim/rate/reverse and independent triggering. It saves `artifacts/browser-results.json` and `artifacts/GMC-9000.png`. Automated signal checks do not substitute for human listening or long-duration background-tab testing.

## Source layout

- `src/state.ts`: pad state, settings snapshots, cycle math, random counts.
- `src/audio/engine.ts`: decoding, per-pad AudioBufferSource voices, independent audio-clock scheduling, transport and non-destructive region/reverse playback.
- `src/audio/effects.ts`: parallel delay and convolution reverb graph.
- `public/crusher.js`: audio-thread sample-rate and bit-depth reduction.
- `src/interface.ts`, `src/style.css`: physical panel markup and materials.
- `src/main.ts`: application events, selection, waveform, editing history and transport adapter.
- `docs/GEOMETRY.md`: coordinate map. `docs/DS9.md`: future link contract.

Scheduling uses a 25 ms look-ahead pump with audio-clock timestamps, never animation timing. A 120 ms queue provides foreground timing stability. Severe main-thread stalls or browser background suspension can cause missed intervals; late scheduling skips expired repetitions and resumes the current interval rather than accumulating drift. Dedicated audio-thread sequencing is a future hardening step. Browser audio buffers remain memory resident. There is no limiter; lower pad/master levels when summing loud samples.

## Reserved / incomplete

Overdub, pitch-preserving time stretch, destructive trim, audio-buffer undo, full session persistence and DS-9 connectivity are not implemented. OVERDUB and T-STR remain disabled or explicitly marked unavailable. Each pad starts with an original synthesized stereo test sample. LOAD replaces it with your own WAV. Windows packaging is not included; the application has no native/server dependency and can be packaged later.

## Audio interface recording and MIDI learn

Use Chrome or Edge over HTTPS for the broadest audio/MIDI support. No driver is installed by the app; Windows must already recognize your interface.

1. Open MENU → ENABLE AUDIO / REFRESH DEVICES and grant audio-input permission. Select the interface INPUT, then CONNECT INPUT. The browser may expose an interface as a stereo pair rather than all of its hardware channels.
2. Select OUTPUT to send the instrument to your interface. If the browser does not offer AudioContext output selection, select the interface in Windows Settings → System → Sound instead. The app reports this fallback in MENU. Input monitoring defaults to OFF; enable it with headphones when wanted. DISCONNECT INPUT releases the microphone/interface capture stream.
3. Close MENU, select a destination pad with the cursor controls, then press REC. Recording stops existing sampler playback and captures unprocessed input into that pad. Press REC again or STOP to finish; click the pad to play the recording through the sampler and chosen output. Selecting another pad during capture does not change the recording destination. Recordings are memory-resident and replace the destination sample when finished; reloading the page discards recordings and reloads test samples. SAVE still exports settings only.
4. MENU → CONNECT MIDI requests Web MIDI permission (no SysEx). Select a LEARN TARGET, press LEARN NEXT NOTE / CC, then play a note or move a controller. That message is used for learning only; subsequent messages control the target. Pad notes layer independent one-shots. CC pad triggers fire on the upward crossing of 64. MIDI note-off and note-on velocity zero do not trigger. Other learned targets adjust the selected pad's parameters or the global master/effect amounts. Effect ON switches still control whether wet effects are heard.
5. Mappings include the MIDI input device and channel, are saved locally in this browser, and can be removed with CLEAR MAPPINGS. Reconnect MIDI each browser session; use Learn again if device identifiers change. Newly attached devices are recognized after MIDI access is granted.

`npm run test:io` (with Vite running) verifies all nine demo samples, Numpad 1–9, real AudioWorklet PCM capture using a Chromium simulated WAV input, recorded playback, monitoring default, and MIDI note/CC learn using simulated MIDI messages. Results are saved in `artifacts/io-results.json`. Physical Windows interface routing, latency, monitoring and physical MIDI controllers require user testing. No permission is requested on page load, and no audio is uploaded.
