import { engine } from "./engine";
export class AudioInput {
  stream: MediaStream | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  monitor: GainNode | null = null;
  capture: AudioWorkletNode | null = null;
  chunks: Float32Array[][] = [];
  recording = false;
  private flushDone: (() => void) | null = null;
  private loaded = false;
  async connect(deviceId: string) {
    if (this.recording) throw new Error("Stop recording before changing input");
    await engine.init();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.disconnect();
    this.stream = stream;
    this.source = engine.context.createMediaStreamSource(stream);
    this.monitor = engine.context.createGain();
    this.monitor.gain.value = 0;
    this.source.connect(this.monitor);
    this.monitor.connect(engine.master);
  }
  disconnect() {
    if (this.recording)
      throw new Error("Stop recording before disconnecting input");
    this.source?.disconnect();
    this.monitor?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.monitor = null;
  }
  monitoring(on: boolean) {
    if (this.monitor)
      this.monitor.gain.setTargetAtTime(
        on ? 1 : 0,
        engine.context.currentTime,
        0.01,
      );
  }
  async start() {
    if (!this.source) throw new Error("Connect an audio input in MENU first");
    if (this.recording) return;
    if (!this.loaded) {
      await engine.context.audioWorklet.addModule(
        `${import.meta.env.BASE_URL}capture.js`,
      );
      this.loaded = true;
    }
    if (engine.context.state === "suspended") await engine.context.resume();
    this.chunks = [];
    this.capture = new AudioWorkletNode(engine.context, "gmc-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.capture.port.onmessage = ({ data }) => {
      if (data.channels) this.chunks.push(data.channels);
      if (data.done) this.flushDone?.();
    };
    this.source.connect(this.capture);
    this.capture.connect(engine.context.destination);
    this.recording = true;
  }
  async stop() {
    if (!this.capture || !this.recording) return null;
    const node = this.capture;
    await new Promise<void>((resolve) => {
      this.flushDone = resolve;
      node.port.postMessage("flush");
    });
    this.flushDone = null;
    this.source?.disconnect(node);
    node.disconnect();
    node.port.close();
    this.capture = null;
    this.recording = false;
    const length = this.chunks.reduce((n, c) => n + c[0].length, 0);
    if (!length) return null;
    const b = engine.context.createBuffer(2, length, engine.context.sampleRate);
    for (let c = 0; c < 2; c++) {
      let offset = 0;
      for (const chunk of this.chunks) {
        b.getChannelData(c).set(chunk[c], offset);
        offset += chunk[c].length;
      }
    }
    this.chunks = [];
    return b;
  }
}
export const audioInput = new AudioInput();
