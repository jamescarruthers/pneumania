import { create } from 'zustand';
import { type PortState, type SimParams, type Solver, DEFAULT_SIM_PARAMS } from '../solver/types';
import { TLMSolverEngine } from '../solver/engine';
import { RapierHybridSolver, ensureRapierInit } from '../solver/rapier/RapierHybridSolver';
import type { SolverBackend } from '../solver/interface';

export type SimSpeed = 0.1 | 0.25 | 0.5 | 1 | 2 | 5 | 10;

interface SimulationState {
  running: boolean;
  speed: SimSpeed;
  solver: Solver;
  simParams: SimParams;
  portStates: PortState[];
  componentStates: Map<string, Record<string, number>>;
  solverBackend: SolverBackend;
  stepsPerSecond: number;
  switchingBackend: boolean;

  // Actions
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  stepOnce: () => void;
  reset: () => void;
  setSpeed: (speed: SimSpeed) => void;
  setSolverBackend: (backend: SolverBackend) => Promise<void>;
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
  switchingBackend: false,

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

  setSolverBackend: async (backend: SolverBackend) => {
    const { solver: oldSolver, running } = get();
    if (running) return; // don't switch while running

    set({ switchingBackend: true });

    try {
      let newSolver: Solver;
      if (backend === 'rapier') {
        await ensureRapierInit();
        newSolver = new RapierHybridSolver();
      } else {
        newSolver = new TLMSolverEngine();
      }

      oldSolver.dispose();
      set({
        solver: newSolver,
        solverBackend: backend,
        simParams: { ...DEFAULT_SIM_PARAMS },
        portStates: [],
        componentStates: new Map(),
        switchingBackend: false,
      });
    } catch (err) {
      console.error('Failed to switch solver backend:', err);
      set({ switchingBackend: false });
    }
  },

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
