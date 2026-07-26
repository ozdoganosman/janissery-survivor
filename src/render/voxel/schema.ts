/**
 * Voxel model description and its runtime validation.
 *
 * Models are authored as JSON under `data/models/` and imported at build time, so
 * there is no asset download and no binary in the repository. TypeScript can check
 * the shape of an imported JSON literal but not its meaning — a colour index past
 * the end of the palette, a zero-sized box, two parts claiming the same limb role —
 * so those are checked here, once, with an error message that names the offending
 * path. An unreadable model should fail loudly at boot, not render as a hole.
 */

/**
 * What a part does when animated.
 *
 * `static` parts never rotate. The rest are rotated about their own pivot by the
 * animator; `armLeft`/`legLeft` and their right-hand counterparts swing in
 * opposition, which is what reads as walking.
 */
export const LIMB_ROLES = ['static', 'armLeft', 'armRight', 'legLeft', 'legRight', 'head'] as const;

export type LimbRole = (typeof LIMB_ROLES)[number];

export type Vec3Tuple = readonly [number, number, number];

export interface VoxelBox {
  /** Centre of the box in model space, in voxel units. */
  readonly pos: Vec3Tuple;
  /** Full extents in voxel units — not half-extents. */
  readonly size: Vec3Tuple;
  /** Index into the model's palette. */
  readonly color: number;
}

export interface VoxelPart {
  readonly name: string;
  /**
   * Rotation origin in model space, in voxel units.
   *
   * A limb must pivot at the shoulder or hip, not at its own centre, or a walk
   * cycle looks like the arms are detached and spinning. The builder bakes this
   * offset into the geometry so a part can be rotated about its local origin.
   */
  readonly pivot: Vec3Tuple;
  readonly role: LimbRole;
  readonly boxes: readonly VoxelBox[];
}

export interface VoxelModel {
  readonly name: string;
  /** CSS hex colours (`#rrggbb`), indexed by `VoxelBox.color`. */
  readonly palette: readonly string[];
  /** World units per voxel unit. */
  readonly scale: number;
  /**
   * Flat list of parts — deliberately not a tree.
   *
   * Hierarchy was considered and dropped: the instanced renderer applies exactly
   * one rotation per part on the GPU, with no parent chain to walk, so a nested
   * part would animate correctly for the player and incorrectly for the hundreds
   * of instanced enemies sharing the same model. One flat list keeps both paths
   * showing the same thing. Anything that must follow a limb (a sword in a hand)
   * belongs in that limb's box list.
   */
  readonly parts: readonly VoxelPart[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

class ModelError extends Error {
  constructor(path: string, detail: string) {
    super(`Invalid voxel model at ${path}: ${detail}`);
    this.name = 'ModelError';
  }
}

function readVec3(value: unknown, path: string): Vec3Tuple {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ModelError(path, 'expected an array of three numbers');
  }
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const component: unknown = value[i];
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new ModelError(`${path}[${i}]`, `expected a finite number, got ${String(component)}`);
    }
    out.push(component);
  }
  return [out[0], out[1], out[2]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLimbRole(value: unknown): value is LimbRole {
  return typeof value === 'string' && (LIMB_ROLES as readonly string[]).includes(value);
}

/**
 * Validates a parsed JSON model and returns it typed.
 *
 * Throws `ModelError` with a path-qualified message on the first problem found.
 */
export function parseVoxelModel(input: unknown): VoxelModel {
  if (!isRecord(input)) {
    throw new ModelError('<root>', 'expected an object');
  }

  const { name, palette, scale, parts } = input;

  if (typeof name !== 'string' || name.length === 0) {
    throw new ModelError('name', 'expected a non-empty string');
  }

  if (!Array.isArray(palette) || palette.length === 0) {
    throw new ModelError('palette', 'expected a non-empty array of hex colours');
  }
  palette.forEach((entry, index) => {
    if (typeof entry !== 'string' || !HEX_COLOR.test(entry)) {
      throw new ModelError(`palette[${index}]`, `expected "#rrggbb", got ${String(entry)}`);
    }
  });

  if (typeof scale !== 'number' || !(scale > 0)) {
    throw new ModelError('scale', `expected a positive number, got ${String(scale)}`);
  }

  if (!Array.isArray(parts) || parts.length === 0) {
    throw new ModelError('parts', 'expected a non-empty array');
  }

  const seenNames = new Set<string>();
  const seenRoles = new Set<string>();
  const validatedParts: VoxelPart[] = parts.map((rawPart, partIndex) => {
    const at = `parts[${partIndex}]`;
    if (!isRecord(rawPart)) {
      throw new ModelError(at, 'expected an object');
    }

    const partName = rawPart.name;
    if (typeof partName !== 'string' || partName.length === 0) {
      throw new ModelError(`${at}.name`, 'expected a non-empty string');
    }
    if (seenNames.has(partName)) {
      throw new ModelError(`${at}.name`, `duplicate part name "${partName}"`);
    }
    seenNames.add(partName);

    const role: unknown = rawPart.role;
    if (!isLimbRole(role)) {
      throw new ModelError(
        `${at}.role`,
        `expected one of ${LIMB_ROLES.join(', ')}, got ${String(role)}`,
      );
    }
    // Two parts sharing a limb role would be driven by one animation channel and
    // move as a unit, which is never what the author meant. `static` is exempt:
    // any number of parts can be non-animating.
    if (role !== 'static') {
      if (seenRoles.has(role)) {
        throw new ModelError(`${at}.role`, `role "${role}" is already used by another part`);
      }
      seenRoles.add(role);
    }

    const pivot = readVec3(rawPart.pivot, `${at}.pivot`);

    const boxes = rawPart.boxes;
    if (!Array.isArray(boxes) || boxes.length === 0) {
      throw new ModelError(`${at}.boxes`, 'expected a non-empty array');
    }

    const validatedBoxes: VoxelBox[] = boxes.map((rawBox, boxIndex) => {
      const boxAt = `${at}.boxes[${boxIndex}]`;
      if (!isRecord(rawBox)) {
        throw new ModelError(boxAt, 'expected an object');
      }

      const pos = readVec3(rawBox.pos, `${boxAt}.pos`);
      const size = readVec3(rawBox.size, `${boxAt}.size`);
      for (let axis = 0; axis < 3; axis++) {
        if (!(size[axis] > 0)) {
          throw new ModelError(`${boxAt}.size[${axis}]`, `expected a positive extent`);
        }
      }

      const color = rawBox.color;
      if (typeof color !== 'number' || !Number.isInteger(color)) {
        throw new ModelError(`${boxAt}.color`, `expected an integer, got ${String(color)}`);
      }
      if (color < 0 || color >= palette.length) {
        throw new ModelError(
          `${boxAt}.color`,
          `index ${color} is outside the palette (0..${palette.length - 1})`,
        );
      }

      return { pos, size, color };
    });

    return { name: partName, pivot, role, boxes: validatedBoxes };
  });

  return { name, palette: palette as string[], scale, parts: validatedParts };
}
