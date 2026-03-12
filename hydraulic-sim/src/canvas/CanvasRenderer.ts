/**
 * Canvas2D drawing engine for the circuit schematic.
 * Handles grid, components, connections, pressure colours, flow arrows.
 */

import type { ComponentDef, ConnectionDef, PortState, FluidDef } from '../solver/types';
import { drawComponentSymbol, getPortWorldPositions, COMPONENT_SIZES, type SymbolContext } from '../components/symbols';
import { pressureToColour, getFluidLineStyle } from './PressureColourMap';
import { drawFlowArrows } from './FlowAnimation';

export interface RenderState {
  components: ComponentDef[];
  connections: ConnectionDef[];
  fluids: FluidDef[];
  portStates: PortState[];
  componentStates: Map<string, Record<string, number>>;
  // Port index mapping: componentId:portId -> global port index
  portIndexMap: Map<string, number>;

  selectedComponentIds: Set<string>;
  selectedConnectionIds: Set<string>;

  cameraX: number;
  cameraY: number;
  zoom: number;
  gridSize: number;

  showGrid: boolean;
  showPressureColours: boolean;
  showFlowArrows: boolean;
  showLabels: boolean;
  running: boolean;
  time: number;
}

export function renderCircuit(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: RenderState
): void {
  const { width, height } = canvas;
  const dpr = window.devicePixelRatio || 1;

  ctx.clearRect(0, 0, width, height);

  ctx.save();

  // Apply camera transform
  ctx.translate(width / (2 * dpr), height / (2 * dpr));
  ctx.scale(state.zoom, state.zoom);
  ctx.translate(-state.cameraX, -state.cameraY);

  // Grid
  if (state.showGrid) {
    drawGrid(ctx, state);
  }

  // Connections
  for (const conn of state.connections) {
    drawConnection(ctx, conn, state);
  }

  // Components
  for (const comp of state.components) {
    const size = COMPONENT_SIZES[comp.type] ?? { width: 50, height: 30 };
    const compState = state.componentStates.get(comp.id);

    const sc: SymbolContext = {
      ctx,
      x: comp.position.x,
      y: comp.position.y,
      width: size.width,
      height: size.height,
      rotation: comp.rotation,
      selected: state.selectedComponentIds.has(comp.id),
      running: state.running,
      state: compState,
      params: comp.params,
    };

    // Apply rotation transform centered on component position
    if (comp.rotation !== 0) {
      ctx.save();
      ctx.translate(comp.position.x, comp.position.y);
      ctx.rotate(comp.rotation * Math.PI / 180);
      ctx.translate(-comp.position.x, -comp.position.y);
      drawComponentSymbol(comp.type, sc);
      ctx.restore();
    } else {
      drawComponentSymbol(comp.type, sc);
    }

    // Label (always drawn un-rotated below the bounding box)
    if (state.showLabels) {
      const rotated = comp.rotation === 90 || comp.rotation === 270;
      const labelOffset = (rotated ? size.width : size.height) / 2 + 20;
      ctx.fillStyle = '#b2bec3';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(comp.label, comp.position.x, comp.position.y + labelOffset);
    }
  }

  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const gridSize = state.gridSize;
  const viewSize = 2000; // visible area estimate

  const startX = Math.floor((state.cameraX - viewSize / state.zoom) / gridSize) * gridSize;
  const startY = Math.floor((state.cameraY - viewSize / state.zoom) / gridSize) * gridSize;
  const endX = Math.ceil((state.cameraX + viewSize / state.zoom) / gridSize) * gridSize;
  const endY = Math.ceil((state.cameraY + viewSize / state.zoom) / gridSize) * gridSize;

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;

  ctx.beginPath();
  for (let x = startX; x <= endX; x += gridSize) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += gridSize) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();
}

