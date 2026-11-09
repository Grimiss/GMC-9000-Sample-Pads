export interface Pad {
  id: number;
  name: string;
  buffer: AudioBuffer | null;
  start: number;
  end: number;
  speed: number;
  reverse: boolean;
  level: number;
  play: number;
  rest: number;
  loop: boolean;
  armed: boolean;
  mode?: "ONE SHOT" | "LOOP" | "CYCLE";
  pitch?: number;
  stretch?: number;
  fadeIn?: number;
  fadeOut?: number;
  crossfade?: number;
  pan?: number;
  probability?: number;
  every?: number;
  retrigger?: "layer" | "replace";
}
const names = [
  "Forest Ambience",
  "Rain Texture",
  "Wind Drones",
  "Chimes",
  "Tape Hiss",
  "Distant Voices",
  "Space Hum",
  "Pianos",
  "Textures",
];
const counts = [
  [8, 12],
  [4, 6],
  [16, 3],
  [2, 18],
  [10, 10],
  [7, 20],
  [12, 4],
  [6, 16],
  [14, 8],
];
export const pads: Pad[] = names.map((name, i) => ({
  id: i,
  name,
  buffer: null,
  start: 0,
  end: 1,
  speed: 1,
  reverse: false,
  level: 0.75,
  play: counts[i][0],
  rest: counts[i][1],
  loop: true,
  armed: false,
}));
export function randomCounts(random = Math.random) {
  return {
    play: 1 + Math.floor(random() * 20),
    rest: Math.floor(random() * 21),
  };
}
export function regionDuration(
  p: Pick<Pad, "start" | "end" | "speed" | "stretch">,
  duration: number,
) {
  return Math.max(
    0.001,
    ((p.end - p.start) * duration * (p.stretch ?? 1)) / p.speed,
  );
}
export function phaseAt(
  elapsed: number,
  duration: number,
  play: number,
  rest: number,
) {
  const interval = Math.floor(Math.max(0, elapsed) / duration);
  const cycle = play + rest;
  return {
    audible: interval % cycle < play,
    interval,
    position: (Math.max(0, elapsed) % duration) / duration,
    remaining: cycle - (interval % cycle),
  };
}
export interface PadSettings extends Omit<Pad, "buffer"> {}
export const settings = (p: Pad): PadSettings => {
  const { buffer, ...s } = p;
  return s;
};
