import { describe, expect, it } from 'vitest';
import itemModels from '../data/models/items.json';
import { parseVoxelModel } from '../src/render/voxel/schema';
import { PASSIVE_IDS } from '../src/sim/loadout';
import { WEAPON_IDS } from '../src/sim/weapons';

/**
 * The icons are not tested by rendering them — that needs a GPU, and this suite runs
 * headless. What is worth pinning is the part that silently rots: the set of items
 * the HUD can draw versus the set the game can actually give you.
 */

const ITEM_IDS = Object.keys(itemModels);

describe('item models', () => {
  it('covers every weapon', () => {
    for (const id of WEAPON_IDS) expect(ITEM_IDS).toContain(id);
  });

  it('covers every passive', () => {
    for (const id of PASSIVE_IDS) expect(ITEM_IDS).toContain(id);
  });

  it('has nothing the game cannot give the player', () => {
    // An orphan model is dead weight in the bundle and a rename nobody noticed.
    const owned = new Set<string>([...WEAPON_IDS, ...PASSIVE_IDS]);
    for (const id of ITEM_IDS) expect(owned.has(id), id).toBe(true);
  });

  it('parses as a valid voxel model', () => {
    for (const id of ITEM_IDS) {
      const model = parseVoxelModel((itemModels as Record<string, unknown>)[id]);
      expect(model.parts.length).toBeGreaterThan(0);
      expect(model.parts.some((part) => part.boxes.length > 0)).toBe(true);
    }
  });

  it('is drawn from enough boxes to be a silhouette rather than a cube', () => {
    // One box renders as an indistinguishable square at HUD size; the point of the
    // icons is that they can be told apart at 26 pixels.
    for (const id of ITEM_IDS) {
      const model = parseVoxelModel((itemModels as Record<string, unknown>)[id]);
      const boxes = model.parts.reduce((total, part) => total + part.boxes.length, 0);
      expect(boxes, id).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps every palette bright enough to read on a dark HUD', () => {
    // The roster's own palettes are dark browns that read fine on grass and collapse
    // into identical black lumps on a 26-pixel tile over a dark panel.
    for (const id of ITEM_IDS) {
      const model = parseVoxelModel((itemModels as Record<string, unknown>)[id]);
      const luminance = model.palette.map((colour) => {
        const value = colour.replace('#', '');
        const r = Number.parseInt(value.slice(0, 2), 16);
        const g = Number.parseInt(value.slice(2, 4), 16);
        const b = Number.parseInt(value.slice(4, 6), 16);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      });
      expect(Math.max(...luminance), id).toBeGreaterThan(0.35);
    }
  });
});
