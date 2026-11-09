import { preparedRegion } from "./audio/region";
import { modeOf, studio, padDefaults } from "./v2/model";
import { StudioUI } from "./v2/ui";
import { installViewportFit } from "./viewport";
import { MidiEditor } from "./midi-editor";
let midiEditor: MidiEditor | undefined;
import { loadDemoSamples } from "./audio/demo";
import { audioInput } from "./audio/input";
import { MidiLearn } from "./midi";
import { hardwareMarkup } from "./interface";
import "./style.css";
import {
  pads,
  randomCounts,
  settings,
  type Pad,
  type PadSettings,
} from "./state";
import { engine } from "./audio/engine";
let selected = 0,
  clipboard: PadSettings | null = null;
let history: Pad[][] = [],
  future: Pad[][] = [];
let sr = 12000,
  bits = 10,
  delayOn = false,
  reverbOn = false,
  delayAmount = 0.25,
  reverbAmount = 0.2;
const $ = <T extends HTMLElement = HTMLElement>(q: string) =>
  document.querySelector<T>(q)!;
loadDemoSamples();
document.querySelector("#app")!.innerHTML = hardwareMarkup();

$("#stretch").closest("label")!.title = "Non-destructive granular time stretch";
$("#rec").title = "Record connected audio input into selected pad";
function message(s: string) {
  $("#status").textContent = s;
}
function checkpoint() {
  history.push(pads.map((p) => ({ ...p })));
  if (history.length > 40) history.shift();
  future = [];
}
function apply(snapshot: Pad[]) {
  snapshot.forEach((s, i) => {
    pads[i] = { ...s };
    engine.changed(i);
  });
  render();
}
function select(id: number) {
  selected = (id + 9) % 9;
  render();
}
function render() {
  midiEditor?.refresh();
  midiEditor?.changed();
  const p = pads[selected];
  $("#lcd-number").textContent = String(selected + 1).padStart(2, "0");
  $("#lcd-name").textContent = p.name;
  $("#loop").textContent = modeOf(p);
  $<HTMLInputElement>("#play-count").value = String(p.play);
  $<HTMLInputElement>("#rest-count").value = String(p.rest);
  for (const key of ["start", "end", "speed", "stretch"] as const) {
    $<HTMLInputElement>("#" + key).value = String(p[key] ?? 1);
    updateKnob(key);
  }
  $<HTMLInputElement>("#pad-level").value = String(p.level);
  document.querySelectorAll<HTMLElement>(".pad").forEach((el) => {
    const id = Number(el.dataset.pad),
      pad = pads[id];
    el.classList.toggle("selected", id === selected);
    el.querySelector(".sample-name")!.textContent = pad.name;
    el.querySelector('[data-count="play"] span')!.textContent = String(
      pad.play,
    ).padStart(2, "0");
    el.querySelector('[data-count="rest"] span')!.textContent = String(
      pad.rest,
    ).padStart(2, "0");
  });
  $("#f1").classList.toggle("active", p.reverse);
  $("#undo").toggleAttribute("disabled", !history.length);
  $("#redo").toggleAttribute("disabled", !future.length);
  drawWave();
}
function updateKnob(id: string) {
  const input = $<HTMLInputElement>("#" + id);
  const angle =
    ((Number(input.value) - Number(input.min)) /
      (Number(input.max) - Number(input.min))) *
      270 -
    135;
  input.parentElement!.style.setProperty("--angle", `${angle}deg`);
  const out = $("#" + id + "-value");
  out.textContent =
    id === "sr"
      ? `${(Number(input.value) / 1000).toFixed(1)}k`
      : id === "bits"
        ? input.value
        : id === "speed" || id === "stretch"
          ? `${Number(input.value).toFixed(2)}×`
          : id === "start" || id === "end"
            ? `${Math.round(Number(input.value) * 100)}%`
            : "";
}
function drawWave() {
  const canvas = $<HTMLCanvasElement>("#waveform"),
    ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 780, 66);
  const p = pads[selected];
  ctx.fillStyle = "#69efb5";
  if (!p.buffer) {
    ctx.font = "20px monospace";
    ctx.fillText("LOAD WAV → READY TO SAMPLE", 45, 41);
    return;
  }
  const data = p.buffer.getChannelData(0);
  ctx.fillStyle = "#123c29";
  ctx.fillRect(0, 0, 780 * p.start, 66);
  ctx.fillRect(780 * p.end, 0, 780 * (1 - p.end), 66);
  ctx.strokeStyle = "#79efba";
  ctx.beginPath();
  for (let x = 0; x < 780; x++) {
    let peak = 0;
    const from = Math.floor((x * data.length) / 780),
      to = Math.floor(((x + 1) * data.length) / 780);
    for (let i = from; i < to; i += Math.max(1, Math.floor((to - from) / 80)))
      peak = Math.max(peak, Math.abs(data[i]));
    ctx.moveTo(x, 33 - peak * 30);
    ctx.lineTo(x, 33 + peak * 30);
  }
  ctx.stroke();
  ctx.fillStyle = "#efffb9";
  ctx.fillRect(780 * p.start, 0, 2, 66);
  ctx.fillRect(780 * p.end - 2, 0, 2, 66);
  const phase = engine.phase(selected);
  if (phase?.audible) {
    ctx.fillStyle = "#fff6cb";
    ctx.fillRect(
      (p.start + phase.position * (p.end - p.start)) * 780,
      0,
      2,
      66,
    );
  }
}
async function safely(fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    message(e instanceof Error ? e.message : String(e));
    console.error(e);
  }
}
async function ready() {
  await engine.init();
  engine.degrade(sr, bits);
  engine.volume(Number($<HTMLInputElement>("#master").value));
  engine.effects("delay", delayOn, delayAmount);
  engine.effects("reverb", reverbOn, reverbAmount);
}
$("#load").onclick = () => $<HTMLInputElement>("#file").click();
$("#file").onchange = () =>
  safely(async () => {
    const input = $<HTMLInputElement>("#file");
    const files = Array.from(input.files ?? []);
    checkpoint();
    for (let i = 0; i < Math.min(files.length, 9); i++) {
      const id = (selected + i) % 9;
      if (!/\.wav$/i.test(files[i].name))
        throw new Error("Please choose a WAV file");
      await engine.import(files[i], id);
    }
    await ready();
    render();
    message(`${files.length} WAV LOADED · CLICK PAD TO PLAY`);
    input.value = "";
  });
