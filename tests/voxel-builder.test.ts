import { describe, expect, it } from 'vitest';
import { buildVoxelModel } from '../src/render/voxel/builder';
import { parseVoxelModel, type VoxelModel } from '../src/render/voxel/schema';
import karakoncolos from '../data/models/karakoncolos.json';
import yeniceri from '../data/models/yeniceri.json';

/** A model with one part holding the given boxes. */
function singlePart(
  boxes: { pos: number[]; size: number[]; color?: number }[],
  role = 'static',
): VoxelModel {
  return parseVoxelModel({
    name: 'probe',
    scale: 1,
    palette: ['#ffffff', '#000000'],
    parts: [
      {
        name: 'p',
        role,
        pivot: [0, 0, 0],
        boxes: boxes.map((b) => ({ pos: b.pos, size: b.size, color: b.color ?? 0 })),
      },
    ],
  });
}

describe('buildVoxelModel', () => {
  it('emits six faces for a lone box', () => {
    const built = buildVoxelModel(singlePart([{ pos: [0, 0, 0], size: [2, 2, 2] }]));
    expect(built.faceCount).toBe(6);
    expect(built.culledFaceCount).toBe(0);
  });

  it('produces four vertices and six indices per face', () => {
    const built = buildVoxelModel(singlePart([{ pos: [0, 0, 0], size: [2, 2, 2] }]));
    const geometry = built.parts[0].geometry;
    expect(geometry.getAttribute('position').count).toBe(6 * 4);
    expect(geometry.getIndex()?.count).toBe(6 * 6);
    expect(geometry.getAttribute('normal').count).toBe(6 * 4);
    expect(geometry.getAttribute('color').count).toBe(6 * 4);
  });

  it('drops the two faces buried between stacked boxes', () => {
    // Two 2x2x2 boxes touching at y = 1. The upper face of the lower box and the lower
    // face of the upper box are interior and can never be seen.
    const built = buildVoxelModel(
      singlePart([
        { pos: [0, 0, 0], size: [2, 2, 2] },
        { pos: [0, 2, 0], size: [2, 2, 2] },
      ]),
    );
    expect(built.faceCount).toBe(10);
    expect(built.culledFaceCount).toBe(2);
  });

  it('keeps a face that its neighbour only partly covers', () => {
    // The upper box is narrower, so part of the lower box's top face stays visible and
    // culling it would open a hole.
    const built = buildVoxelModel(
      singlePart([
        { pos: [0, 0, 0], size: [4, 2, 4] },
        { pos: [0, 2, 0], size: [2, 2, 2] },
      ]),
    );
    expect(built.culledFaceCount).toBe(1); // only the small box's hidden underside
    expect(built.faceCount).toBe(11);
  });

  it('keeps every face of boxes that merely touch at an edge', () => {
    const built = buildVoxelModel(
      singlePart([
        { pos: [0, 0, 0], size: [2, 2, 2] },
        { pos: [2, 2, 0], size: [2, 2, 2] },
      ]),
    );
    expect(built.culledFaceCount).toBe(0);
    expect(built.faceCount).toBe(12);
  });

  it('culls where one box is swallowed by a larger one', () => {
    const built = buildVoxelModel(
      singlePart([
        { pos: [0, 0, 0], size: [10, 10, 10] },
        { pos: [0, 0, 0], size: [2, 2, 2] },
      ]),
    );
    // Every face of the inner box is inside the outer one.
    expect(built.culledFaceCount).toBe(6);
    expect(built.faceCount).toBe(6);
  });

  it('never culls between parts that can move apart', () => {
    // An arm resting against a torso hides part of it, but that face is exposed the
    // moment the arm swings. Culling it would tear a hole in every walking figure.
    const model = parseVoxelModel({
      name: 'probe',
      scale: 1,
      palette: ['#ffffff'],
      parts: [
        {
          name: 'torso',
          role: 'static',
          pivot: [0, 0, 0],
          boxes: [{ pos: [0, 0, 0], size: [2, 2, 2], color: 0 }],
        },
        {
          name: 'arm',
          role: 'armLeft',
          pivot: [2, 1, 0],
          boxes: [{ pos: [2, 0, 0], size: [2, 2, 2], color: 0 }],
        },
      ],
    });
    expect(buildVoxelModel(model).culledFaceCount).toBe(0);
  });

  it('does cull between two static parts, which cannot move apart', () => {
    const model = parseVoxelModel({
      name: 'probe',
      scale: 1,
      palette: ['#ffffff'],
      parts: [
        {
          name: 'a',
          role: 'static',
          pivot: [0, 0, 0],
          boxes: [{ pos: [0, 0, 0], size: [2, 2, 2], color: 0 }],
        },
        {
          name: 'b',
          role: 'static',
          pivot: [0, 0, 0],
          boxes: [{ pos: [2, 0, 0], size: [2, 2, 2], color: 0 }],
        },
      ],
    });
    expect(buildVoxelModel(model).culledFaceCount).toBe(2);
  });

  it('makes geometry relative to the pivot', () => {
    const model = parseVoxelModel({
      name: 'probe',
      scale: 1,
      palette: ['#ffffff'],
      // Box centred at y = 5, pivot at y = 10: vertices should straddle y = -5.
      parts: [
        {
          name: 'limb',
          role: 'armLeft',
          pivot: [0, 10, 0],
          boxes: [{ pos: [0, 5, 0], size: [2, 10, 2], color: 0 }],
        },
      ],
    });
    const built = buildVoxelModel(model);
    const part = built.parts[0];
    expect(part.pivot.y).toBe(10);

    const positions = part.geometry.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      minY = Math.min(minY, positions.getY(i));
      maxY = Math.max(maxY, positions.getY(i));
    }
    // Pivot-relative: the limb hangs from 0 down to -10.
    expect(maxY).toBeCloseTo(0, 6);
    expect(minY).toBeCloseTo(-10, 6);
  });

  it('applies scale to vertices, pivot and height', () => {
    const model = parseVoxelModel({
      name: 'probe',
      scale: 0.5,
      palette: ['#ffffff'],
      parts: [
        {
          name: 'p',
          role: 'head',
          pivot: [0, 4, 0],
          boxes: [{ pos: [0, 5, 0], size: [2, 10, 2], color: 0 }],
        },
      ],
    });
    const built = buildVoxelModel(model);
    expect(built.parts[0].pivot.y).toBeCloseTo(2, 6);
    expect(built.height).toBeCloseTo(5, 6);
  });

  it('reports height from the tallest box, not the part order', () => {
    const built = buildVoxelModel(
      singlePart([
        { pos: [0, 20, 0], size: [2, 2, 2] },
        { pos: [0, 1, 0], size: [2, 2, 2] },
      ]),
    );
    expect(built.height).toBeCloseTo(21, 6);
  });

  it('winds faces counter-clockwise so outward normals agree with the geometry', () => {
    // A wrong winding is invisible until backface culling is enabled and then whole
    // figures turn inside out, so check the cross product of a triangle against its
    // declared normal for every face of a cube.
    const built = buildVoxelModel(singlePart([{ pos: [0, 0, 0], size: [2, 2, 2] }]));
    const geometry = built.parts[0].geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    expect(index).not.toBeNull();

    for (let face = 0; face < 6; face++) {
      const a = index!.getX(face * 6);
      const b = index!.getX(face * 6 + 1);
      const c = index!.getX(face * 6 + 2);

      const ax = position.getX(b) - position.getX(a);
      const ay = position.getY(b) - position.getY(a);
      const az = position.getZ(b) - position.getZ(a);
      const bx = position.getX(c) - position.getX(a);
      const by = position.getY(c) - position.getY(a);
      const bz = position.getZ(c) - position.getZ(a);

      const cross = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
      const length = Math.hypot(...cross);
      const declared = [normal.getX(a), normal.getY(a), normal.getZ(a)];
      const dot =
        (cross[0] / length) * declared[0] +
        (cross[1] / length) * declared[1] +
        (cross[2] / length) * declared[2];
      expect(dot).toBeCloseTo(1, 5);
    }
  });

  it('assigns palette colours per box', () => {
    const built = buildVoxelModel(
      singlePart([
        { pos: [0, 0, 0], size: [2, 2, 2], color: 0 },
        { pos: [8, 0, 0], size: [2, 2, 2], color: 1 },
      ]),
    );
    const colors = built.parts[0].geometry.getAttribute('color');
    // First box is white, second black; sRGB conversion keeps 0 and 1 at the extremes.
    expect(colors.getX(0)).toBeCloseTo(1, 5);
    expect(colors.getX(24)).toBeCloseTo(0, 5);
  });

  it('builds a geometry for every part of the shipped models', () => {
    for (const source of [yeniceri, karakoncolos]) {
      const built = buildVoxelModel(parseVoxelModel(source));
      expect(built.parts.length).toBeGreaterThan(0);
      for (const part of built.parts) {
        expect(part.geometry.getAttribute('position').count).toBeGreaterThan(0);
      }
      expect(built.height).toBeGreaterThan(0);
      built.dispose();
    }
  });

  it('gives each shipped model exactly one part per animated role', () => {
    for (const source of [yeniceri, karakoncolos]) {
      const built = buildVoxelModel(parseVoxelModel(source));
      const roles = built.parts.map((p) => p.role).filter((r) => r !== 'static');
      expect(new Set(roles).size).toBe(roles.length);
      // Both shipped models walk, so both need all four limbs.
      for (const required of ['armLeft', 'armRight', 'legLeft', 'legRight'] as const) {
        expect(roles).toContain(required);
      }
    }
  });
});
