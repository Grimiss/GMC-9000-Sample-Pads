export type Quantization = "OFF" | "1/4" | "1/8" | "1/16" | "1/32";
export type PlaybackMode = "SEQ" | "MIDI" | "BOTH";
export type ClockMode = "FREE" | "SYNC";
export interface TriggerEvent {
  id: string;
  lane: number;
  beat: number;
  originalBeat: number;
  velocity: number;
  duration?: number;
  originalDuration?: number;
}
export interface Clip {
  id: string;
  name: string;
  length: number;
  events: TriggerEvent[];
}
export interface EventState {
  version: 1;
  clips: Clip[];
  activeClip: string;
  bpm: number;
  clockMode: ClockMode;
  playbackMode: PlaybackMode;
  quantization: Quantization;
  timeBase?: "seconds" | "beats";
  clockSource?: "internal" | "host";
  swing?: number;
}
export interface ClockSnapshot {
  beat: number;
  bpm: number;
  running: boolean;
  revision: number;
}
export interface HostClock {
  snapshot(audioTime: number): ClockSnapshot;
}
export interface VoicePort {
  trigger(event: {
    lane: number;
    when: number;
    velocity: number;
    owner: string;
    occurrence: string;
  }): void;
  cancelOwner(owner: string, after?: number): void;
}
let nextId = 0;
export const uid = () =>
  `${Date.now().toString(36)}-${(++nextId).toString(36)}`;
