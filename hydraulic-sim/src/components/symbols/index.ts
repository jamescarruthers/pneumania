/**
 * ISO 1219 hydraulic schematic symbol rendering.
 * Each component type has a draw function that renders to Canvas2D.
 */

import type { ComponentType } from '../../solver/types';

export interface SymbolContext {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;  // degrees
  selected: boolean;
  running: boolean;
  // Component-specific state for animation
  state?: Record<string, number>;
  params?: Record<string, number | string | boolean>;
}

export interface PortPosition {
  id: string;
  x: number;
  y: number;
}

const STROKE_COLOUR = '#c8d6e5';
const STROKE_SELECTED = '#48dbfb';
const FILL_COLOUR = '#2d3436';
const PORT_COLOUR = '#feca57';
const PORT_RADIUS = 4;

function getStroke(selected: boolean): string {
  return selected ? STROKE_SELECTED : STROKE_COLOUR;
}

// ============================================================
// Drawing helpers
// ============================================================

function drawPort(ctx: CanvasRenderingContext2D, x: number, y: number, connected: boolean = false): void {
  ctx.beginPath();
  ctx.arc(x, y, PORT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = connected ? PORT_COLOUR : '#636e72';
  ctx.fill();
  ctx.strokeStyle = PORT_COLOUR;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ============================================================
// Symbol drawers
// ============================================================

export function drawCylinderSymbol(sc: SymbolContext): void {
  const { ctx, x, y, width, height, selected, state } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  // Cylinder body
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.fillStyle = FILL_COLOUR;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.strokeRect(-width / 2, -height / 2, width, height);

  // Piston position (animated)
  const position = state?.position ?? 0;
  const stroke_length = (sc.params?.stroke_length as number) ?? 0.2;
  const pistonRatio = stroke_length > 0 ? position / stroke_length : 0;
  const pistonX = -width / 2 + 8 + pistonRatio * (width - 24);

  // Piston line
  ctx.beginPath();
  ctx.moveTo(pistonX, -height / 2 + 4);
  ctx.lineTo(pistonX, height / 2 - 4);
  ctx.strokeStyle = '#dfe6e9';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Rod
  ctx.beginPath();
  ctx.moveTo(pistonX, 0);
  ctx.lineTo(width / 2 + 10, 0);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Ports
  drawPort(ctx, -width / 2, 0);   // Port A
  drawPort(ctx, width / 2, 0);    // Port B

  // Labels
  ctx.fillStyle = '#b2bec3';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('A', -width / 2, height / 2 + 12);
  ctx.fillText('B', width / 2, height / 2 + 12);

  ctx.restore();
}

export function drawPressureSourceSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);
  const r = 18;

  ctx.save();
  ctx.translate(x, y);

  // Circle
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = FILL_COLOUR;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Triangle (pump symbol)
  ctx.beginPath();
  ctx.moveTo(-8, 10);
  ctx.lineTo(8, 10);
  ctx.lineTo(0, -10);
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Port
  drawPort(ctx, r + 6, 0);

  // Label
  ctx.fillStyle = '#b2bec3';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  const pressure = (sc.params?.pressure as number) ?? 150e5;
  ctx.fillText(`${(pressure / 1e5).toFixed(0)} bar`, 0, r + 14);

  ctx.restore();
}

export function drawTankSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  // Open-topped rectangle
  const w = 30, h = 20;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.stroke();

  // Connect line
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(0, -h / 2 - 10);
  ctx.stroke();

  drawPort(ctx, 0, -h / 2 - 10);

  ctx.fillStyle = '#b2bec3';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('T', 0, h / 2 + 12);

  ctx.restore();
}

export function drawOrificeSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  // Hourglass shape
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, -10);
  ctx.lineTo(10, 10);
  ctx.moveTo(10, -10);
  ctx.lineTo(-10, 10);
  ctx.stroke();

  // Connection lines
  ctx.beginPath();
  ctx.moveTo(-25, 0);
  ctx.lineTo(-10, 0);
  ctx.moveTo(10, 0);
  ctx.lineTo(25, 0);
  ctx.stroke();

  drawPort(ctx, -25, 0);
  drawPort(ctx, 25, 0);

  ctx.restore();
}