document.querySelectorAll<HTMLElement>("[data-trigger]").forEach(
  (el) =>
    (el.onclick = (e) =>
      safely(async () => {
        select(Number(el.dataset.trigger));
        await ready();
        if (midiEditor?.timeline.armed) {
          if ((e as MouseEvent).detail === 0) {
            await midiEditor.perform(selected, 1, `click:${selected}`);
            midiEditor.release(`click:${selected}`);
          }
          return;
        }
        await engine.trigger(selected, (e as MouseEvent).shiftKey);
        message(
          pads[selected].buffer
            ? "PAD " +
                String(selected + 1).padStart(2, "0") +
                " · " +
                (pads[selected].armed ? "CYCLE ARMED" : "ONE SHOT / DISARMED")
            : "PRESS LOAD TO IMPORT A WAV",
        );
      })),
);
document.querySelectorAll<HTMLElement>("[data-trigger]").forEach((el) => {
  el.onpointerdown = (e) => {
    if (!midiEditor?.timeline.armed || e.button !== 0) return;
    const id = Number(el.dataset.trigger);
    select(id);
    el.setPointerCapture(e.pointerId);
    safely(() =>
      midiEditor!.perform(
        id,
        1,
        `pointer:${e.pointerId}`,
        midiEditor!.audioTime(e.timeStamp),
      ),
    );
  };
  el.onpointerup = (e) =>
    midiEditor?.release(
      `pointer:${e.pointerId}`,
      midiEditor.audioTime(e.timeStamp),
    );
  el.onpointercancel = (e) => midiEditor?.release(`pointer:${e.pointerId}`);
});
function randomize(id: number) {
  checkpoint();
  Object.assign(pads[id], randomCounts());
  engine.changed(id);
  render();
  message("RND · COUNTS SET UNTIL CHANGED");
}
document
  .querySelectorAll<HTMLElement>("[data-rnd]")
  .forEach((el) => (el.onclick = () => randomize(Number(el.dataset.rnd))));
