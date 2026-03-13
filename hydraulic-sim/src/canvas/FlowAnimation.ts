/**
 * Animated flow chevrons along bezier connection curves.
 */

import { type Point, type Dir, bezierPoint, segmentControlPoints } from './bezierUtils';

/** Densely sample points along the full bezier path */
function sampleBezierPath(
  points: Point[],
  fromDir?: Dir,
  toDir?: Dir
): Point[] {
  const dense: Point[] = [];
  const stepsPerSeg = 40;

  for (let i = 0; i < points.length - 1; i++) {
    const d0 = i === 0 ? fromDir : undefined;
    const d1 = i === points.length - 2 ? toDir : undefined;
    const [cp1, cp2] = segmentControlPoints(points[i], points[i + 1], d0, d1);
    for (let s = 0; s <= stepsPerSeg; s++) {
      // Skip duplicate junction points
      if (i > 0 && s === 0) continue;
      dense.push(bezierPoint(points[i], cp1, cp2, points[i + 1], s / stepsPerSeg));
    }
  }

  return dense;
}

export function drawFlowArrows(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  flow: number,
  time: number,
  colour: string = '#fff',
  fromDir?: Dir,
  toDir?: Dir
): void {
  if (Math.abs(flow) < 1e-10) return;
  if (points.length < 2) return;

  // Sample dense points along the bezier path
  const spacing = 25;
  const dense = sampleBezierPath(points, fromDir, toDir);
  if (dense.length < 2) return;

  // Compute cumulative arc lengths
  const arcLen: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i].x - dense[i - 1].x;
    const dy = dense[i].y - dense[i - 1].y;
    arcLen.push(arcLen[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLen = arcLen[arcLen.length - 1];
  if (totalLen < 20) return;

  const dir = flow > 0 ? 1 : -1;
  const speed = Math.min(Math.abs(flow) * 1e6, 5);
  const arrowSize = 4;

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.7;

  const offset = ((time * speed * 60) % spacing) * dir;

  // Find point and tangent at a given arc distance
  function pointAtDist(d: number): { x: number; y: number; nx: number; ny: number } | null {
    if (d < 0 || d > totalLen) return null;
    // Binary search for segment
    let lo = 0, hi = arcLen.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (arcLen[mid] <= d) lo = mid; else hi = mid;
    }
    const segLen = arcLen[hi] - arcLen[lo];
    const t = segLen > 0 ? (d - arcLen[lo]) / segLen : 0;
    const x = dense[lo].x + t * (dense[hi].x - dense[lo].x);
    const y = dense[lo].y + t * (dense[hi].y - dense[lo].y);
    const dx = dense[hi].x - dense[lo].x;
    const dy = dense[hi].y - dense[lo].y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x, y, nx: dx / len, ny: dy / len };
  }

  for (let d = offset; d < totalLen; d += spacing) {
    if (d < 5 || d > totalLen - 5) continue;
    const pt = pointAtDist(d);
    if (!pt) continue;

    const { x: cx, y: cy, nx, ny } = pt;

    ctx.beginPath();
    ctx.moveTo(
      cx - (nx * dir + ny) * arrowSize,
      cy - (ny * dir - nx) * arrowSize
    );
    ctx.lineTo(cx, cy);
    ctx.lineTo(
      cx - (nx * dir - ny) * arrowSize,
      cy - (ny * dir + nx) * arrowSize
    );
    ctx.stroke();
  }

  ctx.restore();
}
