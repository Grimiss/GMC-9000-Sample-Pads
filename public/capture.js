class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = [[], []];
    this.count = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "flush") {
        this.flush();
        this.port.postMessage({ done: true });
      }
    };
  }
  flush() {
    if (!this.count) return;
    const channels = this.channels.map((c) => Float32Array.from(c));
    this.port.postMessage(
      { channels },
      channels.map((c) => c.buffer),
    );
    this.channels = [[], []];
    this.count = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    for (const out of outputs[0] || []) out.fill(0);
    if (input?.length) {
      for (let i = 0; i < input[0].length; i++) {
        for (let c = 0; c < 2; c++)
          this.channels[c].push(input[c % input.length][i]);
        this.count++;
      }
      if (this.count >= 4096) this.flush();
    }
    return true;
  }
}
registerProcessor("gmc-capture", Capture);
