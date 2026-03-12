/**
 * Main circuit canvas React component.
 * Handles pan/zoom, component placement, port connection, piston drag.
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useCircuitStore } from '../store/circuitStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUIStore } from '../store/uiStore';
import { renderCircuit, hitTestComponent, hitTestPort, type RenderState } from './CanvasRenderer';
import { snapToGrid } from '../utils/math';

export function CircuitCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragComponentRef = useRef<string | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0 });

  const circuit = useCircuitStore((s) => s.circuit);
  const addComponent = useCircuitStore((s) => s.addComponent);
  const updateComponentPosition = useCircuitStore((s) => s.updateComponentPosition);
  const addConnection = useCircuitStore((s) => s.addConnection);
  const removeComponent = useCircuitStore((s) => s.removeComponent);
  const removeConnection = useCircuitStore((s) => s.removeConnection);

  const running = useSimulationStore((s) => s.running);
  const solver = useSimulationStore((s) => s.solver);
  const speed = useSimulationStore((s) => s.speed);
  const portStates = useSimulationStore((s) => s.portStates);
  const componentStates = useSimulationStore((s) => s.componentStates);
  const simParams = useSimulationStore((s) => s.simParams);
  const updateFromSolver = useSimulationStore((s) => s.updateFromSolver);

  const ui = useUIStore();

  // Screen -> world coordinate conversion
  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cx = (sx - rect.left) * dpr;
      const cy = (sy - rect.top) * dpr;
      const hw = canvas.width / (2 * dpr);
      const hh = canvas.height / (2 * dpr);
      return {
        x: (cx / dpr - hw) / ui.zoom + ui.cameraX,
        y: (cy / dpr - hh) / ui.zoom + ui.cameraY,
      };
    },
    [ui.zoom, ui.cameraX, ui.cameraY]
  );

  // Build port index map for rendering (memoized)
  const portIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const comp of circuit.components) {
      for (const port of comp.ports) {
        map.set(`${comp.id}:${port.id}`, idx);
        idx++;
      }
    }
    return map;
  }, [circuit.components]);

  // Main render + simulation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = performance.now();
    let lastUpdateTime = 0;

    const loop = (now: number) => {
      // Resize
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width * dpr;
      const h = rect.height * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Solver steps
      if (running) {
        const dt = simParams.dt || 1e-4;
        const elapsed = (now - lastTime) / 1000;
        const targetSteps = Math.round((elapsed * speed) / dt);
        const maxSteps = 5000; // cap to prevent freezing
        const steps = Math.min(targetSteps, maxSteps);
        if (steps > 0) {
          solver.step(steps);
          // Throttle store updates to ~30fps to reduce React re-renders
          if (now - lastUpdateTime >= 33) {
            updateFromSolver();
            lastUpdateTime = now;
          }
        }
      }
      lastTime = now;

      // Render
      const state: RenderState = {
        components: circuit.components,
        connections: circuit.connections,
        fluids: circuit.fluids,
        portStates,
        componentStates,
        portIndexMap,
        selectedComponentIds: ui.selectedComponentIds,
        selectedConnectionIds: ui.selectedConnectionIds,
        cameraX: ui.cameraX,
        cameraY: ui.cameraY,
        zoom: ui.zoom,
        gridSize: ui.gridSize,
        showGrid: ui.showGrid,
        showPressureColours: ui.showPressureColours,
        showFlowArrows: ui.showFlowArrows,
        showLabels: ui.showLabels,
        running,
        time: simParams.time,
      };
      renderCircuit(ctx, canvas, state);

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [
    circuit, running, solver, speed, portStates, componentStates,
    simParams, ui, portIndexMap, updateFromSolver,
  ]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const world = screenToWorld(e.clientX, e.clientY);

      // Middle click = pan
      if (e.button === 1) {
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          camX: ui.cameraX,
          camY: ui.cameraY,
        };
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      // Placing a component
      if (ui.toolMode === 'place' && ui.placingComponentType) {
        const snapped = {
          x: snapToGrid(world.x, ui.gridSize),
          y: snapToGrid(world.y, ui.gridSize),
        };
        addComponent(ui.placingComponentType, snapped.x, snapped.y);
        ui.cancelPlacing();
        return;
      }

      // Check for port hit (start connection)
      const portHit = hitTestPort(world.x, world.y, circuit.components);
      if (portHit && !running) {
        if (ui.connectingFrom) {
          // Complete connection
          addConnection(ui.connectingFrom, portHit);
          ui.cancelConnecting();
        } else {
          ui.startConnecting(portHit.component, portHit.port);
        }
        return;
      }

      // Check for component hit
      const compHit = hitTestComponent(world.x, world.y, circuit.components);
      if (compHit) {
        ui.selectComponent(compHit.id, e.shiftKey);
        if (!running) {
          isDraggingRef.current = true;
          dragComponentRef.current = compHit.id;
          dragStartRef.current = world;
        }
        return;
      }

      // Click on empty space
      if (ui.connectingFrom) {
        ui.cancelConnecting();
      }
      ui.clearSelection();

      // Start panning with left click on empty space
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        camX: ui.cameraX,
        camY: ui.cameraY,
      };
    },
    [screenToWorld, ui, circuit.components, running, addComponent, addConnection]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) {
        const dx = (e.clientX - panStartRef.current.x) / ui.zoom;
        const dy = (e.clientY - panStartRef.current.y) / ui.zoom;
        ui.setCamera(
          panStartRef.current.camX - dx,
          panStartRef.current.camY - dy,
          ui.zoom
        );
        return;
      }

      if (isDraggingRef.current && dragComponentRef.current) {
        const world = screenToWorld(e.clientX, e.clientY);
        const snapped = {
          x: snapToGrid(world.x, ui.gridSize),
          y: snapToGrid(world.y, ui.gridSize),
        };
        updateComponentPosition(dragComponentRef.current, snapped.x, snapped.y);
      }
    },
    [screenToWorld, ui, updateComponentPosition]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    dragComponentRef.current = null;
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5, ui.zoom * factor));
      ui.setCamera(ui.cameraX, ui.cameraY, newZoom);
    },
    [ui]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (running) return;
        for (const id of ui.selectedComponentIds) {
          removeComponent(id);
        }
        for (const id of ui.selectedConnectionIds) {
          removeConnection(id);
        }
        ui.clearSelection();
      }
      if (e.key === 'Escape') {
        if (ui.connectingFrom) ui.cancelConnecting();
        if (ui.placingComponentType) ui.cancelPlacing();
        ui.clearSelection();
      }
    },
    [running, ui, removeComponent, removeConnection]
  );

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        background: '#1a1a2e',
        cursor: ui.toolMode === 'place'
          ? 'crosshair'
          : ui.toolMode === 'connect'
          ? 'pointer'
          : isPanningRef.current
          ? 'grabbing'
          : 'default',
      }}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    />
  );
}