export function drawCheckValveSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;

  // Triangle
  ctx.beginPath();
  ctx.moveTo(-8, -10);
  ctx.lineTo(8, 0);
  ctx.lineTo(-8, 10);
  ctx.closePath();
  ctx.stroke();

  // Bar
  ctx.beginPath();
  ctx.moveTo(8, -10);
  ctx.lineTo(8, 10);
  ctx.stroke();

  // Lines
  ctx.beginPath();
  ctx.moveTo(-25, 0);
  ctx.lineTo(-8, 0);
  ctx.moveTo(8, 0);
  ctx.lineTo(25, 0);
  ctx.stroke();

  drawPort(ctx, -25, 0);
  drawPort(ctx, 25, 0);

  ctx.restore();
}

export function drawDcv43Symbol(sc: SymbolContext): void {
  const { ctx, x, y, selected, state } = sc;
  const stroke = getStroke(selected);
  const spool = state?.actual_spool ?? 0;

  ctx.save();
  ctx.translate(x, y);

  const boxW = 30;
  const boxH = 30;
  const totalW = boxW * 3;

  // Three position boxes
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.fillStyle = FILL_COLOUR;

  for (let i = 0; i < 3; i++) {
    const bx = -totalW / 2 + i * boxW;
    ctx.fillRect(bx, -boxH / 2, boxW, boxH);
    ctx.strokeRect(bx, -boxH / 2, boxW, boxH);
  }

  // Highlight active position
  const activeBox = spool > 0.3 ? 2 : spool < -0.3 ? 0 : 1;
  const highlightX = -totalW / 2 + activeBox * boxW;
  ctx.fillStyle = 'rgba(72, 219, 251, 0.15)';
  ctx.fillRect(highlightX, -boxH / 2, boxW, boxH);

  // Flow arrows in each position
  ctx.strokeStyle = '#b2bec3';
  ctx.lineWidth = 1;
  // Position 1 (left): P→B, A→T
  drawFlowPath(ctx, -totalW / 2, -boxH / 2, boxW, boxH, 'cross');
  // Position 2 (centre): closed
  drawFlowPath(ctx, -totalW / 2 + boxW, -boxH / 2, boxW, boxH, 'closed');
  // Position 3 (right): P→A, B→T
  drawFlowPath(ctx, -totalW / 2 + boxW * 2, -boxH / 2, boxW, boxH, 'straight');

  // Ports
  drawPort(ctx, -boxW * 0.5, boxH / 2 + 8);  // P
  drawPort(ctx, boxW * 0.5, boxH / 2 + 8);    // T
  drawPort(ctx, -boxW * 0.5, -boxH / 2 - 8);  // A
  drawPort(ctx, boxW * 0.5, -boxH / 2 - 8);   // B

  // Port labels
  ctx.fillStyle = '#b2bec3';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('P', -boxW * 0.5, boxH / 2 + 22);
  ctx.fillText('T', boxW * 0.5, boxH / 2 + 22);
  ctx.fillText('A', -boxW * 0.5, -boxH / 2 - 14);
  ctx.fillText('B', boxW * 0.5, -boxH / 2 - 14);

  // Actuator symbols (arrows on sides)
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  // Left actuator
  ctx.beginPath();
  ctx.moveTo(-totalW / 2 - 12, 0);
  ctx.lineTo(-totalW / 2, 0);
  ctx.moveTo(-totalW / 2 - 8, -4);
  ctx.lineTo(-totalW / 2, 0);
  ctx.lineTo(-totalW / 2 - 8, 4);
  ctx.stroke();
  // Right actuator
  ctx.beginPath();
  ctx.moveTo(totalW / 2 + 12, 0);
  ctx.lineTo(totalW / 2, 0);
  ctx.moveTo(totalW / 2 + 8, -4);
  ctx.lineTo(totalW / 2, 0);
  ctx.lineTo(totalW / 2 + 8, 4);
  ctx.stroke();

  ctx.restore();
}

