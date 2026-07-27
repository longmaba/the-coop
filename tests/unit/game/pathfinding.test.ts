import { describe, expect, it } from 'vitest';
import { LEVEL_ONE, findPath, gridToWorld, isDoorCell, isStaticWalkable, octileDistance } from '../../../src/game/index.ts';
import type { LevelDefinition } from '../../../src/game/level.ts';

describe('deterministic level pathfinding', () => {
  it('uses an octile heuristic and a repeatable eight-direction path', () => {
    expect(octileDistance({ x: 1, y: 1 }, { x: 4, y: 3 })).toBe(38);
    const first = findPath({ x: 3, y: 5 }, { x: 8, y: 6 }, false);
    const second = findPath({ x: 3, y: 5 }, { x: 8, y: 6 }, false);
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
    expect(first?.every((point) => isStaticWalkable(point))).toBe(true);
    expect(first?.some((point) => point.x === 5 && point.y === 5)).toBe(false);
    expect(gridToWorld({ x: 3, y: 5 })).toEqual({ x: 168, y: 264 });
  });

  it('does not cut diagonal corners', () => {
    const boxed: LevelDefinition = {
      ...LEVEL_ONE,
      width: 3,
      height: 3,
      walls: new Set(['1,0', '0,1']),
      doorCells: [],
      leftThreshold: { x: 0, y: 0 },
      rightThreshold: { x: 2, y: 2 },
      leftRegionMaxX: 0,
      rightRegionMinX: 2,
      playerSpawns: [{ x: 0, y: 0 }, { x: 2, y: 2 }],
      nearPlate: { x: 0, y: 0 },
      farPlate: { x: 2, y: 2 },
      exitCells: [{ x: 2, y: 2 }],
    };
    expect(findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, false, boxed)).toBeNull();
  });

  it('keeps the divider impassable while closed and opens its two passage cells', () => {
    expect(findPath({ x: 3, y: 5 }, { x: 14, y: 6 }, false)).toBeNull();
    const openPath = findPath({ x: 3, y: 5 }, { x: 14, y: 6 }, true);
    expect(openPath).not.toBeNull();
    expect(openPath?.some((point) => isDoorCell(point))).toBe(true);
  });
});
