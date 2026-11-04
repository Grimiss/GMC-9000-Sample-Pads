import { pads } from "../state";
/** Original, deterministic synthesized test samples; no downloads or licensed recordings. */
export function loadDemoSamples() {
  for (const p of pads) {
    const rate = 44100,
      seconds = p.id === 3 ? 2.4 : 1.6;
    const b = new AudioBuffer({
      length: Math.floor(rate * seconds),
      numberOfChannels: 2,
      sampleRate: rate,
    });
    let seed = 7919 * (p.id + 1);
    for (let i = 0; i < b.length; i++) {
      const t = i / rate,
        fade = Math.min(1, t / 0.02, (seconds - t) / 0.08);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 4294967296) * 2 - 1;
      const base = [
        196, 293.66, 110, 523.25, 440, 164.81, 65.4, 261.63, 329.63,
      ][p.id];
      let v = 0;
      if (p.id === 0 || p.id === 1 || p.id === 4)
        v =
          noise * (p.id === 4 ? 0.12 : 0.22) +
          Math.sin(t * base * 6.283) * 0.04;
      else if (p.id === 3 || p.id === 7) {
        const a = t % (p.id === 3 ? 0.6 : 0.4);
        v =
          (Math.sin(t * base * 6.283) +
            0.35 * Math.sin(t * base * 2.01 * 6.283)) *
          Math.exp(-a * 7) *
          0.24;
      } else
        v =
          (Math.sin(t * base * 6.283) +
            0.3 * Math.sin(t * base * 1.503 * 6.283) +
            noise * 0.05) *
          (0.16 + 0.06 * Math.sin(t * 3));
      b.getChannelData(0)[i] = v * fade;
      b.getChannelData(1)[i] = v * fade * (0.9 + 0.1 * Math.sin(t * 2));
    }
    p.buffer = b;
  }
}
