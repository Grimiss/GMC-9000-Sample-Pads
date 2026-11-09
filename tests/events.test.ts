import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClipStore,
  EventEngine,
  quantize,
  validateEvents,
} from "../src/events/core.ts";
function setup() {
  let time = 0;
  const notes: any[] = [],
    cancelled: string[] = [];
  const store = new ClipStore();
  store.state.timeBase = "beats";
  store.state.quantization = "1/16";
  store.state.clockSource = "host";
  store.state.playbackMode = "BOTH";
  const engine = new EventEngine(store, () => time, {
    trigger: (e) => notes.push(e),
    cancelOwner: (o) => cancelled.push(o),
  });
  return { store, engine, notes, cancelled, at: (t: number) => (time = t) };
}
test("quantization and precise OFF timestamps; no duplicate lane/onset", () => {
  assert.equal(quantize(0.37, "OFF"), 0.37);
  assert.equal(quantize(0.37, "1/16"), 0.25);
  for (const q of ["1/4", "1/8", "1/16", "1/32"] as const)
    assert.ok(Number.isFinite(quantize(0.124, q)));
  const s = new ClipStore();
  s.state.quantization = "OFF";
  s.checkpoint();
  assert.ok(s.add(0, 0.123456, 0.4));
  assert.equal(s.add(0, 0.123456), null);
  assert.ok(s.add(0, 0.123457));
  s.undo();
  assert.equal(s.clip.events.length, 0);
  s.redo();
  assert.equal(s.clip.events.length, 2);
});
test("independent one-shot scheduling, velocity and no repeat within lookahead", () => {
  const x = setup();
  x.store.add(0, 0, 0.25);
  x.store.add(1, 0.25, 0.7);
  x.engine.play();
  assert.equal(x.notes.length, 1);
  assert.equal(x.notes[0].velocity, 0.25);
  x.engine.tick();
  assert.equal(x.notes.length, 1);
  x.at(0.1);
  x.engine.tick();
  assert.equal(x.notes.length, 2);
  assert.equal(x.notes[1].when, 0.125);
  x.engine.tick();
  assert.equal(x.notes.length, 2);
});
test("loop occurrences, pause/resume, stop and missed intervals", () => {
  const x = setup();
  x.store.clip.length = 1;
  x.store.add(0, 0);
  x.engine.play();
  x.at(0.46);
  x.engine.tick();
  assert.equal(x.notes.length, 2);
  assert.equal(x.notes[1].when, 0.5);
  x.engine.pause();
  const paused = x.engine.snapshot().beat;
  x.at(8);
  assert.equal(x.engine.snapshot().beat, paused);
  x.engine.play();
  x.engine.stop();
  assert.equal(x.engine.snapshot().beat, 0);
  assert.ok(x.cancelled.every((o) => o === "midi"));
});
test("SYNC waits for optional clock; host revision invalidates; FREE independent", () => {
  const x = setup();
  x.store.add(0, 0);
  x.store.state.clockMode = "SYNC";
  x.engine.play();
  assert.equal(x.notes.length, 0);
  let beat = 0,
    revision = 0,
    running = true;
  x.engine.connectHost({
    snapshot: () => ({ beat, bpm: 120, running, revision }),
  });
  x.engine.tick();
  assert.equal(x.notes.length, 1);
  beat = 16;
  revision++;
  x.engine.tick();
  assert.equal(x.notes.length, 2);
  running = false;
  x.engine.tick();
  const n = x.notes.length;
  x.engine.connectHost(null);
  x.engine.tick();
  assert.equal(x.notes.length, n);
  x.engine.reanchor(() => (x.store.state.clockMode = "FREE"));
  assert.equal(x.engine.snapshot().running, true);
});
test("recording keeps raw onset, note durations, overdub; generated playback never records", () => {
  const x = setup();
  x.store.state.quantization = "OFF";
  x.engine.armed = true;
  x.at(0.001);
  x.engine.noteOn("a", 2, 0.4);
  x.at(0.2);
  x.engine.noteOff("a");
  assert.equal(x.store.clip.events.length, 1);
  assert.equal(x.store.clip.events[0].velocity, 0.4);
  assert.ok(Math.abs(x.store.clip.events[0].duration! - 0.398) < 1e-6);
  x.at(0.3);
  x.engine.noteOn("b", 3, 0.8);
  x.at(0.4);
  x.engine.noteOff("b");
  assert.equal(x.store.clip.events.length, 2);
  x.at(0.5);
  x.engine.tick();
  assert.equal(x.store.clip.events.length, 2);
});
test("recorded live trigger is not echoed by same-loop quantized clip playback", () => {
  const x = setup();
  x.engine.armed = true;
  x.engine.play();
  x.at(0.1);
  x.engine.noteOn("a", 0, 1);
  x.engine.tick();
  assert.equal(x.notes.length, 0);
  x.at(8.02);
  x.engine.tick();
  assert.equal(x.notes.length, 1);
});
test("SEQ suppresses MIDI scheduling; movement collision and transactional validation", () => {
  const x = setup();
  const a = x.store.add(0, 0)!,
    b = x.store.add(0, 1)!;
  assert.equal(x.store.move(a.id, 0, 1), false);
  assert.equal(x.store.move(a.id, 1, 0.333), true);
  x.store.state.playbackMode = "SEQ";
  x.engine.play();
  assert.equal(x.notes.length, 0);
  const valid = validateEvents(x.store.state, 9);
  assert.notEqual(valid, x.store.state);
  valid.clips[0].events.push({ ...b, id: "duplicate" });
  assert.throws(() => validateEvents(valid, 9), /Duplicate/);
});
test("two standalone instances retain independent loop lengths and clocks", () => {
  const a = setup(),
    b = setup();
  a.store.clip.length = 2;
  b.store.clip.length = 3;
  a.store.add(0, 0);
  b.store.add(0, 0);
  a.engine.play();
  b.engine.play();
  a.at(0.96);
  b.at(0.96);
  a.engine.tick();
  b.engine.tick();
  assert.equal(a.notes.length, 2);
  assert.equal(b.notes.length, 1);
});

test("no-op control commits preserve gesture undo and redo history", () => {
  const s = new ClipStore();
  s.update(() => {
    s.add(0, 0);
  });
  assert.equal(
    s.update(() => {}),
    false,
  );
  assert.equal(s.undoStack.length, 1);
  s.undo();
  assert.equal(s.clip.events.length, 0);
  s.update(() => {});
  assert.equal(s.redoStack.length, 1);
  s.redo();
  assert.equal(s.clip.events.length, 1);
});
test("local pause cancels queued MIDI starts only; stop cancels all owned voices", () => {
  let t = 0;
  const cancellations: { owner: string; after?: number }[] = [];
  const s = new ClipStore();
  s.state.playbackMode = "MIDI";
  s.add(0, 0);
  const e = new EventEngine(s, () => t, {
    trigger: () => {},
    cancelOwner: (owner, after) => cancellations.push({ owner, after }),
  });
  e.play();
  t = 0.1;
  e.pause();
  assert.equal(cancellations.at(-1)?.after, 0.1);
  e.play();
  assert.equal(cancellations.at(-1)?.after, 0.1);
  e.stop();
  assert.equal(cancellations.at(-1)?.after, undefined);
});