$("#lcd-rnd").onclick = () => randomize(selected);
document.querySelectorAll<HTMLElement>("[data-count]").forEach(
  (el) =>
    (el.onclick = () => {
      select(Number(el.dataset.id));
      const key = el.dataset.count === "play" ? "play-count" : "rest-count";
      $<HTMLInputElement>("#" + key).focus();
      $<HTMLInputElement>("#" + key).select();
    }),
);
for (const key of ["play", "rest"] as const) {
  $("#" + key + "-count").onchange = () => {
    const value = Number($<HTMLInputElement>("#" + key + "-count").value);
    if (!Number.isFinite(value)) {
      render();
      return;
    }
    checkpoint();
    pads[selected][key] = Math.max(
      key === "play" ? 1 : 0,
      Math.min(99, Math.round(value)),
    );
    engine.changed(selected);
    render();
  };
}
$("#loop").onclick = () => {
  checkpoint();
  const p = pads[selected],
    modes = ["ONE SHOT", "LOOP", "CYCLE"] as const;
  p.mode = modes[(modes.indexOf(modeOf(p)) + 1) % 3];
  p.loop = p.mode !== "ONE SHOT";
  if (p.mode === "LOOP" && p.crossfade === undefined) p.crossfade = 0.005;
  if (!p.loop) {
    engine.cancel(selected);
    p.armed = false;
  }
  engine.changed(selected);
  render();
};
for (const key of ["start", "end", "speed", "stretch"] as const) {
  $("#" + key).onpointerdown = () => checkpoint();
  $("#" + key).oninput = () => {
    const p = pads[selected],
      v = Number($<HTMLInputElement>("#" + key).value);
    p[key] =
      key === "start"
        ? Math.min(p.end - 0.001, v)
        : key === "end"
          ? Math.max(p.start + 0.001, v)
          : v;
    engine.changed(selected);
    render();
  };
}
$("#f0").onclick = () => {
  message("TRIM · START / END SET THE AUDIBLE REGION");
  $<HTMLInputElement>("#start").focus();
};
$("#f1").onclick = () => {
  checkpoint();
  pads[selected].reverse = !pads[selected].reverse;
  engine.changed(selected);
  render();
  message(pads[selected].reverse ? "REVERSE ON" : "REVERSE OFF");
};
$("#f2").onclick = () => $<HTMLInputElement>("#speed").focus();
$("#f3").onclick = () => {
  $<HTMLInputElement>("#stretch").focus();
  message("GRANULAR STRETCH · EDIT FOR PITCH / FADES");
};
$("#f4").onclick = () => $<HTMLInputElement>("#sr").focus();
$("#f5").onclick = () => $<HTMLInputElement>("#delay").focus();
async function playTransport() {
  if (v2UI?.song.playing) {
    if (v2UI.song.paused) await v2UI.song.pause();
    return;
  }
  await midiEditor!.play();
}
async function pauseTransport() {
  if (v2UI?.song.playing) {
    await v2UI.song.pause();
    return;
  }
  if (engine.status === "paused") await midiEditor!.play();
  else await midiEditor!.pause();
}
async function stopTransport() {
  if (v2UI?.song.playing || v2UI?.song.pending) await v2UI.song.stop();
  else await midiEditor!.stop();
}
$("#play").onclick = () =>
  safely(async () => {
    await ready();
    await playTransport();
    message("TRANSPORT · PLAY");
  });
$("#pause").onclick = () => safely(() => pauseTransport());
$("#stop").onclick = () =>
  safely(async () => {
    if (v2UI?.inputOwned) await v2UI.finishHeld();
    else await finishRecording();
    if (v2UI?.resampling) await v2UI.finishResample();
    await stopTransport();
    message("STOP · ALL CYCLES RESET");
  });
$("#master").oninput = () =>
  engine.volume(Number($<HTMLInputElement>("#master").value));
$("#pad-level").oninput = () =>
  engine.level(selected, Number($<HTMLInputElement>("#pad-level").value));
for (const id of ["sr", "bits"])
  $("#" + id).oninput = () => {
    sr = Number($<HTMLInputElement>("#sr").value);
    bits = Number($<HTMLInputElement>("#bits").value);
    engine.degrade(sr, bits);
    updateKnob(id);
  };
