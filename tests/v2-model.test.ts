import { test } from "node:test";
import assert from "node:assert/strict";
import { modeOf, cycleAllowed, sceneSeconds } from "../src/v2/model.ts";
test("legacy loop flag migrates to CYCLE, not continuous LOOP", () => {
  assert.equal(modeOf({ loop: true }), "CYCLE");
  assert.equal(modeOf({ loop: false }), "ONE SHOT");
  assert.equal(modeOf({ loop: true, mode: "LOOP" }), "LOOP");
});
test("probability and every-N apply to whole PLAY/REST cycles", () => {
  assert.equal(
    cycleAllowed({ probability: 1, every: 3 }, 0, () => 0.5),
    true,
  );
  assert.equal(
    cycleAllowed({ probability: 1, every: 3 }, 1, () => 0.5),
    false,
  );
  assert.equal(
    cycleAllowed({ probability: 1, every: 3 }, 3, () => 0.5),
    true,
  );
  assert.equal(
    cycleAllowed({ probability: 0, every: 1 }, 0, () => 0),
    false,
  );
});
test("scene durations support seconds and bars", () => {
  assert.equal(
    sceneSeconds({ duration: 2, units: "bars", midi: { bpm: 120 } as any }),
    4,
  );
  assert.equal(
    sceneSeconds({
      duration: 17.25,
      units: "seconds",
      midi: { bpm: 20 } as any,
    }),
    17.25,
  );
});

import { ClipStore, EventEngine } from "../src/events/core.ts";
test("new FREE clips use seconds and ignore BPM; quantization defaults OFF", () => {
  let time = 0;
  const store = new ClipStore();
  assert.equal(store.state.quantization, "OFF");
  assert.equal(store.state.timeBase, "seconds");
  store.state.playbackMode = "MIDI";
  store.state.bpm = 300;
  const events: any[] = [];
  const player = new EventEngine(store, () => time, {
    trigger: (e) => events.push(e),
    cancelOwner: () => {},
  });
  store.add(0, 0.123456);
  player.play();
  time = 1;
  assert.equal(player.snapshot().beat, 1);
  store.state.bpm = 30;
  time = 2;
  assert.equal(player.snapshot().beat, 2);
  assert.equal(store.clip.events[0].beat, 0.123456);
});
test("SYNC internal tempo and swing schedule musical events on audio time", () => {
  let time = 0;
  const store = new ClipStore();
  Object.assign(store.state, {
    clockMode: "SYNC",
    clockSource: "internal",
    timeBase: "beats",
    bpm: 120,
    playbackMode: "MIDI",
    swing: 0.5,
  });
  store.add(0, 0.5);
  const events: any[] = [];
  const player = new EventEngine(store, () => time, {
    trigger: (e) => events.push(e),
    cancelOwner: () => {},
  });
  player.play();
  time = 0.26;
  player.tick();
  assert.equal(events.length, 1);
  assert.ok(Math.abs(events[0].when - 0.375) < 0.00001);
});
