import { replaceStudio } from "./v2/model";
import { pads } from "./state";
import { engine } from "./audio/engine";
import {
  ClipStore,
  EventEngine,
  stepSize,
  quantize,
  uid,
  wrap,
  type HostClock,
  type PlaybackMode,
  type Quantization,
} from "./events/core";
import {
  captureProject,
  stageProject,
  legacySettings,
  RecoveryStore,
  type GlobalSettings,
} from "./project";
export class MidiEditor {
  store = new ClipStore();
  timeline: EventEngine;
  private recovery = new RecoveryStore();
  private selected: string | null = null;
  private dirty = false;
  private saving = false;
  private busy = false;
  private readyState = false;
  private recoveryPending = false;
  private notes = new Set<string>();
  private restoreSnapshot: unknown = null;
  private dialog: HTMLDialogElement;
  private canvas: HTMLCanvasElement;
  private status: HTMLElement;
  private callbacks: {
    ready: () => Promise<void>;
    render: () => void;
    globals: () => GlobalSettings;
    applyGlobals: (g: GlobalSettings, when?: number) => void;
    canLoad: () => boolean;
  };
  constructor(callbacks: MidiEditor["callbacks"]) {
    this.callbacks = callbacks;
    this.timeline = new EventEngine(
      this.store,
      () => engine.context?.currentTime ?? 0,
      {
        trigger: (e) =>
          engine.scheduledTrigger(
            e.lane,
            e.when,
            e.velocity,
            e.owner,
            e.occurrence,
          ),
        cancelOwner: (owner, after) => engine.cancelOwner(owner, after),
      },
    );
    const controls = document.createElement("div");
    controls.className = "midi-controls";
    controls.innerHTML =
      '<button id="midi-rec" aria-pressed="false">MIDI REC</button><button id="midi-edit">MIDI EDIT</button><label>PLAYBACK <select id="playback-mode"><option>SEQ</option><option>MIDI</option><option>BOTH</option></select></label><span id="midi-transport-status" role="status">MIDI STOPPED · FREE</span>';
    document.querySelector("#app")!.append(controls);
    this.dialog = document.createElement("dialog");
    this.dialog.id = "midi-editor";
    this.dialog.innerHTML = `<h2>GMC-9000 · SAMPLE LANES</h2><div class="editor-controls"><button id="clip-play">PLAY</button><button id="clip-pause">PAUSE</button><button id="clip-stop">STOP</button><label>CLIP <select id="clip-select"></select></label><button id="clip-new">NEW CLIP</button><button id="clip-duplicate">DUPLICATE PATTERN</button><label>NAME <input id="clip-name" maxlength="80"></label><label>LENGTH (<span id="length-units">SECONDS</span>) <input id="clip-length" type="number" min=".125" max="4096" step=".125" value="16"></label><label>LOCAL BPM <input id="clip-bpm" type="number" min="20" max="400" value="120"></label><label>CLOCK <select id="clip-clock"><option>FREE</option><option>SYNC</option></select></label><label>UNITS <select id="clip-units"><option value="seconds">SECONDS / FREE</option><option value="beats">BEATS / SYNC</option></select></label><label>CLOCK SOURCE <select id="clip-source"><option value="internal">INTERNAL</option><option value="host">SUPPLIED HOST</option></select></label><label>SWING <input id="clip-swing" type="number" min="0" max=".75" step=".01" value="0"></label><label>QUANTIZE <select id="clip-quantize"><option>OFF</option><option>1/4</option><option>1/8</option><option selected>1/16</option><option>1/32</option></select></label><label>TAKE <select id="clip-take"><option value="overdub">OVERDUB</option><option value="replace">REPLACE CLIP</option></select></label><button id="editor-rec">MIDI REC</button><button id="clip-undo">UNDO</button><button id="clip-redo">REDO</button></div><p>Paint: drag empty grid · Erase: Ctrl-drag · Move: drag a trigger · Select a trigger for precise timing and velocity. Labels always follow current pad assignments. Note duration is retained as metadata; playback is one-shot.</p><div class="lane-scroll"><canvas id="lane-canvas" width="1200" height="590" aria-label="Nine named sample lanes. Use event list and timing fields for keyboard editing."></canvas></div><div class="editor-controls"><label>EVENT <select id="event-select"><option value="">Select trigger</option></select></label><label>PAD <select id="event-lane">${[6, 7, 8, 3, 4, 5, 0, 1, 2].map((i) => `<option value="${i}">PAD ${i + 1}</option>`).join("")}</select></label><label>TIME (<span id="event-time-units">SECONDS</span>, 0-BASED) <input type="number" id="event-beat" min="0" step=".001"></label><label>VELOCITY <input type="range" id="event-velocity" min=".01" max="1" step=".01"></label><button id="event-add">ADD TRIGGER</button><button id="event-delete">DELETE</button><button id="clip-requantize">QUANTIZE ORIGINAL TIMING</button><span id="event-duration"></span></div><div class="editor-controls"><button id="project-export">EXPORT PROJECT + AUDIO</button><button id="project-load">LOAD PROJECT / LEGACY SETTINGS</button><button id="project-recover">RECOVER AUTOSAVE</button><button id="project-previous">RECOVER PREVIOUS</button><button id="project-use-current">KEEP CURRENT / ENABLE AUTOSAVE</button><button id="editor-close">CLOSE MIDI EDITOR</button><input hidden id="project-file" type="file" accept=".json,.gmc,application/json"></div><p id="project-status" role="status">Checking local recovery…</p>`;
    document.body.append(this.dialog);
    this.canvas = this.el("lane-canvas");
    this.status = this.el("project-status");
    this.el("midi-edit").onclick = () => {
      this.dialog.showModal();
      this.refresh();
    };
    this.el("editor-close").onclick = () => this.dialog.close();
    this.el("midi-rec").onclick = () => this.safe(() => this.arm());
    this.el("editor-rec").onclick = () => this.safe(() => this.arm());
    this.input("playback-mode").onchange = () =>
      this.edit(() => {
        this.store.state.playbackMode = this.input("playback-mode")
          .value as PlaybackMode;
      });
    this.el("clip-play").onclick = () =>
      this.safe(async () => {
        await callbacks.ready();
        await this.play();
      });
    this.el("clip-pause").onclick = () => this.safe(() => this.pause());
    this.el("clip-stop").onclick = () => this.safe(() => this.stop());
    this.input("clip-select").onchange = () => {
      const value = this.input("clip-select").value;
      this.disarm();
      this.edit(() => (this.store.state.activeClip = value));
      this.selected = null;
    };
    this.el("clip-new").onclick = () => {
      this.disarm();
      this.edit(() => {
        const c = {
          id: uid(),
          name: `Clip ${this.store.state.clips.length + 1}`,
          length: this.store.state.timeBase === "seconds" ? 8 : 16,
          events: [],
        };
        this.store.state.clips.push(c);
        this.store.state.activeClip = c.id;
        this.store.state.quantization = "OFF";
      });
    };
    this.input("clip-name").onchange = () =>
      this.edit(() => {
        this.store.clip.name = this.input("clip-name").value || "Clip";
      });
    this.input("clip-length").onchange = () => {
      const v = Number(this.input("clip-length").value);
      if (v >= 0.125 && v <= 4096) {
        this.disarm();
        this.edit(() => (this.store.clip.length = v));
      } else this.refresh();
    };
    this.input("clip-bpm").onchange = () => {
      const v = Number(this.input("clip-bpm").value);
      if (v >= 20 && v <= 400)
        this.edit(() =>
          this.timeline.reanchor(() => (this.store.state.bpm = v)),
        );
      else this.refresh();
    };
    const setTiming = (mode: "FREE" | "SYNC") => {
      const state = this.store.state,
        old = state.timeBase ?? "beats",
        next = mode === "FREE" ? "seconds" : "beats",
        factor =
          old === next
            ? 1
            : next === "seconds"
              ? 60 / state.bpm
              : state.bpm / 60,
        position = this.timeline.snapshot().beat * factor;
      this.disarm();
      this.edit(() => {
        for (const c of state.clips) {
          c.length *= factor;
          for (const e of c.events) {
            e.beat *= factor;
            e.originalBeat *= factor;
            if (e.duration !== undefined) e.duration *= factor;
            if (e.originalDuration !== undefined) e.originalDuration *= factor;
          }
        }
        state.timeBase = next;
        state.clockMode = mode;
        if (next === "seconds") state.quantization = "OFF";
        this.timeline.seek(position);
      });
    };
    this.input("clip-clock").onchange = () =>
      setTiming(this.input("clip-clock").value as "FREE" | "SYNC");
    this.input("clip-units").onchange = () =>
      setTiming(this.input("clip-units").value === "seconds" ? "FREE" : "SYNC");
    this.input("clip-source").onchange = () => {
      const value = this.input("clip-source").value as "internal" | "host";
      this.edit(() => {
        this.store.state.clockSource = value;
        this.timeline.invalidate();
      });
    };
    this.input("clip-swing").onchange = () => {
      const v = Number(this.input("clip-swing").value);
      if (v >= 0 && v <= 0.75) this.edit(() => (this.store.state.swing = v));
      else this.refresh();
    };
    this.el("clip-duplicate").onclick = () =>
      this.edit(() => {
        const c = structuredClone(this.store.clip);
        c.id = uid();
        c.name += " copy";
        c.events.forEach((e) => (e.id = uid()));
        this.store.state.clips.push(c);
        this.store.state.activeClip = c.id;
      });
    this.input("clip-quantize").onchange = () =>
      this.edit(
        () =>
          (this.store.state.quantization = this.input("clip-quantize")
            .value as Quantization),
      );
    this.el("clip-undo").onclick = () => {
      this.disarm();
      this.store.undo();
      this.timeline.invalidate();
    };
    this.el("clip-redo").onclick = () => {
      this.disarm();
      this.store.redo();
      this.timeline.invalidate();
    };
    this.input("event-select").onchange = () => {
      this.selected = this.input("event-select").value || null;
      this.refresh();
    };
    this.el("event-add").onclick = () =>
      this.edit(() => {
        const e = this.store.add(
          Number(this.input("event-lane").value),
          Number(this.input("event-beat").value) || 0,
          Number(this.input("event-velocity").value) || 0.8,
        );
        this.selected = e?.id ?? null;
      });
    this.el("event-delete").onclick = () =>
      this.edit(() => {
        this.store.clip.events = this.store.clip.events.filter(
          (e) => e.id !== this.selected,
        );
        this.selected = null;
      });
    const move = () => {
      const beat = Number(this.input("event-beat").value),
        lane = Number(this.input("event-lane").value);
      if (!Number.isFinite(beat) || beat < 0) return this.refresh();
      this.edit(() => {
        if (this.selected && !this.store.move(this.selected, lane, beat))
          this.status.textContent =
            "Move rejected: another trigger occupies that position.";
      });
    };
    this.input("event-beat").onchange = move;
    this.input("event-lane").onchange = move;
    this.input("event-velocity").onchange = () =>
      this.edit(() => {
        const e = this.store.clip.events.find((e) => e.id === this.selected);
        if (e) e.velocity = Number(this.input("event-velocity").value);
      });
    this.el("clip-requantize").onclick = () =>
      this.edit(() => {
        const occupied = new Set<string>();
        for (const e of [...this.store.clip.events].sort(
          (a, b) => a.originalBeat - b.originalBeat,
        )) {
          const beat = wrap(
              quantize(e.originalBeat, this.store.state.quantization),
              this.store.clip.length,
            ),
            key = `${e.lane}/${beat}`;
          if (occupied.has(key)) {
            this.status.textContent =
              "Quantization collision: colliding trigger kept at its previous timing.";
            occupied.add(`${e.lane}/${e.beat}`);
            continue;
          }
          if (
            this.store.clip.events.some(
              (x) =>
                x.id !== e.id &&
                x.lane === e.lane &&
                Math.abs(x.beat - beat) < 1e-7,
            )
          ) {
            occupied.add(`${e.lane}/${e.beat}`);
            continue;
          }
          e.beat = beat;
          occupied.add(key);
        }
      });
    this.el("project-export").onclick = () =>
      this.safe(() => this.exportProject());
    this.el("project-load").onclick = () =>
      this.el<HTMLInputElement>("project-file").click();
    this.el("project-file").onchange = () =>
      this.safe(async () => {
        const file = this.el<HTMLInputElement>("project-file").files?.[0];
        if (file) await this.load(JSON.parse(await file.text()));
        this.el<HTMLInputElement>("project-file").value = "";
      });
    this.el("project-recover").onclick = () => this.safe(() => this.recover());
    this.el("project-previous").onclick = () =>
      this.safe(() => this.recover("previous"));
    this.el("project-use-current").onclick = () => {
      this.recoveryPending = false;
      this.dirty = true;
      this.status.textContent =
        "Autosave enabled for current session. Existing latest will be retained as previous.";
    };
    this.installGestures();
    this.store.listeners.add(() => {
      engine.enableSequencer(this.store.state.playbackMode !== "MIDI");
      this.refresh();
      this.changed();
    });
    this.refresh();
    void this.checkRecovery();
    setInterval(() => {
      this.timeline.tick();
      this.transportStatus();
      if (this.dialog.open) this.draw();
    }, 25);
    setInterval(() => void this.autosave(), 4000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void this.autosave();
    });
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) {
    return document.getElementById(id)! as T;
  }
  private input(id: string) {
    return this.el<HTMLInputElement>(id);
  }
  private async safe(f: () => void | Promise<void>) {
    try {
      await f();
    } catch (e) {
      this.status.textContent = e instanceof Error ? e.message : String(e);
    }
  }
  getGlobals() {
    return this.callbacks.globals();
  }
  setGlobals(g: GlobalSettings, when?: number) {
    this.callbacks.applyGlobals(g, when);
    this.changed();
  }
  changed() {
    if (this.readyState) this.dirty = true;
  }
  private edit(f: () => void) {
    if (this.store.update(f)) this.timeline.invalidate();
    else this.refresh();
  }
  private disarm() {
    this.timeline.closeNotes();
    this.timeline.armed = false;
    this.notes.clear();
    this.refresh();
  }
  async arm() {
    await this.callbacks.ready();
    if (this.timeline.armed) {
      this.disarm();
      this.store.notify();
      return;
    }
    if (
      this.store.state.clockMode === "SYNC" &&
      this.store.state.clockSource !== "internal" &&
      !this.timeline.host
    ) {
      this.status.textContent =
        "SYNC is waiting: connect a host clock, or select FREE.";
      this.dialog.showModal();
      return;
    }
    this.store.checkpoint();
    if (this.input("clip-take").value === "replace")
      this.store.clip.events = [];
    this.timeline.armed = true;
    this.store.notify();
  }
  async perform(pad: number, velocity = 1, key = `pad:${pad}`, time?: number) {
    await this.callbacks.ready();
    if (engine.context.state === "suspended") await engine.context.resume();
    if (engine.status === "paused") this.timeline.play();
    if (engine.status !== "playing") engine.status = "playing";
    const at = time ?? engine.context.currentTime;
    this.timeline.noteOn(key, pad, velocity, at);
    this.notes.add(key);
    engine.scheduledTrigger(
      pad,
      engine.context.currentTime + 0.005,
      velocity,
      "performance",
    );
  }
  release(key: string, time?: number) {
    this.timeline.noteOff(key, time);
    this.notes.delete(key);
  }
  audioTime(timestamp: number) {
    if (!engine.context) return undefined;
    return Math.max(
      0,
      engine.context.currentTime + (timestamp - performance.now()) / 1000,
    );
  }
  async play() {
    await this.callbacks.ready();
    if (this.store.state.playbackMode === "MIDI") {
      if (engine.context.state === "suspended") await engine.context.resume();
      engine.status = "playing";
    } else await engine.play();
    this.timeline.play();
  }
  async pause() {
    this.timeline.pause();
    await engine.pause();
  }
  async stop() {
    this.disarm();
    this.timeline.stop();
    await engine.stop();
  }
  connectHostClock(host: HostClock | null) {
    this.timeline.connectHost(host);
    this.transportStatus();
  }
  private transportStatus() {
    const s = this.timeline.snapshot(),
      waiting =
        this.store.state.clockMode === "SYNC" &&
        this.store.state.clockSource !== "internal" &&
        !s.running;
    this.el("midi-transport-status").textContent =
      `${this.timeline.armed ? "● MIDI REC ARMED · " : ""}${this.timeline.running ? "MIDI PLAY" : "MIDI STOPPED"} · ${this.store.state.clockMode}${waiting ? " · WAITING FOR HOST" : ""}`;
    for (const id of ["midi-rec", "editor-rec"]) {
      this.el(id).classList.toggle("armed", this.timeline.armed);
      this.el(id).setAttribute("aria-pressed", String(this.timeline.armed));
    }
  }
  refresh() {
    const s = this.store.state,
      c = this.store.clip;
    const clips = this.el<HTMLSelectElement>("clip-select");
    clips.replaceChildren(...s.clips.map((c) => new Option(c.name, c.id)));
    clips.value = c.id;
    this.input("clip-name").value = c.name;
    this.input("clip-length").value = String(c.length);
    this.input("clip-bpm").value = String(s.bpm);
    this.input("clip-bpm").disabled = s.timeBase === "seconds";
    this.input("clip-swing").disabled = s.timeBase === "seconds";
    this.input("clip-quantize").disabled = s.timeBase === "seconds";
    this.input("clip-units").value = s.timeBase ?? "beats";
    this.input("clip-source").value =
      s.clockSource ?? (s.clockMode === "SYNC" ? "host" : "internal");
    this.input("clip-swing").value = String(s.swing ?? 0);
    this.el("length-units").textContent =
      s.timeBase === "seconds" ? "SECONDS" : "BEATS";
    this.el("event-time-units").textContent =
      s.timeBase === "seconds" ? "SECONDS" : "BEATS";
    this.input("clip-clock").value = s.clockMode;
    this.input("clip-quantize").value = s.quantization;
    this.input("playback-mode").value = s.playbackMode;
    this.el("clip-undo").toggleAttribute(
      "disabled",
      !this.store.undoStack.length,
    );
    this.el("clip-redo").toggleAttribute(
      "disabled",
      !this.store.redoStack.length,
    );
    const list = this.el<HTMLSelectElement>("event-select");
    list.replaceChildren(
      new Option("Select trigger", ""),
      ...c.events.map(
        (e) =>
          new Option(
            `PAD ${e.lane + 1} · ${e.beat.toFixed(3)} · v${Math.round(e.velocity * 127)}`,
            e.id,
          ),
      ),
    );
    list.value = this.selected ?? "";
    const e = c.events.find((e) => e.id === this.selected);
    if (e) {
      this.input("event-beat").value = String(e.beat);
      this.input("event-lane").value = String(e.lane);
      this.input("event-velocity").value = String(e.velocity);
    }
    this.el("event-duration").textContent = e
      ? `Original onset ${e.originalBeat.toFixed(4)} beats · duration ${e.duration?.toFixed(4) ?? "unknown"} beats`
      : "";
    this.transportStatus();
    this.draw();
  }
  private draw() {
    const ctx = this.canvas.getContext("2d")!,
      w = this.canvas.width,
      h = this.canvas.height,
      label = 210,
      top = 32,
      row = 62,
      grid = w - label,
      c = this.store.clip;
    ctx.fillStyle = "#102219";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "17px monospace";
    ctx.textBaseline = "middle";
    const lanes = [6, 7, 8, 3, 4, 5, 0, 1, 2];
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? "#173225" : "#132c20";
      ctx.fillRect(0, top + i * row, w, row);
      ctx.fillStyle = "#baf3cf";
      const p = pads[lanes[i]];
      let name = p.buffer ? p.name : `PAD ${p.id + 1}`;
      if (name.length > 15) name = name.slice(0, 14) + "…";
      ctx.fillText(
        `${String(p.id + 1).padStart(2, "0")} ${name}`,
        8,
        top + i * row + row / 2,
      );
    }
    const step =
        stepSize(
          this.store.state.timeBase === "seconds"
            ? "OFF"
            : this.store.state.quantization,
        ) || 0.25,
      count = Math.min(1024, Math.ceil(c.length / step));
    for (let i = 0; i <= count; i++) {
      const beat = (i * c.length) / count,
        x = label + (beat / c.length) * grid;
      ctx.strokeStyle =
        Math.abs(beat - Math.round(beat)) < 0.001 ? "#4c795e" : "#294a36";
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (i % Math.max(1, Math.ceil(count / 16)) === 0) {
        ctx.fillStyle = "#89bba0";
        ctx.fillText(beat.toFixed(beat % 1 ? 1 : 0), x + 3, 15);
      }
    }
    for (const e of c.events) {
      if (e.beat >= c.length) continue;
      const y = top + lanes.indexOf(e.lane) * row,
        x = label + (e.beat / c.length) * grid;
      ctx.fillStyle = e.id === this.selected ? "#ffca62" : "#6dd5a4";
      ctx.fillRect(
        x,
        y + row * (1 - e.velocity) * 0.5 + 8,
        Math.max(8, Math.min(22, (grid / c.length) * 0.15)),
        row * 0.7 * Math.max(0.15, e.velocity),
      );
      if (e.duration) {
        ctx.strokeStyle = "#76aa87";
        ctx.beginPath();
        ctx.moveTo(x, y + row - 6);
        ctx.lineTo(
          Math.min(w, x + (e.duration / c.length) * grid),
          y + row - 6,
        );
        ctx.stroke();
      }
    }
    if (this.timeline.running) {
      const x =
        label +
        (wrap(this.timeline.snapshot().beat, c.length) / c.length) * grid;
      ctx.strokeStyle = "#ffe9a0";
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
  private installGestures() {
    const lanes = [6, 7, 8, 3, 4, 5, 0, 1, 2];
    let gesture: {
      mode: "paint" | "erase" | "move";
      id?: string;
      last?: number;
      lane?: number;
    } | null = null;
    const position = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect(),
        x = ((e.clientX - r.left) * 1200) / r.width,
        y = ((e.clientY - r.top) * 590) / r.height;
      return {
        lane: lanes[Math.min(8, Math.max(0, Math.floor((y - 32) / 62)))],
        beat: Math.max(
          0,
          Math.min(
            this.store.clip.length - 1e-6,
            ((x - 210) / 990) * this.store.clip.length,
          ),
        ),
        valid: x >= 210 && y >= 32,
      };
    };
    const apply = (e: PointerEvent) => {
      if (!gesture) return;
      const p = position(e);
      if (!p.valid) return;
      const step = stepSize(this.store.state.quantization) || 0.03125,
        b = stepSize(this.store.state.quantization)
          ? Math.floor(p.beat / step) * step
          : p.beat;
      if (gesture.mode === "move") {
        this.store.move(
          gesture.id!,
          p.lane,
          quantize(p.beat, this.store.state.quantization),
        );
      } else {
        let from =
            gesture.lane === p.lane && gesture.last !== undefined
              ? gesture.last
              : b,
          to = b;
        if (from > to) [from, to] = [to, from];
        const paint = (beat: number) =>
          gesture!.mode === "erase"
            ? this.store.erase(
                p.lane,
                beat,
                stepSize(this.store.state.quantization),
              )
            : this.store.add(p.lane, beat);
        if (this.store.state.quantization === "OFF") {
          if (gesture.mode === "erase")
            this.store.clip.events = this.store.clip.events.filter(
              (e) =>
                !(
                  e.lane === p.lane &&
                  e.beat >= from - 0.03 &&
                  e.beat <= to + 0.03
                ),
            );
          else paint(b);
        } else for (let x = from; x <= to + 1e-7; x += step) paint(x);
        gesture.last = b;
        gesture.lane = p.lane;
      }
      this.store.notify();
    };
    this.canvas.onpointerdown = (e) => {
      if (e.button !== 0) return;
      const p = position(e);
      if (!p.valid) return;
      e.preventDefault();
      this.disarm();
      this.store.checkpoint();
      this.timeline.invalidate();
      const hit = this.store.clip.events.find(
        (x) =>
          x.lane === p.lane &&
          Math.abs(x.beat - p.beat) <
            Math.max(0.015, this.store.clip.length * 0.012),
      );
      if (hit) this.selected = hit.id;
      gesture = {
        mode: e.ctrlKey ? "erase" : hit ? "move" : "paint",
        id: hit?.id,
      };
      this.canvas.setPointerCapture(e.pointerId);
      if (gesture.mode !== "move") apply(e);
      else this.refresh();
    };
    this.canvas.onpointermove = (e) => {
      if (gesture) apply(e);
    };
    const end = () => {
      if (gesture) {
        gesture = null;
        this.timeline.invalidate();
        this.store.notify();
      }
    };
    this.canvas.onpointerup = end;
    this.canvas.onpointercancel = end;
  }
  private async checkRecovery() {
    try {
      this.restoreSnapshot = await this.recovery.read();
      this.recoveryPending = !!this.restoreSnapshot;
      this.status.textContent = this.restoreSnapshot
        ? "Recovery available. Recover explicitly before editing, or export/save current work to preserve it separately. Autosave is held until recovery is resolved."
        : "Local autosave ready.";
    } catch (e) {
      this.status.textContent = `Local recovery unavailable: ${e}`;
    } finally {
      this.readyState = true;
    }
  }
  async exportProject() {
    const p = await captureProject(this.store.state, this.callbacks.globals()),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(p)], { type: "application/json" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "GMC-9000-project.gmc";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status.textContent =
      "Portable project exported, including sample audio.";
  }
  async load(raw: unknown) {
    if (!this.callbacks.canLoad())
      throw new Error("Finish audio recording before loading a project");
    if (this.busy) throw new Error("Project operation already running");
    this.busy = true;
    try {
      await this.callbacks.ready();
      const p = raw as { format?: string };
      const portable = p?.format === "GRIMISS-GMC-9000";
      if (p?.format === "GRIMISS-GMC-9000") {
        const staged = await stageProject(raw, engine.context);
        await this.stop();
        staged.pads.forEach((p, i) => (pads[i] = { ...p }));
        replaceStudio(staged.studio);
        this.callbacks.applyGlobals(staged.globals);
        this.store.restore(staged.midi);
      } else {
        const legacy = legacySettings(raw);
        await this.stop();
        legacy.pads.forEach((p, i) => Object.assign(pads[i], p));
        this.callbacks.applyGlobals(legacy.globals);
      }
      document.dispatchEvent(new Event("gmc-project-loaded"));
      this.callbacks.render();
      this.refresh();
      this.recoveryPending = false;
      this.dirty = true;
      this.status.textContent = portable
        ? "Project loaded. Audio restored; transport stopped."
        : "Legacy settings applied; existing audio and MIDI clips retained.";
    } finally {
      this.busy = false;
    }
  }
  private async recover(key = "latest") {
    const p =
      key === "latest" && this.restoreSnapshot
        ? this.restoreSnapshot
        : await this.recovery.read(key);
    if (!p) throw new Error("No recovery snapshot available");
    await this.load(p);
  }
  private async autosave() {
    if (
      !this.readyState ||
      this.recoveryPending ||
      !this.dirty ||
      this.saving ||
      this.busy ||
      this.timeline.armed
    )
      return;
    this.saving = true;
    this.dirty = false;
    try {
      await this.recovery.save(
        await captureProject(this.store.state, this.callbacks.globals()),
      );
      this.status.textContent = "Project autosaved locally (with audio).";
    } catch (e) {
      this.dirty = true;
      this.status.textContent = `Autosave failed; export your project: ${e}`;
    } finally {
      this.saving = false;
    }
  }
}
