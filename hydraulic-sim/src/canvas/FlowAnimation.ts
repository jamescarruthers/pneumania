/**
 * Animated flow chevrons along bezier connection curves.
 */

interface Point { x: number; y: number }

/** Evaluate a cubic bezier at parameter t */
function bezierPoint(
  p0: Point, cp1: Point, cp2: Point, p1: Point, t: number
): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * p1.y,
  };
}

/** Build control points for a segment (matches CanvasRenderer logic) */
function segmentControlPoints(p0: Point, p1: Point): [Point, Point] {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const tension = Math.min(dist * 0.4, 80);

  if (Math.abs(dx) >= Math.abs(dy)) {
    return [
      { x: p0.x + tension, y: p0.y },
      { x: p1.x - tension, y: p1.y },
    ];
  } else {
    const sy = Math.sign(dy) || 1;
    return [
      { x: p0.x, y: p0.y + sy * tension },
      { x: p1.x, y: p1.y - sy * tension },
    ];
  }
}

/** Sample evenly-spaced points along the full bezier path */
function sampleBezierPath(points: Point[], spacing: number): Point[] {
  // First, densely sample all segments
  const dense: Point[] = [];
  const stepsPerSeg = 40;

  for (let i = 0; i < points.length - 1; i++) {
    const [cp1, cp2] = segmentControlPoints(points[i], points[i + 1]);
    for (let s = 0; s <= stepsPerSeg; s++) {
      // Skip duplicate junction points
      if (i > 0 && s === 0) continue;
      dense.push(bezierPoint(points[i], cp1, cp2, points[i + 1], s / stepsPerSeg));
    }
  }

  if (dense.length < 2) return dense;

  // Build cumulative arc-length table
  const arcLen: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i].x - dense[i - 1].x;
    const dy = dense[i].y - dense[i - 1].y;
    arcLen.push(arcLen[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }

  return dense;
}

export function drawFlowArrows(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  flow: number,
  time: number,
  colour: string = '#fff'
): void {
  if (Math.abs(flow) < 1e-10) return;
  if (points.length < 2) return;

  // Sample dense points along the bezier path
  const spacing = 25;
  const dense = sampleBezierPath(points, spacing);
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
