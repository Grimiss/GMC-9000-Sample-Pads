import { preparedRegion } from "./region";
import { modeOf, cycleAllowed, studio, type FXState } from "../v2/model";
import { createEffects } from "./effects";
import { pads, regionDuration, phaseAt } from "../state";
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
  end: number;
  pad: number;
  owner: string;
  velocity: number;
  occurrence?: string;
  panner: StereoPannerNode;
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
  seqEnabled = true;
  output!: GainNode;
  limiter!: DynamicsCompressorNode;
  filter!: BiquadFilterNode;
  characterFilter!: BiquadFilterNode;
  drive!: WaveShaperNode;
  feedback!: GainNode;
  random = Math.random;
  private decisions = new Map<string, boolean>();
  cancelPlan: { when: number; fade: number } | null = null;
  sceneFade = new Map<number, { at: number; seconds: number }>();
  private initializing: Promise<void> | null = null;
  async init() {
    if (this.initializing) await this.initializing;
    if (!this.context) {
      this.initializing = this.createGraph();
      try {
        await this.initializing;
      } catch (e) {
        await (this.context as AudioContext | undefined)?.close();
        this.context = undefined as unknown as AudioContext;
        throw e;
      } finally {
        this.initializing = null;
      }
    }
    if (this.context.state === "suspended" && this.status !== "paused")
      await this.context.resume();
  }
  private async createGraph() {
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule(
      `${import.meta.env.BASE_URL}crusher.js`,
    );
    const c = this.context;
    this.master = c.createGain();
    this.master.gain.value = 0.7;
    this.crusher = new AudioWorkletNode(c, "gmc-crusher");
    this.characterFilter = c.createBiquadFilter();
    this.characterFilter.type = "lowpass";
    this.characterFilter.frequency.value = 22000;
    this.drive = c.createWaveShaper();
    this.filter = c.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 22000;
    this.crusher.connect(this.characterFilter);
    this.characterFilter.connect(this.drive);
    this.drive.connect(this.filter);
    this.filter.connect(this.master);
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.output = c.createGain();
    this.master.connect(this.limiter);
    this.limiter.connect(this.output);
    this.output.connect(c.destination);
    Object.assign(this, createEffects(c, this.filter, this.master));
    this.setFX(studio.fx);
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
  async trigger(id: number, independent = false, velocity = 1) {
    await this.init();
    if (this.status === "paused") await this.play();
    const p = pads[id];
    if (!p.buffer) return;
    if (independent || modeOf(p) === "ONE SHOT") {
      if (p.retrigger === "replace")
        this.cancelPadOwner(id, independent ? "manual" : "manual");
      if (this.status === "stopped") {
        this.status = "playing";
        this.epoch = this.context.currentTime;
      }
      this.voice(id, this.context.currentTime + 0.005, 0, "manual", velocity);
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
      this.cancelPadOwner(id, "seq");
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
    this.cancelPadOwner(id, "seq");
    this.beginCycle(id, this.context.currentTime + 0.01);
  }
  beginCycle(id: number, when: number) {
    this.origins.set(id, when);
    this.next.set(id, 0);
    for (const key of this.decisions.keys())
      if (key.startsWith(`${id}/`)) this.decisions.delete(key);
  }
  changed(id: number) {
    if (this.status !== "stopped" && pads[id].armed) this.resetPad(id);
  }
  private cancelPadOwner(id: number, owner: string) {
    for (const v of this.voices.filter(
      (v) => v.pad === id && v.owner === owner,
    )) {
      try {
        v.source.stop();
      } catch {}
      this.voices = this.voices.filter((x) => x !== v);
    }
  }
  cancel(id: number) {
    for (const v of this.voices.filter((v) => v.pad === id)) {
      try {
        v.source.stop();
      } catch {}
    }
    this.voices = this.voices.filter((v) => v.pad !== id);
  }
  private voice(
    id: number,
    when: number,
    offset: number,
    owner = "manual",
    velocity = 1,
    occurrence?: string,
  ) {
    const p = pads[id];
    if (!p.buffer) return;
    const c = this.context;
    const source = c.createBufferSource();
    const prepared = preparedRegion({
      ...p,
      reverse: p.reverse !== studio.fx.reverse,
    });
    source.buffer =
      prepared ??
      (p.reverse !== studio.fx.reverse ? this.reversed(p.buffer) : p.buffer);
    source.playbackRate.value = p.speed * 2 ** (studio.fx.pitch / 12);
    const gain = c.createGain();
    gain.gain.value = p.level * velocity;
    const panner = c.createStereoPanner();
    panner.pan.value = p.pan ?? 0;
    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.crusher);
    const duration = prepared
      ? prepared.duration
      : (p.end - p.start) * p.buffer.duration;
    const start = prepared
      ? 0
      : (p.reverse !== studio.fx.reverse ? 1 - p.end : p.start) *
        p.buffer.duration;
    const actualRate = source.playbackRate.value,
      total = Math.max(0.001, duration / actualRate - offset),
      edge = Math.min(0.002, total / 4);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(p.level * velocity, when + edge);
    gain.gain.setValueAtTime(
      p.level * velocity,
      when + Math.max(edge, total - edge),
    );
    gain.gain.linearRampToValueAtTime(0, when + total);
    source.start(
      when,
      start + offset * actualRate,
      Math.max(0.001, duration - offset * actualRate),
    );
    const sf = owner === "seq" ? this.sceneFade.get(id) : undefined;
    if (sf && sf.seconds > 0 && when < sf.at + sf.seconds) {
      const peak = p.level * velocity;
      gain.gain.cancelScheduledValues(when);
      gain.gain.setValueAtTime(
        peak * Math.max(0, (when - sf.at) / sf.seconds),
        when,
      );
      gain.gain.linearRampToValueAtTime(
        peak * Math.min(1, (when + total - sf.at) / sf.seconds),
        when + Math.max(0.001, total - edge),
      );
      gain.gain.linearRampToValueAtTime(0, when + total);
    }
    const v = {
      source,
      gain,
      start: when,
      end: when + duration / actualRate - offset,
      pad: id,
      owner,
      panner,
      velocity,
      occurrence,
    };
    this.voices.push(v);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
      this.voices = this.voices.filter((x) => x !== v);
    };
  }
  scheduledTrigger(
    id: number,
    when: number,
    velocity: number,
    owner: string,
    occurrence?: string,
  ) {
    if (!this.context || !pads[id]?.buffer) return;
    this.voice(
      id,
      Math.max(this.context.currentTime, when),
      0,
      owner,
      Math.max(0, Math.min(1, velocity)),
      occurrence,
    );
  }
  cancelOwner(owner: string, after = -Infinity) {
    if (this.cancelPlan) {
      const { when, fade } = this.cancelPlan;
      this.stopOwnerAt(owner, when, fade);
      this.voices = this.voices.filter((v) => v.owner !== owner);
      return;
    }

    for (const v of this.voices.filter(
      (v) => v.owner === owner && v.start >= after,
    )) {
      try {
        v.source.stop();
      } catch {}
      this.voices = this.voices.filter((x) => x !== v);
    }
  }
  enableSequencer(on: boolean) {
    this.seqEnabled = on;
    if (!on) this.cancelOwner("seq");
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
      if (!this.seqEnabled || !p.buffer || !p.armed || modeOf(p) === "ONE SHOT")
        continue;
      const origin = this.origins.get(p.id);
      if (origin === undefined) continue;
      const d = regionDuration(p, p.buffer.duration);
      let n = this.next.get(p.id) ?? 0;
      if (origin + n * d < now - 0.1) n = Math.floor((now - origin) / d);
      let guard = 0;
      while (origin + n * d < now + 0.12 && guard++ < 256) {
        const t = origin + n * d;
        const cycle = Math.floor(n / (p.play + p.rest)),
          key = `${p.id}/${cycle}`;
        if (!this.decisions.has(key))
          this.decisions.set(key, cycleAllowed(p, cycle, this.random));
        if (this.decisions.size > 1024)
          this.decisions.delete(this.decisions.keys().next().value!);
        if (
          modeOf(p) === "LOOP" ||
          (n % (p.play + p.rest) < p.play && this.decisions.get(key))
        ) {
          const late = Math.max(0, now - t);
          if (late < d) this.voice(p.id, Math.max(now, t), late, "seq");
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
      modeOf(p) === "LOOP" ? 1 : p.play,
      modeOf(p) === "LOOP" ? 0 : p.rest,
    );
  }
  setFX(fx: FXState, when = this.context?.currentTime ?? 0, ramp = 0.015) {
    if (!this.context) return;
    const at = Math.max(this.context.currentTime, when);
    const param = (p: AudioParam, v: number) => {
      p.setTargetAtTime(v, at, Math.max(0.001, ramp));
    };
    param(
      this.characterFilter.frequency,
      fx.characterBypass ? 22000 : fx.bandwidth,
    );
    param(this.filter.frequency, fx.filter);
    param(this.filter.Q, fx.resonance);
    const amount = fx.characterBypass ? 0 : fx.saturation * fx.characterAmount,
      curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = amount
        ? Math.tanh(x * (1 + amount * 8)) / Math.tanh(1 + amount * 8)
        : x;
    }
    this.drive.curve = curve;
    this.crusher.port.postMessage({
      amount: fx.characterBypass ? 0 : fx.characterAmount,
      stutter: fx.stutter,
      stutterSeconds: fx.stutterSeconds,
      when: at,
    });
    param(this.delay.delayTime, fx.delayTime);
    param(this.feedback.gain, fx.delayFeedback);
    for (const v of this.voices)
      param(v.source.playbackRate, pads[v.pad].speed * 2 ** (fx.pitch / 12));
  }
  stopOwnerAt(owner: string, when: number, fade = 0) {
    for (const v of this.voices.filter((v) => v.owner === owner)) {
      v.gain.gain.cancelScheduledValues(when);
      v.gain.gain.setValueAtTime(v.gain.gain.value, when);
      v.gain.gain.linearRampToValueAtTime(0, when + Math.max(0.003, fade));
      try {
        v.source.stop(when + Math.max(0.004, fade));
      } catch {}
    }
  }
  degrade(rate: number, bits: number, when = this.context?.currentTime ?? 0) {
    this.crusher?.port.postMessage({ rate, bits, when });
  }
  volume(v: number, when = this.context?.currentTime ?? 0) {
    if (this.master)
      this.master.gain.setTargetAtTime(
        v,
        Math.max(this.context.currentTime, when),
        0.01,
      );
  }
  level(id: number, v: number) {
    pads[id].level = v;
    for (const voice of this.voices.filter((x) => x.pad === id))
      voice.gain.gain.setTargetAtTime(
        v * voice.velocity,
        this.context.currentTime,
        0.01,
      );
  }
  effects(
    kind: "delay" | "reverb",
    on: boolean,
    amount: number,
    when = this.context?.currentTime ?? 0,
  ) {
    const node = kind === "delay" ? this.delayWet : this.reverbWet;
    if (node)
      node.gain.setTargetAtTime(
        on ? amount : 0,
        Math.max(this.context.currentTime, when),
        0.02,
      );
  }
}
export const engine = new Sampler();
