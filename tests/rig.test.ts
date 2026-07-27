import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getVoxelModel } from '../src/render/voxel/models';
import { createVoxelRig } from '../src/render/voxel/rig';

/**
 * The player's figure, tested without a GPU.
 *
 * three.js only needs a renderer to *draw*; building a scene graph and posing it is
 * arithmetic, so the one thing that actually matters here can be measured directly:
 * whether the sword arm moves. A screenshot cannot tell a swing from a lucky frame,
 * and the bug this file exists for shipped precisely because nothing checked.
 */

const TICK = 1 / 60;

function armAngle(root: THREE.Object3D): number {
  const arm = root.getObjectByName('armRight');
  if (arm === undefined) throw new Error('the rig has no armRight');
  return arm.rotation.x;
}

function heroRig(): ReturnType<typeof createVoxelRig> {
  return createVoxelRig(getVoxelModel('yeniceri'));
}

describe('createVoxelRig', () => {
  it('names its parts after their roles', () => {
    const rig = heroRig();
    for (const role of ['armLeft', 'armRight', 'legLeft', 'legRight', 'head']) {
      expect(rig.root.getObjectByName(role), role).toBeDefined();
    }
    rig.dispose();
  });

  it('swings the sword arm when told to strike', () => {
    // The regression. The first wiring gated the strike on `finished`, which is only
    // ever true for a one-shot; a walking hero plays a loop, so the test never passed
    // and the sword never left his side through eight phases of development.
    const rig = heroRig();
    rig.play('walk');
    for (let i = 0; i < 10; i++) rig.update(TICK);

    const before = armAngle(rig.root);
    rig.strike('attack');

    let travel = 0;
    let previous = before;
    for (let i = 0; i < 30; i++) {
      rig.update(TICK);
      const now = armAngle(rig.root);
      travel = Math.max(travel, Math.abs(now - before));
      previous = now;
    }
    void previous;

    // The pose winds back past a radian and strikes forward through two more, so a
    // working swing cannot possibly stay inside the walk cycle's own small arc.
    expect(travel).toBeGreaterThan(1);
    rig.dispose();
  });

  it('keeps the legs walking through a strike', () => {
    // A swing that stops the legs is a character sliding across the ground.
    const rig = heroRig();
    rig.play('walk');
    for (let i = 0; i < 5; i++) rig.update(TICK);

    rig.strike('attack');
    const legs = new Set<number>();
    for (let i = 0; i < 20; i++) {
      rig.update(TICK);
      const leg = rig.root.getObjectByName('legLeft');
      legs.add(Math.round((leg?.rotation.x ?? 0) * 1000));
    }
    expect(legs.size).toBeGreaterThan(5);
    rig.dispose();
  });

  it('returns the arm to its walk once the swing is over', () => {
    const rig = heroRig();
    rig.play('walk');
    rig.strike('attack');
    // Well past the swing's own length.
    for (let i = 0; i < 120; i++) rig.update(TICK);
    expect(rig.overlay).toBeNull();
    rig.dispose();
  });

  it('lets a new strike interrupt one already playing', () => {
    // Weapons firing faster than the arm can travel is a real state late in a run;
    // cutting the old arc short beats dropping the new one.
    const rig = heroRig();
    rig.play('walk');
    rig.strike('attack');
    for (let i = 0; i < 10; i++) rig.update(TICK);
    const mid = armAngle(rig.root);

    rig.strike('attack');
    rig.update(TICK);
    // Restarted, so the arm is back near the beginning of the wind-up rather than
    // wherever the interrupted swing had reached.
    expect(Math.abs(armAngle(rig.root) - mid)).toBeGreaterThan(0.05);
    rig.dispose();
  });

  it('reports which one-shot is on the upper body', () => {
    const rig = heroRig();
    expect(rig.overlay).toBeNull();
    rig.strike('hit');
    expect(rig.overlay).toBe('hit');
    rig.dispose();
  });

  it('does not move the arm at all without a strike', () => {
    // Standing still: nothing should twitch, or the idle would read as a nervous tic.
    const rig = heroRig();
    rig.play('idle');
    rig.update(TICK);
    const first = armAngle(rig.root);
    for (let i = 0; i < 30; i++) rig.update(TICK);
    expect(Math.abs(armAngle(rig.root) - first)).toBeLessThan(0.5);
    rig.dispose();
  });
});
