import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({
  viewport: { width: 1536, height: 1100 },
  acceptDownloads: true,
});
const errors = [],
  passed = [];
page.on("pageerror", (e) => errors.push(String(e)));
const check = (name, v) => {
  assert.ok(v, name);
  passed.push(name);
};
try {
  await page.addInitScript(() => {
    const input = { id: "test-midi", onmidimessage: null };
    window.fakeMidi = input;
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: async () => ({
        inputs: new Map([["test-midi", input]]),
        onstatechange: null,
      }),
    });
  });
  await page.goto("http://127.0.0.1:5173");
  await page.waitForSelector("#midi-edit");
  await page.evaluate(async () => {
    const resource = (p) =>
      performance
        .getEntriesByType("resource")
        .find((r) => new URL(r.name).pathname === p).name;
    window.session = (await import(resource("/src/main.ts"))).midiSession;
    window.padsTest = (await import(resource("/src/state.ts"))).pads;
    window.audio = (await import(resource("/src/audio/engine.ts"))).engine;
    window.projectModule = await import(resource("/src/project.ts"));
  });
  await page.click('[data-trigger="0"]');
  await page.waitForFunction(() => window.audio.origins.has(0));
  const origin = await page.evaluate(() => window.audio.origins.get(0));
  await page.click("#midi-rec");
  check(
    "MIDI REC has visible armed state",
    (await page.locator("#midi-rec").getAttribute("aria-pressed")) === "true",
  );
  await page.locator('[data-trigger="0"]').hover();
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  check(
    "Live pad recording layers without resetting PLAY/REST",
    await page.evaluate(
      (o) =>
        window.audio.origins.get(0) === o &&
        window.audio.voices.some((v) => v.owner === "seq") &&
        window.audio.voices.some((v) => v.owner === "performance") &&
        window.session.store.clip.events.length === 1,
      origin,
    ),
  );
  await page.keyboard.down("Numpad2");
  await page.waitForTimeout(65);
  await page.keyboard.up("Numpad2");
  check(
    "Key releases record note duration",
    await page.evaluate(() =>
      window.session.store.clip.events.some(
        (e) => e.lane === 1 && e.duration > 0,
      ),
    ),
  );
  await page.click("#menu");
  await page.click("#midi-connect");
  await page.selectOption("#midi-target", "pad:2");
  await page.click("#midi-learn");
  await page.evaluate(() =>
    window.fakeMidi.onmidimessage({ data: new Uint8Array([144, 60, 100]) }),
  );
  await page
    .locator("#menu-dialog")
    .getByText("BACK TO SAMPLER", { exact: true })
    .click();
  await page.evaluate(() =>
    window.fakeMidi.onmidimessage({ data: new Uint8Array([144, 60, 32]) }),
  );
  await page.waitForTimeout(60);
  await page.evaluate(() =>
    window.fakeMidi.onmidimessage({ data: new Uint8Array([128, 60, 0]) }),
  );
  check(
    "Mapped MIDI captures velocity and note-off without changing pad level",
    await page.evaluate(() => {
      const e = window.session.store.clip.events.find((e) => e.lane === 2);
      return (
        e &&
        Math.abs(e.velocity - 32 / 127) < 0.0001 &&
        e.duration > 0 &&
        window.padsTest[2].level === 0.75
      );
    }),
  );
  await page.click("#midi-rec");
  await page.click("#stop");
  await page.click("#midi-edit");
  await page.click("#clip-new");
  await page.selectOption("#clip-units", "beats");
  await page.selectOption("#clip-quantize", "1/16");
  await page.fill("#clip-length", "4");
  await page.locator("#clip-length").dispatchEvent("change");
  const canvas = page.locator("#lane-canvas");
  async function point(beat, row = 0) {
    const r = await canvas.boundingBox();
    return {
      x: r.x + ((210 + (beat / 4) * 990 + 5) / 1200) * r.width,
      y: r.y + ((32 + row * 62 + 30) / 590) * r.height,
    };
  }
  const a = await point(0),
    b = await point(0.75);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  check(
    "Dragging paints all traversed cells without duplicates",
    await page.evaluate(
      () =>
        window.session.store.clip.events.length === 4 &&
        new Set(
          window.session.store.clip.events.map((e) => e.lane + "/" + e.beat),
        ).size === 4,
    ),
  );
  await page.keyboard.down("Control");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  check(
    "Ctrl-drag erases triggers",
    await page.evaluate(() => window.session.store.clip.events.length === 0),
  );
  await page.click("#clip-undo");
  check(
    "One undo restores whole erased gesture",
    await page.evaluate(() => window.session.store.clip.events.length === 4),
  );
  await page.click("#clip-redo");
  check(
    "Redo restores erase",
    await page.evaluate(() => window.session.store.clip.events.length === 0),
  );
  const c = await point(1),
    d = await point(1.5, 1);
  await page.mouse.click(c.x, c.y);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y, { steps: 4 });
  await page.mouse.up();
  check(
    "Triggers move across time and pad lanes",
    await page.evaluate(() => {
      const e = window.session.store.clip.events[0];
      return e.lane === 7 && Math.abs(e.beat - 1.5) < 0.001;
    }),
  );
  await page.fill("#event-beat", "1.333");
  await page.locator("#event-beat").dispatchEvent("change");
  await page.locator("#event-velocity").evaluate((e) => {
    e.value = ".35";
    e.dispatchEvent(new Event("change", { bubbles: true }));
  });
  check(
    "Precise timing and velocity inspector works",
    await page.evaluate(() => {
      const e = window.session.store.clip.events[0];
      return e.beat === 1.333 && e.velocity === 0.35;
    }),
  );
  await page.evaluate(() => {
    window.padsTest[7].name = "Renamed Sample";
    window.session.refresh();
  });
  await page.screenshot({ path: "artifacts/MIDI-editor.png" });
  await page.selectOption("#clip-clock", "SYNC");
  await page.selectOption("#clip-source", "host");
  await page.click("#clip-play");
  await page.waitForTimeout(40);
  check(
    "SYNC without host visibly waits and produces no MIDI voices",
    await page.evaluate(
      () =>
        document
          .querySelector("#midi-transport-status")
          .textContent.includes("WAITING FOR HOST") &&
        !window.audio.voices.some((v) => v.owner === "midi"),
    ),
  );
  await page.click("#clip-stop");
  await page.selectOption("#clip-clock", "FREE");
  await page.selectOption("#clip-units", "beats");
  await page.selectOption("#clip-source", "internal");
  // Verify independent MIDI ownership and intentional overlap with existing sequencer.
  await page.evaluate(() => {
    window.session.store.clip.events = [
      { id: "both-event", lane: 0, beat: 0, originalBeat: 0, velocity: 0.2 },
    ];
    window.session.store.state.playbackMode = "BOTH";
    window.session.store.notify();
  });
  await page.click("#clip-play");
  await page.waitForTimeout(40);
  check(
    "BOTH retains coincident SEQ and MIDI voices with independent gains",
    await page.evaluate(
      () =>
        window.audio.voices.some((v) => v.owner === "seq" && v.pad === 0) &&
        window.audio.voices.some(
          (v) => v.owner === "midi" && v.pad === 0 && v.velocity === 0.2,
        ),
    ),
  );
  await page.click("#clip-pause");
  await page.waitForFunction(() => window.audio.status === "paused");
  check(
    "Pause retains active MIDI sample tail for resume",
    await page.evaluate(
      () =>
        window.audio.status === "paused" &&
        window.audio.voices.some((v) => v.owner === "midi"),
    ),
  );
  await page.click("#clip-play");
  check(
    "Resume retains the same MIDI tail",
    await page.evaluate(() =>
      window.audio.voices.some((v) => v.owner === "midi"),
    ),
  );
  await page.evaluate(async () => {
    const original = window.audio.voices.find((v) => v.owner === "midi");
    await window.audio.trigger(0);
    window.cycleIsolation = window.audio.voices.includes(original);
  });
  check(
    "Disarming a pad cycle does not cancel independent MIDI voices",
    await page.evaluate(() => window.cycleIsolation),
  );
  await page.click("#clip-stop");
  await page.evaluate(() => {
    window.session.store.state.quantization = "OFF";
    window.session.store.state.bpm = 137;
    window.session.store.clip.events[0].beat = 0.123456;
    window.session.store.clip.events[0].originalBeat = 0.123456;
    window.session.store.clip.events[0].duration = 1.234;
    window.padsTest[0].reverse = true;
    window.padsTest[0].start = 0.1;
    window.padsTest[0].end = 0.8;
    window.padsTest[0].play = 7;
  });
  await page.evaluate(async () => {
    const bytes = window.projectModule.wavBytes(window.padsTest[6].buffer);
    await window.audio.import(
      new File([bytes], "Imported Test.wav", { type: "audio/wav" }),
      6,
    );
  });
  const downloadPromise = page.waitForEvent("download");
  await page.click("#project-export");
  const download = await downloadPromise;
  const file = "/tmp/GMC-project-test.gmc";
  await download.saveAs(file);
  const portable = JSON.parse(await fs.readFile(file, "utf8"));
  check(
    "Portable export includes actual deduplicated hashed WAV audio",
    portable.version === 2 &&
      Object.keys(portable.assets).length > 0 &&
      portable.pads.every((p) => p.asset && portable.assets[p.asset]?.data),
  );
  await page.evaluate(async (p) => {
    window.savedProject = p;
    window.padsTest.forEach((p) => {
      p.buffer = null;
      p.name = "MISSING";
    });
    await window.session.load(p);
  }, portable);
  check(
    "Project load restores audio, assignments, edits, PLAY/REST and exact clip timing",
    await page.evaluate(
      () =>
        window.padsTest.every((p) => p.buffer?.length > 0) &&
        window.padsTest[7].name === "Renamed Sample" &&
        window.padsTest[6].name === "Imported Test" &&
        window.padsTest[0].reverse &&
        window.padsTest[0].start === 0.1 &&
        window.padsTest[0].play === 7 &&
        window.session.store.clip.events[0].beat === 0.123456 &&
        window.session.store.clip.events[0].duration === 1.234 &&
        window.session.store.clip.length === 4 &&
        window.session.store.state.bpm === 137 &&
        window.session.store.state.playbackMode === "BOTH" &&
        window.session.store.state.clockMode === "SYNC",
    ),
  );
  check(
    "Corrupt asset rejected atomically without changing current audio",
    await page.evaluate(async () => {
      const bad = structuredClone(window.savedProject),
        key = bad.pads[0].asset;
      bad.assets[key].data = "AAAA";
      const buffer = window.padsTest[0].buffer;
      try {
        await window.session.load(bad);
        return false;
      } catch {
        return window.padsTest[0].buffer === buffer;
      }
    }),
  );
  check(
    "Unknown future project version is rejected",
    await page.evaluate(async () => {
      try {
        await window.session.load({ ...window.savedProject, version: 99 });
        return false;
      } catch {
        return true;
      }
    }),
  );
  check(
    "Legacy settings import retains sample audio and MIDI mappings",
    await page.evaluate(async () => {
      const b = window.padsTest[0].buffer;
      const legacy = {
        product: "GMC-9000",
        pads: window.savedProject.pads.map(({ asset, ...p }) => p),
        ...window.savedProject.globals,
      };
      legacy.pads[0].name = "Legacy Name";
      await window.session.load(legacy);
      return (
        window.padsTest[0].buffer === b &&
        window.padsTest[0].name === "Legacy Name" &&
        JSON.parse(localStorage.getItem("gmc-midi")).length === 1
      );
    }),
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector("#project-status")
        .textContent.includes("autosaved"),
    { timeout: 15000 },
  );
  await page.reload();
  await page.waitForFunction(() =>
    document
      .querySelector("#project-status")
      .textContent.includes("Recovery available"),
  );
  await page.click("#midi-edit");
  await page.click("#project-recover");
  await page.waitForFunction(() =>
    document
      .querySelector("#project-status")
      .textContent.includes("Project loaded"),
  );
  check(
    "IndexedDB recovery restores sample audio after reload",
    await page.evaluate(async () => {
      const resource = (p) =>
        performance
          .getEntriesByType("resource")
          .find((r) => new URL(r.name).pathname === p).name;
      const { pads } = await import(resource("/src/state.ts"));
      return (
        pads[0].name === "Legacy Name" &&
        pads.every((p) => p.buffer?.length > 0)
      );
    }),
  );
  check("No browser runtime errors", errors.length === 0);
  await fs.writeFile(
    "artifacts/editor-results.json",
    JSON.stringify({ passed, errors }, null, 2),
  );
  console.log(passed.map((x) => "PASS " + x).join("\n"));
  await fs.rm(file, { force: true });
} finally {
  await browser.close();
}
