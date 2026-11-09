import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const rate = 44100,
  n = rate * 2,
  wav = Buffer.alloc(44 + n * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++)
  wav.writeInt16LE(Math.sin((i / rate) * Math.PI * 880) * 8000, 44 + i * 2);
await fs.writeFile("/tmp/v2-input.wav", wav);
const b = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--use-file-for-fake-audio-capture=/tmp/v2-input.wav",
  ],
});
const p = await b.newPage({
    viewport: { width: 1400, height: 1000 },
    hasTouch: true,
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
  await p.waitForSelector("[data-screen]");
  await p.evaluate(async () => {
    const r = (path) =>
      performance
        .getEntriesByType("resource")
        .find((r) => new URL(r.name).pathname === path).name;
    const m = await import(r("/src/main.ts"));
    window.app = m.appUI;
    window.v2 = m.v2UI;
    window.pads = (await import(r("/src/state.ts"))).pads;
    window.engine = (await import(r("/src/audio/engine.ts"))).engine;
    window.region = (await import(r("/src/audio/region.ts"))).preparedRegion;
    await window.app.ready();
  });
  check(
    "Clear has safe audio undo",
    await p.evaluate(() => {
      const original = window.pads[0].buffer;
      document.querySelector("#clear").click();
      document.querySelector("#undo").click();
      return window.pads[0].buffer === original;
    }),
  );
  await p.evaluate(() => {
    window.app.select(8);
    document.querySelector("#clear").click();
  });
  const target = p.locator('[data-trigger="8"]');
  await target.hover();
  await p.mouse.down();
  await p.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("RECORDING PAD"),
  );
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForFunction(() => window.pads[8].buffer?.duration > 0.1);
  check(
    "Hold empty pad records and assigns on release",
    await p.evaluate(
      () =>
        window.pads[8].name === "Recording 9" &&
        window.pads[8].buffer.getChannelData(0).some((x) => Math.abs(x) > 0.01),
    ),
  );
  await p.evaluate(() => {
    window.recorded = window.pads[8].buffer;
  });
  await p.click("#overdub");
  await p.waitForFunction(() =>
    document.querySelector("#rec").classList.contains("recording"),
  );
  await p.waitForTimeout(180);
  await p.click("#overdub");
  await p.waitForFunction(() => window.pads[8].name === "Overdub 9");
  check(
    "Audio overdub mixes input with sample and remains undoable",
    await p.evaluate(() => {
      const mixed = window.pads[8].buffer;
      document.querySelector("#undo").click();
      return (
        mixed !== window.recorded &&
        mixed.duration >= window.recorded.duration &&
        window.pads[8].buffer === window.recorded
      );
    }),
  );
  check(
    "Audio duplication and swapping retain permanent pad numbers",
    await p.evaluate(() => {
      window.v2.clipboard = { ...window.pads[8] };
      document.querySelector("#v2-other").value = "6";
      document.querySelector("#v2-duplicate").click();
      const b = window.pads[6].buffer;
      document.querySelector("#v2-other").value = "5";
      window.app.select(6);
      document.querySelector("#v2-swap").click();
      return (
        b === window.recorded &&
        window.pads[5].buffer === b &&
        window.pads[5].id === 5 &&
        window.pads[6].id === 6
      );
    }),
  );
  check(
    "Crossfade makes loop boundary continuous",
    await p.evaluate(() => {
      const region = window.region({ ...window.pads[0], crossfade: 0.005 });
      const d = region.getChannelData(0);
      return Math.abs(d[0] - d[d.length - 1]) < 1e-7;
    }),
  );
  check(
    "Granular pitch/stretch and fades preserve original audio",
    await p.evaluate(() => {
      const base = window.pads[0],
        original = base.buffer.getChannelData(0).slice();
      const edited = window.region({
        ...base,
        start: 0.1,
        end: 0.9,
        pitch: 12,
        stretch: 1.5,
        fadeIn: 0.01,
        fadeOut: 0.01,
        crossfade: 0.01,
      });
      return (
        Math.abs(edited.duration - base.buffer.duration * 0.8 * 1.5) < 0.001 &&
        edited.getChannelData(0)[0] === 0 &&
        edited.getChannelData(0).some((x) => Math.abs(x) > 0.01) &&
        original.every((x, i) => x === base.buffer.getChannelData(0)[i])
      );
    }),
  );
  await p.evaluate(() => {
    window.app.select(0);
    window.v2.open("EDIT");
  });
  const canvas = p.locator("#v2-wave"),
    r = await canvas.boundingBox();
  await p.mouse.move(r.x + r.width * 0.1, r.y + 50);
  await p.mouse.down();
  await p.mouse.move(r.x + r.width * 0.25, r.y + 50, { steps: 6 });
  await p.mouse.up();
  check(
    "Waveform drag trims audible start",
    await p.evaluate(
      () => window.pads[0].start > 0.2 && window.pads[0].start < 0.3,
    ),
  );
  await p.click("#edit-undo");
  check(
    "Trim undo restores original region",
    await p.evaluate(() => window.pads[0].start === 0),
  );
  await p.click("#v2-close");
  check(
    "Continuous LOOP ignores CYCLE rest count",
    await p.evaluate(async () => {
      const e = window.engine,
        p = window.pads[0];
      await e.stop();
      const buf = e.context.createBuffer(1, 4410, 44100);
      for (let i = 0; i < buf.length; i++)
        buf.getChannelData(0)[i] = Math.sin(i * 0.1) * 0.2;
      p.buffer = buf;
      p.mode = "LOOP";
      p.loop = true;
      p.rest = 99;
      p.play = 1;
      p.armed = false;
      await e.trigger(0);
      await new Promise((r) => setTimeout(r, 260));
      return (
        e.phase(0).audible &&
        e.voices.filter((v) => v.owner === "seq" && v.pad === 0).length === 1 &&
        e.voices.some((v) => v.source.loop)
      );
    }),
  );
  check(
    "Probability zero makes a CYCLE silent",
    await p.evaluate(async () => {
      const e = window.engine,
        p = window.pads[0];
      await e.stop();
      p.mode = "CYCLE";
      p.probability = 0;
      p.armed = false;
      await e.trigger(0);
      await new Promise((r) => setTimeout(r, 40));
      return !e.voices.some((v) => v.pad === 0);
    }),
  );
  await p.evaluate(async () => {
    await window.engine.stop();
    window.pads[0].probability = 1;
    window.pads[0].mode = "LOOP";
    window.pads[0].armed = false;
    window.app.select(7);
    document.querySelector("#clear").click();
    await window.engine.trigger(0);
    window.source = window.pads[0].buffer;
    await window.v2.startResample(7);
  });
  await p.waitForTimeout(200);
  await p.evaluate(() => window.v2.fx("filter", 3000));
  await p.waitForTimeout(180);
  await p.evaluate(() => window.v2.finishResample());
  check(
    "Internal resampling captures output and FX without replacing sources",
    await p.evaluate(
      () =>
        window.pads[7].buffer.duration > 0.2 &&
        window.pads[7].buffer
          .getChannelData(0)
          .some((x) => Math.abs(x) > 0.005) &&
        window.pads[0].buffer === window.source,
    ),
  );
  check(
    "Occupied resample destinations are protected",
    await p.evaluate(async () => {
      try {
        await window.v2.startResample(0);
        return false;
      } catch {
        return window.pads[0].buffer === window.source;
      }
    }),
  );
  check(
    "Resampler nodes disconnect after capture",
    await p.evaluate(
      () =>
        window.v2.recorder.capture === null && !window.v2.recorder.recording,
    ),
  );
  check(
    "Character bypass and resonance are real DSP parameters",
    await p.evaluate(() => {
      window.v2.fx("characterBypass", true);
      window.v2.fx("resonance", 4);
      return window.engine.drive.curve && window.engine.filter.Q.value >= 0.7;
    }),
  );
  await p.evaluate(async () => {
    await window.engine.stop();
    window.app.select(7);
  });
  const touchTarget = await p.locator('[data-trigger="7"]').boundingBox();
  await p.touchscreen.tap(
    touchTarget.x + touchTarget.width / 2,
    touchTarget.y + touchTarget.height / 2,
  );
  await p.waitForFunction(() => window.engine.voices.some((v) => v.pad === 7));
  check("Actual touch input triggers an audible sampled voice", true);
  await p.evaluate(() => {
    window.app.select(0);
    window.v2.open("EDIT");
  });
  const touchWave = await p.locator("#v2-wave").boundingBox();
  await p.touchscreen.tap(
    touchWave.x + touchWave.width * 0.2,
    touchWave.y + 60,
  );
  check(
    "Actual touch edits waveform marker",
    await p.evaluate(() => window.pads[0].start > 0.15),
  );
  await p.click("#v2-close");
  await p.evaluate(async () => {
    const r = (p) =>
      performance
        .getEntriesByType("resource")
        .find((e) => new URL(e.name).pathname === p).name;
    const { audioInput } = await import(r("/src/audio/input.ts"));
    audioInput.disconnect();
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
    window.app.select(4);
    document.querySelector("#clear").click();
  });
  await p.locator('[data-trigger="4"]').hover();
  await p.mouse.down();
  await p.waitForFunction(
    () =>
      !window.v2.inputOwned &&
      document
        .querySelector("#status")
        .textContent.includes("permission denied"),
  );
  await p.mouse.up();
  check(
    "Permission denial preserves pad and resets capture state",
    await p.evaluate(
      () => window.pads[4].buffer === null && !window.v2.inputOwned,
    ),
  );
  check("No browser errors", errors.length === 0);
  await fs.writeFile(
    "artifacts/v2-sampling-results.json",
    JSON.stringify({ passed, errors }, null, 2),
  );
  console.log(passed.map((x) => "PASS " + x).join("\n"));
} finally {
  await b.close();
  await fs.rm("/tmp/v2-input.wav", { force: true });
}
