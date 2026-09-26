/**
 * Every sound in the game, made on the spot with WebAudio: no recordings to load. The
 * town's murmur swells as the camera comes down into the streets, birds sing in spring
 * and summer, the wind blows over the walls in winter and hammers knock where something
 * is being built. Short cues answer the player's orders, and a ney improvises in makam
 * Hicaz over a soft drone.
 *
 * Browsers only let a page make sound after the player has touched it, so nothing is
 * created until `unlock` is called from a click or a key.
 */

export type Cue = 'build' | 'demolish' | 'upgrade' | 'complete' | 'coin' | 'bad' | 'rank' | 'click';

/** What the ambience listens to, each frame. */
export interface Mood {
  /** 0 far above the city, 1 down among the houses. */
  closeness: number;
  season: 'Bahar' | 'Yaz' | 'Güz' | 'Kış';
  paused: boolean;
  /** 0..1: how big and busy the city is. */
  bustle: number;
  /** Building works going on. */
  works: number;
}

const MASTER = 0.8;
const MUSIC = 0.16;

/**
 * Makam Hicaz on dügâh (D), in cents above the tonic: dügâh, dik kürdî, nîm hicaz,
 * nevâ, hüseynî, acem, gerdaniye, and the upper dügâh an octave up.
 */
const HICAZ = [0, 90, 384, 498, 702, 792, 996, 1200];
const TONIC_HZ = 293.66;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private murmur: GainNode | null = null;
  private wind: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private mood: Mood = { closeness: 0, season: 'Bahar', paused: false, bustle: 0, works: 0 };
  private nextBird = 0;
  private nextKnock = 0;
  private nextPhrase = 2;
  private note = 0;

  constructor(
    private sound: boolean,
    private music: boolean,
  ) {}

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Starts (or resumes) audio. Call from inside a user gesture. */
  unlock(): void {
    if (this.ctx === null) {
      const Ctor = window.AudioContext as typeof AudioContext | undefined;
      if (Ctor === undefined) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  setSound(on: boolean): void {
    this.sound = on;
    this.applyLevels();
  }

  setMusic(on: boolean): void {
    this.music = on;
    this.applyLevels();
  }

  private applyLevels(): void {
    const ctx = this.ctx;
    if (ctx === null || this.master === null || this.musicBus === null || this.fx === null) return;
    const t = ctx.currentTime;
    this.fx.gain.setTargetAtTime(this.sound ? 1 : 0, t, 0.1);
    this.musicBus.gain.setTargetAtTime(this.music ? MUSIC : 0, t, 0.4);
  }

  private build(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = MASTER;
    this.master.connect(ctx.destination);
    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    // Two seconds of white noise, the raw stuff of crowds, wind and rubble.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }

    // The town: noise through a few voice-like bands, each breathing at its own pace.
    this.murmur = ctx.createGain();
    this.murmur.gain.value = 0;
    this.murmur.connect(this.fx);
    for (const [freq, rate] of [
      [420, 0.13],
      [900, 0.21],
      [1700, 0.17],
    ] as const) {
      const src = this.loop(ctx);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0.35;
      lfo.connect(depth).connect(g.gain);
      src.connect(band).connect(g).connect(this.murmur);
      lfo.start();
    }

    // The wind: low, slowly sweeping noise.
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    this.wind.connect(this.fx);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 350;
    this.windFilter.Q.value = 3;
    this.loop(ctx).connect(this.windFilter).connect(this.wind);

    // The drone under the ney: dügâh and nevâ, very soft.
    for (const [cents, level] of [
      [-1200, 0.28],
      [-702, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = TONIC_HZ * Math.pow(2, cents / 1200);
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(this.musicBus);
      o.start();
    }
    this.applyLevels();
  }

  private loop(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // Start each loop at its own place, so the layers do not repeat together.
    src.start(0, Math.random() * 2);
    return src;
  }

  /** Called every frame: sets the ambience and schedules birds, hammers and the ney. */
  update(mood: Mood): void {
    this.mood = mood;
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const near = mood.closeness;
    const hush = mood.paused ? 0.35 : 1;
    this.murmur?.gain.setTargetAtTime(0.18 * near * (0.3 + 0.7 * mood.bustle) * hush, t, 0.5);
    const winter = mood.season === 'Kış' ? 1 : mood.season === 'Güz' ? 0.35 : 0.1;
    this.wind?.gain.setTargetAtTime((0.05 + 0.25 * winter) * (1 - near * 0.6), t, 1);
    this.windFilter?.frequency.setTargetAtTime(
      300 + 250 * Math.sin(t * 0.21) + 150 * Math.sin(t * 0.07),
      t,
      0.5,
    );

    if (t >= this.nextBird) {
      const birds =
        mood.season === 'Bahar' ? 1 : mood.season === 'Yaz' ? 0.7 : mood.season === 'Güz' ? 0.25 : 0;
      if (birds > 0 && !mood.paused) this.bird(t, 0.05 * birds * (0.3 + 0.7 * near));
      this.nextBird = t + 0.4 + Math.random() * (birds > 0.5 ? 2.2 : 5);
    }
    if (t >= this.nextKnock) {
      if (mood.works > 0 && !mood.paused && near > 0.2) this.knock(t, 0.12 * near, 0.5 + Math.random() * 0.5);
      this.nextKnock = t + 0.35 + Math.random() * (1.4 / Math.max(1, mood.works));
    }
    if (t >= this.nextPhrase) this.nextPhrase = this.phrase(t);
  }

  /** One short cue. */
  play(cue: Cue): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== 'running' || !this.sound) return;
    const t = ctx.currentTime + 0.01;
    switch (cue) {
      case 'build':
        this.knock(t, 0.35, 0.9);
        this.knock(t + 0.16, 0.3, 1.1);
        this.thud(t + 0.02, 0.25);
        break;
      case 'demolish':
        this.rubble(t, 0.35);
        this.thud(t, 0.35);
        break;
      case 'upgrade':
        this.pluck(t, 2 * TONIC_HZ, 0.18);
        this.pluck(t + 0.12, 2 * TONIC_HZ * Math.pow(2, 498 / 1200), 0.18);
        break;
      case 'complete':
        this.bell(t, 3 * TONIC_HZ, 0.16);
        break;
      case 'rank':
        HICAZ.slice(3, 8).forEach((c, k) =>
          this.bell(t + k * 0.14, 2 * TONIC_HZ * Math.pow(2, c / 1200), 0.1),
        );
        break;
      case 'coin':
        this.ping(t, 3100, 0.06);
        this.ping(t + 0.07, 4200, 0.05);
        break;
      case 'bad':
        this.thud(t, 0.4);
        this.thud(t + 0.28, 0.3);
        break;
      case 'click':
        this.ping(t, 1800, 0.03);
        break;
    }
  }

  // ---------------------------------------------------------------- voices

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /** A wooden knock: a burst of noise through a resonant band. */
  private knock(t: number, level: number, pitch: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900 * pitch;
    band.Q.value = 8;
    const g = this.env(t, level, 0.002, 0.09);
    src.connect(band).connect(g).connect(this.fx!);
    src.start(t, Math.random());
    src.stop(t + 0.15);
  }

  /** A low drum-like thump, falling in pitch. */
  private thud(t: number, level: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    const g = this.env(t, level, 0.005, 0.3);
    o.connect(g).connect(this.fx!);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** Falling stones: low noise sliding down. */
  private rubble(t: number, level: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(1600, t);
    low.frequency.exponentialRampToValueAtTime(200, t + 0.7);
    const g = this.env(t, level, 0.01, 0.7);
    src.connect(low).connect(g).connect(this.fx!);
    src.start(t, Math.random());
    src.stop(t + 0.8);
  }

  /** A plucked string, like an ud. */
  private pluck(t: number, hz: number, level: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(hz * 6, t);
    low.frequency.exponentialRampToValueAtTime(hz * 1.2, t + 0.4);
    const g = this.env(t, level, 0.004, 0.5);
    o.connect(low).connect(g).connect(this.fx!);
    o.start(t);
    o.stop(t + 0.6);
  }

  /** A small bell: inharmonic partials dying away. */
  private bell(t: number, hz: number, level: number): void {
    const ctx = this.ctx!;
    for (const [ratio, share] of [
      [1, 1],
      [2.76, 0.4],
      [5.4, 0.2],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = hz * ratio;
      const g = this.env(t, level * share, 0.003, 1.4 / ratio + 0.3);
      o.connect(g).connect(this.fx!);
      o.start(t);
      o.stop(t + 2);
    }
  }

  /** A bright tick, like a coin on a counter. */
  private ping(t: number, hz: number, level: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz;
    const g = this.env(t, level, 0.002, 0.12);
    o.connect(g).connect(this.fx!);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** A bird: a few quick upward and downward whistles. */
  private bird(t: number, level: number): void {
    const ctx = this.ctx!;
    const base = 2600 + Math.random() * 2200;
    const notes = 1 + Math.floor(Math.random() * 4);
    for (let k = 0; k < notes; k++) {
      const s = t + k * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), s);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), s + 0.05);
      const g = this.env(s, level, 0.005, 0.06);
      o.connect(g).connect(this.fx!);
      o.start(s);
      o.stop(s + 0.1);
    }
  }

  /**
   * One phrase of a ney taksim: a few notes wandering the scale by steps, breathy and with
   * a slow vibrato, coming to rest on dügâh or nevâ. Returns when the next phrase may begin.
   */
  private phrase(t: number): number {
    if (!this.music || this.mood.paused) return t + 2;
    const ctx = this.ctx!;
    const count = 3 + Math.floor(Math.random() * 5);
    let at = t + 0.05;
    for (let k = 0; k < count; k++) {
      const last = k === count - 1;
      if (last) this.note = Math.random() < 0.6 ? 0 : 3;
      else this.note = Math.max(0, Math.min(HICAZ.length - 1, this.note + (Math.random() < 0.5 ? -1 : 1)));
      const hz = TONIC_HZ * Math.pow(2, HICAZ[this.note] / 1200);
      const dur = (last ? 1.6 : 0.5) + Math.random() * (last ? 1.2 : 0.9);
      this.ney(at, hz, dur, ctx);
      at += dur * 0.92;
    }
    return at + 2 + Math.random() * 4;
  }

  private ney(t: number, hz: number, dur: number, ctx: AudioContext): void {
    const bus = this.musicBus!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.18);
    g.gain.setValueAtTime(0.5, t + dur - 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(bus);
    // The tone: a soft fundamental with a little of the octave and twelfth.
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 4.5 + Math.random();
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(hz * 0.006, t + dur * 0.6);
    vibrato.connect(depth);
    for (const [ratio, level] of [
      [1, 0.8],
      [2, 0.12],
      [3, 0.05],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = hz * ratio;
      const scaled = ctx.createGain();
      scaled.gain.value = ratio;
      depth.connect(scaled).connect(o.frequency);
      const lg = ctx.createGain();
      lg.gain.value = level;
      o.connect(lg).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    vibrato.start(t);
    vibrato.stop(t + dur + 0.05);
    // The breath: noise through a band at the note, strongest at the attack.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = hz * 2;
    band.Q.value = 2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.25, t + 0.08);
    bg.gain.exponentialRampToValueAtTime(0.04, t + 0.4);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(bg).connect(bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}
