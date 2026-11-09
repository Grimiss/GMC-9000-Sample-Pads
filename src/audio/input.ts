import { engine } from "./engine";
const captureModules = new WeakMap<AudioContext, Promise<void>>();
export class AudioInput {
  stream: MediaStream | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  monitor: GainNode | null = null;
  capture: AudioWorkletNode | null = null;
  chunks: Float32Array[][] = [];
  recording = false;
  captureStarted = 0;
  maxFrames = Infinity;
  overflow: (() => void) | null = null;
  private frames = 0;
  private overflowed = false;
  private stopping: Promise<AudioBuffer | null> | null = null;
  private flushDone: (() => void) | null = null;
  private loaded = false;
  private tap: AudioNode | null = null;
  async connect(deviceId: string) {
    if (this.recording) throw new Error("Stop recording before changing input");
    await engine.init();
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Audio recording requires HTTPS or localhost in a supported browser",
      );
    const stream = await navigator.mediaDevices
      .getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
      .catch((error) => {
        if (error?.name === "NotAllowedError")
          throw new Error(
            "Microphone permission denied. Allow access in browser settings, then try REC again.",
          );
        if (error?.name === "NotReadableError")
          throw new Error(
            "Audio input unavailable or in use. Check your interface settings.",
          );
        throw error;
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
  async start(from?: AudioNode) {
    if (!from && !this.source)
      throw new Error("Connect an audio input in MENU first");
    if (this.recording) return;
    let module = captureModules.get(engine.context);
    if (!module) {
      module = engine.context.audioWorklet.addModule(
        `${import.meta.env.BASE_URL}capture.js`,
      );
      captureModules.set(engine.context, module);
    }
    await module;
    if (engine.context.state === "suspended") await engine.context.resume();
    this.chunks = [];
    this.frames = 0;
    this.overflowed = false;
    this.captureStarted = engine.context.currentTime;
    this.capture = new AudioWorkletNode(engine.context, "gmc-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.capture.port.onmessage = ({ data }) => {
      if (data.started !== undefined) this.captureStarted = data.started;
      if (data.channels && !this.overflowed) {
        this.frames += data.channels[0].length;
        if (this.frames > this.maxFrames) {
          this.overflowed = true;
          this.overflow?.();
        } else this.chunks.push(data.channels);
      }
      if (data.done) this.flushDone?.();
    };
    this.tap = from ?? this.source!;
    this.tap.connect(this.capture);
    this.capture.connect(engine.context.destination);
    this.recording = true;
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.finish();
    try {
      return await this.stopping;
    } finally {
      this.stopping = null;
    }
  }
  private async finish() {
    if (!this.capture || !this.recording) return null;
    const node = this.capture;
    let timer: number | undefined;
    try {
      if (engine.context.state === "suspended") await engine.context.resume();
      await new Promise<void>((resolve, reject) => {
        timer = window.setTimeout(
          () =>
            reject(
              new Error("Recording flush timed out; original pad preserved"),
            ),
          5000,
        );
        this.flushDone = resolve;
        node.port.postMessage("flush");
      });
    } catch (error) {
      this.chunks = [];
      throw error;
    } finally {
      clearTimeout(timer);
      this.flushDone = null;
      this.tap?.disconnect(node);
      this.tap = null;
      node.disconnect();
      node.port.close();
      this.capture = null;
      this.recording = false;
    }
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