function drawFlowPath(
  ctx: CanvasRenderingContext2D,
  bx: number, by: number,
  w: number, h: number,
  type: 'straight' | 'cross' | 'closed'
): void {
  const cx = bx + w / 2;
  const cy = by + h / 2;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#636e72';

  if (type === 'straight') {
    // P→A (bottom-left to top-left)
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + h / 2 - 4);
    ctx.lineTo(cx - 6, cy - h / 2 + 4);
    ctx.stroke();
    // Arrow
    drawArrowHead(ctx, cx - 6, cy - h / 2 + 4, -Math.PI / 2);
    // B→T (top-right to bottom-right)
    ctx.beginPath();
    ctx.moveTo(cx + 6, cy - h / 2 + 4);
    ctx.lineTo(cx + 6, cy + h / 2 - 4);
    ctx.stroke();
    drawArrowHead(ctx, cx + 6, cy + h / 2 - 4, Math.PI / 2);
  } else if (type === 'cross') {
    // P→B (bottom-left to top-right)
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + h / 2 - 4);
    ctx.lineTo(cx + 6, cy - h / 2 + 4);
    ctx.stroke();
    drawArrowHead(ctx, cx + 6, cy - h / 2 + 4, -Math.PI / 4);
    // A→T (top-left to bottom-right)
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - h / 2 + 4);
    ctx.lineTo(cx + 6, cy + h / 2 - 4);
    ctx.stroke();
    drawArrowHead(ctx, cx + 6, cy + h / 2 - 4, Math.PI / 4);
  } else {
    // Closed centre - T symbols
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy + h / 2 - 6);
    ctx.lineTo(cx - 4, cy + 2);
    ctx.moveTo(cx - 8, cy + 2);
    ctx.lineTo(cx, cy + 2);
    ctx.moveTo(cx + 4, cy - h / 2 + 6);
    ctx.lineTo(cx + 4, cy - 2);
    ctx.moveTo(cx, cy - 2);
    ctx.lineTo(cx + 8, cy - 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  const size = 4;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size);
  ctx.moveTo(0, 0);
  ctx.lineTo(size, -size);
  ctx.stroke();
  ctx.restore();
}

export function drawDcv32Symbol(sc: SymbolContext): void {
  const { ctx, x, y, selected, state } = sc;
  const stroke = getStroke(selected);
  const spool = state?.actual_spool ?? 0;

  ctx.save();
  ctx.translate(x, y);

  const boxW = 30;
  const boxH = 30;
  const totalW = boxW * 2;

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.fillStyle = FILL_COLOUR;

  for (let i = 0; i < 2; i++) {
    const bx = -totalW / 2 + i * boxW;
    ctx.fillRect(bx, -boxH / 2, boxW, boxH);
    ctx.strokeRect(bx, -boxH / 2, boxW, boxH);
  }

  const activeBox = spool > 0.5 ? 1 : 0;
  const highlightX = -totalW / 2 + activeBox * boxW;
  ctx.fillStyle = 'rgba(72, 219, 251, 0.15)';
  ctx.fillRect(highlightX, -boxH / 2, boxW, boxH);

  // Ports
  drawPort(ctx, -boxW * 0.3, boxH / 2 + 8);
  drawPort(ctx, boxW * 0.3, boxH / 2 + 8);
  drawPort(ctx, 0, -boxH / 2 - 8);

  ctx.fillStyle = '#b2bec3';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('P', -boxW * 0.3, boxH / 2 + 22);
  ctx.fillText('T', boxW * 0.3, boxH / 2 + 22);
  ctx.fillText('A', 0, -boxH / 2 - 14);

  ctx.restore();
}

