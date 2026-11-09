import { renderPad } from "../audio/region";
import { SongController } from "./song";
import { pads, settings, type Pad } from "../state";
import { engine } from "../audio/engine";
import { audioInput, AudioInput } from "../audio/input";
import { wavBytes, captureProject } from "../project";
import {
  modeOf,
  padDefaults,
  studio,
  songSeconds,
  type FXState,
} from "./model";
import type { MidiEditor } from "../midi-editor";
interface AppUI {
  selected: () => number;
  select: (id: number) => void;
  render: () => void;
  checkpoint: () => void;
  ready: () => Promise<void>;
  finishRecording: () => Promise<void>;
  midi: MidiEditor;
}
export function downloadWav(buffer: AudioBuffer, name: string) {
  const url = URL.createObjectURL(
      new Blob([wavBytes(buffer)], { type: "audio/wav" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name + ".wav";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export class StudioUI {
  song!: SongController;
  dialog: HTMLDialogElement;
  wave: HTMLCanvasElement;
  recorder = new AudioInput();
  resampling = false;
  inputOwned = false;
  private heldEnding: Promise<void> | null = null;
  destination = 0;
  exporting = false;
  private exportRestore: unknown = null;
  private exportToken = 0;
  private exportPreparing = false;
  clipboard: Pad | null = null;
  zoom = 1;
  scroll = 0;
  private held = new Map<
    number,
    { released: boolean; pad: number; starting: boolean }
  >();
  private suppress = new Map<number, number>();
  constructor(public app: AppUI) {
    const nav = document.createElement("div");
    nav.className = "v2-controls";
    nav.innerHTML =
      "<b>WORKFLOW</b>" +
      ["SAMPLE", "EDIT", "PLAY", "SONG"]
        .map((n) => `<button data-screen="${n}">${n}</button>`)
        .join("") +
      '<button id="quick-fx">FX</button><button id="quick-resample">RESAMPLE</button><button id="quick-stutter">STUTTER</button><button id="quick-reverse">REVERSE FX</button><button id="quick-scene">CAPTURE SCENE</button>';
    document.querySelector("#app")!.append(nav);
    this.dialog = document.createElement("dialog");
    this.dialog.id = "v2-panel";
    this.dialog.innerHTML = `<h2 id="v2-title">GMC-9000 · SAMPLE</h2><div class="v2-tabs">${["SAMPLE", "EDIT", "PLAY", "SONG"].map((n) => `<button data-screen="${n}">${n}</button>`).join("")}<button id="v2-effects">EFFECTS</button><button id="v2-close">BACK TO PADS</button></div><p id="v2-status" role="status">Ready. All edits are non-destructive.</p><div id="v2-sample" class="v2-section"><p>Choose a pad, then record or import. Hold an empty hardware pad to record and release to finish. Microphone access requires HTTPS and permission.</p><label>PAD <select id="v2-pad"></select></label><button id="v2-rec">REC / FINISH INPUT</button><button id="v2-import">IMPORT WAV</button><button id="v2-audition">AUDITION</button><label>OTHER PAD <select id="v2-other"></select></label><button id="v2-copy">COPY AUDIO + SETTINGS</button><button id="v2-duplicate">DUPLICATE TO OTHER</button><button id="v2-swap">SWAP PADS</button><button id="v2-clear">CLEAR (UNDOABLE)</button><button id="v2-export-pad">EXPORT EDITED WAV</button><button id="v2-export-original">EXPORT ORIGINAL WAV</button><button id="v2-load-project">LOAD PROJECT</button><button id="v2-legacy-export">EXPORT LEGACY SETTINGS</button><button id="v2-undo">UNDO PAD EDIT</button><button id="v2-redo">REDO PAD EDIT</button><p>Drop WAV files directly onto a hardware pad. Settings-only COPY/PASTE remain on the chassis.</p></div><div id="v2-edit" class="v2-section"><canvas id="v2-wave" width="1000" height="200" aria-label="Waveform with draggable start and end trim markers"></canvas><label>ZOOM <input id="v2-zoom" type="range" min="1" max="32" value="1" step=".1"></label><label>SCROLL <input id="v2-scroll" type="range" min="0" max="1" value="0" step=".001"></label><div class="v2-grid">${[
      ["start", 0, 0.999, 0.001],
      ["end", 0.001, 1, 0.001],
      ["speed", 0.25, 2, 0.01],
      ["pitch", -24, 24, 0.1],
      ["stretch", 0.25, 4, 0.01],
      ["fadeIn", 0, 5, 0.001],
      ["fadeOut", 0, 5, 0.001],
      ["crossfade", 0, 0.5, 0.001],
      ["level", 0, 1, 0.01],
      ["pan", -1, 1, 0.01],
      ["play", 1, 99, 1],
      ["rest", 0, 99, 1],
      ["probability", 0, 1, 0.01],
      ["every", 1, 99, 1],
    ]
      .map(
        ([id, min, max, step]) =>
          `<label>${String(id).toUpperCase()} <input data-pad-field="${id}" id="edit-${id}" type="number" min="${min}" max="${max}" step="${step}"></label>`,
      )
      .join(
        "",
      )}<label>MODE <select id="v2-mode"><option>ONE SHOT</option><option>LOOP</option><option>CYCLE</option></select></label><label>RETRIGGER <select id="v2-retrigger"><option value="layer">OVERLAP</option><option value="replace">REPLACE</option></select></label></div><button id="v2-reverse">REVERSE SAMPLE</button><button id="edit-audition">AUDITION</button><button id="edit-undo">UNDO</button><button id="edit-redo">REDO</button><p>Pitch/stretch use cached granular overlap-add: creative texture, not transparent studio time stretching. SPEED retains its original rate/pitch behavior. Fades and crossfade values are seconds. Start/end are normalized loop points.</p></div><div id="v2-play" class="v2-section"><h3>CHARACTER & PERFORMANCE EFFECTS</h3><div class="v2-grid">${[
      ["characterAmount", 0, 1, 0.01],
      ["bandwidth", 500, 22000, 10],
      ["saturation", 0, 1, 0.01],
      ["filter", 30, 22000, 10],
      ["resonance", 0.1, 20, 0.1],
      ["pitch", -24, 24, 0.1],
      ["stutterSeconds", 0.02, 1, 0.005],
      ["delayTime", 0.02, 1.5, 0.01],
      ["delayFeedback", 0, 0.85, 0.01],
    ]
      .map(
        ([id, min, max, step]) =>
          `<label>${String(id).toUpperCase()}<input data-fx-field="${id}" id="fx-${id}" type="range" min="${min}" max="${max}" step="${step}"><output id="value-${id}"></output></label>`,
      )
      .join(
        "",
      )}</div><label><input id="fx-characterBypass" type="checkbox"> CHARACTER BYPASS</label><label><input id="fx-stutter" type="checkbox"> STUTTER ON</label><label><input id="fx-reverse" type="checkbox"> REVERSE NEW VOICES</label><label><input id="fx-filterBypass" type="checkbox"> FILTER BYPASS</label><label><input id="fx-delay-enabled" type="checkbox"> DELAY ON</label><label>DELAY WET <input id="fx-delay-wet" type="range" min="0" max=".8" step=".01"></label><label><input id="fx-reverb-enabled" type="checkbox"> REVERB ON</label><label>REVERB WET <input id="fx-reverb-wet" type="range" min="0" max=".8" step=".01"></label><button id="fx-auto-rec">RECORD FX MOVEMENTS</button><button id="fx-auto-play">PLAY / LOOP FX</button><button id="fx-auto-stop">STOP FX AUTOMATION</button><p id="fx-auto-status"></p><p>Wet controls mirror the hardware; dry output remains present. Reverse affects new voices; use sample REV to restart an active loop in reverse.</p><h3>INTERNAL RESAMPLING</h3><label>DESTINATION <select id="resample-destination"></select></label><button id="resample-start">START OUTPUT CAPTURE</button><button id="resample-stop">FINISH / ASSIGN</button><p>Captures the audible stereo output, including active pads and live effect changes. Destination must be empty. Sources are never overwritten; clear/undo or select an empty pad first. Recording has a muted capture output to avoid feedback.</p></div><div id="v2-song" class="v2-section"><div id="song-content"></div></div>`;
    document.body.append(this.dialog);
    this.wave = this.el("v2-wave");
    document
      .querySelectorAll<HTMLElement>("[data-screen]")
      .forEach((b) => (b.onclick = () => this.open(b.dataset.screen!)));
    this.el("v2-close").onclick = () => this.dialog.close();
    for (const id of ["quick-fx", "v2-effects"])
      this.el(id).onclick = () => this.open("PLAY", true);
    for (const id of ["v2-pad", "v2-other", "resample-destination"]) {
      const select = this.el<HTMLSelectElement>(id);
      for (let i = 0; i < 9; i++)
        select.add(new Option(`PAD ${i + 1}`, String(i)));
    }
    this.el<HTMLSelectElement>("v2-other").value = "1";
    this.el("v2-pad").onchange = () => {
      app.select(Number(this.input("v2-pad").value));
      this.refresh();
    };
    this.el("v2-rec").onclick = () =>
      this.safe(async () => {
        if (audioInput.recording) await app.finishRecording();
        else this.el("rec").click();
      });
    this.el("v2-import").onclick = () => this.el("load").click();
    for (const id of ["v2-audition", "edit-audition"])
      this.el(id).onclick = () =>
        this.safe(async () => {
          await app.ready();
          await engine.trigger(app.selected(), true);
        });
    this.el("v2-copy").onclick = () => {
      this.clipboard = { ...pads[app.selected()] };
      this.status(
        "Audio and settings copied. Choose another pad, then Duplicate.",
      );
    };
    this.el("v2-duplicate").onclick = () => {
      const source = this.clipboard ?? pads[app.selected()],
        target = Number(this.input("v2-other").value);
      app.checkpoint();
      engine.cancel(target);
      pads[target] = { ...source, id: target, armed: false };
      this.changed();
      this.status(
        `Duplicated audio into PAD ${target + 1}; UNDO restores its previous sample.`,
      );
    };
    this.el("v2-swap").onclick = () => {
      const a = app.selected(),
        b = Number(this.input("v2-other").value);
      if (a === b) return;
      app.checkpoint();
      engine.cancel(a);
      engine.cancel(b);
      const old = { ...pads[a] };
      const other = { ...pads[b] };
      pads[a] = { ...other, id: a, armed: false };
      pads[b] = { ...old, id: b, armed: false };
      this.changed();
    };
    this.el("v2-clear").onclick = () => {
      this.el("clear").click();
      this.refresh();
    };
    for (const [id, target] of [
      ["v2-undo", "undo"],
      ["v2-redo", "redo"],
      ["edit-undo", "undo"],
      ["edit-redo", "redo"],
    ])
      this.el(id).onclick = () => {
        this.el(target).click();
        this.refresh();
      };
    this.el("v2-export-pad").onclick = () =>
      this.safe(async () => {
        const p = pads[app.selected()];
        downloadWav(await renderPad(p), p.name + " edited");
        this.status(
          "Exported edited region, speed, pitch/stretch, fades, level and pan. Use RESAMPLE for global effects.",
        );
      });
    this.el("v2-export-original").onclick = () =>
      this.safe(() => {
        const p = pads[app.selected()];
        if (!p.buffer) throw new Error("Selected pad is empty");
        downloadWav(p.buffer, p.name + " original");
      });
    this.el("v2-load-project").onclick = () => this.el("project-load").click();
    this.el("v2-legacy-export").onclick = () =>
      this.el("save").dispatchEvent(
        new MouseEvent("click", { shiftKey: true, bubbles: true }),
      );
    document
      .querySelectorAll<HTMLInputElement>("[data-pad-field]")
      .forEach((input) => {
        input.onchange = () => {
          const p = pads[app.selected()],
            key = input.dataset.padField as keyof Pad,
            value = Number(input.value);
          if (
            !Number.isFinite(value) ||
            value < Number(input.min) ||
            value > Number(input.max)
          )
            return this.refresh();
          app.checkpoint();
          if (key === "start") p.start = Math.min(p.end - 0.001, value);
          else if (key === "end") p.end = Math.max(p.start + 0.001, value);
          else (p as unknown as Record<string, unknown>)[key] = value;
          engine.changed(p.id);
          this.changed();
        };
      });
    this.el("v2-mode").onchange = () => {
      app.checkpoint();
      const p = pads[app.selected()];
      p.mode = this.input("v2-mode").value as Pad["mode"];
      p.loop = p.mode !== "ONE SHOT";
      if (p.mode === "LOOP" && p.crossfade === undefined) p.crossfade = 0.005;
      if (!p.loop) {
        engine.cancel(p.id);
        p.armed = false;
      }
      engine.changed(p.id);
      this.changed();
    };
    this.el("v2-retrigger").onchange = () => {
      app.checkpoint();
      pads[app.selected()].retrigger = this.input("v2-retrigger").value as
        "layer" | "replace";
      this.changed();
    };
    this.el("v2-reverse").onclick = () => {
      this.el("f1").click();
      this.refresh();
    };
    this.el("v2-zoom").oninput = () => {
      this.zoom = Number(this.input("v2-zoom").value);
      this.draw();
    };
    this.el("v2-scroll").oninput = () => {
      this.scroll = Number(this.input("v2-scroll").value);
      this.draw();
    };
    document
      .querySelectorAll<HTMLInputElement>("[data-fx-field]")
      .forEach(
        (input) =>
          (input.oninput = () =>
            this.fx(
              input.dataset.fxField as keyof FXState,
              Number(input.value),
            )),
      );
    for (const id of ["characterBypass", "stutter", "reverse", "filterBypass"])
      this.el("fx-" + id).onchange = () =>
        this.fx(
          id as keyof FXState,
          this.el<HTMLInputElement>("fx-" + id).checked,
        );
    this.el("quick-stutter").onpointerdown = () => this.fx("stutter", true);
    for (const event of ["pointerup", "pointercancel", "pointerleave"])
      this.el("quick-stutter").addEventListener(event, () =>
        this.fx("stutter", false),
      );
    this.el("quick-reverse").onclick = () =>
      this.fx("reverse", !studio.fx.reverse);
    this.el("quick-resample").onclick = () => {
      this.open("PLAY", true);
      const empty = pads.find((p) => !p.buffer);
      if (empty) this.input("resample-destination").value = String(empty.id);
    };
    this.el("resample-start").onclick = () =>
      this.safe(() =>
        this.startResample(Number(this.input("resample-destination").value)),
      );
    this.el("resample-stop").onclick = () =>
      this.safe(() => this.finishResample());
    const learn = this.el<HTMLSelectElement>("midi-target");
    for (const key of [
      "filter",
      "resonance",
      "pitch",
      "characterAmount",
      "bandwidth",
      "saturation",
      "stutterSeconds",
      "delayTime",
      "delayFeedback",
    ])
      learn.add(new Option("FX " + key, "fx-" + key));
    this.song = new SongController(this);
    for (const kind of ["delay", "reverb"] as const) {
      this.el("fx-" + kind + "-wet").oninput = () => {
        const g = this.app.midi.getGlobals(),
          key = kind === "delay" ? "delayAmount" : "reverbAmount",
          value = Number(this.input("fx-" + kind + "-wet").value);
        g[key] = value;
        this.app.midi.setGlobals(g);
        this.song.record(
          "global." + key,
          value,
          engine.context?.currentTime ?? 0,
        );
      };
      this.el("fx-" + kind + "-enabled").onchange = () => {
        const g = this.app.midi.getGlobals(),
          key = kind === "delay" ? "delayOn" : "reverbOn",
          on = this.el<HTMLInputElement>("fx-" + kind + "-enabled").checked;
        g[key] = on;
        this.app.midi.setGlobals(g);
        this.song.record(
          "global." + key,
          on ? 1 : 0,
          engine.context?.currentTime ?? 0,
        );
      };
    }
    this.el("fx-auto-rec").onclick = () => this.el("auto-rec").click();
    this.el("fx-auto-play").onclick = () => this.el("auto-play").click();
    this.el("fx-auto-stop").onclick = () => this.el("auto-stop").click();
    this.dialog.addEventListener("cancel", (e) => {
      if (this.exporting) {
        e.preventDefault();
        this.status("Use CANCEL EXPORT to restore the original session");
      }
    });
    this.installWave();
    this.installHoldAndDrop();
    this.refresh();
    document.addEventListener("gmc-project-loaded", () => {
      engine.setFX(studio.fx);
      this.refresh();
    });
  }
  el<T extends HTMLElement = HTMLElement>(id: string) {
    return document.getElementById(id)! as T;
  }
  input(id: string) {
    return this.el<HTMLInputElement>(id);
  }
  status(s: string) {
    this.el("v2-status").textContent = s;
    document.querySelector("#status")!.textContent = s;
  }
  async safe(f: () => unknown | Promise<unknown>) {
    try {
      await f();
    } catch (e) {
      this.status(e instanceof Error ? e.message : String(e));
    }
  }
  changed() {
    this.app.render();
    this.app.midi.changed();
    this.refresh();
  }
  open(screen: string, effects = false) {
    if (screen === "PLAY" && !effects) {
      this.dialog.close();
      return;
    }
    this.el("v2-title").textContent = "GMC-9000 · " + screen;
    for (const name of ["SAMPLE", "EDIT", "PLAY", "SONG"])
      this.el("v2-" + name.toLowerCase()).hidden = name !== screen;
    if (!this.dialog.open) this.dialog.showModal();
    this.refresh();
  }
  fx(
    key: keyof FXState,
    value: number | boolean,
    when = engine.context?.currentTime ?? 0,
  ) {
    if (key === "filter") studio.fx.filterBypass = false;
    (studio.fx as unknown as Record<string, unknown>)[key] = value;
    engine.setFX(studio.fx, when);
    this.app.midi.changed();
    document.dispatchEvent(
      new CustomEvent("gmc-fx-move", { detail: { key, value, time: when } }),
    );
    this.refreshFX();
  }
  refreshFX() {
    const g = this.app.midi.getGlobals();
    for (const kind of ["delay", "reverb"] as const) {
      this.input("fx-" + kind + "-wet").value = String(
        kind === "delay" ? g.delayAmount : g.reverbAmount,
      );
      this.el<HTMLInputElement>("fx-" + kind + "-enabled").checked =
        kind === "delay" ? g.delayOn : g.reverbOn;
    }
    for (const key of Object.keys(studio.fx) as (keyof FXState)[]) {
      const input = document.getElementById(
        "fx-" + key,
      ) as HTMLInputElement | null;
      if (input) {
        if (typeof studio.fx[key] === "boolean")
          input.checked = studio.fx[key] as boolean;
        else input.value = String(studio.fx[key]);
      }
      const value = document.getElementById("value-" + key);
      if (value) value.textContent = String(studio.fx[key]);
    }
    this.el("quick-stutter").classList.toggle("armed", studio.fx.stutter);
    this.el("quick-reverse").classList.toggle("armed", studio.fx.reverse);
  }
  refresh() {
    const p = pads[this.app.selected()];
    this.input("v2-pad").value = String(p.id);
    for (const key of [
      "start",
      "end",
      "speed",
      "pitch",
      "stretch",
      "fadeIn",
      "fadeOut",
      "crossfade",
      "level",
      "pan",
      "play",
      "rest",
      "probability",
      "every",
    ])
      this.input("edit-" + key).value = String(
        (p as unknown as Record<string, unknown>)[key] ??
          (padDefaults as unknown as Record<string, unknown>)[key],
      );
    this.input("v2-mode").value = modeOf(p);
    this.input("v2-retrigger").value = p.retrigger ?? "layer";
    this.refreshFX();
    this.draw();
  }
  draw() {
    const p = pads[this.app.selected()],
      ctx = this.wave.getContext("2d")!,
      w = 1000,
      h = 200;
    ctx.fillStyle = "#082219";
    ctx.fillRect(0, 0, w, h);
    if (!p.buffer) {
      ctx.fillStyle = "#a9eac4";
      ctx.font = "24px monospace";
      ctx.fillText("EMPTY PAD · HOLD PAD TO RECORD", 20, 95);
      return;
    }
    const data = p.buffer.getChannelData(0),
      span = 1 / this.zoom,
      left = this.scroll * (1 - span);
    ctx.strokeStyle = "#75edb4";
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const from = Math.floor((left + (x / w) * span) * data.length),
        to = Math.floor((left + ((x + 1) / w) * span) * data.length);
      let peak = 0;
      for (
        let i = from;
        i < to;
        i += Math.max(1, Math.floor((to - from) / 100))
      )
        peak = Math.max(peak, Math.abs(data[i]));
      ctx.moveTo(x, 100 - peak * 90);
      ctx.lineTo(x, 100 + peak * 90);
    }
    ctx.stroke();
    for (const [value, label] of [
      [p.start, "START"],
      [p.end, "END"],
    ] as const) {
      const x = ((value - left) / span) * w;
      ctx.fillStyle = "#ffd47a";
      ctx.fillRect(x - 2, 0, 4, h);
      ctx.font = "16px monospace";
      ctx.fillText(label, Math.min(w - 60, Math.max(0, x)), 18);
    }
  }
  private installWave() {
    let marker: "start" | "end" | null = null;
    const value = (e: PointerEvent) => {
      const r = this.wave.getBoundingClientRect();
      return Math.max(
        0,
        Math.min(
          1,
          this.scroll * (1 - 1 / this.zoom) +
            (e.clientX - r.left) / r.width / this.zoom,
        ),
      );
    };
    this.wave.onpointerdown = (e) => {
      const p = pads[this.app.selected()];
      if (!p.buffer) return;
      this.app.checkpoint();
      const v = value(e);
      marker = Math.abs(p.start - v) < Math.abs(p.end - v) ? "start" : "end";
      this.wave.setPointerCapture(e.pointerId);
      this.wave.onpointermove!(e);
    };
    this.wave.onpointermove = (e) => {
      if (!marker) return;
      const p = pads[this.app.selected()],
        v = value(e);
      if (marker === "start") p.start = Math.min(p.end - 0.001, v);
      else p.end = Math.max(p.start + 0.001, v);
      engine.changed(p.id);
      this.changed();
    };
    this.wave.onpointerup = () => (marker = null);
    this.wave.onpointercancel = () => (marker = null);
  }
  async startResample(destination: number) {
    if (
      this.exporting ||
      this.exportPreparing ||
      this.resampling ||
      audioInput.recording
    )
      throw new Error("Finish the current recording first");
    if (pads[destination].buffer)
      throw new Error(
        "Choose an EMPTY destination pad; source audio is preserved",
      );
    await this.app.ready();
    this.destination = destination;
    this.recorder.maxFrames = Infinity;
    this.recorder.overflow = null;
    await this.recorder.start(engine.output);
    this.resampling = true;
    this.status(
      `RESAMPLING OUTPUT TO PAD ${destination + 1} · perform / move effects, then FINISH`,
    );
  }
  async finishResample() {
    if (!this.resampling) return;
    const buffer = await this.recorder.stop();
    this.resampling = false;
    if (buffer) {
      if (pads[this.destination].buffer) {
        downloadWav(buffer, "Unassigned resample");
        throw new Error(
          "Destination changed: resample downloaded instead of replacing audio",
        );
      }
      this.app.checkpoint();
      Object.assign(pads[this.destination], {
        buffer,
        name: "Resample " + (this.destination + 1),
        start: 0,
        end: 1,
        armed: false,
        mode: "ONE SHOT",
        loop: false,
      });
      this.app.select(this.destination);
      this.changed();
      this.status("Resample assigned. Sources preserved; EDIT is ready.");
    }
  }
  async exportSong() {
    if (
      this.exporting ||
      this.exportPreparing ||
      this.resampling ||
      audioInput.recording
    )
      throw new Error("Finish recording/resampling first");
    if (!studio.arrangement.length)
      throw new Error("Build a song arrangement first");
    for (const step of studio.arrangement) {
      const s = studio.scenes.find((s) => s.id === step.scene);
      if (s?.midi.clockSource === "host" && s.midi.clockMode === "SYNC")
        throw new Error(
          "Use INTERNAL clock in song scenes before rendering. External-host export is not implemented.",
        );
    }
    await this.app.ready();
    const globals = this.app.midi.getGlobals(),
      maxTail = studio.scenes.reduce((max, s) => {
        const fx = s.fx,
          g = s.globals;
        const delay = g.delayOn
          ? fx.delayTime *
            (fx.delayFeedback > 0
              ? Math.ceil(Math.log(0.0001) / Math.log(fx.delayFeedback))
              : 1)
          : 0;
        return Math.max(max, delay, g.reverbOn ? 2.2 : 0, fx.stutter ? 2 : 0);
      }, 0.15);
    const seconds = songSeconds(studio) + maxTail + 0.2,
      budget = 512 * 1024 * 1024;
    if (seconds * engine.context.sampleRate * 8 > budget)
      throw new Error(
        "Song export exceeds the 512 MiB capture budget. Export shorter arrangements.",
      );
    this.exportPreparing = true;
    try {
      this.exportRestore = await captureProject(
        this.app.midi.store.state,
        globals,
      );
    } finally {
      this.exportPreparing = false;
    }
    this.exporting = true;
    const token = ++this.exportToken;
    document.body.classList.add("exporting");
    this.status(
      "RENDERING COMPLETE SONG IN REAL TIME · keep tab foreground; CANCEL restores the original session",
    );
    try {
      await this.song.stop();
      audioInput.monitoring(false);
      await new Promise((r) => setTimeout(r, 20));
      if (token !== this.exportToken || !this.exporting) return;
      engine.clearTails();
      this.recorder.maxFrames = budget / 8;
      this.recorder.overflow = () =>
        void this.cancelExport(
          "Export exceeded memory budget; no truncated WAV was saved.",
        );
      await this.recorder.start(engine.output);
      if (token !== this.exportToken || !this.exporting) {
        await this.recorder.stop();
        return;
      }
      await this.song.play(() => {
        void this.safe(async () => {
          studio.automation.enabled = false;
          const end = engine.context.currentTime + maxTail;
          while (engine.context.currentTime < end) {
            if (!this.exporting || token !== this.exportToken) return;
            await new Promise((r) => setTimeout(r, 30));
          }
          if (token !== this.exportToken) return;
          const started = this.song.started,
            recordStart = this.recorder.captureStarted,
            buffer = await this.recorder.stop();
          if (!buffer) throw new Error("No export audio captured");
          const from = Math.max(
              0,
              Math.round((started - recordStart) * buffer.sampleRate),
            ),
            trimmed = engine.context.createBuffer(
              2,
              Math.max(1, buffer.length - from),
              buffer.sampleRate,
            );
          for (let c = 0; c < 2; c++) {
            const data = trimmed.getChannelData(c);
            data.set(buffer.getChannelData(c).subarray(from));
            const fade = Math.min(
              data.length,
              Math.floor(buffer.sampleRate * 0.02),
            );
            for (let i = 0; i < fade; i++)
              data[data.length - fade + i] *= 1 - i / fade;
          }
          downloadWav(trimmed, "GMC-9000-song");
          await this.restoreAfterExport();
          this.status(
            "Complete stereo song WAV exported with samples, worklet DSP, effects, automation and transitions. Original session restored.",
          );
        });
      });
    } catch (e) {
      await this.cancelExport();
      throw e;
    }
  }
  private async restoreAfterExport() {
    const saved = this.exportRestore;
    try {
      if (saved) await this.app.midi.load(saved);
      this.exportRestore = null;
    } finally {
      this.exporting = false;
      document.body.classList.remove("exporting");
    }
  }
  async cancelExport(message = "Export cancelled; original session restored.") {
    if (!this.exporting) return;
    ++this.exportToken;
    if (this.recorder.recording) await this.recorder.stop();
    await this.song.stop();
    await this.restoreAfterExport();
    this.status(message);
  }
  private installHoldAndDrop() {
    document.querySelectorAll<HTMLElement>("[data-trigger]").forEach((el) => {
      const id = Number(el.dataset.trigger);
      el.addEventListener(
        "pointerdown",
        (e) => {
          if (pads[id].buffer || this.app.midi.timeline.armed) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          el.setPointerCapture(e.pointerId);
          if (this.held.size || audioInput.recording || this.resampling) {
            this.status("Finish the current capture first");
            return;
          }
          const hold = { released: false, pad: id, starting: true };
          this.inputOwned = true;
          this.held.set(e.pointerId, hold);
          this.suppress.set(id, performance.now() + 60000);
          this.app.select(id);
          void this.safe(async () => {
            try {
              await this.app.ready();
              if (!audioInput.source)
                await audioInput.connect(this.input("audio-input").value);
              if (hold.released) {
                this.inputOwned = false;
                this.held.delete(e.pointerId);
                this.suppress.set(id, performance.now() + 400);
                return;
              }
              try {
                await audioInput.start();
              } finally {
                hold.starting = false;
              }

              this.status(`RECORDING PAD ${id + 1} · RELEASE TO FINISH`);
              if (hold.released) await this.endHold(e.pointerId);
            } catch (e) {
              this.held.clear();
              this.inputOwned = false;
              this.suppress.set(id, performance.now() + 400);
              throw e;
            }
          });
        },
        true,
      );
      const release = (e: PointerEvent) => {
        const hold = this.held.get(e.pointerId);
        if (!hold) return;
        e.stopImmediatePropagation();
        hold.released = true;
        void this.safe(() => this.endHold(e.pointerId));
      };
      el.addEventListener("pointerup", release, true);
      el.addEventListener("pointercancel", release, true);
      el.addEventListener(
        "click",
        (e) => {
          if ((this.suppress.get(id) ?? 0) > performance.now()) {
            e.stopImmediatePropagation();
            e.preventDefault();
          }
        },
        true,
      );
      el.ondragover = (e) => {
        e.preventDefault();
      };
      el.ondrop = (e) => {
        e.preventDefault();
        void this.safe(async () => {
          this.app.checkpoint();
          const files = Array.from(e.dataTransfer?.files ?? []);
          for (let i = 0; i < Math.min(9, files.length); i++)
            await engine.import(files[i], (id + i) % 9);
          this.changed();
        });
      };
    });
  }
  async finishHeld() {
    for (const [id, hold] of this.held) {
      hold.released = true;
      if (!hold.starting) await this.endHold(id);
    }
    if (this.heldEnding) await this.heldEnding;
  }
  private async endHold(pointer: number) {
    if (this.heldEnding) return this.heldEnding;
    this.heldEnding = this.completeHold(pointer);
    try {
      await this.heldEnding;
    } finally {
      this.heldEnding = null;
    }
  }
  private async completeHold(pointer: number) {
    const hold = this.held.get(pointer);
    if (!hold || hold.starting) return;
    this.held.delete(pointer);
    if (audioInput.recording) {
      const b = await audioInput.stop();
      if (b) {
        this.app.checkpoint();
        Object.assign(pads[hold.pad], {
          buffer: b,
          name: "Recording " + (hold.pad + 1),
          start: 0,
          end: 1,
          armed: false,
        });
        this.changed();
        this.status("Recording assigned · click pad to audition");
      }
    }
    this.held.delete(pointer);
    this.suppress.set(hold.pad, performance.now() + 400);
    this.inputOwned = false;
  }
}
