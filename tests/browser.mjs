import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const results = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  results.push(name);
};
try {
  await page.goto("http://127.0.0.1:5173");
  await page.waitForSelector(".pad");
  check(
    "Nine pads in reference order",
    await page
      .locator("[data-trigger]")
      .evaluateAll(
        (els) =>
          els.map((e) => e.dataset.trigger).join(",") === "6,7,8,3,4,5,0,1,2",
      ),
  );
  // Real mono and stereo PCM WAVs, with distinct durations and pitches.
  function wav(seconds, channels = 1) {
    const rate = 44100,
      n = Math.round(seconds * rate),
      b = Buffer.alloc(44 + n * channels * 2);
    b.write("RIFF");
    b.writeUInt32LE(b.length - 8, 4);
    b.write("WAVEfmt ", 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(channels, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * channels * 2, 28);
    b.writeUInt16LE(channels * 2, 32);
    b.writeUInt16LE(16, 34);
    b.write("data", 36);
    b.writeUInt32LE(n * channels * 2, 40);
    for (let i = 0; i < n; i++)
      for (let c = 0; c < channels; c++)
        b.writeInt16LE(
          Math.round(
            Math.sin((i / rate) * Math.PI * 2 * (440 + c * 110)) *
              0.23 *
              (0.2 + 0.8 * Math.abs(Math.sin(i * 0.00041))) *
              32767,
          ),
          44 + (i * channels + c) * 2,
        );
    return b;
  }
  await page.locator("#file").setInputFiles([
    { name: "Forest Ambience.wav", mimeType: "audio/wav", buffer: wav(0.2) },
    { name: "Rain Texture.wav", mimeType: "audio/wav", buffer: wav(0.35, 2) },
  ]);
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("WAV LOADED"),
  );
  check(
    "WAV import and stereo decoding",
    await page.evaluate(async () => {
      const { pads } = await import(
        performance
          .getEntriesByType("resource")
          .find((r) => new URL(r.name).pathname === "/src/state.ts").name
      );
      return (
        pads[0].buffer.numberOfChannels === 1 &&
        pads[1].buffer.numberOfChannels === 2 &&
        pads[1].name === "Rain Texture"
      );
    }),
  );
  await page.evaluate(async () => {
    const { engine } = await import(
      performance
        .getEntriesByType("resource")
        .find((r) => new URL(r.name).pathname === "/src/audio/engine.ts").name
    );
    const { pads } = await import(
      performance
        .getEntriesByType("resource")
        .find((r) => new URL(r.name).pathname === "/src/state.ts").name
    );
    window.testEngine = engine;
    window.testPads = pads;
    const analyser = engine.context.createAnalyser();
    analyser.fftSize = 2048;
    engine.master.connect(analyser);
    window.testAnalyser = analyser;
    for (let i = 0; i < 9; i++) {
      if (i > 1) {
        pads[i].buffer = pads[i % 2].buffer;
      }
      pads[i].play = 1;
      pads[i].rest = 1;
      pads[i].armed = true;
    }
    await engine.play();
  });
  await page.waitForTimeout(70);
  check(
    "All nine audio engines produce overlapping voices",
    await page.evaluate(
      () => new Set(window.testEngine.voices.map((v) => v.pad)).size === 9,
    ),
  );
  async function rms() {
    return page.evaluate(() => {
      const a = window.testAnalyser,
        d = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    });
  }
  check("Actual mixed audio output is nonzero", (await rms()) > 0.01);
  await page.waitForTimeout(170);
  check(
    "Independent PLAY / REST phases",
    await page.evaluate(
      () =>
        !window.testEngine.phase(0).audible &&
        window.testEngine.phase(1).audible,
    ),
  );
  await page.click("#pause");
  const paused = await page.evaluate(
    () => window.testEngine.context.currentTime,
  );
  await page.waitForTimeout(160);
  check(
    "Pause freezes audio clock",
    await page.evaluate(
      (t) =>
        window.testEngine.status === "paused" &&
        Math.abs(window.testEngine.context.currentTime - t) < 0.005,
      paused,
    ),
  );
  await page.click("#play");
  await page.waitForTimeout(80);
  check(
    "Resume advances preserved clock",
    await page.evaluate(
      (t) => window.testEngine.context.currentTime > t + 0.04,
      paused,
    ),
  );
  await page.click("#stop");
  check(
    "Stop clears voices and resets cycles",
    await page.evaluate(
      () =>
        window.testEngine.voices.length === 0 &&
        window.testEngine.origins.size === 0 &&
        window.testEngine.status === "stopped",
    ),
  );
  await page.click('[data-rnd="0"]');
  check(
    "RND counts in range and audio preserved",
    await page.evaluate(() => {
      const p = window.testPads[0];
      return (
        p.play >= 1 &&
        p.play <= 20 &&
        p.rest >= 0 &&
        p.rest <= 20 &&
        p.buffer &&
        p.speed === 1 &&
        p.level === 0.75
      );
    }),
  );
  // Capture the actual worklet processor output using the same shipped source in a VM.
  const { runInNewContext } = await import("node:vm");
  let Processor;
  runInNewContext(await fs.readFile("public/crusher.js", "utf8"), {
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port = {};
    },
    registerProcessor: (_, P) => (Processor = P),
  });
  const proc = new Processor();
  const input = Float32Array.from(
    { length: 128 },
    (_, i) => Math.sin(i * 0.213) * 0.7,
  );
  const output = [new Float32Array(128)];
  proc.port.onmessage({ data: { rate: 6000, bits: 4 } });
  proc.process([[input]], [output]);
  check(
    "Worklet bit depth quantizes real PCM",
    output[0].every((x) => Math.abs(x * 8 - Math.round(x * 8)) < 1e-6),
  );
  check(
    "Worklet sample reduction holds values",
    output[0].slice(1).filter((x, i) => x === output[0][i]).length > 90,
  );
  check(
    "Degradation changes the signal",
    output[0].some((x, i) => Math.abs(x - input[i]) > 0.1),
  );
  await page.click("#delay-on");
  await page.click("#reverb-on");
  await page.waitForTimeout(100);
  check(
    "Effect switches set live audio gains",
    await page.evaluate(
      () =>
        window.testEngine.delayWet.gain.value > 0 &&
        window.testEngine.reverbWet.gain.value > 0,
    ),
  );
  check(
    "Delay and reverb produce actual audio tails",
    await page.evaluate(async () => {
      const { createEffects } = await import("/src/audio/effects.ts");
      for (const kind of ["delay", "reverb"]) {
        const c = new OfflineAudioContext(2, 48000, 48000),
          input = c.createGain(),
          output = c.createGain();
        output.connect(c.destination);
        const fx = createEffects(c, input, output);
        fx[kind + "Wet"].gain.value = 0.6;
        const source = c.createBufferSource();
        const b = c.createBuffer(1, 2400, 48000);
        for (let i = 0; i < 2400; i++)
          b.getChannelData(0)[i] = Math.sin(i * 0.09) * 0.3;
        source.buffer = b;
        source.connect(input);
        source.start();
        const rendered = await c.startRendering();
        const data = rendered.getChannelData(0);
        const start = kind === "delay" ? 14880 : 4800;
        let energy = 0;
        for (let i = start; i < start + 2400; i++) energy += data[i] * data[i];
        if (energy < 0.001) return false;
      }
      return true;
    }),
  );
  check(
    "Trim, rate, reverse and independent trigger affect the playback engine",
    await page.evaluate(async () => {
      const e = window.testEngine,
        p = window.testPads[0];
      p.start = 0.25;
      p.end = 0.75;
      p.speed = 2;
      p.reverse = true;
      const cycleBefore = e.origins.get(0);
      await e.trigger(0, true);
      const v = e.voices.find((v) => v.pad === 0);
      const original = p.buffer.getChannelData(0),
        reversed = v.source.buffer.getChannelData(0);
      const ok =
        Math.abs(v.end - v.start - 0.05) < 0.0001 &&
        v.source.playbackRate.value === 2 &&
        reversed[0] === original[original.length - 1] &&
        e.origins.get(0) === cycleBefore;
      await e.stop();
      p.start = 0;
      p.end = 1;
      p.speed = 1;
      p.reverse = false;
      return ok;
    }),
  );
  await page.evaluate(() => {
    for (let i = 0; i < 9; i++) {
      window.testPads[i].armed = false;
      const counts = [
        [8, 12],
        [4, 6],
        [16, 3],
        [2, 18],
        [10, 10],
        [7, 20],
        [12, 4],
        [6, 16],
        [14, 8],
      ];
      window.testPads[i].play = counts[i][0];
      window.testPads[i].rest = counts[i][1];
    }
    window.testPads[0].play = 8;
    window.testPads[0].rest = 12;
  });
  await page.click("#right");
  await page.click("#left");
  await page.addStyleTag({
    content:
      ".machine{transform:scale(1)!important}.viewport{width:1536px!important;height:1024px!important;margin:0}footer{display:none}body{display:block}",
  });
  await page.locator(".machine").screenshot({ path: "artifacts/GMC-9000.png" });
  await page.setViewportSize({ width: 1024, height: 768 });
  check(
    "Canvas retains 3:2 ratio at smaller size",
    await page.locator(".machine").evaluate((e) => {
      const r = e.getBoundingClientRect();
      return Math.abs(r.width / r.height - 1.5) < 0.001;
    }),
  );
  await page.setViewportSize({ width: 1536, height: 1024 });
  check("No browser runtime errors", errors.length === 0);
  await fs.writeFile(
    "artifacts/browser-results.json",
    JSON.stringify({ passed: results, errors }, null, 2),
  );
  console.log(results.map((x) => "PASS " + x).join("\n"));
} finally {
  await browser.close();
}
