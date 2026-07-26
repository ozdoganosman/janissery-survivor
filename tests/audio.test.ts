import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clamp01, createAudioEngine } from '../src/audio/engine';
import { createMusic } from '../src/audio/music';
import { createSfx, SFX_IDS } from '../src/audio/sfx';

/**
 * The audio is verified by watching the graph it builds, not by listening.
 *
 * What is worth pinning is not the timbre — that is a judgement made by ear — but the
 * two things that break silently: the rate limiting that stops hundreds of hits a
 * second turning into a buzz, and the scheduler's behaviour when the clock jumps.
 */

interface FakeNode {
  readonly kind: string;
  connect: (target: unknown) => void;
  disconnect: () => void;
}

/** A stand-in for `AudioContext` that records what was built and started. */
function fakeContext(): {
  context: AudioContext;
  started: { kind: string; at: number }[];
  advance: (seconds: number) => void;
  state: (next: AudioContextState) => void;
} {
  let currentTime = 0;
  let state: AudioContextState = 'running';
  const started: { kind: string; at: number }[] = [];

  const param = (): AudioParam =>
    ({
      value: 0,
      setValueAtTime: () => param(),
      linearRampToValueAtTime: () => param(),
      exponentialRampToValueAtTime: () => param(),
    }) as unknown as AudioParam;

  const node = (kind: string): FakeNode => ({
    kind,
    connect: () => undefined,
    disconnect: () => undefined,
  });

  const source = (kind: string): FakeNode & { start: (at: number) => void; stop: () => void } =>
    ({
      ...node(kind),
      frequency: param(),
      detune: param(),
      type: 'sine',
      start: (at: number) => started.push({ kind, at }),
      stop: () => undefined,
      buffer: null,
    }) as never;

  const context = {
    get currentTime() {
      return currentTime;
    },
    get state() {
      return state;
    },
    sampleRate: 48000,
    destination: node('destination'),
    createGain: () => ({ ...node('gain'), gain: param() }) as never,
    createOscillator: () => source('oscillator'),
    createBufferSource: () => source('bufferSource'),
    createBiquadFilter: () =>
      ({ ...node('filter'), frequency: param(), Q: param(), type: 'bandpass' }) as never,
    createBuffer: (_channels: number, length: number) =>
      ({ length, getChannelData: () => new Float32Array(length) }) as never,
    resume: () => Promise.resolve(),
    suspend: () => {
      state = 'suspended';
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  } as unknown as AudioContext;

  return {
    context,
    started,
    advance: (seconds) => {
      currentTime += seconds;
    },
    state: (next) => {
      state = next;
    },
  };
}

/** A window stand-in whose `AudioContext` is the fake above. */
function fakeWindow(harness: ReturnType<typeof fakeContext>): {
  target: Window;
  gesture: () => void;
} {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const target = {
    AudioContext: function () {
      return harness.context;
    } as unknown as typeof AudioContext,
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((h) => h !== handler),
      );
    },
  } as unknown as Window;

  return {
    target,
    gesture: () => {
      for (const handler of listeners.get('pointerdown') ?? []) handler({});
    },
  };
}

