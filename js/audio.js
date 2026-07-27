// Tiny synth SFX via WebAudio — no external asset files needed.
let ctx = null;

function getCtx() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, delay, dur, type, vol) {
  const c = getCtx();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function playPickup() {
  tone(520, 0, 0.06, 'sine', 0.06);
}

export function playSnap() {
  tone(880, 0, 0.07, 'square', 0.1);
  tone(1320, 0.06, 0.09, 'square', 0.08);
}

export function playError() {
  tone(180, 0, 0.16, 'sawtooth', 0.12);
}

export function playWin() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.12, 0.22, 'square', 0.1));
}
