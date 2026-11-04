class GMCCrusher extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rate = 12000;
    this.bits = 10;
    this.phase = 1;
    this.held = [];
    this.port.onmessage = ({ data }) => {
      this.rate = Math.max(1000, Math.min(sampleRate, data.rate));
      this.bits = Math.max(4, Math.min(16, data.bits));
    };
  }
  process(inputs, outputs) {
    const input = inputs[0],
      output = outputs[0];
    if (!input?.length) return true;
    const steps = 2 ** (this.bits - 1);
    for (let i = 0; i < output[0].length; i++) {
      this.phase += this.rate / sampleRate;
      const update = this.phase >= 1;
      if (update) this.phase -= 1;
      for (let ch = 0; ch < output.length; ch++) {
        if (update)
          this.held[ch] =
            Math.round((input[ch % input.length][i] || 0) * steps) / steps;
        output[ch][i] = this.held[ch] || 0;
      }
    }
    return true;
  }
}
registerProcessor("gmc-crusher", GMCCrusher);