describe('clamp01', () => {
  it('clamps and rejects nonsense', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(4)).toBe(1);
    // A NaN volume silences the game rather than throwing somewhere downstream.
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('createAudioEngine', () => {
  it('does not build a context before a gesture', () => {
    // Browsers refuse to start one outside a gesture, and building it up front wastes
    // the resource on everyone who never clicks.
    const harness = fakeContext();
    const { target } = fakeWindow(harness);
    const engine = createAudioEngine(target);
    expect(engine.buses).toBeNull();
    expect(engine.running).toBe(false);
    expect(engine.now()).toBe(0);
    engine.dispose();
  });

  it('builds the graph on the first gesture', () => {
    const harness = fakeContext();
    const { target, gesture } = fakeWindow(harness);
    const engine = createAudioEngine(target);
    gesture();
    expect(engine.buses).not.toBeNull();
    expect(engine.running).toBe(true);
    engine.dispose();
  });

  it('hands out no voices before it is running', () => {
    const harness = fakeContext();
    const { target } = fakeWindow(harness);
    const engine = createAudioEngine(target);
    expect(engine.claimVoice(0.1)).toBeNull();
    engine.dispose();
  });

  it('stops handing out voices once the budget is spent', () => {
    // The alternative is an unbounded graph: in a packed crowd the browser would be
    // asked for hundreds of oscillators a second.
    vi.useFakeTimers();
    const harness = fakeContext();
    const { target, gesture } = fakeWindow(harness);
    const engine = createAudioEngine(target);
    gesture();

    let granted = 0;
    for (let i = 0; i < 200; i++) if (engine.claimVoice(1) !== null) granted++;
    expect(granted).toBeGreaterThan(0);
    expect(granted).toBeLessThan(40);

    // The slots come back once the sounds have finished.
    vi.advanceTimersByTime(2000);
    expect(engine.claimVoice(0.1)).not.toBeNull();
    engine.dispose();
    vi.useRealTimers();
  });

  it('suspends itself after a stretch of silence', () => {
    const harness = fakeContext();
    const { target, gesture } = fakeWindow(harness);
    const engine = createAudioEngine(target);
    gesture();
    engine.tick(20);
    expect(engine.running).toBe(false);
    engine.dispose();
  });

  it('does not suspend while something is keeping it awake', () => {
    const harness = fakeContext();
    const { target, gesture } = fakeWindow(harness);
    const engine = createAudioEngine(target);
    gesture();
    for (let i = 0; i < 40; i++) {
      engine.keepAwake();
      engine.tick(1);
    }
    expect(engine.running).toBe(true);
    engine.dispose();
  });

  it('survives a browser with no audio at all', () => {
    const listeners: ((event: unknown) => void)[] = [];
    const target = {
      addEventListener: (_: string, handler: (event: unknown) => void) => listeners.push(handler),
      removeEventListener: () => undefined,
    } as unknown as Window;
    const engine = createAudioEngine(target);
    for (const handler of listeners) handler({});
    expect(engine.buses).toBeNull();
    expect(() => {
      engine.setMasterVolume(1);
      engine.tick(1);
      engine.keepAwake();
    }).not.toThrow();
    engine.dispose();
  });
});

describe('createSfx', () => {
  let harness: ReturnType<typeof fakeContext>;
  let engine: ReturnType<typeof createAudioEngine>;

  beforeEach(() => {
    harness = fakeContext();
    const fake = fakeWindow(harness);
    engine = createAudioEngine(fake.target);
    fake.gesture();
  });

  it('plays every sound it advertises without throwing', () => {
    const sfx = createSfx(engine);
    for (const id of SFX_IDS) {
      harness.advance(5);
      expect(() => sfx.play(id)).not.toThrow();
    }
    expect(harness.started.length).toBeGreaterThanOrEqual(SFX_IDS.length);
  });

  it('drops a repeat that arrives inside the minimum interval', () => {
    // Hundreds of hits a second played faithfully is a buzz that carries no
    // information — the same failure the damage numbers had.
    const sfx = createSfx(engine);
    sfx.play('hit');
    const afterFirst = harness.started.length;
    for (let i = 0; i < 50; i++) sfx.play('hit');
    expect(harness.started.length).toBe(afterFirst);
  });

  it('plays again once the interval has passed', () => {
    const sfx = createSfx(engine);
    sfx.play('hit');
    const afterFirst = harness.started.length;
    harness.advance(0.5);
    sfx.play('hit');
    expect(harness.started.length).toBeGreaterThan(afterFirst);
  });

  it('throttles each sound separately', () => {
    // A wall of hits must not be able to swallow the level-up that happened with it.
    const sfx = createSfx(engine);
    sfx.play('hit');
    const afterHit = harness.started.length;
    sfx.play('levelUp');
    expect(harness.started.length).toBeGreaterThan(afterHit);
  });

  it('never throttles the sounds that happen once', () => {
    const sfx = createSfx(engine);
    for (const id of ['levelUp', 'win', 'lose'] as const) {
      const before = harness.started.length;
      sfx.play(id);
      sfx.play(id);
      expect(harness.started.length).toBeGreaterThan(before);
    }
  });

  it('does nothing at all before the context exists', () => {
    const silent = createAudioEngine({
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as Window);
    const sfx = createSfx(silent);
    expect(() => sfx.play('hit')).not.toThrow();
    silent.dispose();
  });

  it('tolerates a nonsensical intensity', () => {
    const sfx = createSfx(engine);
    for (const intensity of [0, -3, Number.NaN, 1e9]) {
      harness.advance(1);
      expect(() => sfx.play('hurt', intensity)).not.toThrow();
    }
  });
});

describe('createMusic', () => {
  let harness: ReturnType<typeof fakeContext>;
  let engine: ReturnType<typeof createAudioEngine>;

  beforeEach(() => {
    harness = fakeContext();
    const fake = fakeWindow(harness);
    engine = createAudioEngine(fake.target);
    fake.gesture();
  });

  it('does nothing until there is a context', () => {
    const silent = createAudioEngine({
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as Window);
    const music = createMusic(silent);
    expect(() => music.update()).not.toThrow();
    expect(music.playing).toBe(false);
    silent.dispose();
  });

  it('schedules ahead rather than one bar at a time', () => {
    const music = createMusic(engine);
    music.update();
    expect(music.playing).toBe(true);
    expect(harness.started.length).toBeGreaterThan(4);
  });

  it('stops adding bars once the queue is far enough ahead', () => {
    const music = createMusic(engine);
    music.update();
    const afterFirst = harness.started.length;
    // No time has passed, so there is nothing new to place.
    music.update();
    expect(harness.started.length).toBe(afterFirst);
  });

  it('keeps scheduling as time advances', () => {
    const music = createMusic(engine);
    music.update();
    const afterFirst = harness.started.length;
    harness.advance(4);
    music.update();
    expect(harness.started.length).toBeGreaterThan(afterFirst);
  });

  it('does not try to catch up after a long suspension', () => {
    // A context resumed after a minute would otherwise have a minute of bars placed
    // in one call — hundreds of oscillators at once, all already in the past.
    const music = createMusic(engine);
    music.update();
    const afterFirst = harness.started.length;
    harness.advance(600);
    music.update();
    const placed = harness.started.length - afterFirst;
    expect(placed).toBeGreaterThan(0);
    expect(placed).toBeLessThan(120);
  });

  it('adds the melody only once the run has some pressure in it', () => {
    // The first minute is drums walking in; the zurna and cymbals arrive with the
    // difficulty. Measured as notes placed in one identical stretch of time, so the
    // two runs are actually comparable.
    const notesOverOneBar = (intensity: number): number => {
      const local = fakeContext();
      const fake = fakeWindow(local);
      const localEngine = createAudioEngine(fake.target);
      fake.gesture();

      const music = createMusic(localEngine);
      music.setIntensity(intensity);
      music.update();
      local.advance(3);
      music.update();

      localEngine.dispose();
      return local.started.length;
    };

    const drumsOnly = notesOverOneBar(0);
    const fullBand = notesOverOneBar(1);
    expect(drumsOnly).toBeGreaterThan(0);
    expect(fullBand).toBeGreaterThan(drumsOnly);
  });

  it('tolerates a nonsensical intensity', () => {
    const music = createMusic(engine);
    for (const value of [Number.NaN, -5, 1e6]) {
      expect(() => {
        music.setIntensity(value);
        music.update();
      }).not.toThrow();
    }
  });

  it('stops scheduling when told to', () => {
    const music = createMusic(engine);
    music.update();
    music.stop();
    expect(music.playing).toBe(false);
    const afterStop = harness.started.length;
    harness.advance(4);
    // `update` restarts it; `stop` is about not being called again.
    expect(harness.started.length).toBe(afterStop);
  });
});
