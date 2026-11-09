import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1450, height: 1100 } }),
  passed = [],
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const check = (s, v) => {
  assert.ok(v, s);
  passed.push(s);
};
try {
  await page.goto("http://127.0.0.1:5173");
  await page.waitForSelector("#quick-scene");
  await page.evaluate(async () => {
    const r = (p) =>
      performance
        .getEntriesByType("resource")
        .find((r) => new URL(r.name).pathname === p).name;
    const m = await import(r("/src/main.ts"));
    window.v2 = m.v2UI;
    window.app = m.appUI;
    window.model = await import(r("/src/v2/model.ts"));
    window.pads = (await import(r("/src/state.ts"))).pads;
    window.engine = (await import(r("/src/audio/engine.ts"))).engine;
    await window.app.ready();
  });
  check(
    "New patterns are seconds-based and unquantized",
    await page.evaluate(
      () =>
        window.app.midi.store.state.timeBase === "seconds" &&
        window.app.midi.store.state.quantization === "OFF",
    ),
  );
  await page.click("#midi-edit");
  await page.click("#clip-duplicate");
  check(
    "Pattern duplication retains separate identities",
    await page.evaluate(() => {
      const s = window.app.midi.store.state;
      return s.clips.length === 2 && s.clips[0].id !== s.clips[1].id;
    }),
  );
  await page.selectOption("#clip-units", "beats");
  await page.selectOption("#clip-source", "internal");
  await page.click("#clip-play");
  await page.waitForTimeout(40);
  check(
    "SYNC internal clock runs without a host",
    await page.evaluate(() => window.app.midi.timeline.snapshot().running),
  );
  await page.click("#clip-stop");
  await page.selectOption("#clip-units", "seconds");
  await page.click("#editor-close");
  await page.evaluate(async () => {
    window.pads[0].mode = "LOOP";
    window.pads[0].armed = false;
    await window.engine.trigger(0);
    window.origin = window.engine.origins.get(0);
    window.first = window.v2.song.capture();
  });
  check(
    "Scene capture does not interrupt the current loop",
    await page.evaluate(
      () =>
        window.engine.origins.get(0) === window.origin &&
        window.engine.voices.some((v) => v.pad === 0),
    ),
  );
  await page.evaluate(() => window.v2.song.apply(window.first));
  check(
    "Scene recall can retain loop phase",
    await page.evaluate(() => window.engine.origins.get(0) === window.origin),
  );
  check(
    "Scene capture and recall retain active one-shot samples",
    await page.evaluate(async () => {
      window.pads[1].mode = "ONE SHOT";
      await window.engine.trigger(1, true);
      const s = window.v2.song.capture();
      window.engine.cancel(1);
      window.v2.song.apply(s);
      return (
        s.active.includes(1) &&
        window.engine.voices.some((v) => v.pad === 1 && v.owner === "scene")
      );
    }),
  );
  await page.evaluate(() => {
    const s = window.model.studio;
    window.v2.song.automationRecording = true;
    window.v2.song.automationStart = window.engine.context.currentTime;
    window.v2.fx("filter", 1200);
    window.v2.fx("pitch", 3);
    window.v2.song.automationRecording = false;
  });
  check(
    "Effect movements record independently of sample audio",
    await page.evaluate(
      () =>
        window.model.studio.automation.events.some(
          (e) => e.parameter === "filter",
        ) &&
        window.model.studio.automation.events.some(
          (e) => e.parameter === "pitch",
        ) &&
        window.pads[0].buffer === window.first.pads[0].buffer,
    ),
  );
  await page.evaluate(() => {
    const a = window.model.studio.automation;
    a.length = 0.25;
    a.events = [{ id: "filter", parameter: "filter", time: 0.05, value: 850 }];
    a.enabled = true;
    window.v2.song.automationStart = window.engine.context.currentTime;
    window.v2.song.autoCursor = 0;
  });
  await page.waitForTimeout(170);
  check(
    "Automation playback reaches actual filter parameter",
    await page.evaluate(() => window.engine.filter.frequency.value < 1500),
  );
  await page.evaluate(() => {
    const studio = window.model.studio;
    studio.automation.enabled = false;
    window.first.duration = 0.25;
    window.first.continueLoops = true;
    window.second = window.v2.song.copy(window.first);
    window.second.id = "second";
    window.second.name = "Break";
    window.second.duration = 0.25;
    window.second.pads[0].level = 0.3;
    window.second.transition = "fade";
    window.second.fade = 0.05;
    studio.scenes.push(window.second);
    studio.arrangement = [
      { id: "a", scene: window.first.id, repeat: 2 },
      { id: "b", scene: "second", repeat: 1 },
    ];
    window.v2.song.changed();
  });
  await page.evaluate(() => window.v2.song.play());
  await page.waitForTimeout(100);
  await page.evaluate(() => window.v2.song.pause());
  const frozen = await page.evaluate(() => window.engine.context.currentTime);
  await page.waitForTimeout(150);
  check(
    "Song pause freezes audio and arrangement clock",
    await page.evaluate(
      (t) => window.engine.context.currentTime === t && window.v2.song.paused,
      frozen,
    ),
  );
  await page.evaluate(() => window.v2.song.pause());
  await page.waitForTimeout(850);
  check(
    "Song repeats and advances through all scenes then stops",
    await page.evaluate(
      () =>
        !window.v2.song.playing &&
        window.v2.song.index === 1 &&
        window.engine.status === "stopped",
    ),
  );
  check(
    "Scene level and crossfade settings applied",
    await page.evaluate(() => window.pads[0].level === 0.3),
  );
  await page.evaluate(() => window.v2.song.play());
  await page.waitForTimeout(60);
  await page.click("#stop");
  await page.waitForTimeout(400);
  check(
    "Hardware STOP prevents song scheduler restarting playback",
    await page.evaluate(
      () =>
        !window.v2.song.playing &&
        window.engine.status === "stopped" &&
        window.engine.voices.length === 0,
    ),
  );
  await page.evaluate(() => {
    window.v2.open("SONG");
    window.v2.song.refresh();
  });
  await page.screenshot({ path: "artifacts/V2-song.png" });
  await page.click("#v2-effects");
  await page.click("#fx-auto-rec");
  await page.waitForFunction(() => window.v2.song.automationRecording);
  await page.locator("#fx-delay-wet").evaluate((el) => {
    el.value = ".37";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.check("#fx-filterBypass");
  check(
    "Context FX wet and bypass controls apply and record automation",
    await page.evaluate(
      () =>
        window.app.midi.getGlobals().delayAmount === 0.37 &&
        window.model.studio.fx.filterBypass &&
        window.model.studio.automation.events.some(
          (e) => e.parameter === "global.delayAmount",
        ),
    ),
  );
  await page.click("#fx-auto-rec");
  await page.click("#fx-auto-stop");
  check(
    "Context FX automation stops cleanly",
    await page.evaluate(
      () =>
        !window.v2.song.automationRecording &&
        !window.model.studio.automation.enabled,
    ),
  );
  check("No runtime errors", errors.length === 0);
  await fs.writeFile(
    "artifacts/v2-song-results.json",
    JSON.stringify({ passed, errors }, null, 2),
  );
  console.log(passed.map((x) => "PASS " + x).join("\n"));
} finally {
  await browser.close();
}
