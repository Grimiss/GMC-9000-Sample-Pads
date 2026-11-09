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
