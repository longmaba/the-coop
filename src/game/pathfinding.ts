import { LEVEL_ONE, isWalkable, sameGridPoint } from './level.ts';
import type { LevelDefinition } from './level.ts';
import type { GridPoint } from './types.ts';

interface OpenNode {
  point: GridPoint;
  g: number;
  h: number;
  order: number;
}

const CARDINAL_COST = 10;
const DIAGONAL_COST = 14;

const pointKey = (point: GridPoint): string => `${point.x},${point.y}`;

export function octileDistance(a: GridPoint, b: GridPoint): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return CARDINAL_COST * (dx + dy) + (DIAGONAL_COST - 2 * CARDINAL_COST) * Math.min(dx, dy);
}

function compareNodes(a: OpenNode, b: OpenNode): number {
  const af = a.g + a.h;
  const bf = b.g + b.h;
  return af - bf || a.h - b.h || a.point.y - b.point.y || a.point.x - b.point.x || a.order - b.order;
}

/**
 * Deterministic eight-direction A*. The fixed neighbour ordering and total
 * queue ordering make equal-cost paths repeatable across machines.
 */
export function findPath(
  start: GridPoint,
  target: GridPoint,
  doorOpen: boolean,
  level: LevelDefinition = LEVEL_ONE,
): GridPoint[] | null {
  if (!isWalkable(start, doorOpen, level) || !isWalkable(target, doorOpen, level)) return null;
  if (sameGridPoint(start, target)) return [start];

  const open: OpenNode[] = [{ point: start, g: 0, h: octileDistance(start, target), order: 0 }];
  const gScore = new Map<string, number>([[pointKey(start), 0]]);
  const cameFrom = new Map<string, GridPoint>();
  const closed = new Set<string>();
  let order = 1;
  const directions = [
    { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
    { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
  ];

  while (open.length > 0) {
    open.sort(compareNodes);
    const current = open.shift();
    if (current === undefined) break;
    const currentKey = pointKey(current.point);
    if (closed.has(currentKey)) continue;
    if (sameGridPoint(current.point, target)) {
      const path = [current.point];
      let cursor = current.point;
      while (!sameGridPoint(cursor, start)) {
        const previous = cameFrom.get(pointKey(cursor));
        if (previous === undefined) return null;
        path.push(previous);
        cursor = previous;
      }
      return path.reverse();
    }
    closed.add(currentKey);

    for (const direction of directions) {
      const next = { x: current.point.x + direction.x, y: current.point.y + direction.y };
      if (!isWalkable(next, doorOpen, level)) continue;
      if (direction.x !== 0 && direction.y !== 0) {
        const horizontal = { x: current.point.x + direction.x, y: current.point.y };
        const vertical = { x: current.point.x, y: current.point.y + direction.y };
        if (!isWalkable(horizontal, doorOpen, level) || !isWalkable(vertical, doorOpen, level)) continue;
      }
      const nextKey = pointKey(next);
      if (closed.has(nextKey)) continue;
      const cost = direction.x === 0 || direction.y === 0 ? CARDINAL_COST : DIAGONAL_COST;
      const tentativeG = current.g + cost;
      if (tentativeG >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(nextKey, current.point);
      gScore.set(nextKey, tentativeG);
      open.push({ point: next, g: tentativeG, h: octileDistance(next, target), order });
      order += 1;
    }
  }
  return null;
}
