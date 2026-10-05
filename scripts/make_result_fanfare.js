// Original fanfare synthesized without external samples.
const fs = require('fs');
const path = require('path');
const rate = 22050;
const samples = new Float64Array(Math.ceil(rate * 1.85));
function chord(start, length, notes, volume) {
  const offset = Math.round(start * rate);
  for (let i = 0; i < length * rate; i++) {
    const t = i / rate;
    const envelope = Math.min(1, t / 0.012) * Math.min(1, (length - t) / 0.13) * (0.82 + 0.18 * Math.exp(-t * 8));
    let value = 0;
    for (const note of notes) {
      const phase = 2 * Math.PI * 440 * 2 ** ((note - 69) / 12) * t;
      value += Math.sin(phase) + 0.48 * Math.sin(phase * 2) + 0.23 * Math.sin(phase * 3) + 0.10 * Math.sin(phase * 4) + 0.12 * Math.sin(phase * 1.003);
    }
    samples[offset + i] += value / notes.length * envelope * volume;
  }
}
// Two short rising stabs followed by a broad, sustained major chord.
chord(0, 0.11, [55, 67, 71, 74], 0.55);
chord(0.13, 0.11, [57, 69, 73, 76], 0.58);
chord(0.28, 1.15, [48, 55, 60, 64, 67, 72, 76, 79], 0.78);
chord(0.28, 1.15, [36, 48], 0.20);
chord(0.30, 0.22, [84, 88], 0.10);
chord(0.44, 0.30, [91], 0.09);
// Deterministic noise and a short bass-drum hit accent the final reveal.
let seed = 123456789;
for (let i = 0; i < rate * 0.75; i++) {
  const t = i / rate;
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  const noise = ((seed >>> 0) / 4294967295) * 2 - 1;
  const cymbal = noise * Math.exp(-t * 9) * (1 - Math.exp(-t * 300)) * 0.17;
  const drum = Math.sin(2 * Math.PI * (55 * t + 2.5 * (1 - Math.exp(-t * 28)))) * Math.exp(-t * 18) * 0.18;
  samples[Math.round(0.28 * rate) + i] += cymbal + drum;
}
const dry = samples.slice();
for (const [delay, gain] of [[0.065, 0.13], [0.115, 0.09], [0.19, 0.06]]) {
  const offset = Math.round(delay * rate);
  for (let i = offset; i < samples.length; i++) samples[i] += dry[i - offset] * gain;
}
for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i] * 1.3);
const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i] / peak * 0.84 * 32767), 44 + i * 2);
fs.writeFileSync(path.join(__dirname, '../assets/result-fanfare-strong.wav'), wav);
