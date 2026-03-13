/**
 * Canvas2D drawing engine for the circuit schematic.
 * Handles grid, components, connections, pressure colours, flow arrows.
 */

import type { ComponentDef, ConnectionDef, PortState, FluidDef } from '../solver/types';
import { drawComponentSymbol, getPortWorldPositions, getPortOutwardDir, COMPONENT_SIZES, type SymbolContext } from '../components/symbols';
import { pressureToColour, getFluidLineStyle } from './PressureColourMap';
import { drawFlowArrows } from './FlowAnimation';
import { segmentControlPoints } from './bezierUtils';

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

  // Port outward directions for bezier control points
  const fromDir = getPortOutwardDir(fromComp.type, conn.from.port, fromComp.rotation, fromComp.ports);
  const toDir = getPortOutwardDir(toComp.type, conn.to.port, toComp.rotation, toComp.ports);

  // Build full point list: from -> waypoints -> to
  const points = [
    { x: fromPort.x, y: fromPort.y },
    ...conn.waypoints,
    { x: toPort.x, y: toPort.y },
  ];

  // Draw bezier curve through points with control points going
  // outward from the component at each port
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    const d0 = i === 1 ? fromDir : undefined;
    const d1 = i === points.length - 1 ? toDir : undefined;
    const [cp1, cp2] = segmentControlPoints(points[i - 1], points[i], d0, d1);
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, points[i].x, points[i].y);
  }

  ctx.stroke();
  ctx.setLineDash([]);

  // Flow arrows along bezier curve
  if (state.running && state.showFlowArrows) {
    const portKey = `${conn.from.component}:${conn.from.port}`;
    const portIdx = state.portIndexMap.get(portKey);
    if (portIdx !== undefined && state.portStates[portIdx]) {
      const flow = state.portStates[portIdx].q;
      drawFlowArrows(ctx, points, flow, state.time, lineColour, fromDir, toDir);
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
 * Hit test: find connection (pipe) at world coordinates.
 * Samples the bezier curve and checks distance to the click point.
 */
export function hitTestConnection(
  wx: number, wy: number,
  connections: ConnectionDef[],
  components: ComponentDef[],
  threshold: number = 8
): ConnectionDef | null {
  // Build a lookup map for O(1) component access
  const compMap = new Map<string, ComponentDef>();
  for (const c of components) compMap.set(c.id, c);

  const threshSq = threshold * threshold;
  const stepsPerSeg = 30;

  for (const conn of connections) {
    const fromComp = compMap.get(conn.from.component);
    const toComp = compMap.get(conn.to.component);
    if (!fromComp || !toComp) continue;

    const fromPorts = getPortWorldPositions(
      fromComp.type, fromComp.position.x, fromComp.position.y,
      fromComp.ports, fromComp.rotation
    );
    const toPorts = getPortWorldPositions(
      toComp.type, toComp.position.x, toComp.position.y,
      toComp.ports, toComp.rotation
    );

    const fromPort = fromPorts.find((p) => p.id === conn.from.port);
    const toPort = toPorts.find((p) => p.id === conn.to.port);
    if (!fromPort || !toPort) continue;

    const fromDir = getPortOutwardDir(fromComp.type, conn.from.port, fromComp.rotation, fromComp.ports);
    const toDir = getPortOutwardDir(toComp.type, conn.to.port, toComp.rotation, toComp.ports);

    const points = [
      { x: fromPort.x, y: fromPort.y },
      ...conn.waypoints,
      { x: toPort.x, y: toPort.y },
    ];

    // Sample bezier using shared helper and check distance
    for (let i = 0; i < points.length - 1; i++) {
      const d0 = i === 0 ? fromDir : undefined;
      const d1 = i === points.length - 2 ? toDir : undefined;
      const [cp1, cp2] = segmentControlPoints(points[i], points[i + 1], d0, d1);
      const p0 = points[i];
      const p1 = points[i + 1];

      for (let s = 0; s <= stepsPerSeg; s++) {
        const t = s / stepsPerSeg;
        const u = 1 - t;
        const sx = u*u*u*p0.x + 3*u*u*t*cp1.x + 3*u*t*t*cp2.x + t*t*t*p1.x;
        const sy = u*u*u*p0.y + 3*u*u*t*cp1.y + 3*u*t*t*cp2.y + t*t*t*p1.y;
        const ddx = wx - sx;
        const ddy = wy - sy;
        if (ddx * ddx + ddy * ddy < threshSq) {
          return conn;
        }
      }
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
