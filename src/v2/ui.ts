import { pads, settings, type Pad } from "../state";
import { engine } from "../audio/engine";
import { audioInput, AudioInput } from "../audio/input";
import { wavBytes } from "../project";
import { modeOf, padDefaults, studio, type FXState } from "./model";
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
  dialog: HTMLDialogElement;
  wave: HTMLCanvasElement;
  recorder = new AudioInput();
  resampling = false;
  destination = 0;
  exporting = false;
  clipboard: Pad | null = null;
  zoom = 1;
  scroll = 0;
  private held = new Map<number, { released: boolean; pad: number; starting:boolean }>();
  private suppress = new Map<number, number>();
  constructor(public app: AppUI) {
    const nav = document.createElement("div");
    nav.className = "v2-controls";
    nav.innerHTML =
      "<b>WORKFLOW</b>" +
      ["SAMPLE", "EDIT", "PLAY", "SONG"]
        .map((n) => `<button data-screen="${n}">${n}</button>`)
        .join("") +
      '<button id="quick-resample">RESAMPLE</button><button id="quick-stutter">STUTTER</button><button id="quick-reverse">REVERSE FX</button><button id="quick-scene">CAPTURE SCENE</button>';
    document.querySelector("#app")!.append(nav);
    this.dialog = document.createElement("dialog");
    this.dialog.id = "v2-panel";
    this.dialog.innerHTML = `<h2 id="v2-title">GMC-9000 · SAMPLE</h2><div class="v2-tabs">${["SAMPLE", "EDIT", "PLAY", "SONG"].map((n) => `<button data-screen="${n}">${n}</button>`).join("")}<button id="v2-close">BACK TO PADS</button></div><p id="v2-status" role="status">Ready. All edits are non-destructive.</p><div id="v2-sample" class="v2-section"><p>Choose a pad, then record or import. Hold an empty hardware pad to record and release to finish. Microphone access requires HTTPS and permission.</p><label>PAD <select id="v2-pad"></select></label><button id="v2-rec">REC / FINISH INPUT</button><button id="v2-import">IMPORT WAV</button><button id="v2-audition">AUDITION</button><label>OTHER PAD <select id="v2-other"></select></label><button id="v2-copy">COPY AUDIO + SETTINGS</button><button id="v2-duplicate">DUPLICATE TO OTHER</button><button id="v2-swap">SWAP PADS</button><button id="v2-clear">CLEAR (UNDOABLE)</button><button id="v2-export-pad">EXPORT SELECTED WAV</button><button id="v2-undo">UNDO PAD EDIT</button><button id="v2-redo">REDO PAD EDIT</button><p>Drop WAV files directly onto a hardware pad. Settings-only COPY/PASTE remain on the chassis.</p></div><div id="v2-edit" class="v2-section"><canvas id="v2-wave" width="1000" height="200" aria-label="Waveform with draggable start and end trim markers"></canvas><label>ZOOM <input id="v2-zoom" type="range" min="1" max="32" value="1" step=".1"></label><label>SCROLL <input id="v2-scroll" type="range" min="0" max="1" value="0" step=".001"></label><div class="v2-grid">${[
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
      )}</div><label><input id="fx-characterBypass" type="checkbox"> CHARACTER BYPASS</label><label><input id="fx-stutter" type="checkbox"> STUTTER ON</label><label><input id="fx-reverse" type="checkbox"> REVERSE NEW VOICES</label><p>Delay/reverb amounts and ON switches remain on the hardware panel. Filter bypass: fully open at 22 kHz; resonance defaults to 0.707. Reverse affects new voices and does not reverse already sounding buffers.</p><h3>INTERNAL RESAMPLING</h3><label>DESTINATION <select id="resample-destination"></select></label><button id="resample-start">START OUTPUT CAPTURE</button><button id="resample-stop">FINISH / ASSIGN</button><p>Captures the audible stereo output, including active pads and live effect changes. Destination must be empty. Sources are never overwritten; clear/undo or select an empty pad first. Recording has a muted capture output to avoid feedback.</p></div><div id="v2-song" class="v2-section"><div id="song-content"></div></div>`;
    document.body.append(this.dialog);
    this.wave = this.el("v2-wave");
    document
      .querySelectorAll<HTMLElement>("[data-screen]")
      .forEach((b) => (b.onclick = () => this.open(b.dataset.screen!)));
    this.el("v2-close").onclick = () => this.dialog.close();
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
      Object.assign(pads[target], source, { id: target, armed: false });
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
      Object.assign(pads[a], pads[b], { id: a, armed: false });
      Object.assign(pads[b], old, { id: b, armed: false });
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
        const b = pads[app.selected()].buffer;
        if (!b) throw new Error("Selected pad is empty");
        downloadWav(b, pads[app.selected()].name);
        this.status(
          "Exported original audio. Use resampling to export edits/effects.",
        );
      });
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
    for (const id of ["characterBypass", "stutter", "reverse"])
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
    (studio.fx as unknown as Record<string, unknown>)[key] = value;
    engine.setFX(studio.fx, when);
    this.app.midi.changed();
    document.dispatchEvent(
      new CustomEvent("gmc-fx-move", { detail: { key, value, time: when } }),
    );
    this.refreshFX();
  }
  refreshFX() {
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
    if (this.exporting || this.resampling || audioInput.recording)
      throw new Error("Finish the current recording first");
    if (pads[destination].buffer)
      throw new Error(
        "Choose an EMPTY destination pad; source audio is preserved",
      );
    await this.app.ready();
    this.destination = destination;
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
          if(this.held.size||audioInput.recording||this.resampling){this.status('Finish the current capture first');return;}
          const hold = { released: false, pad: id, starting:true };
          this.held.set(e.pointerId, hold);
          this.suppress.set(id, performance.now() + 60000);
          this.app.select(id);
          void this.safe(async () => {
            await this.app.ready();
            if (!audioInput.source)
              await audioInput.connect(this.input("audio-input").value);
            if (hold.released){this.held.delete(e.pointerId);this.suppress.set(id,performance.now()+400);return;}
            try{await audioInput.start();}finally{hold.starting=false;}

            this.status(`RECORDING PAD ${id + 1} · RELEASE TO FINISH`);
            if (hold.released) await this.endHold(e.pointerId);
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
  private async endHold(pointer: number) {
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
  }
}
