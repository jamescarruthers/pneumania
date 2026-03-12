import { create } from 'zustand';
import { type PortState, type SimParams, DEFAULT_SIM_PARAMS } from '../solver/types';
import { TLMSolverEngine } from '../solver/engine';

export type SimSpeed = 0.1 | 0.25 | 0.5 | 1 | 2 | 5 | 10;

interface SimulationState {
  running: boolean;
  speed: SimSpeed;
  solver: TLMSolverEngine;
  simParams: SimParams;
  portStates: PortState[];
  componentStates: Map<string, Record<string, number>>;
  solverBackend: 'js' | 'webgpu' | 'wasm';
  stepsPerSecond: number;

  // Actions
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  stepOnce: () => void;
  reset: () => void;
  setSpeed: (speed: SimSpeed) => void;
  setSolverBackend: (backend: 'js' | 'webgpu' | 'wasm') => void;
  updateFromSolver: () => void;
  setMouseForce: (componentId: string, force: number) => void;
  clearMouseForce: (componentId: string) => void;
  setComponentState: (componentId: string, key: string, value: number) => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  running: false,
  speed: 1,
  solver: new TLMSolverEngine(),
  simParams: { ...DEFAULT_SIM_PARAMS },
  portStates: [],
  componentStates: new Map(),
  solverBackend: 'js',
  stepsPerSecond: 0,

  play: () => set({ running: true }),
  pause: () => set({ running: false }),
  togglePlayPause: () => set((s) => ({ running: !s.running })),

  stepOnce: () => {
    const { solver } = get();
    const dt = solver.getSimParams().dt;
    const stepsPerFrame = Math.max(1, Math.round((1 / 60) / dt));
    solver.step(stepsPerFrame);
    get().updateFromSolver();
  },

  reset: () => {
    const { solver } = get();
    solver.reset();
    get().updateFromSolver();
  },

  setSpeed: (speed) => set({ speed }),

  setSolverBackend: (backend) => set({ solverBackend: backend }),

  updateFromSolver: () => {
    const { solver } = get();
    const compiled = solver.getCompiledCircuit();
    if (!compiled) return;

    // Reuse arrays/maps — only copy state values to avoid triggering unnecessary re-renders
    const prevPorts = get().portStates;
    let portStates: PortState[];
    if (prevPorts.length === compiled.ports.length) {
      portStates = prevPorts;
      for (let i = 0; i < compiled.ports.length; i++) {
        const src = compiled.ports[i];
        const dst = portStates[i];
        dst.p = src.p;
        dst.q = src.q;
        dst.c = src.c;
        dst.Zc = src.Zc;
        dst.fluid_id = src.fluid_id;
      }
    } else {
      portStates = compiled.ports.map((p) => ({ ...p }));
    }

    const componentStates = new Map<string, Record<string, number>>();
    for (const c of compiled.components) {
      componentStates.set(c.id, { ...c.state });
    }

    set({
      simParams: solver.getSimParams(),
      portStates,
      componentStates,
    });
  },

  setMouseForce: (componentId, force) => {
    get().solver.setMouseForce(componentId, force);
  },

  clearMouseForce: (componentId) => {
    get().solver.clearMouseForce(componentId);
  },

  setComponentState: (componentId, key, value) => {
    get().solver.setComponentState(componentId, key, value);
  },
}));