export function drawTeeSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;

  // T-shape
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(20, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 20);
  ctx.stroke();

  // Junction dot
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fillStyle = stroke;
  ctx.fill();

  drawPort(ctx, -20, 0);
  drawPort(ctx, 20, 0);
  drawPort(ctx, 0, 20);

  ctx.restore();
}

export function drawSphereSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected, state, params } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  const r = 18;

  // Sphere body
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = FILL_COLOUR;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Diaphragm line (animated)
  const R_sphere = (params?.R_sphere as number) ?? 0.06;
  const h = state?.h ?? R_sphere;
  const diaphragmY = r - (h / (2 * R_sphere)) * 2 * r;

  ctx.beginPath();
  ctx.moveTo(-r * 0.8, diaphragmY);
  ctx.quadraticCurveTo(0, diaphragmY - 6, r * 0.8, diaphragmY);
  ctx.strokeStyle = '#feca57';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Gas label
  ctx.fillStyle = '#636e72';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N₂', 0, diaphragmY - 8);

  // Port at bottom
  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.lineTo(0, r + 10);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawPort(ctx, 0, r + 10);

  ctx.restore();
}

export function drawBalloonSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected, state, params } = sc;
  const stroke = getStroke(selected);
  const isSpherical = !params?.length;

  ctx.save();
  ctx.translate(x, y);

  const R_nominal = (params?.R_nominal as number) ?? 0.025;
  const V_current = state?.V_current ?? 0;
  const V_nominal = isSpherical
    ? (4 / 3) * Math.PI * R_nominal ** 3
    : Math.PI * R_nominal ** 2 * ((params?.length as number) ?? 0.1);
  const scale = Math.max(0.7, Math.min(1.5, Math.pow(V_current / V_nominal, 1 / 3)));

  // Strain colour
  const maxStrain = (params?.max_strain as number) ?? 2.5;
  const strain = scale - 1;
  const strainRatio = Math.min(strain / (maxStrain * 0.3), 1);
  const r = Math.round(100 + strainRatio * 155);
  const g = Math.round(200 * (1 - strainRatio));
  const fillColour = `rgb(${r},${g},50)`;

  if (isSpherical) {
    const baseR = 16;
    ctx.beginPath();
    ctx.arc(0, 0, baseR * scale, 0, Math.PI * 2);
    ctx.fillStyle = fillColour;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    const baseW = 30;
    const baseH = 14;
    const w = baseW * scale;
    const h = baseH * scale;
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = fillColour;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Port
  const portY = isSpherical ? 16 * scale + 8 : 14 * scale / 2 + 8;
  ctx.beginPath();
  ctx.moveTo(0, isSpherical ? 16 * scale : 14 * scale / 2);
  ctx.lineTo(0, portY);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawPort(ctx, 0, portY);

  ctx.restore();
}

export function drawSpringSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;

  // Zig-zag spring
  const w = 40;
  const coils = 5;
  const coilW = w / coils;
  ctx.beginPath();
  ctx.moveTo(-w / 2 - 10, 0);
  ctx.lineTo(-w / 2, 0);
  for (let i = 0; i < coils; i++) {
    const sx = -w / 2 + i * coilW;
    ctx.lineTo(sx + coilW / 4, -8);
    ctx.lineTo(sx + coilW * 3 / 4, 8);
    ctx.lineTo(sx + coilW, 0);
  }
  ctx.lineTo(w / 2 + 10, 0);
  ctx.stroke();

  drawPort(ctx, -w / 2 - 10, 0);
  drawPort(ctx, w / 2 + 10, 0);

  ctx.restore();
}

export function drawVariableOrificeSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  // Base orifice
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, -10);
  ctx.lineTo(10, 10);
  ctx.moveTo(10, -10);
  ctx.lineTo(-10, 10);
  ctx.stroke();

  // Diagonal arrow (variable)
  ctx.beginPath();
  ctx.moveTo(-14, 14);
  ctx.lineTo(14, -14);
  ctx.stroke();
  drawArrowHead(ctx, 14, -14, -Math.PI / 4);

  ctx.beginPath();
  ctx.moveTo(-25, 0);
  ctx.lineTo(-10, 0);
  ctx.moveTo(10, 0);
  ctx.lineTo(25, 0);
  ctx.stroke();

  drawPort(ctx, -25, 0);
  drawPort(ctx, 25, 0);

  ctx.restore();
}

