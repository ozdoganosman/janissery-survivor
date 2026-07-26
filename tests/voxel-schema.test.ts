import { describe, expect, it } from 'vitest';
import { LIMB_ROLES, parseVoxelModel } from '../src/render/voxel/schema';
import karakoncolos from '../data/models/karakoncolos.json';
import yeniceri from '../data/models/yeniceri.json';

function validModel(): Record<string, unknown> {
  return {
    name: 'test',
    scale: 0.1,
    palette: ['#ff0000', '#00ff00'],
    parts: [
      {
        name: 'torso',
        role: 'static',
        pivot: [0, 0, 0],
        boxes: [{ pos: [0, 5, 0], size: [4, 10, 4], color: 0 }],
      },
    ],
  };
}

describe('parseVoxelModel', () => {
  it('accepts a minimal valid model', () => {
    const model = parseVoxelModel(validModel());
    expect(model.name).toBe('test');
    expect(model.parts).toHaveLength(1);
    expect(model.parts[0].boxes[0].color).toBe(0);
  });

  it('accepts every shipped model', () => {
    // These are hand-authored JSON, so this is the test that actually catches a typo
    // made while designing a new enemy.
    for (const source of [yeniceri, karakoncolos]) {
      expect(() => parseVoxelModel(source)).not.toThrow();
    }
  });

  it('reports the path of the offending field', () => {
    const model = validModel();
    (model.parts as Record<string, unknown>[])[0].boxes = [
      { pos: [0, 0, 0], size: [1, 1, 1], color: 9 },
    ];
    expect(() => parseVoxelModel(model)).toThrow(/parts\[0\]\.boxes\[0\]\.color/);
  });

  describe('rejects structurally broken input', () => {
    it.each([
      ['not an object', 42],
      ['null', null],
      ['an array', []],
    ])('%s', (_label, input) => {
      expect(() => parseVoxelModel(input)).toThrow(/Invalid voxel model/);
    });
  });

  it('rejects a missing or empty name', () => {
    expect(() => parseVoxelModel({ ...validModel(), name: '' })).toThrow(/name/);
    expect(() => parseVoxelModel({ ...validModel(), name: 7 })).toThrow(/name/);
  });

  it('rejects a non-positive scale', () => {
    for (const scale of [0, -1, 'big']) {
      expect(() => parseVoxelModel({ ...validModel(), scale })).toThrow(/scale/);
    }
  });

  it('rejects a malformed palette entry', () => {
    for (const colour of ['red', '#fff', '#12345g', 0]) {
      expect(() => parseVoxelModel({ ...validModel(), palette: [colour] })).toThrow(/palette\[0\]/);
    }
  });

  it('rejects an empty palette or part list', () => {
    expect(() => parseVoxelModel({ ...validModel(), palette: [] })).toThrow(/palette/);
    expect(() => parseVoxelModel({ ...validModel(), parts: [] })).toThrow(/parts/);
  });

  it('rejects a colour index outside the palette', () => {
    const model = validModel();
    (model.parts as Record<string, unknown>[])[0].boxes = [
      { pos: [0, 0, 0], size: [1, 1, 1], color: 2 },
    ];
    expect(() => parseVoxelModel(model)).toThrow(/outside the palette/);

    const negative = validModel();
    (negative.parts as Record<string, unknown>[])[0].boxes = [
      { pos: [0, 0, 0], size: [1, 1, 1], color: -1 },
    ];
    expect(() => parseVoxelModel(negative)).toThrow(/outside the palette/);
  });

  it('rejects a zero or negative box extent', () => {
    // A zero-thickness box produces degenerate faces that render as flickering slivers,
    // so it is worth catching at authoring time.
    for (const size of [
      [0, 1, 1],
      [1, -2, 1],
    ]) {
      const model = validModel();
      (model.parts as Record<string, unknown>[])[0].boxes = [{ pos: [0, 0, 0], size, color: 0 }];
      expect(() => parseVoxelModel(model)).toThrow(/size/);
    }
  });

  it('rejects a vector that is not three finite numbers', () => {
    for (const pivot of [[0, 0], [0, 0, 0, 0], [0, 'x', 0], [0, Number.NaN, 0], 'origin']) {
      const model = validModel();
      (model.parts as Record<string, unknown>[])[0].pivot = pivot;
      expect(() => parseVoxelModel(model)).toThrow(/pivot/);
    }
  });

  it('rejects an unknown limb role', () => {
    const model = validModel();
    (model.parts as Record<string, unknown>[])[0].role = 'tail';
    expect(() => parseVoxelModel(model)).toThrow(/role/);
  });

  it('rejects two parts claiming the same animated role', () => {
    // Both parts would be driven by one animation channel and move as a unit, which is
    // never intended — almost certainly a copy-paste while adding a limb.
    const model = validModel();
    const part = (model.parts as Record<string, unknown>[])[0];
    model.parts = [
      { ...part, name: 'a', role: 'armLeft' },
      { ...part, name: 'b', role: 'armLeft' },
    ];
    expect(() => parseVoxelModel(model)).toThrow(/already used/);
  });

  it('allows any number of static parts', () => {
    const model = validModel();
    const part = (model.parts as Record<string, unknown>[])[0];
    model.parts = [
      { ...part, name: 'a' },
      { ...part, name: 'b' },
      { ...part, name: 'c' },
    ];
    expect(parseVoxelModel(model).parts).toHaveLength(3);
  });

  it('rejects duplicate part names', () => {
    const model = validModel();
    const part = (model.parts as Record<string, unknown>[])[0];
    model.parts = [part, { ...part }];
    expect(() => parseVoxelModel(model)).toThrow(/duplicate part name/);
  });

  it('exposes the role list it validates against', () => {
    expect(LIMB_ROLES).toContain('static');
    expect(LIMB_ROLES).toContain('armLeft');
    expect(new Set(LIMB_ROLES).size).toBe(LIMB_ROLES.length);
  });
});
