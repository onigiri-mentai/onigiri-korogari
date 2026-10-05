// Original fanfare synthesized without external samples.
const fs = require('fs');
const path = require('path');
const rate = 22050;
const samples = new Float64Array(Math.ceil(rate * 1.7));
function chord(start, length, notes, volume) {
  const offset = Math.round(start * rate);
  for (let i = 0; i < length * rate; i++) {
    const t = i / rate;
    const envelope = Math.min(1, t / 0.012) * Math.min(1, (length - t) / 0.13) * (0.65 + 0.35 * Math.exp(-t * 8));
    let value = 0;
    for (const note of notes) {
      const phase = 2 * Math.PI * 440 * 2 ** ((note - 69) / 12) * t;
      value += Math.sin(phase) + 0.28 * Math.sin(phase * 2) + 0.13 * Math.sin(phase * 3) + 0.12 * Math.sin(phase * 1.003);
    }
    samples[offset + i] += value / notes.length * envelope * volume;
  }
}
chord(0, 0.15, [55, 67, 71, 74], 0.42);
chord(0.20, 0.15, [55, 67, 71, 77], 0.46);
chord(0.42, 0.96, [48, 60, 64, 67, 72], 0.56);
chord(0.43, 0.16, [84], 0.08);
chord(0.53, 0.16, [88], 0.07);
chord(0.63, 0.22, [91], 0.06);
const dry = samples.slice();
for (const [delay, gain] of [[0.065, 0.13], [0.115, 0.09], [0.19, 0.06]]) {
  const offset = Math.round(delay * rate);
  for (let i = offset; i < samples.length; i++) samples[i] += dry[i - offset] * gain;
}
const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i] / peak * 0.72 * 32767), 44 + i * 2);
fs.writeFileSync(path.join(__dirname, '../assets/result-fanfare.wav'), wav);