export const wrap = (beat: number, length: number) => {
  const value = beat % length;
  return value < 0 ? value + length : value;
};
export function stepSize(q: Quantization) {
  return q === "OFF" ? 0 : 4 / Number(q.slice(2));
}
export function quantize(beat: number, q: Quantization) {
  const step = stepSize(q);
  return step ? Math.round(beat / step) * step : beat;
}
export function initialEvents(): EventState {
  const id = uid();
  return {
    version: 1,
    clips: [{ id, name: "Clip 1", length: 16, events: [] }],
    activeClip: id,
    bpm: 120,
    clockMode: "FREE",
    playbackMode: "SEQ",
    quantization: "OFF",
    timeBase: "seconds",
    clockSource: "internal",
    swing: 0,
  };
}
export class ClipStore {
  state = initialEvents();
  undoStack: EventState[] = [];
  redoStack: EventState[] = [];
  listeners = new Set<() => void>();
  get clip() {
    return this.state.clips.find((c) => c.id === this.state.activeClip)!;
  }
  notify() {
    this.listeners.forEach((f) => f());
  }
  checkpoint() {
    this.undoStack.push(structuredClone(this.state));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  update(action: () => void) {
    const before = structuredClone(this.state);
    try {
      action();
    } catch (e) {
      this.state = before;
      throw e;
    }
    if (JSON.stringify(before) === JSON.stringify(this.state)) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
    return true;
  }
  undo() {
    const s = this.undoStack.pop();
    if (s) {
      this.redoStack.push(structuredClone(this.state));
      this.state = s;
      this.notify();
    }
  }
  redo() {
    const s = this.redoStack.pop();
    if (s) {
      this.undoStack.push(structuredClone(this.state));
      this.state = s;
      this.notify();
    }
  }
  add(lane: number, beat: number, velocity = 0.8, duration?: number) {
    const originalBeat = wrap(beat, this.clip.length),
      b = wrap(
        quantize(
          originalBeat,
          this.state.timeBase === "seconds" ? "OFF" : this.state.quantization,
        ),
        this.clip.length,
      );
    if (
      this.clip.events.some(
        (e) => e.lane === lane && Math.abs(e.beat - b) < 1e-7,
      )
    )
      return null;
    const event = {
      id: uid(),
      lane,
      beat: b,
      originalBeat,
      velocity: Math.max(0, Math.min(1, velocity)),
      duration,
      originalDuration: duration,
    };
    this.clip.events.push(event);
    return event;
  }
  move(id: string, lane: number, beat: number) {
    const e = this.clip.events.find((e) => e.id === id);
    if (!e) return false;
    beat = Math.max(0, Math.min(this.clip.length - 1e-7, beat));
    if (
      this.clip.events.some(
        (x) => x.id !== id && x.lane === lane && Math.abs(x.beat - beat) < 1e-7,
      )
    )
      return false;
    e.lane = lane;
    e.beat = beat;
    return true;
  }
  erase(lane: number, beat: number, cell: number) {
    this.clip.events = this.clip.events.filter(
      (e) =>
        !(
          e.lane === lane &&
          (cell
            ? Math.floor(e.beat / cell) === Math.floor(beat / cell)
            : Math.abs(e.beat - beat) < 0.03)
        ),
    );
  }
  restore(state: EventState) {
    this.state = structuredClone(state);
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}
/** No instrument or DOM dependencies. Caller supplies AudioContext time and voice adapter. */
export class EventEngine {
  running = false;
  armed = false;
  host: HostClock | null = null;
  private originTime = 0;
  private originBeat = 0;
  private cursor: number | null = null;
  private revision = "";
  private suppressed = new Map<string, number>();
  private pending = new Map<
    string,
    { clip: Clip; event: TriggerEvent; start: number }
  >();
  store: ClipStore;
  private now: () => number;
  private port: VoicePort;
  constructor(store: ClipStore, now: () => number, port: VoicePort) {
    this.store = store;
    this.now = now;
    this.port = port;
  }
  snapshot(time = this.now()): ClockSnapshot {
    if (
      this.store.state.clockMode === "SYNC" &&
      this.store.state.clockSource !== "internal"
    )
      return (
        this.host?.snapshot(time) ?? {
          beat: 0,
          bpm: this.store.state.bpm,
          running: false,
          revision: -1,
        }
      );
    return {
      beat:
        this.originBeat +
        (this.running
          ? ((time - this.originTime) *
              (this.store.state.timeBase === "seconds"
                ? 60
                : this.store.state.bpm)) /
            60
          : 0),
      bpm: this.store.state.timeBase === "seconds" ? 60 : this.store.state.bpm,
      running: this.running,
      revision: 0,
    };
  }
  play() {
    if (this.running) return;
    this.originTime = this.now();
    this.running = true;
    this.cursor = null;
    this.port.cancelOwner("midi", this.now());
    this.tick(this.originBeat);
  }
  playAt(time: number) {
    this.running = true;
    this.originTime = time;
    this.originBeat = 0;
    this.cursor = null;
    this.tick(0);
  }
  pause() {
    if (!this.running) return;
    this.closeNotes();
    this.originBeat = this.snapshot().beat;
    this.running = false;
    this.cursor = null;
    this.port.cancelOwner("midi", this.now());
  }
  stop() {
    this.closeNotes();
    this.running = false;
    this.suppressed.clear();
    this.originBeat = 0;
    this.originTime = this.now();
    this.invalidate();
  }
  seek(position: number, time = this.now()) {
    this.originBeat = position;
    this.originTime = time;
    this.invalidate();
  }
  connectHost(host: HostClock | null) {
    this.host = host;
    this.invalidate();
  }
  reanchor(change: () => void) {
    const beat = this.snapshot().beat;
    change();
    this.originBeat = beat;
    this.originTime = this.now();
    this.invalidate();
  }
  invalidate() {
    this.port.cancelOwner("midi");
    this.cursor = null;
  }
  tick(fromBeat?: number) {
    if (!this.running) return;
    const time = this.now(),
      s = this.snapshot(time);
    if (
      !s.running ||
      !Number.isFinite(s.beat) ||
      !Number.isFinite(s.bpm) ||
      s.bpm <= 0
    ) {
      this.invalidate();
      return;
    }
    const key = `${this.store.state.activeClip}/${this.store.state.clockMode}/${this.store.state.timeBase}/${this.store.state.clockSource}/${s.revision}/${s.bpm}`;
    if (this.revision !== key) {
      this.invalidate();
      this.revision = key;
    }
    if (this.store.state.playbackMode === "SEQ") {
      this.cursor = null;
      return;
    }
    const start =
        fromBeat !== undefined &&
        (this.store.state.clockMode === "FREE" ||
          this.store.state.clockSource === "internal")
          ? fromBeat
          : this.cursor === null
            ? s.beat
            : Math.max(this.cursor, s.beat),
      end = s.beat + (0.12 * s.bpm) / 60,
      clip = this.store.clip;
    if (end < start) {
      this.invalidate();
      return;
    }
    for (const original of clip.events) {
      const e = {
        ...original,
        beat: Math.min(
          clip.length - 1e-7,
          original.beat +
            (this.store.state.timeBase !== "seconds" &&
            Math.floor(original.beat / 0.5) % 2
              ? (this.store.state.swing ?? 0) * 0.5
              : 0),
        ),
      };
      if (original.beat >= clip.length) continue;
      const first = Math.max(
          0,
          Math.ceil((start - e.beat - 1e-9) / clip.length),
        ),
        last = Math.floor((end - e.beat - 1e-9) / clip.length);
      for (let loop = first; loop <= last; loop++) {
        const beat = loop * clip.length + e.beat;
        if (beat < start - 1e-8 || this.suppressed.get(e.id) === loop) continue;
        this.port.trigger({
          lane: e.lane,
          when: time + ((beat - s.beat) * 60) / s.bpm,
          velocity: e.velocity,
          owner: "midi",
          occurrence: `${clip.id}/${e.id}/${loop}`,
        });
      }
    }
    this.cursor = end;
  }
  noteOn(key: string, lane: number, velocity: number, time = this.now()) {
    if (!this.armed) return;
    if (!this.running) this.play();
    const s = this.snapshot(time);
    if (!s.running) return;
    if (this.pending.has(key)) this.noteOff(key, time);
    const e = this.store.add(lane, s.beat, velocity);
    if (e) {
      this.suppressed.set(
        e.id,
        Math.round((s.beat - e.beat) / this.store.clip.length),
      );
      this.pending.set(key, { clip: this.store.clip, event: e, start: s.beat });
      this.store.notify();
    }
  }
  noteOff(key: string, time = this.now()) {
    const n = this.pending.get(key);
    if (!n) return;
    const duration = Math.max(0, this.snapshot(time).beat - n.start);
    n.event.duration = duration;
    n.event.originalDuration = duration;
    this.pending.delete(key);
    this.store.notify();
  }
  closeNotes() {
    for (const key of Array.from(this.pending.keys())) this.noteOff(key);
  }
}
export function validateEvents(raw: unknown, lanes: number): EventState {
  const s = raw as EventState;
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.clips) ||
    !s.clips.length ||
    s.clips.length > 100 ||
    !Number.isFinite(s.bpm) ||
    s.bpm < 20 ||
    s.bpm > 400 ||
    !["FREE", "SYNC"].includes(s.clockMode) ||
    !["SEQ", "MIDI", "BOTH"].includes(s.playbackMode) ||
    !["OFF", "1/4", "1/8", "1/16", "1/32"].includes(s.quantization)
  )
    throw new Error("Invalid MIDI timing settings");
  const ids = new Set<string>();
  let total = 0;
  for (const c of s.clips) {
    if (
      !c ||
      typeof c.id !== "string" ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !Number.isFinite(c.length) ||
      c.length < 0.125 ||
      c.length > 4096 ||
      !Array.isArray(c.events)
    )
      throw new Error("Invalid MIDI clip");
    ids.add(c.id);
    const positions = new Set<string>(),
      eventIds = new Set<string>();
    for (const e of c.events) {
      if (
        ++total > 100000 ||
        typeof e.id !== "string" ||
        eventIds.has(e.id) ||
        !Number.isInteger(e.lane) ||
        e.lane < 0 ||
        e.lane >= lanes ||
        !Number.isFinite(e.beat) ||
        e.beat < 0 ||
        !Number.isFinite(e.originalBeat) ||
        e.originalBeat < 0 ||
        !Number.isFinite(e.velocity) ||
        e.velocity < 0 ||
        e.velocity > 1 ||
        [e.duration, e.originalDuration].some(
          (v) => v !== undefined && (!Number.isFinite(v) || v < 0),
        )
      )
        throw new Error("Invalid MIDI event");
      const p = `${e.lane}/${e.beat}`;
      if (positions.has(p)) throw new Error("Duplicate MIDI trigger");
      positions.add(p);
      eventIds.add(e.id);
    }
  }
  if (!ids.has(s.activeClip)) throw new Error("Missing active clip");
  if (
    (s.timeBase !== undefined && !["seconds", "beats"].includes(s.timeBase)) ||
    (s.clockSource !== undefined &&
      !["internal", "host"].includes(s.clockSource)) ||
    (s.swing !== undefined &&
      (!Number.isFinite(s.swing) || s.swing < 0 || s.swing > 0.75))
  )
    throw new Error("Invalid V2 timing settings");
  return {
    ...structuredClone(s),
    timeBase: s.timeBase ?? "beats",
    clockSource:
      s.clockSource ?? (s.clockMode === "SYNC" ? "host" : "internal"),
    swing: s.swing ?? 0,
  };
}
