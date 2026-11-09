import type { Pad } from "../state";
import type { EventState } from "../events/core";
export type PadMode = "ONE SHOT" | "LOOP" | "CYCLE";
export const modeOf = (p: Pick<Pad, "loop" | "mode">): PadMode =>
  p.mode ?? (p.loop ? "CYCLE" : "ONE SHOT");
export const padDefaults = {
  pitch: 0,
  stretch: 1,
  fadeIn: 0,
  fadeOut: 0,
  crossfade: 0,
  pan: 0,
  probability: 1,
  every: 1,
  retrigger: "layer" as "layer" | "replace",
};
export interface FXState {
  characterAmount: number;
  characterBypass: boolean;
  bandwidth: number;
  saturation: number;
  filter: number;
  resonance: number;
  stutter: boolean;
  stutterSeconds: number;
  reverse: boolean;
  pitch: number;
  delayTime: number;
  delayFeedback: number;
}
export const defaultFX = (): FXState => ({
  characterAmount: 1,
  characterBypass: false,
  bandwidth: 22000,
  saturation: 0,
  filter: 22000,
  resonance: 0.707,
  stutter: false,
  stutterSeconds: 0.125,
  reverse: false,
  pitch: 0,
  delayTime: 0.31,
  delayFeedback: 0.32,
});
export interface Movement {
  id: string;
  parameter: string;
  time: number;
  value: number;
}
export interface Automation {
  length: number;
  events: Movement[];
  enabled: boolean;
}
export interface Scene {
  id: string;
  name: string;
  pads: Pad[];
  midi: EventState;
  globals: Record<string, number | boolean>;
  fx: FXState;
  automation: Automation;
  duration: number;
  units: "seconds" | "bars";
  transition: "immediate" | "bar" | "cycle" | "fade";
  fade: number;
  continueLoops: boolean;
}
export interface SongStep {
  id: string;
  scene: string;
  repeat: number;
}
export interface StudioState {
  fx: FXState;
  automation: Automation;
  scenes: Scene[];
  arrangement: SongStep[];
  loopSong: boolean;
  loopScene: boolean;
}
export const studio: StudioState = {
  fx: defaultFX(),
  automation: { length: 8, events: [], enabled: true },
  scenes: [],
  arrangement: [],
  loopSong: false,
  loopScene: false,
};
export function replaceStudio(s: StudioState) {
  Object.assign(studio, s);
}
export function sceneSeconds(s: Pick<Scene, "duration" | "units" | "midi">) {
  return s.units === "bars" ? (s.duration * 4 * 60) / s.midi.bpm : s.duration;
}
export function songSeconds(state: StudioState) {
  return state.arrangement.reduce((n, step) => {
    const s = state.scenes.find((s) => s.id === step.scene);
    if (!s) throw new Error("Arrangement references a missing scene");
    return n + sceneSeconds(s) * step.repeat;
  }, 0);
}
export function cycleAllowed(
  p: Pick<Pad, "probability" | "every">,
  cycle: number,
  random = Math.random,
) {
  return cycle % (p.every ?? 1) === 0 && random() < (p.probability ?? 1);
}
