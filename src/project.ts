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
  version: 1;
  savedAt: string;
  pads: (PadSettings & { asset: string | null })[];
  assets: Record<string, { encoding: "wav-f32"; data: string }>;
  midi: EventState;
  globals: GlobalSettings;
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
  const savedPads = pads.map((p) => ({
    settings: settings(p),
    buffer: p.buffer,
  }));
  const project: Project = {
    format: "GRIMISS-GMC-9000",
    version: 1,
    savedAt: new Date().toISOString(),
    pads: [],
    assets: {},
    midi: structuredClone(midi),
    globals: structuredClone(globals),
  };
  for (const p of savedPads) {
    const a = p.buffer ? await asset(p.buffer) : null;
    if (a) project.assets[a.id] = { encoding: "wav-f32", data: a.data };
    project.pads.push({ ...p.settings, asset: a?.id ?? null });
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
}
export function validateGlobals(g: GlobalSettings) {
  if (
    !g ||
    !finite(g.sr, 1000, 44100) ||
    !finite(g.bits, 4, 16) ||
    !finite(g.master, 0, 1) ||
    !finite(g.delayAmount, 0, 0.8) ||
    !finite(g.reverbAmount, 0, 0.8) ||
    typeof g.delayOn !== "boolean" ||
    typeof g.reverbOn !== "boolean"
  )
    throw new Error("Invalid global settings");
}
export async function stageProject(raw: unknown, context: AudioContext) {
  const p = raw as Project;
  if (
    !p ||
    p.format !== "GRIMISS-GMC-9000" ||
    p.version !== 1 ||
    !Array.isArray(p.pads) ||
    p.pads.length !== 9 ||
    !p.assets ||
    typeof p.assets !== "object"
  )
    throw new Error("Unsupported or invalid GMC project");
  const midi = validateEvents(p.midi, 9);
  validateGlobals(p.globals);
  p.pads.forEach(validatePad);
  const decoded = new Map<string, AudioBuffer>();
  for (const pad of p.pads) {
    if (pad.asset !== null && typeof pad.asset !== "string")
      throw new Error("Invalid sample asset");
    if (pad.asset && !decoded.has(pad.asset)) {
      const a = p.assets[pad.asset];
      if (!a || a.encoding !== "wav-f32" || typeof a.data !== "string")
        throw new Error(`Missing sample for pad ${pad.id + 1}`);
      const bytes = unb64(a.data);
      if ((await hash(bytes)) !== pad.asset)
        throw new Error(`Sample integrity failure on pad ${pad.id + 1}`);
      decoded.set(pad.asset, await context.decodeAudioData(bytes.buffer));
    }
  }
  return {
    pads: p.pads.map((p) => {
      const { asset, ...s } = p;
      return { ...s, buffer: asset ? decoded.get(asset)! : null };
    }),
    midi,
    globals: structuredClone(p.globals),
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
