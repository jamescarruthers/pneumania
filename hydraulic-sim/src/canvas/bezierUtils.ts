/**
 * Shared bezier curve utilities for connection rendering, hit-testing, and flow animation.
 */

export interface Point { x: number; y: number }
export interface Dir { dx: number; dy: number }

/** Evaluate a cubic bezier at parameter t */
export function bezierPoint(
  p0: Point, cp1: Point, cp2: Point, p1: Point, t: number
): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * p1.y,
  };
}

/** Build bezier control points for a segment between two points. */
export function segmentControlPoints(
  p0: Point, p1: Point,
  dir0?: Dir, dir1?: Dir
): [Point, Point] {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const tension = Math.min(dist * 0.4, 80);

  let cp1: Point;
  if (dir0) {
    cp1 = { x: p0.x + dir0.dx * tension, y: p0.y + dir0.dy * tension };
  } else if (Math.abs(dx) >= Math.abs(dy)) {
    cp1 = { x: p0.x + tension, y: p0.y };
  } else {
    const sy = Math.sign(dy) || 1;
    cp1 = { x: p0.x, y: p0.y + sy * tension };
  }

  let cp2: Point;
  if (dir1) {
    cp2 = { x: p1.x + dir1.dx * tension, y: p1.y + dir1.dy * tension };
  } else if (Math.abs(dx) >= Math.abs(dy)) {
    cp2 = { x: p1.x - tension, y: p1.y };
  } else {
    const sy = Math.sign(dy) || 1;
    cp2 = { x: p1.x, y: p1.y - sy * tension };
  }

  return [cp1, cp2];
}