for (const [id, rate, depth] of [
  ["era80", 26000, 12],
  ["era90", 44100, 16],
  ["era00", 48000, 24],
] as const) {
  $("#" + id).onclick = () => {
    sr = rate;
    bits = depth;
    $<HTMLInputElement>("#sr").value = String(sr);
    $<HTMLInputElement>("#bits").value = String(bits);
    Object.assign(studio.fx, {
      characterBypass: false,
      bandwidth: id === "era80" ? 10500 : id === "era90" ? 18500 : 22000,
      saturation: id === "era80" ? 0.18 : id === "era90" ? 0.035 : 0,
    });
    engine.setFX(studio.fx);
    engine.degrade(sr, bits);
    ["era80", "era90", "era00"].forEach((x) =>
      $("#" + x).classList.toggle("lit", x === id),
    );
    updateKnob("sr");
    updateKnob("bits");
  };
}
for (const kind of ["delay", "reverb"] as const) {
  $("#" + kind + "-on").onclick = () => {
    if (kind === "delay") delayOn = !delayOn;
    else reverbOn = !reverbOn;
    const on = kind === "delay" ? delayOn : reverbOn;
    $("#" + kind + "-on").classList.toggle("lit", on);
    engine.effects(kind, on, kind === "delay" ? delayAmount : reverbAmount);
  };
  $("#" + kind).oninput = () => {
    const value = Number($<HTMLInputElement>("#" + kind).value);
    if (kind === "delay") delayAmount = value;
    else reverbAmount = value;
    updateKnob(kind);
    engine.effects(kind, kind === "delay" ? delayOn : reverbOn, value);
  };
}
$("#copy").onclick = () => {
  clipboard = settings(pads[selected]);
  message("PAD SETTINGS COPIED · AUDIO RETAINED ON ORIGINAL PAD");
};
$("#paste").onclick = () => {
  if (!clipboard) return message("COPY PAD SETTINGS FIRST");
  checkpoint();
  const { id, name, ...s } = clipboard;
  Object.assign(pads[selected], padDefaults, s, { mode: modeOf(clipboard) });
  engine.changed(selected);
  render();
  message("PAD SETTINGS PASTED");
};
$("#undo").onclick = () => {
  const previous = history.pop();
  if (previous) {
    future.push(pads.map((p) => ({ ...p })));
    apply(previous);
  }
};
$("#redo").onclick = () => {
  const next = future.pop();
  if (next) {
    history.push(pads.map((p) => ({ ...p })));
    apply(next);
  }
};
$("#clear").onclick = () => {
  checkpoint();
  engine.cancel(selected);
  Object.assign(pads[selected], {
    buffer: null,
    name: "Empty Pad",
    armed: false,
  });
  render();
  message("PAD AUDIO CLEARED · CANNOT UNDO AUDIO REMOVAL");
};
$("#save").title =
  "Save complete project + audio. Shift-click exports legacy settings.";
