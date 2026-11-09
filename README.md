# GRIMISS GMC-9000 V2

Standalone nine-pad sampling, independent PLAY/REST cycles, performance sequencing and scene-based song construction. The original hardware panel and sample architecture are retained.

**Development review build — not deployed.** Work is on `feature/web-app-v2`, based on the existing MIDI editor branch. Main and the deployment branch are unchanged.

See the [V2 operating guide](docs/V2-GUIDE.md), [implementation and validation report](docs/V2-IMPLEMENTATION.md), and [initial verified audit](docs/V2-AUDIT.md).

## Run

Use Node.js 22.18+ (validated with 24.22.1):

```sh
npm ci
npm run dev
```

Open the Vite URL in Chrome or Edge. Microphone/Web MIDI require HTTPS or localhost and browser permission; audio starts after a gesture. An already hosted build needs only a browser, with no software installation. No audio is uploaded. Fonts, test samples and worklets are bundled.

## Build and verify

```sh
npm run build
npm test
```

Browser tests require Chromium at `/usr/bin/chromium`, Vite on port 5173, and the production preview on 4173 for offline checks. In separate terminals run `npm run dev` and `npm run preview -- --port 4173`, then `npm run test:all`. Tests use simulated input/MIDI plus actual browser Web Audio processing. Human listening and physical interface/controller checks remain necessary.

## Quick workflow

Select SAMPLE to record/import → EDIT to trim, pitch, stretch and fade → PLAY to layer ONE SHOT, LOOP or CYCLE pads → FX to manipulate/resample → CAPTURE SCENE → SONG to arrange and export stereo WAV. SAVE exports a complete portable project including audio; Shift+SAVE retains legacy settings export. Export a project as a durable backup even when IndexedDB autosave is available.

No Android packaging, external MIDI output, gated playback or integration with another instrument is included.
