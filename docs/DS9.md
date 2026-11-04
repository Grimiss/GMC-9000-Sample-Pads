# Future DS-9 transport / trigger contract

The sampler is standalone. No DS-9 network, MIDI, clock synchronization, or lane subscription is implemented.

`transport` exported from `src/main.ts` currently exposes asynchronous `play()`, `pause()`, `stop()` and `trigger(pad)` operations. Pad indexes are integers 0–8; invalid indexes throw. `trigger` fires an independent one-shot without resetting the pad's PLAY/REST origin, counts or currently scheduled repetitions. It layers over existing audio.

Proposed future adapter messages:

```ts
type LinkMode = "FREE" | "SYNC";
type TriggerBehavior = "LAYER" | "REPLACE";
interface LaneTrigger {
  lane: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  behavior: TriggerBehavior;
  timestamp?: number; // explicit clock domain negotiated by adapter
}
```

FREE keeps independent sampler transport; lane triggers map one-to-one to pad indexes. SYNC will follow external play/pause/stop and negotiate a shared epoch while preserving per-sample durations, without introducing a BPM requirement. LAYER creates an additional external voice. REPLACE will stop only the adapter's previous external voice for that lane and start its replacement; it must leave internally scheduled PLAY/REST voices untouched. External voices therefore need explicit ownership tags before implementing REPLACE. Do not implement REPLACE by calling the engine's pad-wide cancel operation.

Future SYNC needs timestamp conversion, look-ahead, late-event handling, disconnect behavior and tests. No claim of SYNC or REPLACE support is made by the current adapter. AudioContext initialization/resume must still follow browser gesture policy.
