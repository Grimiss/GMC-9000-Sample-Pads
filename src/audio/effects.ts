/** Parallel wet returns leave individual pad gains independent. */
export function createEffects(
  c: AudioContext,
  input: AudioNode,
  output: AudioNode,
) {
  const delay = c.createDelay(2);
  delay.delayTime.value = 0.31;
  const feedback = c.createGain();
  feedback.gain.value = 0.32;
  const delayWet = c.createGain();
  delayWet.gain.value = 0;
  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(delayWet);
  delayWet.connect(output);
  const convolver = c.createConvolver();
  const impulse = c.createBuffer(2, c.sampleRate * 2.2, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  }
  convolver.buffer = impulse;
  const reverbWet = c.createGain();
  reverbWet.gain.value = 0;
  input.connect(convolver);
  convolver.connect(reverbWet);
  reverbWet.connect(output);
  return { delay, delayWet, reverbWet, feedback, convolver };
}
