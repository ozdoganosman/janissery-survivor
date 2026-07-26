import type { AudioEngine } from './engine';

/**
 * The mehter loop.
 *
 * Synthesised, like everything else, and scheduled rather than looped from a buffer:
 * a fixed recording would have to be minutes long to avoid being obviously circular,
 * and a sequencer that decides each bar as it goes costs a few hundred bytes and can
 * change with the run.
 *
 * Three things make it read as mehter rather than as generic game music. The rhythm is
 * the *düm-tek* pattern of the davul, with the deep kös on the downbeat. The melody
 * sits in Hicaz — the augmented second between the second and third degrees is the
 * interval the whole flavour hangs on. And the lead is a reedy sawtooth through a
 * narrow bandpass with vibrato, standing in for the zurna.
 *
 * Timing is the other reason this is scheduled. `setTimeout` drifts by tens of
 * milliseconds, which a listener hears immediately as a stumble; WebAudio's clock does
 * not, so bars are placed on it a little ahead of time and the render loop only has to
 * top the queue up.
 */

/** Beats per minute. A march, at the pace a march is actually walked. */
const BPM = 104;
const BEAT = 60 / BPM;
/** Four beats to the bar. */
const BAR = BEAT * 4;

/** How far ahead bars are placed. Long enough to survive a dropped frame. */
const SCHEDULE_AHEAD = 1.2;

/**
 * Hicaz on D: D, E flat, F sharp, G, A, B flat, C.
 *
 * The E flat to F sharp step is the augmented second, and it is the reason this scale
 * and not another one.
 */
const HICAZ = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 523.25];

/** Melodic phrases as scale degrees; -1 is a rest. */
const PHRASES: readonly (readonly number[])[] = [
  [0, -1, 1, 2, -1, 2, 1, 0],
  [4, 3, 2, -1, 1, 2, -1, -1],
  [0, 2, 4, 3, 2, 1, 0, -1],
  [2, 2, 3, 4, -1, 4, 3, 2],
  [4, -1, 5, 6, 5, 4, 2, -1],
];

/** Davul: 1 is a düm (low, on the beat), 2 a tek (high), 0 silence. Sixteen slots. */
const DAVUL = [1, 0, 0, 2, 1, 0, 2, 0, 1, 0, 0, 2, 1, 2, 0, 2];

export interface Music {
  /** Call every rendered frame. Cheap when there is nothing to schedule. */
  update(): void;
  /** Raises the intensity, 0..1. The run gets louder as it gets harder. */
  setIntensity(value: number): void;
  /** Stops scheduling. Bars already placed play out rather than cutting. */
  stop(): void;
  readonly playing: boolean;
  dispose(): void;
}

export function createMusic(engine: AudioEngine): Music {
  /** When the next unscheduled bar begins, in context time. */
  let nextBarAt = 0;
  let bar = 0;
  let intensity = 0;
  let running = false;

  const thump = (at: number, frequency: number, seconds: number, level: number): void => {
    const buses = engine.buses;
    if (buses === null) return;
    const osc = buses.context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency * 2.2, at);
    osc.frequency.exponentialRampToValueAtTime(frequency, at + 0.05);

    const env = buses.context.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0008, at + seconds);

    osc.connect(env);
    env.connect(buses.music);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  };

  /** Zil: the cymbal, a bright noiseless click made from a high detuned pair. */
  const zil = (at: number, level: number): void => {
    const buses = engine.buses;
    if (buses === null) return;
    const env = buses.context.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0008, at + 0.09);
    env.connect(buses.music);

    for (const frequency of [5200, 7350]) {
      const osc = buses.context.createOscillator();
      osc.type = 'square';
      osc.frequency.value = frequency;
      osc.connect(env);
      osc.start(at);
      osc.stop(at + 0.11);
    }
  };

  /** Zurna: sawtooth through a narrow bandpass, with the vibrato that sells the reed. */
  const zurna = (at: number, frequency: number, seconds: number, level: number): void => {
    const buses = engine.buses;
    if (buses === null) return;
    const context = buses.context;

    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = frequency;

    const vibrato = context.createOscillator();
    vibrato.frequency.value = 5.5;
    const vibratoDepth = context.createGain();
    vibratoDepth.gain.value = frequency * 0.012;
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(osc.frequency);

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency * 2.6;
    filter.Q.value = 4.5;

    const env = context.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.03);
    env.gain.setValueAtTime(level, at + seconds * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0008, at + seconds);

    osc.connect(filter);
    filter.connect(env);
    env.connect(buses.music);

    osc.start(at);
    vibrato.start(at);
    osc.stop(at + seconds + 0.02);
    vibrato.stop(at + seconds + 0.02);
  };

  const scheduleBar = (at: number): void => {
    // The zurna enters once the run has some pressure in it, so the first minute is
    // drums walking in and the late game is the full band.
    const lead = intensity > 0.22;
    const cymbals = intensity > 0.5;

    for (let slot = 0; slot < DAVUL.length; slot++) {
      const hit = DAVUL[slot];
      if (hit === 0) continue;
      const when = at + slot * (BEAT / 4);
      if (hit === 1) thump(when, 58, 0.34, 0.5);
      else thump(when, 128, 0.14, 0.26);
    }

    // The kös, on the first beat of every other bar. Rare enough to still land.
    if (bar % 2 === 0) thump(at, 41, 0.75, 0.55 * (0.5 + intensity * 0.5));

    if (cymbals) {
      for (const slot of [3, 7, 11, 15]) zil(at + slot * (BEAT / 4), 0.05 + intensity * 0.05);
    }

    if (lead) {
      const phrase = PHRASES[bar % PHRASES.length];
      const level = 0.055 + intensity * 0.05;
      for (let i = 0; i < phrase.length; i++) {
        const degree = phrase[i];
        if (degree < 0) continue;
        // Held slightly past its slot, so the line breathes as a phrase rather than
        // arriving as eight separate blips.
        zurna(at + i * (BEAT / 2), HICAZ[degree], BEAT * 0.62, level);
      }
    }

    bar++;
  };

  return {
    get playing() {
      return running;
    },

    setIntensity(value): void {
      intensity = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    },

    update(): void {
      const buses = engine.buses;
      if (buses === null || buses.context.state !== 'running') return;

      const now = buses.context.currentTime;
      if (!running) {
        running = true;
        // A beat of lead-in, so the first bar is not clipped by the scheduling call
        // that starts it.
        nextBarAt = now + 0.12;
        bar = 0;
      }

      // A context that was suspended and resumed can leave `nextBarAt` far in the
      // past; catching up bar by bar would schedule hundreds at once.
      if (nextBarAt < now - BAR) nextBarAt = now + 0.05;

      while (nextBarAt < now + SCHEDULE_AHEAD) {
        scheduleBar(nextBarAt);
        nextBarAt += BAR;
      }
      engine.keepAwake();
    },

    stop(): void {
      running = false;
    },

    dispose(): void {
      running = false;
    },
  };
}
