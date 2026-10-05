const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const bpm = 120;
const beatsPerBar = 4;
const bars = 8;
const secondsPerBeat = 60 / bpm;
const duration = bars * beatsPerBar * secondsPerBeat;
const totalSamples = Math.floor(duration * sampleRate);
const out = new Float32Array(totalSamples);

const outputPath = path.join(__dirname, '..', 'assets', 'bgm_pikopoyo_preview.wav');

function noteToHz(note) {
  const match = /^([A-G])(#?)(-?\d)$/.exec(note);
  if (!match) throw new Error(`Bad note: ${note}`);
  const [, name, sharp, octaveText] = match;
  const octave = Number(octaveText);
  const semitoneMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (octave + 1) * 12 + semitoneMap[name] + (sharp ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function env(t, len, attack = 0.012, release = 0.08) {
  if (t < 0 || t > len) return 0;
  const a = clamp(t / attack, 0, 1);
  const r = clamp((len - t) / release, 0, 1);
  return Math.min(a, r);
}

function square(phase, duty = 0.5) {
  return (phase % 1) < duty ? 1 : -1;
}

function triangle(phase) {
  return 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
}

function addNote({ startBeat, lengthBeats, note, volume = 0.2, wave = 'square', duty = 0.5 }) {
  const start = Math.floor(startBeat * secondsPerBeat * sampleRate);
  const len = Math.floor(lengthBeats * secondsPerBeat * sampleRate);
  const freq = noteToHz(note);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sampleRate;
    const phase = freq * t;
    const e = env(t, len / sampleRate);
    const raw = wave === 'triangle' ? triangle(phase) : square(phase, duty);
    out[start + i] += raw * volume * e;
  }
}

function addPoyo(startBeat, note, volume = 0.16) {
  const start = Math.floor(startBeat * secondsPerBeat * sampleRate);
  const len = Math.floor(0.28 * sampleRate);
  const base = noteToHz(note);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sampleRate;
    const bend = 1 + 0.34 * Math.exp(-t * 13);
    const wobble = 1 + Math.sin(t * 38) * 0.014;
    const e = env(t, len / sampleRate, 0.006, 0.16);
    out[start + i] += Math.sin(Math.PI * 2 * base * bend * wobble * t) * volume * e;
  }
}

function addClick(startBeat, volume = 0.045) {
  const start = Math.floor(startBeat * secondsPerBeat * sampleRate);
  const len = Math.floor(0.035 * sampleRate);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sampleRate;
    const e = Math.exp(-t * 95);
    const tone = Math.sin(Math.PI * 2 * 2800 * t) + Math.sin(Math.PI * 2 * 4100 * t) * 0.35;
    out[start + i] += tone * volume * e;
  }
}

const melody = [
  'D5', 'E5', 'G5', 'A5', 'G5', 'E5', 'D5', 'A4',
  'D5', 'E5', 'G5', 'B5', 'A5', 'G5', 'E5', 'D5',
  'E5', 'G5', 'A5', 'B5', 'A5', 'G5', 'E5', 'G5',
  'D5', 'A4', 'D5', 'E5', 'G5', 'E5', 'D5', 'A4'
];

melody.forEach((note, i) => {
  addNote({
    startBeat: i,
    lengthBeats: i % 8 === 7 ? 0.72 : 0.42,
    note,
    volume: 0.13,
    wave: 'square',
    duty: 0.38
  });
});

const harmony = ['D4', 'A4', 'B4', 'G4'];
for (let bar = 0; bar < bars; bar++) {
  const root = ['D3', 'G3', 'B2', 'A2'][bar % 4];
  addNote({ startBeat: bar * beatsPerBar, lengthBeats: 1.8, note: root, volume: 0.09, wave: 'triangle' });
  addNote({ startBeat: bar * beatsPerBar + 2, lengthBeats: 1.4, note: harmony[bar % 4], volume: 0.055, wave: 'square', duty: 0.25 });
  addPoyo(bar * beatsPerBar + 1.5, bar % 2 === 0 ? 'A5' : 'B5', 0.13);
  addPoyo(bar * beatsPerBar + 3.25, bar % 2 === 0 ? 'G5' : 'D6', 0.105);
}

for (let beat = 0; beat < bars * beatsPerBar; beat += 0.5) {
  addClick(beat, beat % 1 === 0 ? 0.038 : 0.026);
}

// Tiny fade at the edges so the preview loops without a click.
const fadeSamples = Math.floor(0.025 * sampleRate);
for (let i = 0; i < fadeSamples; i++) {
  const k = i / fadeSamples;
  out[i] *= k;
  out[out.length - 1 - i] *= k;
}

function writeWav(samples) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const s = clamp(samples[i] * 0.82, -1, 1);
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * bytesPerSample);
  }

  fs.writeFileSync(outputPath, buffer);
}

writeWav(out);
console.log(`Wrote ${outputPath}`);
