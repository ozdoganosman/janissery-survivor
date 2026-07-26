import type { AudioEngine } from './engine';

/**
 * Every sound the game makes, built out of oscillators and noise.
 *
 * The hard problem here is not the synthesis, it is the rate. Six weapons striking a
 * packed crowd land hundreds of hits a second, and a game that faithfully plays one
 * click per hit produces a solid buzz that carries no information at all — the same
 * failure the damage numbers had, in a different sense. So every sound has a minimum
 * interval, and one that arrives inside it is dropped rather than queued.
 *
 * The intervals are not uniform. A hit is background texture and can be thinned hard;
 * a level-up happens once a minute and must never be missed.
 */

export const SFX_IDS = [
  'hit',
  'crit',
  'kill',
  'shoot',
  'pickup',
  'levelUp',
  'hurt',
  'telegraph',
  'slam',
  'bossArrive',
  'select',
  'confirm',
  'lose',
  'win',
] as const;

export type SfxId = (typeof SFX_IDS)[number];

/**
 * Minimum seconds between two plays of the same sound.
 *
 * Zero would be honest and unlistenable. These are the numbers that decide what the
 * crowd sounds like.
 */
const MIN_INTERVAL: Readonly<Record<SfxId, number>> = {
  hit: 0.055,
  crit: 0.09,
  kill: 0.07,
  shoot: 0.1,
  pickup: 0.045,
  levelUp: 0,
  hurt: 0.25,
  telegraph: 0.6,
  slam: 0.3,
  bossArrive: 2,
  select: 0.04,
  confirm: 0.04,
  lose: 0,
  win: 0,
};

export interface Sfx {
  play(id: SfxId, intensity?: number): void;
  dispose(): void;
}

/** A short noise burst, reused by every percussive sound. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * 0.4);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  // A fixed pseudo-random sequence rather than Math.random: the same noise every run
  // keeps a seeded replay identical down to the audio, and nobody can hear the
  // difference between one white noise and another.
  let state = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    data[i] = (state / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

export function createSfx(engine: AudioEngine): Sfx {
  const lastPlayed = new Map<SfxId, number>();
  let noise: AudioBuffer | null = null;

  /** A pitched blip: oscillator, optional glide, exponential decay. */
  const tone = (
    out: GainNode,
    context: AudioContext,
    at: number,
    type: OscillatorType,
    from: number,
    to: number,
    seconds: number,
    level: number,
  ): void => {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + seconds);

    const env = context.createGain();
    // A ramp from exactly zero cannot be exponential, so the attack is linear and
    // only the tail — the part anyone hears as a decay — is exponential.
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0008, at + seconds);

    osc.connect(env);
    env.connect(out);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  };

  /** Filtered noise: every percussive sound in the game is one of these. */
  const hiss = (
    out: GainNode,
    context: AudioContext,
    at: number,
    frequency: number,
    q: number,
    seconds: number,
    level: number,
    type: BiquadFilterType = 'bandpass',
  ): void => {
    noise ??= noiseBuffer(context);
    const source = context.createBufferSource();
    source.buffer = noise;

    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    filter.Q.value = q;

    const env = context.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0008, at + seconds);

    source.connect(filter);
    filter.connect(env);
    env.connect(out);
    source.start(at);
    source.stop(at + seconds + 0.02);
  };

  return {
    play(id, intensity = 1): void {
      const buses = engine.buses;
      if (buses === null) return;

      const at = buses.context.currentTime;
      const minimum = MIN_INTERVAL[id];
      const previous = lastPlayed.get(id);
      if (previous !== undefined && at - previous < minimum) return;

      // Longest tail of any branch below, so the voice budget is not under-counted.
      const out = engine.claimVoice(1.6);
      if (out === null) return;
      lastPlayed.set(id, at);

      const context = buses.context;
      const strength = Math.min(1.4, Math.max(0.15, intensity));
      out.gain.value = 1;

      switch (id) {
        case 'hit':
          // Dry and short: this one plays more than all the others combined.
          hiss(out, context, at, 1750, 1.2, 0.07, 0.16 * strength);
          tone(out, context, at, 'square', 240, 150, 0.05, 0.05 * strength);
          break;

        case 'crit':
          hiss(out, context, at, 3200, 1.6, 0.12, 0.22 * strength);
          tone(out, context, at, 'square', 660, 300, 0.14, 0.11 * strength);
          break;

        case 'kill':
          hiss(out, context, at, 900, 0.7, 0.13, 0.12 * strength, 'lowpass');
          break;

        case 'shoot':
          tone(out, context, at, 'sawtooth', 520, 210, 0.08, 0.06 * strength);
          break;

        case 'pickup':
          // Rising, because it is the one thing in the crowd that is good news.
          tone(out, context, at, 'triangle', 880, 1320, 0.09, 0.1 * strength);
          break;

        case 'levelUp': {
          // An arpeggio in Hicaz, the same mode the music uses, so the reward sounds
          // like it belongs to this game rather than to a menu.
          const steps = [587.33, 622.25, 783.99, 1046.5];
          steps.forEach((frequency, index) => {
            tone(out, context, at + index * 0.075, 'triangle', frequency, frequency, 0.3, 0.12);
          });
          break;
        }

        case 'hurt':
          tone(out, context, at, 'sawtooth', 180, 70, 0.28, 0.2 * strength);
          hiss(out, context, at, 420, 0.6, 0.2, 0.14 * strength, 'lowpass');
          break;

        case 'telegraph':
          // A rising whine, so the ring on the ground is audible even off screen.
          tone(out, context, at, 'sawtooth', 150, 420, 0.85, 0.09);
          break;

        case 'slam':
          tone(out, context, at, 'sine', 110, 34, 0.5, 0.42);
          hiss(out, context, at, 260, 0.5, 0.4, 0.3, 'lowpass');
          break;

        case 'bossArrive':
          // Kös drums: the deepest thing in the mix, and the only sound that gets it.
          tone(out, context, at, 'sine', 70, 42, 0.9, 0.45);
          tone(out, context, at + 0.42, 'sine', 62, 36, 1.1, 0.4);
          hiss(out, context, at, 180, 0.4, 0.7, 0.16, 'lowpass');
          break;

        case 'select':
          tone(out, context, at, 'square', 420, 420, 0.035, 0.05);
          break;

        case 'confirm':
          tone(out, context, at, 'triangle', 523.25, 783.99, 0.14, 0.1);
          break;

        case 'lose':
          tone(out, context, at, 'sawtooth', 220, 55, 1.2, 0.22);
          tone(out, context, at + 0.1, 'sine', 110, 40, 1.4, 0.18);
          break;

        case 'win': {
          const steps = [523.25, 622.25, 783.99, 1046.5, 1244.5];
          steps.forEach((frequency, index) => {
            tone(out, context, at + index * 0.13, 'triangle', frequency, frequency, 0.5, 0.14);
          });
          break;
        }
      }
    },

    dispose(): void {
      lastPlayed.clear();
      noise = null;
    },
  };
}
