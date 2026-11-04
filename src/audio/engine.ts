import { createEffects } from "./effects";
import { pads, regionDuration, phaseAt } from "../state";
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
  end: number;
  pad: number;
}
/** AudioContext time is the sole transport clock. The timer only fills a look-ahead queue. */
export class Sampler {
  context!: AudioContext;
  master!: GainNode;
  crusher!: AudioWorkletNode;
  delay!: DelayNode;
  delayWet!: GainNode;
  reverbWet!: GainNode;
  status: "stopped" | "playing" | "paused" = "stopped";
  epoch = 0;
  elapsed = 0;
  voices: Voice[] = [];
  origins = new Map<number, number>();
  next = new Map<number, number>();
  timer = 0;
  async init() {
    if (this.context) {
      if (this.context.state === "suspended" && this.status !== "paused")
        await this.context.resume();
      return;
    }
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule("/crusher.js");
    const c = this.context;
    this.master = c.createGain();
    this.master.gain.value = 0.7;
    this.crusher = new AudioWorkletNode(c, "gmc-crusher");
    this.crusher.connect(this.master);
    this.master.connect(c.destination);
    Object.assign(this, createEffects(c, this.crusher, this.master));
    this.degrade(12000, 10);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  async import(file: File, id: number) {
    await this.init();
    const buffer = await this.context.decodeAudioData(await file.arrayBuffer());
    this.cancel(id);
    Object.assign(pads[id], {
      buffer,
      name: file.name.replace(/\.wav$/i, ""),
      start: 0,
      end: 1,
    });
    if (this.status !== "stopped" && pads[id].armed) this.resetPad(id);
  }
  async trigger(id: number, independent = false) {
    await this.init();
    if (this.status === "paused") await this.play();
    const p = pads[id];
    if (!p.buffer) return;
    if (independent || !p.loop) {
      if (this.status === "stopped") {
        this.status = "playing";
        this.epoch = this.context.currentTime;
      }
      this.voice(id, this.context.currentTime + 0.005, 0);
      return;
    }
    p.armed = this.status === "stopped" ? true : !p.armed;
    if (p.armed) {
      if (this.status === "stopped") {
        this.status = "playing";
        this.epoch = this.context.currentTime;
        this.elapsed = 0;
      }
      this.resetPad(id);
    } else {
      this.cancel(id);
      this.origins.delete(id);
      this.next.delete(id);
    }
    this.schedule();
  }
  async play() {
    await this.init();
    if (this.status === "paused") {
      await this.context.resume();
      this.status = "playing";
      return;
    }
    if (this.status === "playing") return;
    this.status = "playing";
    this.epoch = this.context.currentTime;
    this.elapsed = 0;
    const loaded = pads.filter((p) => p.buffer);
    if (!loaded.some((p) => p.armed)) loaded.forEach((p) => (p.armed = true));
    for (const p of loaded.filter((p) => p.armed)) this.resetPad(p.id);
    this.schedule();
  }
  async pause() {
    if (this.status !== "playing") return;
    await this.context.suspend();
    this.status = "paused";
  }
  async stop() {
    if (!this.context) return;
    this.voices.forEach((v) => {
      try {
        v.source.stop();
      } catch {}
    });
    this.voices = [];
    this.next.clear();
    this.origins.clear();
    this.elapsed = 0;
    this.status = "stopped";
    if (this.context.state === "suspended") await this.context.resume();
  }
  resetPad(id: number) {
    this.cancel(id);
    this.origins.set(id, this.context.currentTime + 0.01);
    this.next.set(id, 0);
  }
  changed(id: number) {
    if (this.status !== "stopped" && pads[id].armed) this.resetPad(id);
  }
  cancel(id: number) {
    for (const v of this.voices.filter((v) => v.pad === id)) {
      try {
        v.source.stop();
      } catch {}
    }
    this.voices = this.voices.filter((v) => v.pad !== id);
  }
  private voice(id: number, when: number, offset: number) {
    const p = pads[id];
    if (!p.buffer) return;
    const c = this.context;
    const source = c.createBufferSource();
    source.buffer = p.reverse ? this.reversed(p.buffer) : p.buffer;
    source.playbackRate.value = p.speed;
    const gain = c.createGain();
    gain.gain.value = p.level;
    source.connect(gain);
    gain.connect(this.crusher);
    const duration = (p.end - p.start) * p.buffer.duration;
    const start = (p.reverse ? 1 - p.end : p.start) * p.buffer.duration;
    source.start(
      when,
      start + offset * p.speed,
      Math.max(0.001, duration - offset * p.speed),
    );
    const v = {
      source,
      gain,
      start: when,
      end: when + duration / p.speed - offset,
      pad: id,
    };
    this.voices.push(v);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices = this.voices.filter((x) => x !== v);
    };
  }
  reversedCache = new WeakMap<AudioBuffer, AudioBuffer>();
  private reversed(buffer: AudioBuffer) {
    let r = this.reversedCache.get(buffer);
    if (!r) {
      r = this.context.createBuffer(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate,
      );
      for (let ch = 0; ch < buffer.numberOfChannels; ch++)
        r.getChannelData(ch).set(buffer.getChannelData(ch).slice().reverse());
      this.reversedCache.set(buffer, r);
    }
    return r;
  }
  schedule() {
    if (this.status !== "playing") return;
    const now = this.context.currentTime;
    for (const p of pads) {
      if (!p.buffer || !p.armed || !p.loop) continue;
      const origin = this.origins.get(p.id);
      if (origin === undefined) continue;
      const d = regionDuration(p, p.buffer.duration);
      let n = this.next.get(p.id) ?? 0;
      if (origin + n * d < now - 0.1) n = Math.floor((now - origin) / d);
      let guard = 0;
      while (origin + n * d < now + 0.12 && guard++ < 256) {
        const t = origin + n * d;
        if (n % (p.play + p.rest) < p.play) {
          const late = Math.max(0, now - t);
          if (late < d) this.voice(p.id, Math.max(now, t), late);
        }
        n++;
      }
      this.next.set(p.id, n);
    }
  }
  phase(id: number) {
    const p = pads[id],
      o = this.origins.get(id);
    if (!p.buffer || o === undefined || this.status === "stopped") return null;
    return phaseAt(
      this.context.currentTime - o,
      regionDuration(p, p.buffer.duration),
      p.play,
      p.rest,
    );
  }
  degrade(rate: number, bits: number) {
    this.crusher?.port.postMessage({ rate, bits });
  }
  volume(v: number) {
    if (this.master)
      this.master.gain.setTargetAtTime(v, this.context.currentTime, 0.01);
  }
  level(id: number, v: number) {
    pads[id].level = v;
    for (const voice of this.voices.filter((x) => x.pad === id))
      voice.gain.gain.setTargetAtTime(v, this.context.currentTime, 0.01);
  }
  effects(kind: "delay" | "reverb", on: boolean, amount: number) {
    const node = kind === "delay" ? this.delayWet : this.reverbWet;
    if (node)
      node.gain.setTargetAtTime(
        on ? amount : 0,
        this.context.currentTime,
        0.02,
      );
  }
}
export const engine = new Sampler();