function drawConnection(
  ctx: CanvasRenderingContext2D,
  conn: ConnectionDef,
  state: RenderState
): void {
  // Find port positions
  const fromComp = state.components.find((c) => c.id === conn.from.component);
  const toComp = state.components.find((c) => c.id === conn.to.component);
  if (!fromComp || !toComp) return;

  const fromPorts = getPortWorldPositions(
    fromComp.type,
    fromComp.position.x,
    fromComp.position.y,
    fromComp.ports,
    fromComp.rotation
  );
  const toPorts = getPortWorldPositions(
    toComp.type,
    toComp.position.x,
    toComp.position.y,
    toComp.ports,
    toComp.rotation
  );

  const fromPort = fromPorts.find((p) => p.id === conn.from.port);
  const toPort = toPorts.find((p) => p.id === conn.to.port);
  if (!fromPort || !toPort) return;

  const selected = state.selectedConnectionIds.has(conn.id);
  const fluidId = conn.line_params.fluid_id;
  const fluid = state.fluids[fluidId] ?? null;

  // Get pressure-based colour if running
  let lineColour: string;
  const dashPattern: number[] = [];

  if (state.running && state.showPressureColours) {
    const portKey = `${conn.from.component}:${conn.from.port}`;
    const portIdx = state.portIndexMap.get(portKey);
    if (portIdx !== undefined && state.portStates[portIdx]) {
      const pressure = state.portStates[portIdx].p;
      lineColour = pressureToColour(pressure, fluid);
    } else {
      lineColour = getFluidLineStyle(fluid).color;
    }
  } else {
    const style = getFluidLineStyle(fluid);
    lineColour = style.color;
    if (style.dashPattern.length > 0) dashPattern.push(...style.dashPattern);
  }

  if (selected) lineColour = '#48dbfb';

  ctx.save();
  ctx.strokeStyle = lineColour;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.setLineDash(dashPattern);

  // Build full point list: from -> waypoints -> to
  const points = [
    { x: fromPort.x, y: fromPort.y },
    ...conn.waypoints,
    { x: toPort.x, y: toPort.y },
  ];

  // Draw bezier curve through points
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    // Direct connection: cubic bezier with control points extending
    // along the axis of greatest separation for a smooth curve
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const tension = Math.min(dist * 0.4, 80);

    // Extend control points horizontally or vertically based on dominant axis
    if (Math.abs(dx) >= Math.abs(dy)) {
      ctx.bezierCurveTo(
        points[0].x + tension, points[0].y,
        points[1].x - tension, points[1].y,
        points[1].x, points[1].y
      );
    } else {
      ctx.bezierCurveTo(
        points[0].x, points[0].y + Math.sign(dy) * tension,
        points[1].x, points[1].y - Math.sign(dy) * tension,
        points[1].x, points[1].y
      );
    }
  } else {
    // Multiple segments: use cubic bezier for each segment with
    // control points extending along the segment's dominant axis
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const tension = Math.min(dist * 0.4, 80);

      if (Math.abs(dx) >= Math.abs(dy)) {
        ctx.bezierCurveTo(
          p0.x + tension, p0.y,
          p1.x - tension, p1.y,
          p1.x, p1.y
        );
      } else {
        ctx.bezierCurveTo(
          p0.x, p0.y + Math.sign(dy) * tension,
          p1.x, p1.y - Math.sign(dy) * tension,
          p1.x, p1.y
        );
      }
    }
  }

  ctx.stroke();
  ctx.setLineDash([]);

  // Flow arrows along bezier curve
  if (state.running && state.showFlowArrows) {
    const portKey = `${conn.from.component}:${conn.from.port}`;
    const portIdx = state.portIndexMap.get(portKey);
    if (portIdx !== undefined && state.portStates[portIdx]) {
      const flow = state.portStates[portIdx].q;
      drawFlowArrows(ctx, points, flow, state.time, lineColour);
    }
  }

  ctx.restore();
}

/**
 * Hit test: find component at screen coordinates.
 */
export function hitTestComponent(
  wx: number, wy: number,
  components: ComponentDef[]
): ComponentDef | null {
  for (let i = components.length - 1; i >= 0; i--) {
    const comp = components[i];
    const size = COMPONENT_SIZES[comp.type] ?? { width: 50, height: 30 };
    // Swap width/height for 90° and 270° rotations
    const rotated = comp.rotation === 90 || comp.rotation === 270;
    const hw = (rotated ? size.height : size.width) / 2 + 10;
    const hh = (rotated ? size.width : size.height) / 2 + 10;
    if (
      wx >= comp.position.x - hw &&
      wx <= comp.position.x + hw &&
      wy >= comp.position.y - hh &&
      wy <= comp.position.y + hh
    ) {
      return comp;
    }
  }
  return null;
}

/**
 * Hit test: find port at screen coordinates.
 */
export function hitTestPort(
  wx: number, wy: number,
  components: ComponentDef[],
  threshold: number = 12
): { component: string; port: string } | null {
  for (const comp of components) {
    const portPositions = getPortWorldPositions(
      comp.type,
      comp.position.x,
      comp.position.y,
      comp.ports,
      comp.rotation
    );
    for (const pp of portPositions) {
      const dx = wx - pp.x;
      const dy = wy - pp.y;
      if (dx * dx + dy * dy < threshold * threshold) {
        return { component: comp.id, port: pp.id };
      }
    }
  }
  return null;
}
