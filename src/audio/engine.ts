/**
 * The audio context, its buses, and the rule that browsers will not let it start.
 *
 * Every sound in this game is synthesised. That is the same decision the models were:
 * no binary assets means nothing to download, nothing to lose, and a repository whose
 * diffs stay readable — and a WebAudio graph costs less than the WAV it replaces.
 *
 * Nothing here decides *what* to play. This layer owns the context, the volume buses
 * and the voice budget; `sfx.ts` and `music.ts` own the sounds.
 */

/** Concurrent one-shot voices. Past this, new sounds are dropped rather than queued. */
const MAX_VOICES = 24;

/**
 * Seconds of silence before the context is allowed to suspend itself.
 *
 * A running context costs a thread even with nothing playing, and on a phone that is
 * battery for no sound.
 */
const IDLE_SUSPEND_SECONDS = 6;

export interface AudioBuses {
  readonly context: AudioContext;
  /** Everything passes through here; used for the master volume and for muting. */
  readonly master: GainNode;
  readonly music: GainNode;
  readonly sfx: GainNode;
}

export interface AudioEngine {
  /** Null until the browser has let the context start. */
  readonly buses: AudioBuses | null;
  readonly running: boolean;
  /** Seconds since the context started. Safe to call before it exists. */
  now(): number;
  /**
   * Reserves a voice slot, returning a node to play through, or null when the budget
   * is spent. The slot is released automatically after `seconds`.
   */
  claimVoice(seconds: number): GainNode | null;
  setMasterVolume(value: number): void;
  setMusicVolume(value: number): void;
  setSfxVolume(value: number): void;
  /** Call from the render loop; suspends the context when nothing has played. */
  tick(seconds: number): void;
  /** Marks the engine as in use, so `tick` does not suspend it. */
  keepAwake(): void;
  dispose(): void;
}

/**
 * Creates the engine and arranges for it to start on the first user gesture.
 *
 * Browsers refuse to start an `AudioContext` outside a gesture, and building it up
 * front just to have it sit suspended wastes the resource on the many players who
 * never click. So the graph is built lazily, on the first pointer or key.
 */
export function createAudioEngine(target: Window = window): AudioEngine {
  let buses: AudioBuses | null = null;
  let master = 1;
  let music = 0.55;
  let sfx = 0.8;
  let voices = 0;
  let silentFor = 0;
  let disposed = false;

  const releaseAfter = (seconds: number): void => {
    voices++;
    globalThis.setTimeout(
      () => {
        voices = Math.max(0, voices - 1);
      },
      Math.max(50, seconds * 1000 + 60),
    );
  };

  const start = (): void => {
    if (buses !== null || disposed) return;

    // Safari only exposes the prefixed name on older versions, and the whole feature
    // is optional here: a browser with neither still gets a playable game.
    const scope = target as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    if (Ctor === undefined) return;

    let context: AudioContext;
    try {
      context = new Ctor({ latencyHint: 'interactive' });
    } catch {
      // A browser that refuses audio still gets a playable game.
      return;
    }

    const masterGain = context.createGain();
    masterGain.gain.value = master;
    masterGain.connect(context.destination);

    const musicGain = context.createGain();
    musicGain.gain.value = music;
    musicGain.connect(masterGain);

    const sfxGain = context.createGain();
    sfxGain.gain.value = sfx;
    sfxGain.connect(masterGain);

    buses = { context, master: masterGain, music: musicGain, sfx: sfxGain };
    void context.resume();
  };

  const onGesture = (): void => {
    start();
    if (buses !== null) void buses.context.resume();
  };

  // `pointerdown` rather than `click`, so the very first tap that starts a run also
  // starts the audio instead of the one after it.
  target.addEventListener('pointerdown', onGesture, { passive: true });
  target.addEventListener('keydown', onGesture);
  target.addEventListener('touchstart', onGesture, { passive: true });

  return {
    get buses() {
      return buses;
    },

    get running() {
      return buses !== null && buses.context.state === 'running';
    },

    now(): number {
      return buses?.context.currentTime ?? 0;
    },

    claimVoice(seconds): GainNode | null {
      if (buses === null || buses.context.state !== 'running') return null;
      // Dropping past the budget rather than queueing: a sound that arrives late is
      // worse than one that never arrives, and in a crowd nobody can hear the
      // twenty-fifth hit anyway.
      if (voices >= MAX_VOICES) return null;
      silentFor = 0;
      releaseAfter(seconds);
      const gain = buses.context.createGain();
      gain.connect(buses.sfx);
      return gain;
    },

    setMasterVolume(value): void {
      master = clamp01(value);
      if (buses !== null) buses.master.gain.value = master;
    },

    setMusicVolume(value): void {
      music = clamp01(value);
      if (buses !== null) buses.music.gain.value = music;
    },

    setSfxVolume(value): void {
      sfx = clamp01(value);
      if (buses !== null) buses.sfx.gain.value = sfx;
    },

    keepAwake(): void {
      silentFor = 0;
    },

    tick(seconds): void {
      if (buses === null) return;
      silentFor += seconds;
      if (silentFor > IDLE_SUSPEND_SECONDS && buses.context.state === 'running') {
        void buses.context.suspend();
      }
    },

    dispose(): void {
      disposed = true;
      target.removeEventListener('pointerdown', onGesture);
      target.removeEventListener('keydown', onGesture);
      target.removeEventListener('touchstart', onGesture);
      if (buses !== null) {
        void buses.context.close();
        buses = null;
      }
    },
  };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
