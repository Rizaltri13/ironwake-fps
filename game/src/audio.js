// All sound is synthesised with WebAudio: no audio files, nothing to load. A noise
// burst through a lowpass is a gunshot, a square blip is a hit tick, two sines are the
// plant beeps. The context wakes on the first user gesture; before that (and in
// screenshot mode) every call is a no-op. Distant shots are quieter and duller.
export function createAudio() {
  let ctx = null;
  let master = null;

  function wake() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
  }

  function noiseBurst(duration, filterFreq, gain, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start(t);
  }

  function tone(freq, duration, gain, type = 'sine', when = 0, slideTo = null) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    wake,
    shot(weaponId, distance = 0) {
      if (!ctx) return;
      const near = Math.max(0.12, 1 - distance / 55);
      const power = weaponId === 'longshot' || weaponId === 'scatter' ? 1 : weaponId === 'pistol' ? 0.6 : 0.8;
      noiseBurst(0.14 * power + 0.05, 2600 * near + 300, 0.5 * near * power);
      tone(120, 0.09, 0.25 * near, 'triangle', 0, 45);
    },
    dryFire() { tone(1400, 0.03, 0.08, 'square'); },
    reload() { tone(500, 0.05, 0.12, 'square'); tone(340, 0.05, 0.12, 'square', 0.09); tone(720, 0.04, 0.14, 'square', 0.2); },
    hit(killed) { tone(killed ? 1180 : 880, 0.07, 0.16, 'sine'); if (killed) tone(1560, 0.1, 0.14, 'sine', 0.05); },
    hurt() { tone(160, 0.12, 0.2, 'sawtooth', 0, 80); },
    buy() { tone(980, 0.06, 0.12, 'sine'); tone(1320, 0.08, 0.1, 'sine', 0.05); },
    denied() { tone(220, 0.09, 0.12, 'square'); },
    plantBeep(final = false) { tone(final ? 1560 : 1040, final ? 0.3 : 0.07, 0.14, 'sine'); },
    tick() { tone(1240, 0.04, 0.07, 'sine'); },
    roundWin() { tone(523, 0.14, 0.14, 'triangle'); tone(659, 0.14, 0.14, 'triangle', 0.11); tone(784, 0.24, 0.16, 'triangle', 0.22); },
    roundLose() { tone(392, 0.16, 0.14, 'triangle'); tone(330, 0.16, 0.14, 'triangle', 0.13); tone(262, 0.28, 0.15, 'triangle', 0.26); },
    explosion() { noiseBurst(0.9, 500, 0.9); tone(70, 0.7, 0.5, 'sine', 0, 30); },
  };
}
