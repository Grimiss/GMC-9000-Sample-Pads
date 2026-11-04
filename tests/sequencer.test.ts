import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseAt, regionDuration, randomCounts } from "../src/state.ts";
test("five second sample: three plays then three rests", () => {
  for (const t of [0, 4.99, 5, 14.99, 30])
    assert.equal(phaseAt(t, 5, 3, 3).audible, true);
  for (const t of [15, 20, 29.99])
    assert.equal(phaseAt(t, 5, 3, 3).audible, false);
});
test("independent duration, trim, speed and zero rest", () => {
  assert.equal(regionDuration({ start: 0.25, end: 0.75, speed: 2 }, 8), 2);
  assert.equal(phaseAt(7, 2, 2, 2).audible, false);
  assert.equal(phaseAt(7, 5, 2, 2).audible, true);
  assert.equal(phaseAt(999, 1, 1, 0).audible, true);
});
test("random ranges include exact lower and upper limits", () => {
  assert.deepEqual(
    randomCounts(() => 0),
    { play: 1, rest: 0 },
  );
  assert.deepEqual(
    randomCounts(() => 0.999999),
    { play: 20, rest: 20 },
  );
  for (let i = 0; i < 1000; i++) {
    const r = randomCounts();
    assert.ok(r.play >= 1 && r.play <= 20 && r.rest >= 0 && r.rest <= 20);
  }
});
