/**
 * Animated flow chevrons along connection lines.
 */

export function drawFlowArrows(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  flow: number,
  time: number,
  colour: string = '#fff'
): void {
  if (Math.abs(flow) < 1e-10) return;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 20) return;

  const nx = dx / len;
  const ny = dy / len;
  const dir = flow > 0 ? 1 : -1;

  const speed = Math.min(Math.abs(flow) * 1e6, 5); // scale for visibility
  const spacing = 25;
  const arrowSize = 4;

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.7;

  const offset = ((time * speed * 60) % spacing) * dir;

  for (let d = offset; d < len; d += spacing) {
    if (d < 5 || d > len - 5) continue;
    const cx = x1 + nx * d;
    const cy = y1 + ny * d;

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
