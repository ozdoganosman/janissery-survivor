/**
 * What is left of a creature for the third of a second after it dies.
 *
 * Deferred since phase 1, where the plan was a `death` animation alongside walk and
 * idle. It could not be one: the instanced path applies a single rotation per part per
 * figure, so a body coming apart needs a per-instance, per-part offset that the shared
 * uniform has no room for. And an animation on the enemy pool would need the enemy to
 * stay in the pool after dying, which puts a purely visual state into the simulation
 * and spends a slot the wave director wants for something still alive.
 *
 * So the corpse is not an enemy at all. The moment one dies the renderer takes a copy
 * of what it looked like — model, position, facing, size — and plays that copy out on
 * its own. The simulation frees the slot immediately and never learns this exists,
 * which is the same arrangement the shards and the damage numbers already use.
 *
 * The collapse itself is a squash and a sink: the body flattens toward the ground it
 * is falling onto and drops through it, so the last thing seen is the top of the head
 * going under rather than a figure fading out on the spot.
 *
 * This module owns no meshes. It holds the pool and the timing and nothing else; the
 * horde draws the bodies into the very same instanced armies it draws the living with.
 * The first version gave the corpses their own armies, which works and costs a fresh
 * `InstancedMesh` per part per model — up to thirty more draw calls the moment every
 * kind is dying at once, against a stated budget of sixty. Appending to the existing
 * armies costs exactly nothing: the instances were already going to be drawn.
 */

/** How long a body takes to go down. Short: dozens can die in a second. */
const DURATION = 0.34;

/** How far the body sinks, relative to its own height. */
const SINK = 0.55;

/** How wide it spreads at full collapse. Squash reads as weight. */
const SPREAD = 1.25;

/** How a corpse looks at this instant. Handed to the renderer, never stored. */
export interface CorpsePose {
  readonly model: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
  readonly scale: number;
  /** Brightness multiplier, falling toward the ground. */
  readonly shade: number;
}

export interface CorpseField {
  readonly count: number;
  /** Takes a copy of a dying creature. Silently drops it when full. */
  add(modelIndex: number, x: number, z: number, facing: number, scale: number): void;
  /** Ages every corpse. Call once per simulation step. */
  advance(stepSeconds: number): void;
  /** Fills `into` with the pose of corpse `index`. Returns it, for chaining. */
  poseOf(index: number, into: MutableCorpsePose): CorpsePose;
}

/** The scratch object `poseOf` writes into, so reading a corpse allocates nothing. */
export interface MutableCorpsePose {
  model: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  scale: number;
  shade: number;
}

export function createCorpsePose(): MutableCorpsePose {
  return { model: 0, x: 0, y: 0, z: 0, facing: 0, scale: 1, shade: 1 };
}

export function createCorpseField(capacity = 96): CorpseField {
  // A flat pool rather than one per model: deaths do not arrive evenly across the
  // roster, and splitting the budget would let a wall of Karakoncolos exhaust its
  // share while the Sahmeran slots sat empty.
  const model = new Int32Array(capacity);
  const x = new Float32Array(capacity);
  const z = new Float32Array(capacity);
  const facing = new Float32Array(capacity);
  const scale = new Float32Array(capacity);
  const age = new Float32Array(capacity);
  let count = 0;

  const remove = (index: number): void => {
    const last = --count;
    if (index === last) return;
    model[index] = model[last];
    x[index] = x[last];
    z[index] = z[last];
    facing[index] = facing[last];
    scale[index] = scale[last];
    age[index] = age[last];
  };

  return {
    get count() {
      return count;
    },

    add(modelIndex, cx, cz, cfacing, cscale): void {
      // Dropping the newest rather than recycling the oldest: an old corpse is
      // already halfway into the ground and cutting it short is a body that vanishes,
      // while the one not added was never seen in the first place.
      if (count >= capacity) return;
      const index = count++;
      model[index] = modelIndex;
      x[index] = cx;
      z[index] = cz;
      facing[index] = cfacing;
      scale[index] = cscale;
      age[index] = 0;
    },

    advance(stepSeconds): void {
      for (let i = 0; i < count;) {
        age[i] += stepSeconds;
        // No increment: `remove` moved a different corpse into this slot.
        if (age[i] >= DURATION) remove(i);
        else i++;
      }
    },

    poseOf(index, into): CorpsePose {
      const t = Math.min(1, age[index] / DURATION);
      // Eased so the body drops fast and settles, rather than sliding down at a
      // constant rate like a lift.
      const fall = t * t;

      into.model = model[index];
      into.x = x[index];
      into.y = -fall * SINK * scale[index];
      into.z = z[index];
      into.facing = facing[index];
      // Wider as it flattens. The uniform scale cannot squash one axis on its own, so
      // the spread carries the weight and the sink carries the fall.
      into.scale = scale[index] * (1 + (SPREAD - 1) * fall);
      // Darkening toward the ground rather than fading: these materials are opaque,
      // and turning them transparent would cost a separate blended pass for something
      // on screen for a third of a second.
      into.shade = 1 - 0.75 * fall;
      return into;
    },
  };
}
