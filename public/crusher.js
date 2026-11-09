class GMCCrusher extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rate = 12000;
    this.bits = 10;
    this.phase = 1;
    this.held = [];
    this.amount = 1;
    this.stutter = false;
    this.stutterSeconds = 0.125;
    this.ring = [
      new Float32Array(sampleRate * 2),
      new Float32Array(sampleRate * 2),
    ];
    this.write = 0;
    this.read = 0;
    this.freeze = 0;
    this.filled = 0;
    this.pendingStutter = false;
    this.queue = [];
    this.port.onmessage = ({ data }) => {
      if (!data.when) this.apply(data);
      else this.queue.push(data);
    };
  }
  apply(d) {
    if (d.clear) {
      this.ring.forEach((r) => r.fill(0));
      this.queue = [];
      this.held = [];
      this.write = 0;
      this.read = 0;
      this.freeze = 0;
      this.phase = 1;
      this.stutter = false;
      this.filled = 0;
      this.pendingStutter = false;
    }
    if (d.rate !== undefined)
      this.rate = Math.max(1000, Math.min(sampleRate, d.rate));
    if (d.bits !== undefined) this.bits = Math.max(4, Math.min(24, d.bits));
    if (d.amount !== undefined)
      this.amount = Math.max(0, Math.min(1, d.amount));
    if (d.stutterSeconds !== undefined)
      this.stutterSeconds = Math.max(0.02, Math.min(1, d.stutterSeconds));
    if (d.stutter !== undefined) {
      if (d.stutter && !this.stutter) {
        if (this.filled >= Math.floor(this.stutterSeconds * sampleRate)) {
          this.freeze = this.write;
          this.read = 0;
          this.stutter = true;
        } else this.pendingStutter = true;
      }
      if (!d.stutter) {
        this.stutter = false;
        this.pendingStutter = false;
      }
    }
  }
  process(inputs, outputs) {
    for (let q = 0; q < this.queue.length;) {
      if (
        (this.queue[q].when ?? 0) <=
        (typeof currentTime === "number" ? currentTime : 0)
      ) {
        this.apply(this.queue[q]);
        this.queue.splice(q, 1);
      } else q++;
    }
    const input = inputs[0],
      output = outputs[0];
    if (!input?.length) return true;
    const steps = 2 ** (this.bits - 1),
      length = this.ring[0].length,
      loop = Math.floor(this.stutterSeconds * sampleRate);
    for (let i = 0; i < output[0].length; i++) {
      this.phase += this.rate / sampleRate;
      const update = this.phase >= 1;
      if (update) this.phase -= 1;
      for (let ch = 0; ch < output.length; ch++) {
        const raw = input[ch % input.length][i] || 0;
        if (update) this.held[ch] = Math.round(raw * steps) / steps;
        const v = raw * (1 - this.amount) + (this.held[ch] || 0) * this.amount;
        const ring = this.ring[ch % 2];
        if (!this.stutter) ring[this.write] = v;
        let sample = this.stutter
          ? ring[(this.freeze - loop + this.read + length) % length]
          : v;
        if (this.stutter) {
          const edge = Math.min(64, loop / 8),
            pos = this.read;
          sample *= Math.min(1, pos / edge, (loop - 1 - pos) / edge);
        }
        output[ch][i] = sample;
      }
      if (!this.stutter) {
        this.write = (this.write + 1) % length;
        this.filled = Math.min(length, this.filled + 1);
        if (this.pendingStutter && this.filled >= loop) {
          this.pendingStutter = false;
          this.stutter = true;
          this.freeze = this.write;
          this.read = 0;
        }
      } else this.read = (this.read + 1) % loop;
    }
    return true;
  }
}
registerProcessor("gmc-crusher", GMCCrusher);