export function drawMassSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = FILL_COLOUR;
  ctx.fillRect(-15, -10, 30, 20);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(-15, -10, 30, 20);

  ctx.fillStyle = '#b2bec3';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('M', 0, 0);

  drawPort(ctx, 0, -10 - 6);

  ctx.restore();
}

export function drawPushButtonSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected, state } = sc;
  const stroke = getStroke(selected);
  const pressed = (state?.pressed ?? 0) > 0.5;

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = pressed ? '#0984e3' : FILL_COLOUR;
  ctx.fillRect(-15, -10, 30, 20);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(-15, -10, 30, 20);

  ctx.fillStyle = '#dfe6e9';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pressed ? 'ON' : 'OFF', 0, 0);

  drawPort(ctx, 20, 0);

  ctx.restore();
}

export function drawToggleSwitchSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected, state } = sc;
  const stroke = getStroke(selected);
  const toggle = (state?.toggle_state ?? 0) > 0.5;

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = FILL_COLOUR;
  ctx.fillRect(-18, -10, 36, 20);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(-18, -10, 36, 20);

  // Toggle indicator
  const knobX = toggle ? 8 : -8;
  ctx.beginPath();
  ctx.arc(knobX, 0, 6, 0, Math.PI * 2);
  ctx.fillStyle = toggle ? '#00b894' : '#636e72';
  ctx.fill();

  drawPort(ctx, 24, 0);

  ctx.restore();
}

export function drawSliderSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected, state } = sc;
  const stroke = getStroke(selected);
  const value = state?.value ?? 0.5;

  ctx.save();
  ctx.translate(x, y);

  // Track
  ctx.strokeStyle = '#636e72';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(20, 0);
  ctx.stroke();

  // Slider knob
  const knobX = -20 + value * 40;
  ctx.beginPath();
  ctx.arc(knobX, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = stroke;
  ctx.fill();

  drawPort(ctx, 26, 0);

  ctx.restore();
}

export function drawAccumulatorSymbol(sc: SymbolContext): void {
  const { ctx, x, y, selected } = sc;
  const stroke = getStroke(selected);

  ctx.save();
  ctx.translate(x, y);

  // Capsule shape
  const w = 16, h = 30;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2 + w / 2);
  ctx.arc(0, -h / 2 + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(w / 2, h / 2 - w / 2);
  ctx.arc(0, h / 2 - w / 2, w / 2, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = FILL_COLOUR;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Divider line
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 2, 0);
  ctx.lineTo(w / 2 - 2, 0);
  ctx.strokeStyle = '#feca57';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Gas label
  ctx.fillStyle = '#636e72';
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N₂', 0, -8);

  // Port
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(0, h / 2 + 8);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawPort(ctx, 0, h / 2 + 8);

  ctx.restore();
}

// ============================================================
// Main dispatch
// ============================================================

export const COMPONENT_SIZES: Record<string, { width: number; height: number }> = {
  PRESSURE_SOURCE: { width: 48, height: 48 },
  TANK: { width: 40, height: 40 },
  DOUBLE_ACTING_CYLINDER: { width: 100, height: 30 },
  SINGLE_ACTING_CYLINDER: { width: 80, height: 30 },
  ORIFICE: { width: 50, height: 24 },
  VARIABLE_ORIFICE: { width: 50, height: 30 },
  CHECK_VALVE: { width: 50, height: 24 },
  ONE_WAY_FLOW_CONTROL: { width: 50, height: 24 },
  DCV_4_3: { width: 100, height: 50 },
  DCV_3_2: { width: 70, height: 50 },
  TEE_JUNCTION: { width: 40, height: 30 },
  CROSS_JUNCTION: { width: 40, height: 40 },
  HYDROPNEUMATIC_SPHERE: { width: 48, height: 60 },
  PISTON_ACCUMULATOR: { width: 40, height: 60 },
  BALLOON_SPHERICAL: { width: 48, height: 60 },
  BALLOON_CYLINDRICAL: { width: 50, height: 40 },
  SPRING: { width: 60, height: 20 },
  MASS_LOAD: { width: 36, height: 30 },
  PUSH_BUTTON: { width: 40, height: 24 },
  TOGGLE_SWITCH: { width: 44, height: 24 },
  SLIDER_CONTROL: { width: 52, height: 16 },
};

