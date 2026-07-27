import { describe, expect, it } from 'vitest';
import { createCorpseField, createCorpsePose } from '../src/render/fx/corpses';
import { ENEMY_TYPES } from '../src/sim/enemy-types';
import { MODEL_INDEX_OF_KIND, HORDE_MODEL_IDS } from '../src/render/world/horde';

/**
 * The corpse field itself needs a GPU, so what is pinned here is the part that can go
 * silently wrong without one: the mapping a dying creature uses to pick which model to
 * collapse. If it drifts from the one the living crowd uses, a Karakoncolos falls
 * where a Cin died and nothing anywhere throws.
 */

describe('the model bucketing shared by the horde and its dead', () => {
  it('maps every kind to a real model', () => {
    expect(MODEL_INDEX_OF_KIND).toHaveLength(ENEMY_TYPES.length);
    for (const index of MODEL_INDEX_OF_KIND) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(HORDE_MODEL_IDS.length);
    }
  });

  it('sends each kind to the model it is actually drawn with', () => {
    ENEMY_TYPES.forEach((type, kind) => {
      expect(HORDE_MODEL_IDS[MODEL_INDEX_OF_KIND[kind]], type.id).toBe(type.model);
    });
  });

  it('lists each model once', () => {
    // One army per distinct model is the whole reason the crowd fits in a handful of
    // draw calls; a duplicate would quietly double one of them.
    expect(new Set(HORDE_MODEL_IDS).size).toBe(HORDE_MODEL_IDS.length);
  });

  it('gives the boss and the ordinary Gulyabani the same army', () => {
    // They share a model and differ only in scale and tint, which is what keeps the
    // boss from costing its own draw call — alive or dead.
    const boss = ENEMY_TYPES.findIndex((type) => type.id === 'gulyabaniAgasi');
    const ordinary = ENEMY_TYPES.findIndex((type) => type.id === 'gulyabani');
    expect(MODEL_INDEX_OF_KIND[boss]).toBe(MODEL_INDEX_OF_KIND[ordinary]);
  });
});

describe('the corpse pool', () => {
  it('holds a body for a moment and then lets it go', () => {
    const field = createCorpseField(8);
    field.add(0, 1, 2, 0.5, 1);
    expect(field.count).toBe(1);

    // Well past any plausible duration.
    for (let i = 0; i < 60; i++) field.advance(1 / 60);
    expect(field.count).toBe(0);
  });

  it('collapses and sinks over its life', () => {
    const field = createCorpseField(8);
    field.add(0, 0, 0, 0, 1);
    const pose = createCorpsePose();

    const start = { ...field.poseOf(0, pose) };
    for (let i = 0; i < 12; i++) field.advance(1 / 60);
    const later = { ...field.poseOf(0, pose) };

    // Down, wider, darker — the three things that make it read as falling.
    expect(later.y).toBeLessThan(start.y);
    expect(later.scale).toBeGreaterThan(start.scale);
    expect(later.shade).toBeLessThan(start.shade);
  });

  it('starts exactly where the creature stood', () => {
    // Any offset here is a body that teleports at the instant of death.
    const field = createCorpseField(8);
    field.add(2, 7, -3, 1.25, 1.4);
    const pose = field.poseOf(0, createCorpsePose());
    expect(pose.x).toBe(7);
    expect(pose.z).toBe(-3);
    // `toBeCloseTo` rather than `toBe`: the sink is a negated product, so at time
    // zero it comes out as -0, which is equal to 0 everywhere it is used and unequal
    // to it only under `Object.is`.
    expect(pose.y).toBeCloseTo(0, 10);
    expect(pose.facing).toBe(1.25);
    expect(pose.scale).toBeCloseTo(1.4, 5);
    expect(pose.model).toBe(2);
    expect(pose.shade).toBe(1);
  });

  it('sinks a big creature further than a small one', () => {
    const field = createCorpseField(8);
    field.add(0, 0, 0, 0, 1);
    field.add(0, 5, 0, 0, 3);
    for (let i = 0; i < 12; i++) field.advance(1 / 60);

    const small = { ...field.poseOf(0, createCorpsePose()) };
    const large = { ...field.poseOf(1, createCorpsePose()) };
    // A boss is three times the height, so sinking by a fixed amount would leave it
    // standing while a Cin had already vanished.
    expect(large.y).toBeLessThan(small.y);
  });

  it('drops new bodies rather than cutting short the ones on screen', () => {
    const field = createCorpseField(2);
    field.add(0, 0, 0, 0, 1);
    field.add(0, 1, 0, 0, 1);
    field.add(0, 99, 0, 0, 1);
    expect(field.count).toBe(2);
    // The two that were already falling are the two still here.
    expect(field.poseOf(0, createCorpsePose()).x).toBe(0);
    expect(field.poseOf(1, createCorpsePose()).x).toBe(1);
  });

  it('keeps ageing the rest as one is removed', () => {
    // Swap-removal means the loop must not step past the slot it just refilled, or
    // roughly half the bodies would lie on the ground forever.
    const field = createCorpseField(16);
    for (let i = 0; i < 10; i++) field.add(0, i, 0, 0, 1);
    for (let i = 0; i < 60; i++) field.advance(1 / 60);
    expect(field.count).toBe(0);
  });

  it('writes into the pose it was given rather than making a new one', () => {
    const field = createCorpseField(4);
    field.add(1, 3, 4, 0, 1);
    const scratch = createCorpsePose();
    expect(field.poseOf(0, scratch)).toBe(scratch);
  });
});
