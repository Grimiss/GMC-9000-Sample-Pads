import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
function crusher() {
  let Processor: any;
  const sandbox: any = {
    sampleRate: 48000,
    currentTime: 0,
    AudioWorkletProcessor: class {
      port: any = {};
    },
    registerProcessor: (_: string, p: any) => (Processor = p),
  };
  runInNewContext(readFileSync("public/crusher.js", "utf8"), sandbox);
  const p = new Processor();
  return {
    p,
    sandbox,
    run: (data: Float32Array) => {
      const out = [new Float32Array(data.length)];
      p.process([[data]], [out]);
      return out[0];
    },
  };
}
test("character bypass retains original PCM exactly", () => {
  const { p, run } = crusher();
  p.port.onmessage({ data: { rate: 1000, bits: 4, amount: 0 } });
  const input = Float32Array.from(
    { length: 1024 },
    (_, i) => Math.sin(i * 0.13) * 0.4,
  );
  assert.deepEqual(run(input), input);
});
test("stutter replays captured audio while incoming audio is silent", () => {
  const { p, run } = crusher();
  p.port.onmessage({
    data: { rate: 48000, bits: 24, amount: 0, stutterSeconds: 0.02 },
  });
  run(Float32Array.from({ length: 4096 }, (_, i) => Math.sin(i * 0.1) * 0.3));
  p.port.onmessage({ data: { stutter: true } });
  const a = run(new Float32Array(960)),
    b = run(new Float32Array(960));
  assert.ok(a.some((x) => Math.abs(x) > 0.1));
  assert.deepEqual(a, b);
});
test("scheduled worklet changes respect audio time", () => {
  const { p, sandbox, run } = crusher();
  p.port.onmessage({ data: { amount: 0, when: 1 } });
  run(new Float32Array(128));
  assert.equal(p.amount, 1);
  sandbox.currentTime = 1;
  run(new Float32Array(128));
  assert.equal(p.amount, 0);
});
