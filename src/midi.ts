export type Binding = {
  device: string;
  channel: number;
  kind: number;
  number: number;
  target: string;
};
export function midiValue(data: Uint8Array) {
  const [status, number, value] = data;
  if (data.length < 3) return null;
  const kind = status & 240;
  if (kind !== 144 && kind !== 176) return null;
  if (kind === 144 && value === 0) return null;
  return { kind, channel: status & 15, number, value };
}
export class MidiLearn {
  access: MIDIAccess | null = null;
  bindings: Binding[] = [];
  learning: string | null = null;
  previous = new Map<string, number>();
  constructor(
    private apply: (
      target: string,
      value: number,
      trigger: boolean,
      info?: { key: string; timestamp: number; release: boolean },
    ) => void,
    private report: (text: string) => void,
  ) {
    try {
      const s = JSON.parse(localStorage.getItem("gmc-midi") || "[]");
      if (Array.isArray(s))
        this.bindings = s.filter(
          (b) =>
            typeof b.device === "string" &&
            typeof b.target === "string" &&
            Number.isInteger(b.number) &&
            Number.isInteger(b.channel) &&
            [144, 176].includes(b.kind),
        );
    } catch {}
  }
  async connect() {
    if (!navigator.requestMIDIAccess)
      throw new Error(
        "Web MIDI is unavailable. Use Chrome or Edge over HTTPS.",
      );
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.attach();
    this.access.onstatechange = () => this.attach();
  }
  private attach() {
    if (!this.access) return;
    for (const input of this.access.inputs.values())
      input.onmidimessage = (e) => {
        if (e.data) this.receive(input.id, e.data, e.timeStamp);
      };
    this.report(`${this.access.inputs.size} MIDI input(s) connected`);
  }
  receive(device: string, data: Uint8Array, timestamp = performance.now()) {
    const kind = data[0] & 240,
      channel = data[0] & 15,
      number = data[1];
    if (data.length >= 3 && (kind === 128 || (kind === 144 && data[2] === 0))) {
      for (const b of this.bindings)
        if (
          b.device === device &&
          b.channel === channel &&
          b.kind === 144 &&
          b.number === number
        )
          this.apply(b.target, 0, false, {
            key: `${device}/${channel}/144/${number}`,
            timestamp,
            release: true,
          });
      return;
    }
    const m = midiValue(data);
    if (!m) return;
    if (this.learning) {
      const target = this.learning;
      this.bindings = this.bindings.filter(
        (b) =>
          b.target !== target &&
          !(
            b.device === device &&
            b.channel === m.channel &&
            b.kind === m.kind &&
            b.number === m.number
          ),
      );
      this.bindings.push({
        device,
        channel: m.channel,
        kind: m.kind,
        number: m.number,
        target,
      });
      this.learning = null;
      localStorage.setItem("gmc-midi", JSON.stringify(this.bindings));
      this.report(
        `Learned ${target}: ${m.kind === 144 ? "note" : "CC"} ${m.number + 0}, channel ${m.channel + 1}`,
      );
      return;
    }
    const key = `${device}/${m.channel}/${m.kind}/${m.number}`,
      old = this.previous.get(key) || 0;
    this.previous.set(key, m.value);
    for (const b of this.bindings)
      if (
        b.device === device &&
        b.channel === m.channel &&
        b.kind === m.kind &&
        b.number === m.number
      ) {
        const trigger = m.kind === 144 || (m.value >= 64 && old < 64);
        this.apply(b.target, m.value / 127, trigger, {
          key,
          timestamp,
          release: m.kind === 176 && m.value < 64,
        });
      }
  }
  clear() {
    this.bindings = [];
    this.learning = null;
    this.previous.clear();
    localStorage.removeItem("gmc-midi");
    this.report("MIDI mappings cleared");
  }
}
