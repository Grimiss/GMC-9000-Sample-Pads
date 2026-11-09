import type { Pad } from "../state";
const cache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
/** Cached, non-destructive windowed overlap-add. Granular pitch/stretch is intentionally audible. */
export function preparedRegion(p: Pad): AudioBuffer | null {
  const b = p.buffer;
  if (!b) return null;
  const pitch = p.pitch ?? 0,
    stretch = p.stretch ?? 1,
    fadeIn = p.fadeIn ?? 0,
    fadeOut = p.fadeOut ?? 0,
    crossfade = p.crossfade ?? 0;
  if (!pitch && stretch === 1 && !fadeIn && !fadeOut && !crossfade) return null;
  const key = JSON.stringify([
    p.start,
    p.end,
    p.reverse,
    pitch,
    stretch,
    fadeIn,
    fadeOut,
    crossfade,
  ]);
  let versions = cache.get(b);
  if (!versions) {
    versions = new Map();
    cache.set(b, versions);
  }
  const hit = versions.get(key);
  if (hit) return hit;
  const start = Math.floor(p.start * b.length),
    n = Math.max(1, Math.floor((p.end - p.start) * b.length)),
    length = Math.max(1, Math.round(n * stretch));
  const out = new AudioBuffer({
    length,
    numberOfChannels: b.numberOfChannels,
    sampleRate: b.sampleRate,
  });
  const ratio = 2 ** (pitch / 12),
    grain = Math.min(2048, Math.max(128, Math.floor(n / 4))),
    hop = Math.max(32, Math.floor(grain / 4));
  for (let c = 0; c < b.numberOfChannels; c++) {
    const input = b.getChannelData(c),
      data = out.getChannelData(c),
      weights = new Float32Array(length);
    const read = (pos: number) => {
      const x = Math.max(0, Math.min(n - 1, pos));
      const real = p.reverse ? start + n - 1 - x : start + x;
      const a = Math.floor(real),
        f = real - a;
      return (
        (input[a] ?? 0) * (1 - f) +
        (input[Math.min(b.length - 1, a + 1)] ?? 0) * f
      );
    };
    if (!pitch && stretch === 1) {
      for (let i = 0; i < length; i++) data[i] = read(i);
    } else
      for (let g = -grain; g < length; g += hop) {
        const center = (g + grain / 2) / stretch;
        for (let k = 0; k < grain; k++) {
          const i = g + k;
          if (i < 0 || i >= length) continue;
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (grain - 1));
          data[i] += read(center + (k - grain / 2) * ratio) * w;
          weights[i] += w;
        }
      }
    if (pitch || stretch !== 1)
      for (let i = 0; i < length; i++) data[i] /= weights[i] || 1;
    const overlap = Math.min(
      Math.floor(crossfade * b.sampleRate),
      Math.floor(length / 4),
    );
    if (overlap > 1) {
      const boundary = (data[0] + data[length - 1]) * 0.5;
      for (let i = 0; i < overlap; i++) {
        const t = 0.5 - 0.5 * Math.cos((Math.PI * i) / (overlap - 1)),
          a = data[i],
          z = data[length - 1 - i];
        data[i] = boundary * (1 - t) + a * t;
        data[length - 1 - i] = boundary * (1 - t) + z * t;
      }
    }
    for (let i = 0; i < length; i++) {
      const gain = Math.min(
        1,
        fadeIn ? i / (fadeIn * b.sampleRate) : 1,
        fadeOut ? (length - 1 - i) / (fadeOut * b.sampleRate) : 1,
      );
      data[i] *= Math.max(0, gain);
    }
  }
  if (versions.size >= 8) versions.delete(versions.keys().next().value!);
  versions.set(key, out);
  return out;
}

/** Render one edited pad region, without the global effects bus. Original buffer is untouched. */
export async function renderPad(p: Pad) {
  if (!p.buffer) throw new Error("Selected pad is empty");
  const buffer = preparedRegion({
    ...p,
    fadeIn: Math.max(p.fadeIn ?? 0, 1 / p.buffer.sampleRate),
  })!;
  const context = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(buffer.length / p.speed)),
    buffer.sampleRate,
  );
  const source = context.createBufferSource(),
    gain = context.createGain(),
    pan = context.createStereoPanner();
  source.buffer = buffer;
  source.playbackRate.value = p.speed;
  gain.gain.value = p.level;
  pan.pan.value = p.pan ?? 0;
  source.connect(gain);
  gain.connect(pan);
  pan.connect(context.destination);
  source.start();
  return context.startRendering();
}