export function drawComponentSymbol(
  type: ComponentType,
  sc: SymbolContext
): void {
  switch (type) {
    case 'DOUBLE_ACTING_CYLINDER':
    case 'SINGLE_ACTING_CYLINDER':
    case 'LINKED_CYLINDERS':
      drawCylinderSymbol(sc);
      break;
    case 'PRESSURE_SOURCE':
      drawPressureSourceSymbol(sc);
      break;
    case 'TANK':
      drawTankSymbol(sc);
      break;
    case 'ORIFICE':
      drawOrificeSymbol(sc);
      break;
    case 'VARIABLE_ORIFICE':
      drawVariableOrificeSymbol(sc);
      break;
    case 'CHECK_VALVE':
    case 'ONE_WAY_FLOW_CONTROL':
      drawCheckValveSymbol(sc);
      break;
    case 'DCV_4_3':
    case 'DCV_5_2':
    case 'DCV_5_3':
      drawDcv43Symbol(sc);
      break;
    case 'DCV_3_2':
      drawDcv32Symbol(sc);
      break;
    case 'TEE_JUNCTION':
    case 'CROSS_JUNCTION':
      drawTeeSymbol(sc);
      break;
    case 'HYDROPNEUMATIC_SPHERE':
      drawSphereSymbol(sc);
      break;
    case 'PISTON_ACCUMULATOR':
      drawAccumulatorSymbol(sc);
      break;
    case 'BALLOON_SPHERICAL':
    case 'BALLOON_CYLINDRICAL':
      drawBalloonSymbol(sc);
      break;
    case 'SPRING':
      drawSpringSymbol(sc);
      break;
    case 'MASS_LOAD':
      drawMassSymbol(sc);
      break;
    case 'PUSH_BUTTON':
      drawPushButtonSymbol(sc);
      break;
    case 'TOGGLE_SWITCH':
      drawToggleSwitchSymbol(sc);
      break;
    case 'SLIDER_CONTROL':
      drawSliderSymbol(sc);
      break;
    default:
      // Generic box
      sc.ctx.save();
      sc.ctx.translate(sc.x, sc.y);
      sc.ctx.fillStyle = FILL_COLOUR;
      sc.ctx.fillRect(-20, -15, 40, 30);
      sc.ctx.strokeStyle = getStroke(sc.selected);
      sc.ctx.lineWidth = 2;
      sc.ctx.strokeRect(-20, -15, 40, 30);
      sc.ctx.restore();
      break;
  }
}

export function getPortWorldPositions(
  type: ComponentType,
  cx: number,
  cy: number,
  ports: Array<{ id: string; side: string; offset: number }>,
  _rotation: number = 0
): PortPosition[] {
  const size = COMPONENT_SIZES[type] ?? { width: 50, height: 30 };
  const hw = size.width / 2;
  const hh = size.height / 2;

  return ports.map((p) => {
    let px = cx;
    let py = cy;
    switch (p.side) {
      case 'left':   px = cx - hw - 6; py = cy - hh + p.offset * size.height; break;
      case 'right':  px = cx + hw + 6; py = cy - hh + p.offset * size.height; break;
      case 'top':    px = cx - hw + p.offset * size.width; py = cy - hh - 8; break;
      case 'bottom': px = cx - hw + p.offset * size.width; py = cy + hh + 8; break;
    }
    return { id: p.id, x: px, y: py };
  });
}