$("#save").onclick = (event) => {
  if (!event.shiftKey) {
    safely(() => midiEditor!.exportProject());
    return;
  }
  const blob = new Blob(
    [
      JSON.stringify(
        {
          product: "GMC-9000",
          pads: pads.map(settings),
          sr,
          bits,
          delayOn,
          reverbOn,
          delayAmount,
          reverbAmount,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "GMC-9000-settings.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message("SETTINGS EXPORTED · WAV AUDIO NOT INCLUDED");
};
$("#menu").onclick = () => {
  $<HTMLDialogElement>("#menu-dialog").showModal();
};
$("#edit").onclick = () => message("EDIT · F2 REVERSE / START / END / SPEED");
$("#left").onclick = () => select(selected - 1);
$("#right").onclick = () => select(selected + 1);
$("#up").onclick = () => select(selected + 3);
$("#down").onclick = () => select(selected - 3);
$("#data-wheel").onclick = () => select(selected + 1);
$("#data-wheel").onwheel = (e) => {
  e.preventDefault();
  checkpoint();
  pads[selected].play = Math.max(
    1,
    Math.min(99, pads[selected].play + (e.deltaY < 0 ? 1 : -1)),
  );
  engine.changed(selected);
  render();
};
window.addEventListener("keydown", (e) => {
  if (
    v2UI?.exporting ||
    e.repeat ||
    e.ctrlKey ||
    e.altKey ||
    e.metaKey ||
    (e.target as HTMLElement).matches(
      "input,select,textarea,[contenteditable=true]",
    ) ||
    $<HTMLDialogElement>("#menu-dialog").open ||
    $<HTMLDialogElement>("#midi-editor")?.open
  )
    return;
  const digit = /^Numpad[1-9]$/.test(e.code) ? e.code.slice(-1) : e.key;
  if (/^[1-9]$/.test(digit)) {
    e.preventDefault();
    select(Number(digit) - 1);
    safely(async () => {
      await ready();
      const id = Number(digit) - 1;
      if (midiEditor!.timeline.armed)
        await midiEditor!.perform(
          id,
          1,
          `key:${e.code}`,
          midiEditor!.audioTime(e.timeStamp),
        );
      else await engine.trigger(id, e.shiftKey);
    });
  }
  if (e.code === "Space") {
    e.preventDefault();
    safely(async () => {
      await ready();
      if (engine.status === "playing") await pauseTransport();
      else await playTransport();
    });
  }
});
window.addEventListener("keyup", (e) =>
  midiEditor?.release(`key:${e.code}`, midiEditor.audioTime(e.timeStamp)),
);
installViewportFit();
setInterval(() => {
  document.querySelectorAll<HTMLElement>(".pad").forEach((el) => {
    const id = Number(el.dataset.pad),
      p = pads[id],
      phase = engine.phase(id);
    el.classList.toggle(
      "playing",
      !!phase?.audible && p.armed && engine.status === "playing",
    );
    el.querySelector(".pad-state")!.textContent = !p.buffer
      ? "NO SAMPLE"
      : !p.armed
        ? `${p.buffer.duration.toFixed(2)} SEC · READY`
        : engine.status === "paused"
          ? "PAUSED"
          : engine.status === "stopped"
            ? "READY"
            : phase?.audible
              ? "PLAYING"
              : "REST";
  });
  $("#play").classList.toggle("lit", engine.status === "playing");
  $("#pause").classList.toggle("lit", engine.status === "paused");
  $("#engine-state").textContent = engine.context
    ? `AUDIO ${engine.status.toUpperCase()} · ${engine.context.sampleRate / 1000} kHz`
    : "AUDIO STANDBY";
  drawWave();
}, 60);
for (const id of [
  "start",
  "end",
  "speed",
  "stretch",
  "sr",
  "bits",
  "delay",
  "reverb",
])
  updateKnob(id);
render();
// Explicit adapter surface; no DS-9 connection or synchronization is implemented.
export const transport = {
  play: () => playTransport(),
  pause: () => pauseTransport(),
  stop: () => stopTransport(),
  trigger: (pad: number) => {
    if (!Number.isInteger(pad) || pad < 0 || pad > 8)
      throw new RangeError("Pad must be 0–8");
    return engine.trigger(pad, true);
  },
};

// Hardware I/O is opt-in; no microphone or MIDI permissions on page load.
let recordPad = 0,
  recordBusy = false;
let overdubSource: Pad | null = null;
function ioMessage(text: string) {
  $("#io-status").textContent = text;
  message(text);
}
async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const [id, kind] of [
    ["audio-input", "audioinput"],
    ["audio-output", "audiooutput"],
  ] as const) {
    const select = $<HTMLSelectElement>("#" + id),
      value = select.value;
    select.replaceChildren(new Option("System default", ""));
    devices
      .filter((d) => d.kind === kind)
      .forEach((d, i) =>
        select.add(new Option(d.label || `${kind} ${i + 1}`, d.deviceId)),
      );
    select.value = Array.from(select.options).some((o) => o.value === value)
      ? value
      : "";
  }
  const output = engine.context as AudioContext & {
    setSinkId?: (id: string) => Promise<void>;
  };
  $<HTMLSelectElement>("#audio-output").disabled = !output.setSinkId;
  $("#output-support").textContent = output.setSinkId
    ? "Choose the output interface above. No input monitoring unless enabled."
    : "Output selection unavailable: choose your audio interface in Windows Settings → System → Sound.";
}
$("#devices").onclick = () =>
  safely(async () => {
    await ready();
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Audio input requires HTTPS and a supported browser");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    await refreshDevices();
  });
$("#input-connect").onclick = () =>
  safely(async () => {
    await ready();
    await audioInput.connect($<HTMLSelectElement>("#audio-input").value);
    $<HTMLInputElement>("#monitor").checked = false;
    await refreshDevices();
    ioMessage("INPUT CONNECTED · MONITOR OFF · REC TO CAPTURE");
  });
$("#input-disconnect").onclick = () =>
  safely(() => {
    audioInput.disconnect();
    $<HTMLInputElement>("#monitor").checked = false;
    ioMessage("INPUT DISCONNECTED");
  });
$("#monitor").onchange = () => {
  const box = $<HTMLInputElement>("#monitor");
  if (!audioInput.stream) {
    box.checked = false;
    ioMessage("Connect an input first");
    return;
  }
  audioInput.monitoring(box.checked);
};
$("#audio-output").onchange = () =>
  safely(async () => {
    await ready();
    const c = engine.context as AudioContext & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (!c.setSinkId)
      throw new Error("Choose your output in Windows sound settings");
    await c.setSinkId($<HTMLSelectElement>("#audio-output").value);
    ioMessage("AUDIO OUTPUT SELECTED");
  });
async function finishRecording() {
  if (!audioInput.recording || recordBusy) return;
  recordBusy = true;
  try {
    let buffer = await audioInput.stop();
    if (buffer && overdubSource?.buffer) {
      const old = overdubSource,
        original = preparedRegion({
          ...old,
          fadeIn: Math.max(old.fadeIn ?? 0, 1 / old.buffer!.sampleRate),
        })!;
      const c = new OfflineAudioContext(
        2,
        Math.ceil(
          Math.max(
            buffer.duration,
            ((old.end - old.start) *
              old.buffer!.duration *
              (old.stretch ?? 1)) /
              old.speed,
          ) * buffer.sampleRate,
        ),
        buffer.sampleRate,
      );
      const source = c.createBufferSource();
      source.buffer = original;
      source.playbackRate.value = old.speed;
      source.connect(c.destination);
      source.start(
        0,
        original === old.buffer
          ? (old.reverse ? 1 - old.end : old.start) * old.buffer!.duration
          : 0,
        original === old.buffer
          ? (old.end - old.start) * old.buffer!.duration
          : original.duration,
      );
      const mic = c.createBufferSource();
      mic.buffer = buffer;
      mic.connect(c.destination);
      mic.start();
      buffer = await c.startRendering();
    }
    const wasOverdub = !!overdubSource;
    overdubSource = null;
    if (buffer) {
      checkpoint();
      engine.cancel(recordPad);
      Object.assign(pads[recordPad], {
        buffer,
        name: wasOverdub
          ? `Overdub ${recordPad + 1}`
          : `Recording ${recordPad + 1}`,
        start: 0,
        end: 1,
        armed: false,
        ...(wasOverdub
          ? {
              pitch: 0,
              stretch: 1,
              reverse: false,
              fadeIn: 0,
              fadeOut: 0,
              crossfade: 0,
            }
          : {}),
      });
      render();
      ioMessage(
        `RECORDED ${buffer.duration.toFixed(2)} SEC TO PAD ${recordPad + 1}`,
      );
    } else ioMessage("No input audio captured");
  } finally {
    recordBusy = false;
    $("#rec").classList.remove("recording");
  }
}
$("#rec").onclick = () =>
  safely(async () => {
    if (v2UI?.inputOwned) {
      await v2UI.finishHeld();
      return;
    }
    if (recordBusy) return;
    if (audioInput.recording) {
      await finishRecording();
      return;
    }
    recordBusy = true;
    try {
      await ready();
      await stopTransport();
      recordPad = selected;
      if (!audioInput.source)
        await audioInput.connect($<HTMLSelectElement>("#audio-input").value);
      await audioInput.start();
      if (overdubSource) await engine.trigger(recordPad, true);
      $("#rec").classList.add("recording");
      ioMessage(
        `RECORDING INPUT TO PAD ${recordPad + 1} · REC / STOP TO FINISH`,
      );
    } catch (error) {
      overdubSource = null;
      throw error;
    } finally {
      recordBusy = false;
    }
  });
$("#overdub").onclick = () => {
  if (audioInput.recording) {
    $("#rec").click();
    return;
  }
  const p = pads[selected];
  if (!p.buffer) {
    message("Load or record a sample before overdubbing");
    return;
  }
  overdubSource = { ...p };
  $("#rec").click();
};
const midi = new MidiLearn(
  (target, value, trigger, info) => {
    if (v2UI?.exporting) return;
    safely(async () => {
      if (target.startsWith("pad:")) {
        if (info?.release) {
          midiEditor?.release(info.key, midiEditor.audioTime(info.timestamp));
          return;
        }
        if (!trigger) return;
        const id = Number(target.split(":")[1]);
        if (!Number.isInteger(id) || id < 0 || id > 8) return;
        select(id);
        await ready();
        if (midiEditor!.timeline.armed)
          await midiEditor!.perform(
            id,
            value,
            info?.key ?? `midi:${id}`,
            info ? midiEditor!.audioTime(info.timestamp) : undefined,
          );
        else await engine.trigger(id, true, value);
        return;
      }
      if (target === "level") {
        engine.level(selected, value);
        render();
        return;
      }
      const id = target === "master" ? "master" : target;
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (!input || (input.type !== "range" && input.type !== "number")) return;
      const min = Number(input.min),
        max = Number(input.max),
        step = Number(input.step) || 1;
      input.value = String(
        min + Math.round((value * (max - min)) / step) * step,
      );
      input.dispatchEvent(
        new Event(input.type === "number" ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  },
  (text) => {
    $("#midi-status").textContent = text;
  },
);
$("#midi-connect").onclick = () =>
  safely(async () => {
    await ready();
    await midi.connect();
  });
$("#midi-learn").onclick = () => {
  if (!midi.access) {
    $("#midi-status").textContent = "Connect MIDI first";
    return;
  }
  midi.learning = $<HTMLSelectElement>("#midi-target").value;
  $("#midi-status").textContent =
    `Learning ${midi.learning}: press a note or move a CC controller`;
};
$("#midi-clear").onclick = () => midi.clear();
$<HTMLSelectElement>("#midi-target").onchange = () => {
  midi.learning = null;
};
$("#menu-dialog").addEventListener("close", () => {
  midi.learning = null;
});
window.addEventListener("pagehide", () => {
  audioInput.stream?.getTracks().forEach((t) => t.stop());
});

// Per-instance event adapter: independent of Microseq or any host implementation.
midiEditor = new MidiEditor({
  ready,
  render,
  canLoad: (): boolean =>
    !audioInput.recording &&
    !recordBusy &&
    !v2UI?.resampling &&
    !v2UI?.inputOwned,
  globals: () => ({
    sr,
    bits,
    master: Number($<HTMLInputElement>("#master").value),
    delayOn,
    reverbOn,
    delayAmount,
    reverbAmount,
  }),
  applyGlobals: (g, when = engine.context?.currentTime ?? 0) => {
    sr = g.sr;
    bits = g.bits;
    delayOn = g.delayOn;
    reverbOn = g.reverbOn;
    delayAmount = g.delayAmount;
    reverbAmount = g.reverbAmount;
    for (const [id, value] of Object.entries({
      sr,
      bits,
      master: g.master,
      delay: delayAmount,
      reverb: reverbAmount,
    })) {
      $<HTMLInputElement>("#" + id).value = String(value);
      if (id !== "master") updateKnob(id);
    }
    $("#delay-on").classList.toggle("lit", delayOn);
    $("#reverb-on").classList.toggle("lit", reverbOn);
    engine.degrade(sr, bits, when);
    engine.volume(g.master, when);
    engine.effects("delay", delayOn, delayAmount, when);
    engine.effects("reverb", reverbOn, reverbAmount, when);
  },
});
export const midiSession = midiEditor;
document.addEventListener("input", () => midiEditor?.changed());
document.addEventListener("change", () => midiEditor?.changed());

export const appUI = {
  selected: () => selected,
  select,
  render,
  checkpoint,
  ready,
  finishRecording,
  midi: midiEditor,
};
export const v2UI: StudioUI = new StudioUI(appUI);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch(() =>
        message("Offline cache unavailable; export a project for backup."),
      );
  });
}
