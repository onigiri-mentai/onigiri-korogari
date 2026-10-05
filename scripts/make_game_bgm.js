const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const bpm = 132;
const beatsPerBar = 4;
const bars = 8;
const secondsPerBeat = 60 / bpm;
const duration = bars * beatsPerBar * secondsPerBeat;
const totalSamples = Math.floor(duration * sampleRate);
const out = new Float32Array(totalSamples);
const outputPath = path.join(__dirname, '..', 'assets', 'bgm_game_pikopoyo.wav');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function noteToHz(note) {
  const match = /^([A-G])(#?)(-?\d)$/.exec(note);
  if (!match) throw new Error(`Bad note: ${note}`);
  const [, name, sharp, octaveText] = match;
  const octave = Number(octaveText);
  const semitoneMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (octave + 1) * 12 + semitoneMap[name] + (sharp ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function env(t, len, attack = 0.008, release = 0.08) {
  if (t < 0 || t > len) return 0;
  return Math.min(clamp(t / attack, 0, 1), clamp((len - t) / release, 0, 1));
}

function square(phase, duty = 0.5) {
  return phase % 1 < duty ? 1 : -1;
}

function triangle(phase) {
  return 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
}

function addNote({ startBeat, lengthBeats, note, volume = 0.1, wave = 'square', duty = 0.5 }) {
  const start = Math.floor(startBeat * secondsPerBeat * sampleRate);
  const len = Math.floor(lengthBeats * secondsPerBeat * sampleRate);
  const freq = noteToHz(note);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sampleRate;
    const p = freq * t;
    const e = env(t, len / sampleRate);
    const wobble = 1 + Math.sin(t * 18) * 0.006;
    const raw =
      wave === 'triangle'
        ? triangle(p * wobble)
        : wave === 'sine'
          ? Math.sin(Math.PI * 2 * p * wobble)
          : square(p * wobble, duty);
    out[start + i] += raw * volume * e;
  }
}

function addBell(startBeat, note, volume = 0.13) {
  const start = Math.floor(startBeat * secondsPerBeat * sampleRate);
  const len = Math.floor(0.42 * sampleRate);
  const freq = noteToHz(note);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sampleRate;
    const e = Math.exp(-t * 5.8) * env(t, len / sampleRate, 0.004, 0.12);
    const carrier = Math.sin(Math.PI * 2 * freq * t);
    const shimmer = Math.sin(Math.PI * 2 * freq * 2.01 * t) * 0.32;
    out[start + i] += (carrier + shimmer) * volume * e;
  }
}

function addPoyo(startBeat, note, volume = 0.12) {
  const start = Math.floor(startBeat * secondsPerBeat * sampleRate);
  const len = Math.floor(0.22 * sampleRate);
  const freq = noteToHz(note);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sampleRate;
    const bend = 1 + 0.42 * Math.exp(-t * 16);
    const e = env(t, len / sampleRate, 0.005, 0.12);
    out[start + i] += Math.sin(Math.PI * 2 * freq * bend * t) * volume * e;
  }
}

function addPerc(startBeat, type, volume = 0.04) {
  const start = Math.floor(startBeat * secondsPerBeat * sampleRate);
  const len = Math.floor((type === 'kick' ? 0.08 : 0.035) * sampleRate);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sampleRate;
    const e = Math.exp(-t * (type === 'kick' ? 38 : 100));
    const tone =
      type === 'kick'
        ? Math.sin(Math.PI * 2 * (90 - t * 420) * t)
        : Math.sin(Math.PI * 2 * 3200 * t) + Math.sin(Math.PI * 2 * 4600 * t) * 0.35;
    out[start + i] += tone * volume * e;
  }
}

const melody = [
  'G5', 'A5', 'C6', 'D6', 'E6', 'D6', 'C6', 'A5',
  'G5', 'A5', 'C6', 'E6', 'D6', 'C6', 'A5', 'G5',
  'A5', 'C6', 'D6', 'E6', 'G6', 'E6', 'D6', 'C6',
  'A5', 'G5', 'A5', 'C6', 'D6', 'C6', 'A5', 'G5'
];

melody.forEach((note, i) => {
  addNote({ startBeat: i, lengthBeats: 0.34, note, volume: 0.095, wave: 'square', duty: 0.34 });
  if (i % 4 === 2) addBell(i + 0.48, note, 0.07);
});

const bass = ['G2', 'G3', 'C3', 'C4', 'D3', 'D4', 'G2', 'D3'];
for (let bar = 0; bar < bars; bar++) {
  for (let step = 0; step < 4; step++) {
    addNote({
      startBeat: bar * beatsPerBar + step,
      lengthBeats: 0.44,
      note: bass[(bar + step) % bass.length],
      volume: 0.075,
      wave: 'triangle'
    });
  }
  addPoyo(bar * beatsPerBar + 1.5, bar % 2 === 0 ? 'E6' : 'D6', 0.1);
  addPoyo(bar * beatsPerBar + 3.25, bar % 2 === 0 ? 'C6' : 'G6', 0.09);
}

for (let beat = 0; beat < bars * beatsPerBar; beat += 0.5) {
  if (beat % 2 === 0) addPerc(beat, 'kick', 0.045);
  addPerc(beat + 0.25, 'tick', 0.022);
  if (beat % 1 === 0.5) addPerc(beat, 'tick', 0.034);
}

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
    const s = clamp(samples[i] * 0.78, -1, 1);
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * bytesPerSample);
  }

  fs.writeFileSync(outputPath, buffer);
}

writeWav(out);
console.log(`Wrote ${outputPath}`);
