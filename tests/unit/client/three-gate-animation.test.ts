import {
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  NumberKeyframeTrack,
  Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { sampleAnimationPose } from '../../../src/client/three/facility-renderer.ts';

describe('gate animation pose sampling', () => {
  it('samples visible intermediate, open, and closed poses while leaving the action paused', () => {
    const door = new Object3D();
    door.name = 'door';
    const clip = new AnimationClip('open', 1, [
      new NumberKeyframeTrack('door.position[y]', [0, 1], [0, 5]),
    ]);
    const mixer = new AnimationMixer(door);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;

    sampleAnimationPose(mixer, action, 0.5);
    expect(door.position.y).toBeCloseTo(2.5);
    expect(action.paused).toBe(true);

    sampleAnimationPose(mixer, action, clip.duration);
    expect(door.position.y).toBeCloseTo(5);

    sampleAnimationPose(mixer, action, 0);
    expect(door.position.y).toBeCloseTo(0);
  });
});
