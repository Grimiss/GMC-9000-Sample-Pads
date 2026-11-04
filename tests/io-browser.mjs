import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const wav = Buffer.alloc(44 + 44100 * 4);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24);
wav.writeUInt32LE(88200, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 88200; i++)
  wav.writeInt16LE(
    Math.round(Math.sin((i / 44100) * Math.PI * 880) * 8000),
    44 + i * 2,
  );
const fake = "/tmp/gmc-input-test.wav";
await fs.writeFile(fake, wav);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${fake}`,
  ],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const passed = [];
function check(name, value) {
  assert.ok(value, name);
  passed.push(name);
}
try {
  await page.addInitScript(() => {
    const input = { id: "test-controller", onmidimessage: null };
    window.midiTestInput = input;
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: async () => ({
        inputs: new Map([["test-controller", input]]),
        onstatechange: null,
      }),
    });
  });
  await page.goto("http://127.0.0.1:5173");
  await page.waitForSelector(".pad");
  await page.evaluate(async () => {
    const resource = (p) =>
      performance
        .getEntriesByType("resource")
        .find((r) => new URL(r.name).pathname === p).name;
    window.testPads = (await import(resource("/src/state.ts"))).pads;
    window.testEngine = (await import(resource("/src/audio/engine.ts"))).engine;
  });
  check(
    "All nine synthesized test samples contain audio",
    await page.evaluate(() =>
      window.testPads.every(
        (p) =>
          p.buffer?.duration > 1 &&
          p.buffer.getChannelData(0).some((x) => Math.abs(x) > 0.01),
      ),
    ),
  );
  await page.click('[data-trigger="0"]');
  await page.click("#stop");
  for (let i = 1; i <= 9; i++) {
    await page.evaluate(
      (i) =>
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            code: `Numpad${i}`,
            key: "End",
            bubbles: true,
          }),
        ),
      i,
    );
    await page.waitForTimeout(35);
    check(
      `Numpad ${i} triggers pad ${i}`,
      await page.evaluate(
        (i) => window.testEngine.voices.some((v) => v.pad === i - 1),
        i,
      ),
    );
    await page.click("#stop");
  }
  await page.click("#menu");
  await page.click("#devices");
  await page.waitForFunction(
    () => document.querySelector("#audio-input").options.length > 1,
  );
  await page.click("#input-connect");
  await page.waitForFunction(() =>
    document
      .querySelector("#io-status")
      .textContent.includes("INPUT CONNECTED"),
  );
  check(
    "Input monitoring starts off",
    !(await page.locator("#monitor").isChecked()),
  );
  if (!(await page.locator("#audio-output").isDisabled())) {
    await page.selectOption("#audio-output", "");
    await page.waitForFunction(
      () =>
        document.querySelector("#io-status").textContent ===
        "AUDIO OUTPUT SELECTED",
    );
    check("Browser audio output selection succeeds", true);
  } else
    check(
      "Unsupported output selection has a visible Windows fallback",
      await page
        .locator("#output-support")
        .textContent()
        .then((x) => x.includes("Windows")),
    );
  await page.getByText("BACK TO SAMPLER", { exact: true }).click();
  await page.click("#rec");
  await page.waitForFunction(() =>
    document.querySelector("#rec").classList.contains("recording"),
  );
  await page.waitForTimeout(450);
  await page.click("#rec");
  await page.waitForFunction(
    () => !document.querySelector("#rec").classList.contains("recording"),
  );
  check(
    "AudioWorklet records real input PCM into selected pad",
    await page.evaluate(() => {
      const b = window.testPads[8].buffer;
      return (
        window.testPads[8].name === "Recording 9" &&
        b.duration > 0.2 &&
        b.getChannelData(0).some((x) => Math.abs(x) > 0.01)
      );
    }),
  );
  await page.click('[data-trigger="8"]');
  await page.waitForTimeout(60);
  check(
    "Recorded audio plays through sampler output",
    await page.evaluate(() =>
      window.testEngine.voices.some((v) => v.pad === 8),
    ),
  );
  await page.click("#stop");
  await page.click("#menu");
  await page.click("#midi-connect");
  await page.selectOption("#midi-target", "pad:2");
  await page.click("#midi-learn");
  await page.evaluate(() =>
    window.midiTestInput.onmidimessage({
      data: new Uint8Array([144, 60, 100]),
    }),
  );
  check(
    "MIDI note learns pad mapping",
    await page
      .locator("#midi-status")
      .textContent()
      .then((x) => x.includes("Learned pad:2")),
  );
  await page.evaluate(() =>
    window.midiTestInput.onmidimessage({
      data: new Uint8Array([144, 60, 100]),
    }),
  );
  await page.waitForTimeout(40);
  check(
    "Learned MIDI note triggers independent audio voice",
    await page.evaluate(() =>
      window.testEngine.voices.some((v) => v.pad === 2),
    ),
  );
  await page.selectOption("#midi-target", "master");
  await page.click("#midi-learn");
  await page.evaluate(() =>
    window.midiTestInput.onmidimessage({ data: new Uint8Array([176, 7, 10]) }),
  );
  await page.evaluate(() =>
    window.midiTestInput.onmidimessage({ data: new Uint8Array([176, 7, 64]) }),
  );
  await page.waitForTimeout(100);
  check(
    "Learned MIDI CC changes actual master gain",
    await page.evaluate(
      () => Math.abs(window.testEngine.master.gain.value - 0.5) < 0.1,
    ),
  );
  await page.reload();
  check(
    "MIDI mappings persist in browser",
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("gmc-midi")).length === 2,
    ),
  );
  check("No runtime errors", errors.length === 0);
  console.log(passed.map((x) => "PASS " + x).join("\n"));
  await fs.writeFile(
    "artifacts/io-results.json",
    JSON.stringify(
      {
        passed,
        errors,
        limitations: [
          "Physical Windows audio interface and physical MIDI hardware not available; capture uses Chromium fake WAV input and MIDI messages are simulated.",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await fs.rm(fake, { force: true });
}
