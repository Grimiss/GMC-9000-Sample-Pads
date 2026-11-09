import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const b = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const p = await b.newPage({
    viewport: { width: 1400, height: 1100 },
    acceptDownloads: true,
  }),
  passed = [],
  errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const check = (s, v) => {
  assert.ok(v, s);
  passed.push(s);
};
try {
  await p.goto("http://127.0.0.1:5173");
  await p.waitForSelector("#song-export", { state: "attached" });
  await p.evaluate(async () => {
    const r = (path) =>
      performance
        .getEntriesByType("resource")
        .find((e) => new URL(e.name).pathname === path).name;
    const m = await import(r("/src/main.ts"));
    window.app = m.appUI;
    window.v = m.v2UI;
    window.engine = (await import(r("/src/audio/engine.ts"))).engine;
    window.pads = (await import(r("/src/state.ts"))).pads;
    window.project = await import(r("/src/project.ts"));
    window.studio = (await import(r("/src/v2/model.ts"))).studio;
    await window.app.ready();
  });
  await p.evaluate(() => {
    const e = window.engine,
      rate = e.context.sampleRate,
      buf = e.context.createBuffer(2, Math.floor(rate * 0.12), rate);
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < buf.length; i++)
        buf.getChannelData(c)[i] =
          Math.sin((i / rate) * Math.PI * 2 * (440 + c * 110)) * 0.25;
    window.pads.forEach((p) => (p.armed = false));
    Object.assign(window.pads[0], {
      buffer: buf,
      name: "Original tone",
      mode: "LOOP",
      loop: true,
      armed: true,
      pan: -0.5,
      level: 0.7,
      pitch: 0,
      stretch: 1,
    });
    window.pads[1].mode = "ONE SHOT";
    window.app.midi.store.state.playbackMode = "BOTH";
    window.app.midi.store.clip.length = 0.3;
    window.app.midi.store.clip.events = [
      { id: "hit", lane: 1, beat: 0, originalBeat: 0, velocity: 0.35 },
    ];
    window.app.midi.setGlobals({
      sr: 26000,
      bits: 12,
      master: 0.6,
      delayOn: true,
      reverbOn: true,
      delayAmount: 0.15,
      reverbAmount: 0.1,
    });
    Object.assign(window.studio.fx, {
      filter: 3000,
      saturation: 0.15,
      bandwidth: 11000,
      delayTime: 0.04,
      delayFeedback: 0,
      stutter: false,
    });
    window.first = window.v.song.capture();
    window.first.duration = 0.3;
    window.first.continueLoops = false;
    window.second = window.v.song.copy(window.first);
    window.second.id = "second";
    window.second.name = "OUTRO";
    window.second.pads[0].pan = 0.8;
    window.second.fx.filter = 700;
    window.second.duration = 0.3;
    window.second.transition = "fade";
    window.second.fade = 0.05;
    window.second.automation = {
      length: 0.3,
      enabled: true,
      events: [{ id: "sweep", parameter: "filter", time: 0.05, value: 1400 }],
    };
    window.studio.scenes.push(window.second);
    window.studio.arrangement = [
      { id: "one", scene: window.first.id, repeat: 1 },
      { id: "two", scene: "second", repeat: 1 },
    ];
    window.v.song.changed();
    window.v.open("SONG");
  });
  check(
    "V2 project retains scene audio even after current assignment changes",
    await p.evaluate(async () => {
      const original = window.pads[0].buffer;
      window.pads[0].buffer = window.pads[2].buffer;
      const saved = await window.project.captureProject(
        window.app.midi.store.state,
        window.app.midi.getGlobals(),
      );
      window.saved = saved;
      const staged = await window.project.stageProject(
        saved,
        window.engine.context,
      );
      window.pads[0].buffer = original;
      return (
        saved.version === 2 &&
        staged.studio.scenes.length === 2 &&
        staged.studio.arrangement.length === 2 &&
        staged.studio.scenes[0].pads[0].buffer.length === original.length &&
        staged.studio.scenes[1].automation.events[0].value === 1400
      );
    }),
  );
  check(
    "V1 project migration preserves CYCLE and local beat timing",
    await p.evaluate(async () => {
      const old = structuredClone(window.saved);
      old.version = 1;
      delete old.studio;
      for (const p of old.pads) {
        delete p.mode;
        delete p.pitch;
        delete p.stretch;
      }
      delete old.midi.timeBase;
      delete old.midi.clockSource;
      old.midi.clockMode = "FREE";
      old.midi.quantization = "1/16";
      const s = await window.project.stageProject(old, window.engine.context);
      return (
        s.pads[0].mode === "CYCLE" &&
        s.midi.timeBase === "beats" &&
        s.midi.quantization === "1/16" &&
        s.studio.fx.saturation === 0
      );
    }),
  );
  check(
    "Invalid scene/automation rejects without mutating current state",
    await p.evaluate(async () => {
      const bad = structuredClone(window.saved);
      bad.studio.scenes[0].automation.events = [
        { id: "bad", parameter: "unknown", time: 0, value: 1 },
      ];
      const buffer = window.pads[0].buffer;
      try {
        await window.app.midi.load(bad);
        return false;
      } catch {
        return window.pads[0].buffer === buffer;
      }
    }),
  );
  const downloadPromise = p.waitForEvent("download", { timeout: 20000 });
  await p.click("#song-export");
  const download = await downloadPromise,
    file = "/tmp/GMC-V2-song.wav";
  await download.saveAs(file);
  await p.waitForFunction(() => !window.v.exporting, { timeout: 15000 });
  const bytes = await fs.readFile(file);
  check(
    "Full song export produces a real stereo Float32 WAV",
    bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.readUInt16LE(20) === 3 &&
      bytes.readUInt16LE(22) === 2,
  );
  const samples = (bytes.length - 44) / 8,
    rate = bytes.readUInt32LE(24),
    duration = samples / rate;
  check(
    "Export includes complete arrangement plus reverb tail",
    duration >= 2.7 && duration < 3.5,
  );
  let energy = [0, 0],
    peak = 0;
  for (let i = 0; i < samples; i++)
    for (let c = 0; c < 2; c++) {
      const x = bytes.readFloatLE(44 + (i * 2 + c) * 4);
      assert.ok(Number.isFinite(x));
      energy[c] += x * x;
      peak = Math.max(peak, Math.abs(x));
    }
  check(
    "Rendered samples, loops and effects have nonzero stereo output",
    energy[0] > 1 && energy[1] > 1 && Math.abs(energy[0] - energy[1]) > 1,
  );
  check(
    "Export restores original pads, scenes and capture resources",
    await p.evaluate(
      () =>
        window.pads[0].name === "Original tone" &&
        window.studio.scenes.length === 2 &&
        !window.v.recorder.recording &&
        window.v.recorder.capture === null,
    ),
  );
  await p.evaluate(() => {
    window.studio.scenes[0].duration = 8;
    window.v.song.changed();
  });
  await p.click("#song-export");
  await p.waitForFunction(
    () => window.v.exporting && window.v.recorder.recording,
  );
  await p.click("#song-export-cancel");
  await p.waitForFunction(() => !window.v.exporting);
  await p.waitForTimeout(100);
  check(
    "Cancel export releases recorder and restores complete session",
    await p.evaluate(
      () =>
        !window.v.recorder.recording &&
        window.v.recorder.capture === null &&
        !window.v.song.playing &&
        window.studio.scenes[0].duration === 8,
    ),
  );
  check(
    "Repeated start/stop cleans source voices",
    await p.evaluate(async () => {
      await window.engine.stop();
      const context = window.engine.context,
        create = context.createBufferSource.bind(context),
        traces = [];
      context.createBufferSource = () => {
        const source = create(),
          disconnect = source.disconnect.bind(source),
          trace = { disconnected: false };
        traces.push(trace);
        source.disconnect = (...args) => {
          trace.disconnected = true;
          return disconnect(...args);
        };
        return source;
      };
      for (let i = 0; i < 20; i++) {
        await window.engine.trigger(1, true);
        await window.engine.stop();
      }
      await new Promise((r) => setTimeout(r, 100));
      return (
        window.engine.voices.length === 0 &&
        window.engine.origins.size === 0 &&
        traces.length > 0 &&
        traces.every((t) => t.disconnected)
      );
    }),
  );
  await p.click("#v2-close");
  await p.click("#era80");
  check(
    "80s profile establishes bandwidth, saturation and 12-bit defaults",
    await p.evaluate(
      () =>
        Number(document.querySelector("#bits").value) === 12 &&
        Number(document.querySelector("#sr").value) === 26000 &&
        window.studio.fx.bandwidth === 10500 &&
        window.studio.fx.saturation > 0,
    ),
  );
  await p.click("#era90");
  check(
    "90s profile is 16-bit with subtle coloration",
    await p.evaluate(
      () =>
        Number(document.querySelector("#bits").value) === 16 &&
        window.studio.fx.bandwidth === 18500 &&
        window.studio.fx.saturation < 0.1,
    ),
  );
  await p.click("#era00");
  check(
    "00s profile supports clean native-rate 24-bit playback",
    await p.evaluate(
      () =>
        Number(document.querySelector("#bits").value) === 24 &&
        Number(document.querySelector("#sr").value) === 48000 &&
        window.studio.fx.saturation === 0,
    ),
  );
  check("No browser runtime errors", errors.length === 0);
  await fs.writeFile(
    "artifacts/v2-project-export-results.json",
    JSON.stringify(
      { passed, errors, wav: { duration, energy, peak, bytes: bytes.length } },
      null,
      2,
    ),
  );
  console.log(passed.map((x) => "PASS " + x).join("\n"));
  await fs.rm(file, { force: true });
} finally {
  await b.close();
}
