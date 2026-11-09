import {
  studio,
  replaceStudio,
  defaultFX,
  padDefaults,
  modeOf,
  type StudioState,
  type Scene,
  type FXState,
  type Automation,
} from "./v2/model";
import { pads, settings, type PadSettings } from "./state";
import { validateEvents, type EventState } from "./events/core";
export interface GlobalSettings {
  sr: number;
  bits: number;
  master: number;
  delayOn: boolean;
  reverbOn: boolean;
  delayAmount: number;
  reverbAmount: number;
}
export interface Project {
  format: "GRIMISS-GMC-9000";
  version: 1 | 2;
  savedAt: string;
  pads: (PadSettings & { asset: string | null })[];
  assets: Record<string, { encoding: "wav-f32"; data: string }>;
  midi: EventState;
  globals: GlobalSettings;
  studio?: Omit<StudioState, "scenes"> & {
    scenes: (Omit<Scene, "pads"> & {
      pads: (PadSettings & { asset: string | null })[];
    })[];
  };
}
export function wavBytes(buffer: AudioBuffer) {
  const size = buffer.length * buffer.numberOfChannels * 4;
  const bytes = new Uint8Array(44 + size),
    v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + size, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, buffer.numberOfChannels, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * buffer.numberOfChannels * 4, true);
  v.setUint16(32, buffer.numberOfChannels * 4, true);
  v.setUint16(34, 32, true);
  text(36, "data");
  v.setUint32(40, size, true);
  for (let i = 0; i < buffer.length; i++)
    for (let c = 0; c < buffer.numberOfChannels; c++)
      v.setFloat32(
        44 + (i * buffer.numberOfChannels + c) * 4,
        buffer.getChannelData(c)[i],
        true,
      );
  return bytes;
}
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
const cache = new WeakMap<AudioBuffer, Promise<{ id: string; data: string }>>();
async function asset(buffer: AudioBuffer) {
  let p = cache.get(buffer);
  if (!p) {
    p = (async () => {
      const bytes = wavBytes(buffer);
      return { id: await hash(bytes), data: b64(bytes) };
    })();
    cache.set(buffer, p);
  }
  return p;
}
export async function captureProject(
  midi: EventState,
  globals: GlobalSettings,
): Promise<Project> {
  const current = pads.map((p) => ({ ...p })),
    scenes = studio.scenes.map((s) => ({
      ...s,
      pads: s.pads.map((p) => ({ ...p })),
      midi: structuredClone(s.midi),
      globals: { ...s.globals },
      fx: { ...s.fx },
      automation: structuredClone(s.automation),
    }));
  const project: Project = {
    format: "GRIMISS-GMC-9000",
    version: 2,
    savedAt: new Date().toISOString(),
    pads: [],
    assets: {},
    midi: structuredClone(midi),
    globals: structuredClone(globals),
    studio: {
      fx: { ...studio.fx },
      automation: structuredClone(studio.automation),
      scenes: [],
      arrangement: structuredClone(studio.arrangement),
      loopSong: studio.loopSong,
      loopScene: studio.loopScene,
    },
  };
  const savePad = async (p: (typeof pads)[number]) => {
    const a = p.buffer ? await asset(p.buffer) : null;
    if (a) project.assets[a.id] = { encoding: "wav-f32", data: a.data };
    return { ...settings(p), asset: a?.id ?? null };
  };
  for (const p of current) project.pads.push(await savePad(p));
  for (const scene of scenes) {
    const { pads: scenePads, ...rest } = scene;
    const saved = [];
    for (const p of scenePads) saved.push(await savePad(p));
    project.studio!.scenes.push({ ...rest, pads: saved });
  }
  return project;
}
const finite = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function validatePad(p: PadSettings, id: number) {
  if (
    !p ||
    p.id !== id ||
    typeof p.name !== "string" ||
    !finite(p.start, 0, 1) ||
    !finite(p.end, 0, 1) ||
    p.end <= p.start ||
    !finite(p.speed, 0.25, 2) ||
    !finite(p.level, 0, 1) ||
    !Number.isInteger(p.play) ||
    p.play < 1 ||
    p.play > 99 ||
    !Number.isInteger(p.rest) ||
    p.rest < 0 ||
    p.rest > 99 ||
    typeof p.reverse !== "boolean" ||
    typeof p.loop !== "boolean" ||
    typeof p.armed !== "boolean"
  )
    throw new Error(`Invalid settings for pad ${id + 1}`);
  const bounds: Record<string, [number, number]> = {
    pitch: [-24, 24],
    stretch: [0.25, 4],
    fadeIn: [0, 5],
    fadeOut: [0, 5],
    crossfade: [0, 0.5],
    pan: [-1, 1],
    probability: [0, 1],
    every: [1, 99],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const v = (p as unknown as Record<string, unknown>)[key];
    if (v !== undefined && !finite(v, min, max))
      throw new Error(`Invalid ${key} on pad ${id + 1}`);
  }
  if (p.every !== undefined && !Number.isInteger(p.every))
    throw new Error("Invalid cycle interval");
  if (
    (p.mode !== undefined && !["ONE SHOT", "LOOP", "CYCLE"].includes(p.mode)) ||
    (p.retrigger !== undefined && !["layer", "replace"].includes(p.retrigger))
  )
    throw new Error("Invalid playback mode");
}
export function validateGlobals(g: GlobalSettings) {
  if (
    !g ||
    !finite(g.sr, 1000, 48000) ||
    !finite(g.bits, 4, 24) ||
    !finite(g.master, 0, 1) ||
    !finite(g.delayAmount, 0, 0.8) ||
    !finite(g.reverbAmount, 0, 0.8) ||
    typeof g.delayOn !== "boolean" ||
    typeof g.reverbOn !== "boolean"
  )
    throw new Error("Invalid global settings");
}
const fxBounds: Record<string, [number, number]> = {
  characterAmount: [0, 1],
  bandwidth: [500, 22000],
  saturation: [0, 1],
  filter: [30, 22000],
  resonance: [0.1, 20],
  pitch: [-24, 24],
  stutterSeconds: [0.02, 1],
  delayTime: [0.02, 1.5],
  delayFeedback: [0, 0.85],
};
const globalBounds: Record<string, [number, number]> = {
  sr: [1000, 48000],
  bits: [4, 24],
  master: [0, 1],
  delayAmount: [0, 0.8],
  reverbAmount: [0, 0.8],
  delayOn: [0, 1],
  reverbOn: [0, 1],
};
export function validateFX(raw: unknown): FXState {
  const f = {
    ...(raw as FXState),
    filterBypass: (raw as FXState)?.filterBypass ?? false,
  };
  if (!f || typeof f !== "object") throw new Error("Missing effect settings");
  for (const [key, [min, max]] of Object.entries(fxBounds))
    if (!finite((f as unknown as Record<string, unknown>)[key], min, max))
      throw new Error(`Invalid effect: ${key}`);
  for (const key of [
    "characterBypass",
    "stutter",
    "reverse",
    "filterBypass",
  ] as const)
    if (typeof f[key] !== "boolean") throw new Error("Invalid effect switch");
  return { ...f };
}
export function validateAutomation(raw: unknown): Automation {
  const a = raw as Automation;
  if (
    !a ||
    !finite(a.length, 0.125, 3600) ||
    typeof a.enabled !== "boolean" ||
    !Array.isArray(a.events) ||
    a.events.length > 100000
  )
    throw new Error("Invalid automation");
  const ids = new Set<string>();
  for (const e of a.events) {
    const bounds = e?.parameter?.startsWith("global.")
      ? globalBounds[e.parameter.slice(7)]
      : (fxBounds[e?.parameter] ??
        (["characterBypass", "stutter", "reverse", "filterBypass"].includes(
          e?.parameter,
        )
          ? [0, 1]
          : null));
    if (
      !e ||
      typeof e.id !== "string" ||
      ids.has(e.id) ||
      !finite(e.time, 0, 3600) ||
      !bounds ||
      !finite(e.value, bounds[0], bounds[1])
    )
      throw new Error("Invalid automation movement");
    ids.add(e.id);
  }
  return structuredClone(a);
}
export async function stageProject(raw: unknown, context: AudioContext) {
  const p = raw as Project;
  if (
    !p ||
    p.format !== "GRIMISS-GMC-9000" ||
    ![1, 2].includes(p.version) ||
    !Array.isArray(p.pads) ||
    p.pads.length !== 9 ||
    !p.assets ||
    typeof p.assets !== "object"
  )
    throw new Error("Unsupported or invalid GMC project");
  const midi = validateEvents(p.midi, 9);
  validateGlobals(p.globals);
  const decoded = new Map<string, AudioBuffer>();
  const loadPad = async (
    ref: PadSettings & { asset: string | null },
    i: number,
  ) => {
    validatePad(ref, i);
    if (ref.asset !== null && typeof ref.asset !== "string")
      throw new Error("Invalid sample asset");
    if (ref.asset && !decoded.has(ref.asset)) {
      const a = p.assets[ref.asset];
      if (!a || a.encoding !== "wav-f32" || typeof a.data !== "string")
        throw new Error(`Missing sample for pad ${i + 1}`);
      const bytes = unb64(a.data);
      if ((await hash(bytes)) !== ref.asset)
        throw new Error(`Sample integrity failure on pad ${i + 1}`);
      decoded.set(ref.asset, await context.decodeAudioData(bytes.buffer));
    }
    const { asset: refId, ...s } = ref;
    return {
      ...padDefaults,
      ...s,
      mode: modeOf(ref),
      buffer: refId ? decoded.get(refId)! : null,
    };
  };
  const current = [];
  for (let i = 0; i < 9; i++) current.push(await loadPad(p.pads[i], i));
  const extra: StudioState = {
    fx: defaultFX(),
    automation: { length: 8, events: [], enabled: true },
    scenes: [],
    arrangement: [],
    loopSong: false,
    loopScene: false,
  };
  if (p.version === 2) {
    const v = p.studio;
    if (
      !v ||
      !Array.isArray(v.scenes) ||
      v.scenes.length > 256 ||
      !Array.isArray(v.arrangement) ||
      v.arrangement.length > 2048 ||
      typeof v.loopSong !== "boolean" ||
      typeof v.loopScene !== "boolean"
    )
      throw new Error("Invalid V2 song data");
    extra.fx = validateFX(v.fx);
    extra.automation = validateAutomation(v.automation);
    extra.loopSong = v.loopSong;
    extra.loopScene = v.loopScene;
    const ids = new Set<string>();
    for (const scene of v.scenes) {
      if (
        !scene ||
        typeof scene.id !== "string" ||
        ids.has(scene.id) ||
        typeof scene.name !== "string" ||
        !finite(scene.duration, 0.125, 3600) ||
        !["seconds", "bars"].includes(scene.units) ||
        !["immediate", "bar", "cycle", "fade"].includes(scene.transition) ||
        !finite(scene.fade, 0, 10) ||
        typeof scene.continueLoops !== "boolean" ||
        !Array.isArray(scene.pads) ||
        scene.pads.length !== 9
      )
        throw new Error("Invalid scene");
      if (
        scene.active !== undefined &&
        (!Array.isArray(scene.active) ||
          scene.active.some(
            (id: number) => !Number.isInteger(id) || id < 0 || id > 8,
          ) ||
          new Set(scene.active).size !== scene.active.length)
      )
        throw new Error("Invalid active scene pads");
      ids.add(scene.id);
      validateGlobals(scene.globals as unknown as GlobalSettings);
      const savedPads = [];
      for (let i = 0; i < 9; i++)
        savedPads.push(await loadPad(scene.pads[i], i));
      extra.scenes.push({
        ...scene,
        pads: savedPads,
        midi: validateEvents(scene.midi, 9),
        globals: structuredClone(scene.globals),
        fx: validateFX(scene.fx),
        automation: validateAutomation(scene.automation),
      });
    }
    const stepIds = new Set<string>();
    for (const step of v.arrangement) {
      if (
        !step ||
        typeof step.id !== "string" ||
        stepIds.has(step.id) ||
        !ids.has(step.scene) ||
        !Number.isInteger(step.repeat) ||
        step.repeat < 1 ||
        step.repeat > 99
      )
        throw new Error("Invalid arrangement step");
      stepIds.add(step.id);
    }
    extra.arrangement = structuredClone(v.arrangement);
  }
  return {
    pads: current,
    midi,
    globals: structuredClone(p.globals),
    studio: extra,
  };
}
export function legacySettings(raw: unknown) {
  const p = raw as {
    product: string;
    pads: PadSettings[];
    sr: number;
    bits: number;
    delayOn: boolean;
    reverbOn: boolean;
    delayAmount: number;
    reverbAmount: number;
  };
  if (
    !p ||
    p.product !== "GMC-9000" ||
    !Array.isArray(p.pads) ||
    p.pads.length !== 9
  )
    throw new Error("Unknown project format");
  p.pads.forEach(validatePad);
  const globals = { ...p, master: 0.7 };
  validateGlobals(globals);
  return {
    pads: p.pads.map((p) => ({
      ...padDefaults,
      mode: modeOf(p),
      id: p.id,
      name: p.name,
      start: p.start,
      end: p.end,
      speed: p.speed,
      reverse: p.reverse,
      level: p.level,
      play: p.play,
      rest: p.rest,
      loop: p.loop,
      armed: p.armed,
    })),
    globals,
  };
}
export class RecoveryStore {
  private db: Promise<IDBDatabase> | null = null;
  private open() {
    return (this.db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open("gmc-projects", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("snapshots");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        reject(new Error("Close other GMC tabs to unlock recovery storage"));
    }));
  }
  async save(project: Project) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite"),
        store = tx.objectStore("snapshots"),
        get = store.get("latest");
      get.onsuccess = () => {
        if (get.result) store.put(get.result, "previous");
        store.put(project, "latest");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("Autosave aborted"));
      tx.onerror = () => reject(tx.error);
    });
  }
  async read(key = "latest"): Promise<Project | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const r = db.transaction("snapshots").objectStore("snapshots").get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  }
}
