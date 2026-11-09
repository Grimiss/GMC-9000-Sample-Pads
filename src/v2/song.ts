import { pads, regionDuration, type Pad } from "../state";
import { engine } from "../audio/engine";
import { uid } from "../events/core";
import {
  studio,
  sceneSeconds,
  songSeconds,
  modeOf,
  type Scene,
  type Movement,
  type FXState,
} from "./model";
import type { StudioUI } from "./ui";
import type { GlobalSettings } from "../project";
export class SongController {
  playing = false;
  paused = false;
  index = 0;
  iteration = 0;
  boundary = 0;
  started = 0;
  pending: Scene | null = null;
  automationRecording = false;
  automationStart = 0;
  autoCursor = 0;
  private applying = false;
  private onComplete: (() => void) | null = null;
  private scheduledIndex = -1;
  private endScheduled = false;
  private autoManual = false;
  constructor(public ui: StudioUI) {
    ui.el("quick-scene").onclick = () => this.capture();
    ui.el("song-content").innerHTML =
      `<div class="v2-grid"><button id="capture-scene">CAPTURE SCENE</button><label>SCENE <select id="scene-select"></select></label><label>NAME <input id="scene-name"></label><label>DURATION <input id="scene-duration" type="number" min=".125" max="3600" step=".125" value="8"></label><label>UNITS <select id="scene-units"><option value="seconds">SECONDS</option><option value="bars">BARS</option></select></label><label>TRANSITION <select id="scene-transition"><option value="immediate">IMMEDIATE</option><option value="bar">NEXT BAR</option><option value="cycle">NEXT PAD CYCLE</option><option value="fade">CROSSFADE</option></select></label><label>FADE SECONDS <input id="scene-fade" type="number" min="0" max="10" step=".1" value=".2"></label><label><input id="scene-continuity" type="checkbox" checked> CONTINUE SAME LOOPS / FX</label></div><button id="scene-recall">RECALL</button><button id="scene-save">SAVE CURRENT CHANGES</button><button id="scene-duplicate">DUPLICATE</button><button id="scene-delete">DELETE + REMOVE FROM SONG</button><button id="scene-add">ADD TO SONG</button><button id="scene-up">SCENE ↑</button><button id="scene-down">SCENE ↓</button><h3>ARRANGEMENT</h3><div id="song-arrangement"></div><button id="song-play">PLAY SONG</button><button id="song-pause">PAUSE / RESUME</button><button id="song-stop">STOP</button><button id="song-prev">PREVIOUS</button><button id="song-next">NEXT / ADVANCE</button><label><input id="song-loop-scene" type="checkbox"> LOOP SCENE</label><label><input id="song-loop-song" type="checkbox"> LOOP SONG</label><p id="song-status" role="status">Capture a scene, then add it to the arrangement.</p><h3>EFFECT AUTOMATION</h3><label>LOOP SECONDS <input id="auto-length" type="number" min=".125" max="3600" step=".125" value="8"></label><label>TAKE <select id="auto-take"><option value="overdub">OVERDUB</option><option value="replace">REPLACE</option></select></label><button id="auto-rec">RECORD MOVEMENTS</button><button id="auto-play">PLAY / LOOP</button><button id="auto-stop">STOP AUTOMATION</button><button id="auto-clear">CLEAR</button><p id="auto-status"></p><h3>COMPLETE SONG EXPORT</h3><button id="song-export">EXPORT FULL STEREO WAV (REAL TIME)</button><button id="song-export-cancel">CANCEL EXPORT</button><p>Output capture includes the actual sampler, worklets, effects, scene transitions and recorded movements. Keep this tab foreground. Export renders the arrangement once, ignoring loop toggles, then captures effect tails.</p>`;
    ui.el("capture-scene").onclick = () => this.capture();
    ui.el("scene-select").onchange = () => this.refresh();
    const edit = () => {
      const scene = this.selected();
      if (!scene) return;
      const duration = Number(ui.input("scene-duration").value),
        fade = Number(ui.input("scene-fade").value);
      if (
        !Number.isFinite(duration) ||
        duration < 0.125 ||
        duration > 3600 ||
        !Number.isFinite(fade) ||
        fade < 0 ||
        fade > 10
      )
        return this.refresh();
      Object.assign(scene, {
        name: ui.input("scene-name").value || "Scene",
        duration,
        units: ui.input("scene-units").value,
        transition: ui.input("scene-transition").value,
        fade,
        continueLoops: ui.el<HTMLInputElement>("scene-continuity").checked,
      });
      this.changed();
    };
    for (const id of [
      "scene-name",
      "scene-duration",
      "scene-units",
      "scene-transition",
      "scene-fade",
      "scene-continuity",
    ])
      ui.el(id).onchange = edit;
    ui.el("scene-recall").onclick = () =>
      ui.safe(async () => {
        const s = this.selected();
        if (s) {
          await ui.app.ready();
          if (engine.context.state === "suspended")
            await engine.context.resume();
          this.queueRecall(s);
        }
      });
    ui.el("scene-save").onclick = () => {
      const s = this.selected();
      if (!s) return;
      const current = this.snapshot();
      Object.assign(s, current, {
        id: s.id,
        name: s.name,
        duration: s.duration,
        units: s.units,
        transition: s.transition,
        fade: s.fade,
        continueLoops: s.continueLoops,
      });
      this.changed();
    };
    ui.el("scene-duplicate").onclick = () => {
      const s = this.selected();
      if (s) {
        const copy = this.copy(s);
        copy.id = uid();
        copy.name += " copy";
        studio.scenes.push(copy);
        this.changed(copy.id);
      }
    };
    ui.el("scene-delete").onclick = () => {
      const s = this.selected();
      if (!s) return;
      studio.arrangement = studio.arrangement.filter((x) => x.scene !== s.id);
      studio.scenes = studio.scenes.filter((x) => x.id !== s.id);
      this.changed();
    };
    ui.el("scene-add").onclick = () => {
      const s = this.selected();
      if (s) {
        studio.arrangement.push({ id: uid(), scene: s.id, repeat: 1 });
        this.changed();
      }
    };
    for (const [id, delta] of [
      ["scene-up", -1],
      ["scene-down", 1],
    ] as const)
      ui.el(id).onclick = () => {
        const s = this.selected();
        if (!s) return;
        const i = studio.scenes.indexOf(s),
          j = i + delta;
        if (j < 0 || j >= studio.scenes.length) return;
        [studio.scenes[i], studio.scenes[j]] = [
          studio.scenes[j],
          studio.scenes[i],
        ];
        this.changed(s.id);
      };
    ui.el("song-play").onclick = () => ui.safe(() => this.play());
    ui.el("song-pause").onclick = () => ui.safe(() => this.pause());
    ui.el("song-stop").onclick = () => ui.safe(() => this.stop());
    ui.el("song-next").onclick = () => ui.safe(() => this.jump(this.index + 1));
    ui.el("song-prev").onclick = () =>
      ui.safe(() => this.jump(Math.max(0, this.index - 1)));
    for (const [id, key] of [
      ["song-loop-scene", "loopScene"],
      ["song-loop-song", "loopSong"],
    ] as const)
      ui.el(id).onchange = () => {
        studio[key] = ui.el<HTMLInputElement>(id).checked;
        this.changed();
      };
    ui.el("auto-rec").onclick = () =>
      ui.safe(async () => {
        await ui.app.ready();
        this.automationRecording = !this.automationRecording;
        if (this.automationRecording) {
          if (ui.input("auto-take").value === "replace")
            studio.automation.events = [];
          this.automationStart = engine.context.currentTime;
          this.autoCursor = 0;
          studio.automation.enabled = true;
        }
        this.changed();
      });
    ui.el("auto-length").onchange = () => {
      const v = Number(ui.input("auto-length").value);
      if (v >= 0.125 && v <= 3600) {
        studio.automation.length = v;
        this.changed();
      } else this.refresh();
    };
    ui.el("auto-play").onclick = () =>
      ui.safe(async () => {
        await ui.app.ready();
        studio.automation.enabled = true;
        this.autoManual = true;
        this.automationStart = engine.context.currentTime;
        this.autoCursor = 0;
        this.changed();
      });
    ui.el("auto-stop").onclick = () => {
      studio.automation.enabled = false;
      this.autoManual = false;
      this.automationRecording = false;
      this.changed();
    };
    ui.el("auto-clear").onclick = () => {
      studio.automation.events = [];
      this.changed();
    };
    document.addEventListener("gmc-fx-move", (e) => {
      const d = (e as CustomEvent).detail;
      this.record(d.key, Number(d.value), d.time);
    });
    document.addEventListener("input", (e) => {
      const id = (e.target as HTMLElement).id,
        map: Record<string, string> = {
          delay: "delayAmount",
          reverb: "reverbAmount",
          master: "master",
          sr: "sr",
          bits: "bits",
        };
      if (map[id])
        this.record(
          "global." + map[id],
          Number((e.target as HTMLInputElement).value),
          engine.context?.currentTime ?? 0,
        );
    });
    document.addEventListener("click", (e) => {
      const id = (e.target as HTMLElement).id,
        now = engine.context?.currentTime ?? 0,
        g = ui.app.midi.getGlobals();
      if (id === "delay-on" || id === "reverb-on") {
        const key = id === "delay-on" ? "delayOn" : "reverbOn";
        this.record("global." + key, g[key] ? 1 : 0, now);
      }
      if (["era80", "era90", "era00"].includes(id)) {
        this.record("global.sr", g.sr, now);
        this.record("global.bits", g.bits, now);
        for (const key of [
          "bandwidth",
          "saturation",
          "characterAmount",
          "characterBypass",
        ] as const)
          this.record(key, Number(studio.fx[key]), now);
      }
    });
    ui.el("song-export").onclick = () => ui.safe(() => ui.exportSong());
    ui.el("song-export-cancel").onclick = () =>
      ui.safe(() => ui.cancelExport());
    document.addEventListener("gmc-project-loaded", () => {
      this.playing = false;
      this.paused = false;
      this.pending = null;
      this.automationRecording = false;
      this.autoManual = false;
      this.automationStart = engine.context?.currentTime ?? 0;
      this.autoCursor = 0;
      this.refresh();
    });
    setInterval(() => this.tick(), 25);
    this.refresh();
  }
  selected() {
    return studio.scenes.find(
      (s) => s.id === this.ui.input("scene-select").value,
    );
  }
  copy(s: Scene): Scene {
    return {
      ...s,
      pads: s.pads.map((p) => ({ ...p })),
      active: s.active ? [...s.active] : undefined,
      midi: structuredClone(s.midi),
      fx: { ...s.fx },
      globals: { ...s.globals },
      automation: structuredClone(s.automation),
    };
  }
  snapshot(): Omit<
    Scene,
    | "id"
    | "name"
    | "duration"
    | "units"
    | "transition"
    | "fade"
    | "continueLoops"
  > {
    return {
      pads: pads.map((p) => ({ ...p })),
      active: pads
        .filter(
          (p) =>
            p.armed ||
            engine.voices.some(
              (v) =>
                v.pad === p.id &&
                ["manual", "performance", "scene"].includes(v.owner) &&
                v.start <= engine.context.currentTime &&
                v.end > engine.context.currentTime,
            ),
        )
        .map((p) => p.id),
      midi: structuredClone(this.ui.app.midi.store.state),
      globals: { ...this.ui.app.midi.getGlobals() },
      fx: { ...studio.fx },
      automation: structuredClone(studio.automation),
    };
  }
  capture() {
    const s: Scene = {
      ...this.snapshot(),
      id: uid(),
      name: `Scene ${studio.scenes.length + 1}`,
      duration: 8,
      units: "seconds",
      transition: "immediate",
      fade: 0.2,
      continueLoops: true,
    };
    studio.scenes.push(s);
    this.changed(s.id);
    this.ui.status(`Captured ${s.name} without interrupting playback`);
    return s;
  }
  changed(selected?: string) {
    this.ui.app.midi.changed();
    this.refresh(selected);
  }
  private nextBoundary(scene: Scene, base: number) {
    if (scene.transition === "bar") {
      const midi = this.ui.app.midi,
        s = midi.timeline.snapshot(base),
        unit =
          midi.store.state.timeBase === "seconds"
            ? (4 * 60) / midi.store.state.bpm
            : 4;
      return (
        base +
        ((Math.ceil((s.beat + 1e-6) / unit) * unit - s.beat) * 60) / s.bpm
      );
    }
    if (scene.transition === "cycle") {
      const ends = pads
        .filter((p) => p.armed && p.buffer)
        .map((p) => {
          const d = regionDuration(p, p.buffer!.duration),
            o = engine.origins.get(p.id) ?? base;
          return o + Math.ceil((base - o + 1e-6) / d) * d;
        });
      if (ends.length) return Math.min(...ends);
    }
    return base;
  }
  queueRecall(scene: Scene) {
    this.playing = false;
    this.paused = false;
    this.onComplete = null;
    const at = this.nextBoundary(scene, engine.context.currentTime);
    if (at - engine.context.currentTime > 0.12) {
      this.pending = scene;
      this.boundary = at;
      this.ui.status(`Queued ${scene.name}`);
    } else this.apply(scene, at);
  }
  apply(scene: Scene, at = engine.context.currentTime) {
    const current = pads.map((p) => ({ ...p })),
      fade =
        scene.transition === "fade"
          ? Math.min(scene.fade, sceneSeconds(scene))
          : 0;
    for (let i = 0; i < 9; i++) {
      const a = current[i],
        b = scene.pads[i],
        same =
          scene.continueLoops &&
          a.buffer === b.buffer &&
          a.start === b.start &&
          a.end === b.end &&
          a.speed === b.speed &&
          a.reverse === b.reverse &&
          a.pitch === b.pitch &&
          a.stretch === b.stretch &&
          a.fadeIn === b.fadeIn &&
          a.fadeOut === b.fadeOut &&
          a.crossfade === b.crossfade &&
          studio.fx.reverse === scene.fx.reverse &&
          modeOf(a) === modeOf(b) &&
          a.armed &&
          b.armed;
      if (!same) {
        for (const v of engine.voices.filter(
          (v) => v.owner === "seq" && v.pad === i,
        )) {
          v.gain.gain.cancelScheduledValues(at);
          v.gain.gain.setValueAtTime(v.gain.gain.value, at);
          v.gain.gain.linearRampToValueAtTime(0, at + Math.max(0.003, fade));
          try {
            v.source.stop(at + Math.max(0.004, fade));
          } catch {}
        }
        engine.origins.delete(i);
        engine.next.delete(i);
      }
      pads[i] = { ...b };
      if (!same && b.armed && b.buffer && modeOf(b) !== "ONE SHOT") {
        engine.beginCycle(i, at);
        engine.sceneFade.set(i, { at, seconds: fade });
      }
      if (same) {
        for (const v of engine.voices.filter(
          (v) => v.owner === "seq" && v.pad === i,
        )) {
          v.gain.gain.setTargetAtTime(
            b.level * v.velocity,
            at,
            Math.max(0.005, fade / 3),
          );
          v.panner.pan.setTargetAtTime(
            b.pan ?? 0,
            at,
            Math.max(0.005, fade / 3),
          );
        }
      }
    }
    const midi = this.ui.app.midi;
    engine.cancelPlan = { when: at, fade };
    midi.timeline.stop();
    engine.cancelOwner("scene");
    const clips = new Map(midi.store.state.clips.map((c) => [c.id, c]));
    for (const c of scene.midi.clips) clips.set(c.id, structuredClone(c));
    midi.store.restore({
      ...structuredClone(scene.midi),
      clips: [...clips.values()],
    });
    midi.timeline.seek(0, at);
    Object.assign(studio.fx, scene.fx);
    this.ui.app.midi.setGlobals(scene.globals as unknown as GlobalSettings, at);
    engine.setFX(studio.fx, at, Math.max(0.015, fade / 3));
    engine.status = "playing";
    if (scene.midi.playbackMode !== "SEQ") midi.timeline.playAt(at);
    engine.cancelPlan = null;
    if (scene.midi.playbackMode !== "MIDI")
      for (let i = 0; i < 9; i++)
        if (
          modeOf(pads[i]) === "ONE SHOT" &&
          (scene.active?.includes(i) ?? pads[i].armed)
        )
          engine.scheduledTrigger(i, at, 1, "scene", scene.id);
    if (!scene.continueLoops) {
      this.automationStart = at;
      this.autoCursor = 0;
    }
    studio.automation = structuredClone(scene.automation);
    this.ui.app.render();
    this.ui.refresh();
    engine.schedule();
  }
  async play(onComplete?: () => void) {
    if (!studio.arrangement.length)
      throw new Error("Add scenes to the song first");
    await this.ui.app.ready();
    await this.ui.app.midi.stop();
    this.playing = true;
    this.paused = false;
    this.index = 0;
    this.iteration = 0;
    this.onComplete = onComplete ?? null;
    this.started = engine.context.currentTime + 0.03;
    this.applyStep(this.started);
    this.refresh();
  }
  private applyStep(at: number) {
    const step = studio.arrangement[this.index],
      scene = studio.scenes.find((s) => s.id === step?.scene);
    if (!scene) throw new Error("Song has a missing scene");
    this.apply(scene, at);
    this.boundary = at + sceneSeconds(scene);
    if (
      this.iteration + 1 >= step.repeat &&
      this.index + 1 < studio.arrangement.length
    ) {
      const next = studio.scenes.find(
        (s) => s.id === studio.arrangement[this.index + 1].scene,
      );
      if (next) this.boundary = this.nextBoundary(next, this.boundary);
    }
    this.scheduledIndex = this.index;
    this.endScheduled = false;
    engine.songEnd = Infinity;
    this.ui.el("song-status").textContent =
      `PLAYING ${this.index + 1}/${studio.arrangement.length}: ${scene.name} · repeat ${this.iteration + 1}/${step.repeat}`;
  }
  async pause() {
    if (!this.playing) return;
    if (this.paused) {
      await engine.context.resume();
      engine.status = "playing";
      this.ui.app.midi.timeline.play();
      this.paused = false;
    } else {
      this.ui.app.midi.timeline.pause();
      await engine.context.suspend();
      engine.status = "paused";
      this.paused = true;
    }
  }
  async stop() {
    this.playing = false;
    this.paused = false;
    this.pending = null;
    this.onComplete = null;
    this.automationRecording = false;
    await this.ui.app.midi.stop();
    this.ui.el("song-status").textContent = "SONG STOPPED";
  }
  async jump(index: number) {
    if (!studio.arrangement.length) return;
    await this.ui.app.ready();
    if (engine.context.state === "suspended") await engine.context.resume();
    this.index =
      (index + studio.arrangement.length) % studio.arrangement.length;
    this.iteration = 0;
    this.playing = true;
    this.paused = false;
    this.applyStep(engine.context.currentTime + 0.01);
    this.refresh();
  }
  record(parameter: string, value: number, time: number) {
    if (!this.automationRecording || this.applying || !Number.isFinite(value))
      return;
    const t =
        (((time - this.automationStart) % studio.automation.length) +
          studio.automation.length) %
        studio.automation.length,
      existing = studio.automation.events.find(
        (e) => e.parameter === parameter && Math.abs(e.time - t) < 0.005,
      );
    if (existing) existing.value = value;
    else
      studio.automation.events.push({ id: uid(), parameter, time: t, value });
    this.ui.app.midi.changed();
    this.ui.el("fx-auto-status").textContent =
      `${this.automationRecording ? "● RECORDING · " : ""}${studio.automation.events.length} recorded movements`;
    this.ui.el("auto-status").textContent =
      `● RECORDING · ${studio.automation.events.length} movements`;
  }
  applyMovement(e: Movement, at: number) {
    this.applying = true;
    try {
      if (e.parameter.startsWith("global.")) {
        const key = e.parameter.slice(7),
          g = { ...this.ui.app.midi.getGlobals() } as unknown as Record<
            string,
            number | boolean
          >;
        g[key] = typeof g[key] === "boolean" ? !!e.value : e.value;
        this.ui.app.midi.setGlobals(g as unknown as GlobalSettings, at);
      } else {
        const key = e.parameter as keyof FXState;
        this.ui.fx(
          key,
          ["stutter", "reverse", "characterBypass", "filterBypass"].includes(
            key,
          )
            ? !!e.value
            : e.value,
          at,
        );
      }
    } finally {
      this.applying = false;
    }
  }
  private tickAutomation(now: number) {
    const a = studio.automation;
    if (
      !a.enabled ||
      !a.events.length ||
      now < this.automationStart ||
      (engine.status !== "playing" &&
        !this.automationRecording &&
        !this.autoManual)
    )
      return;
    const elapsed = now - this.automationStart,
      start =
        this.autoCursor === 0
          ? Math.max(0, elapsed - 0.05)
          : Math.max(this.autoCursor, elapsed),
      end = elapsed + 0.12;
    for (const e of a.events) {
      if (e.time >= a.length) continue;
      const first = Math.max(0, Math.ceil((start - e.time - 1e-8) / a.length)),
        last = Math.floor((end - e.time - 1e-8) / a.length);
      for (let n = first; n <= last; n++)
        this.applyMovement(e, this.automationStart + n * a.length + e.time);
    }
    this.autoCursor = end;
  }
  tick() {
    if (!engine.context || engine.context.state !== "running" || this.paused)
      return;
    const now = engine.context.currentTime;
    this.tickAutomation(now);
    if (this.pending && now + 0.12 >= this.boundary) {
      const scene = this.pending;
      this.pending = null;
      this.apply(scene, this.boundary);
    }
    if (!this.playing || now + 0.12 < this.boundary) return;
    const step = studio.arrangement[this.index];
    if (!step) {
      void this.stop();
      return;
    }
    if (!this.ui.exporting && studio.loopScene) {
      this.applyStep(this.boundary);
      return;
    }
    if (this.iteration + 1 < step.repeat) {
      this.iteration++;
      this.applyStep(this.boundary);
      return;
    }
    if (
      this.index + 1 >= studio.arrangement.length &&
      (!studio.loopSong || this.ui.exporting) &&
      !this.endScheduled
    ) {
      engine.songEnd = this.boundary;
      engine.stopOwnerAt("seq", this.boundary, 0.01);
      engine.stopOwnerAt("midi", this.boundary, 0.01);
      engine.stopOwnerAt("scene", this.boundary, 0.01);
      this.endScheduled = true;
    }
    if (
      this.index + 1 >= studio.arrangement.length &&
      (!studio.loopSong || this.ui.exporting) &&
      now < this.boundary
    )
      return;
    this.iteration = 0;
    if (this.index + 1 < studio.arrangement.length) {
      this.index++;
      const scene = studio.scenes.find(
        (s) => s.id === studio.arrangement[this.index].scene,
      )!;
      this.applyStep(this.boundary);
      this.refresh();
    } else if (studio.loopSong && !this.ui.exporting) {
      this.index = 0;
      this.applyStep(this.boundary);
      this.refresh();
    } else if (now >= this.boundary) {
      this.playing = false;
      this.ui.app.midi.timeline.stop();
      void engine.stop();
      this.ui.el("song-status").textContent = "SONG COMPLETE";
      const callback = this.onComplete;
      this.onComplete = null;
      callback?.();
    }
  }
  refresh(selected?: string) {
    const select = this.ui.el<HTMLSelectElement>("scene-select"),
      value = selected ?? select.value;
    select.replaceChildren(
      ...studio.scenes.map((s) => new Option(s.name, s.id)),
    );
    select.value = studio.scenes.some((s) => s.id === value)
      ? value
      : (studio.scenes[0]?.id ?? "");
    const s = this.selected();
    if (s) {
      this.ui.input("scene-name").value = s.name;
      this.ui.input("scene-duration").value = String(s.duration);
      this.ui.input("scene-units").value = s.units;
      this.ui.input("scene-transition").value = s.transition;
      this.ui.input("scene-fade").value = String(s.fade);
      this.ui.el<HTMLInputElement>("scene-continuity").checked =
        s.continueLoops;
    }
    this.ui.input("auto-length").value = String(studio.automation.length);
    this.ui.el("auto-rec").classList.toggle("armed", this.automationRecording);
    this.ui
      .el("fx-auto-rec")
      .classList.toggle("armed", this.automationRecording);
    this.ui.el("fx-auto-rec").textContent = this.automationRecording
      ? "STOP FX RECORDING"
      : "RECORD FX MOVEMENTS";
    this.ui.el("fx-auto-status").textContent =
      `${this.automationRecording ? "● RECORDING · " : ""}${studio.automation.events.length} recorded movements`;
    this.ui.el("auto-status").textContent =
      `${this.automationRecording ? "● RECORDING · " : ""}${studio.automation.events.length} movements · ${studio.automation.length} second loop`;
    this.ui.el<HTMLInputElement>("song-loop-song").checked = studio.loopSong;
    this.ui.el<HTMLInputElement>("song-loop-scene").checked = studio.loopScene;
    const arrangement = this.ui.el("song-arrangement");
    arrangement.replaceChildren();
    studio.arrangement.forEach((step, i) => {
      const scene = studio.scenes.find((s) => s.id === step.scene),
        row = document.createElement("div");
      row.className =
        "song-step" + (this.playing && this.index === i ? " active" : "");
      row.draggable = true;
      const title = document.createElement("b");
      title.textContent = `${i + 1}. ${scene?.name ?? "MISSING SCENE"}`;
      row.append(title);
      for (const [text, action] of [
        ["↑", () => this.move(i, i - 1)],
        ["↓", () => this.move(i, i + 1)],
        ["JUMP", () => void this.ui.safe(() => this.jump(i))],
        [
          "REMOVE",
          () => {
            studio.arrangement.splice(i, 1);
            this.changed();
          },
        ],
      ] as const) {
        const b = document.createElement("button");
        b.textContent = text;
        b.onclick = action;
        row.append(b);
      }
      const label = document.createElement("label");
      label.textContent = "REPEATS";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.max = "99";
      input.value = String(step.repeat);
      input.onchange = () => {
        const n = Number(input.value);
        if (Number.isInteger(n) && n >= 1 && n <= 99) {
          step.repeat = n;
          this.changed();
        } else this.refresh();
      };
      label.append(input);
      row.append(label);
      row.ondragstart = (e) => e.dataTransfer?.setData("text/plain", String(i));
      row.ondragover = (e) => e.preventDefault();
      row.ondrop = (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer?.getData("text/plain"));
        if (Number.isInteger(from)) this.move(from, i);
      };
      arrangement.append(row);
    });
  }
  private move(from: number, to: number) {
    if (
      from < 0 ||
      to < 0 ||
      from >= studio.arrangement.length ||
      to >= studio.arrangement.length
    )
      return;
    const [step] = studio.arrangement.splice(from, 1);
    studio.arrangement.splice(to, 0, step);
    this.changed();
  }
}
