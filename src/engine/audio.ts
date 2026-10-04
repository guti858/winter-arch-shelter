// Audio sintetizado con Web Audio (sin archivos): "pop" al completar, campanilla, arpegio de
// subida de nivel, campana de temporizador y viento de fondo (ruido filtrado muy bajo).
// Nada suena hasta el primer gesto del usuario (política de autoplay) y todo respeta el ajuste de sonido.

export type SfxName = 'pop' | 'chime' | 'levelup' | 'bell';

type Ctx = AudioContext;

export class Sfx {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private wind: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private enabled = true;
  private unlocked = false;

  /** Llamar en el primer gesto del usuario. */
  unlock(enabled: boolean) {
    this.unlocked = true;
    this.enabled = enabled;
    if (enabled) this.ensure();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on && this.unlocked) {
      this.ensure();
      this.ctx?.resume();
      this.startWind();
    } else {
      this.stopWind();
    }
  }

  private ensure(): Ctx | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') this.ctx.suspend();
      else if (this.enabled) this.ctx.resume();
    });
    this.startWind();
    return this.ctx;
  }

  play(name: SfxName) {
    if (!this.enabled || !this.unlocked) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'pop':
        this.tone(t, 520, 0.16, 'sine', 0.35, 880);
        this.tone(t, 1040, 0.08, 'triangle', 0.08, 1500);
        break;
      case 'chime':
        this.tone(t, 1318.5, 0.9, 'sine', 0.16); // E6
        this.tone(t + 0.09, 1975.5, 1.1, 'sine', 0.11); // B6
        break;
      case 'levelup':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this.tone(t + i * 0.09, f, 0.7, 'triangle', 0.14);
          this.tone(t + i * 0.09, f * 2, 0.5, 'sine', 0.05);
        });
        this.tone(t + 0.36, 261.63, 1.4, 'sine', 0.08);
        break;
      case 'bell':
        this.tone(t, 880, 1.6, 'sine', 0.18);
        this.tone(t, 1320, 1.1, 'sine', 0.08);
        this.tone(t + 0.4, 880, 1.6, 'sine', 0.12);
        break;
    }
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, vol: number, glideTo?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + Math.min(0.09, dur * 0.5));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private startWind() {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.wind || !this.enabled) return;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // ruido "marrón" suave (más grave que el blanco)
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(band.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 4);
    src.connect(band).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.wind = { src, gain, lfo };
  }

  private stopWind() {
    if (!this.wind || !this.ctx) return;
    const { src, gain, lfo } = this.wind;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.6);
    src.stop(t + 0.7);
    lfo.stop(t + 0.7);
    this.wind = null;
  }
}
