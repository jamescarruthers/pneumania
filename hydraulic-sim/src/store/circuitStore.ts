import { create } from 'zustand';
import {
  type CircuitDefinition,
  type ComponentDef,
  type ConnectionDef,
  type ComponentType,
  MIN_LINE_LENGTH,
} from '../solver/types';
import { getDefaultFluid } from '../fluid/presets';
import { uuid } from '../utils/uuid';
import { getDefaultPorts, getDefaultParams } from './componentDefaults';

interface CircuitState {
  circuit: CircuitDefinition;

  // Actions
  addComponent: (type: ComponentType, x: number, y: number) => string;
  removeComponent: (id: string) => void;
  updateComponentParams: (id: string, params: Record<string, number | string | boolean>) => void;
  updateComponentPosition: (id: string, x: number, y: number) => void;
  updateComponentRotation: (id: string, rotation: 0 | 90 | 180 | 270) => void;
  updateComponentLabel: (id: string, label: string) => void;
  addConnection: (from: { component: string; port: string }, to: { component: string; port: string }) => string | null;
  removeConnection: (id: string) => void;
  updateConnectionFluid: (id: string, fluidId: number) => void;
  updateConnectionDiameter: (id: string, diameter: number) => void;
  updateConnectionLength: (id: string, length: number) => void;
  setDefaultFluid: (fluidId: number) => void;
  loadCircuit: (circuit: CircuitDefinition) => void;
  clearCircuit: () => void;
  getComponent: (id: string) => ComponentDef | undefined;
}

function createEmptyCircuit(): CircuitDefinition {
  return {
    version: '1.0',
    fluids: [getDefaultFluid()],
    default_fluid_id: 0,
    components: [],
    connections: [],
    ui: {
      camera: { x: 0, y: 0, zoom: 1 },
      grid_size: 20,
    },
  };
}

export const useCircuitStore = create<CircuitState>((set, get) => ({
  circuit: createEmptyCircuit(),

  addComponent: (type: ComponentType, x: number, y: number): string => {
    const id = uuid();
    const comp: ComponentDef = {
      id,
      type,
      label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).toLowerCase(),
      position: { x, y },
      rotation: 0,
      params: getDefaultParams(type),
      ports: getDefaultPorts(type),
    };
    set((state) => ({
      circuit: {
        ...state.circuit,
        components: [...state.circuit.components, comp],
      },
    }));
    return id;
  },

  removeComponent: (id: string) => {
    set((state) => ({
      circuit: {
        ...state.circuit,
        components: state.circuit.components.filter((c) => c.id !== id),
        connections: state.circuit.connections.filter(
          (c) => c.from.component !== id && c.to.component !== id
        ),
      },
    }));
  },

  updateComponentParams: (id, params) => {
    set((state) => ({
      circuit: {
        ...state.circuit,
        components: state.circuit.components.map((c) =>
          c.id === id ? { ...c, params: { ...c.params, ...params } } : c
        ),
      },
    }));
  },

  updateComponentPosition: (id, x, y) => {
    set((state) => ({
      circuit: {
        ...state.circuit,
        components: state.circuit.components.map((c) =>
          c.id === id ? { ...c, position: { x, y } } : c
        ),
      },
    }));
  },

  updateComponentRotation: (id, rotation) => {
    set((state) => ({
      circuit: {
        ...state.circuit,
        components: state.circuit.components.map((c) =>
          c.id === id ? { ...c, rotation } : c
        ),
      },
    }));
  },

  updateComponentLabel: (id, label) => {
    set((state) => ({
      circuit: {
        ...state.circuit,
        components: state.circuit.components.map((c) =>
          c.id === id ? { ...c, label } : c
        ),
      },
    }));
  },

  addConnection: (from, to) => {
    const state = get();
    // Prevent duplicate connections
    const existing = state.circuit.connections.find(
      (c) =>
        (c.from.component === from.component && c.from.port === from.port &&
         c.to.component === to.component && c.to.port === to.port) ||
        (c.from.component === to.component && c.from.port === to.port &&
         c.to.component === from.component && c.to.port === from.port)
    );
    if (existing) return null;

    // Prevent self-connection
    if (from.component === to.component) return null;

    const id = uuid();
    const conn: ConnectionDef = {
      id,
      from,
      to,
      waypoints: [],
      line_params: {
        inner_diameter: 0.01, // 10mm default
        length: 0.5,          // 500mm default
        fluid_id: state.circuit.default_fluid_id,
      },
    };
    set((s) => ({
      circuit: {
        ...s.circuit,
        connections: [...s.circuit.connections, conn],
      },
    }));
    return id;
  },

  removeConnection: (id) => {
    set((state) => ({
      circuit: {
        ...state.circuit,
        connections: state.circuit.connections.filter((c) => c.id !== id),
      },
    }));
  },

  updateConnectionFluid: (id, fluidId) => {
    set((state) => ({
      circuit: {
        ...state.circuit,
        connections: state.circuit.connections.map((c) =>
          c.id === id
            ? { ...c, line_params: { ...c.line_params, fluid_id: fluidId } }
            : c
        ),
      },
    }));
  },

  updateConnectionDiameter: (id, diameter) => {
    set((state) => ({
      circuit: {
        ...state.circuit,
        connections: state.circuit.connections.map((c) =>
          c.id === id
            ? { ...c, line_params: { ...c.line_params, inner_diameter: diameter } }
            : c
        ),
      },
    }));
  },

  updateConnectionLength: (id, length) => {
    const clamped = Math.max(length, MIN_LINE_LENGTH);
    set((state) => ({
      circuit: {
        ...state.circuit,
        connections: state.circuit.connections.map((c) =>
          c.id === id
            ? { ...c, line_params: { ...c.line_params, length: clamped } }
            : c
        ),
      },
    }));
  },

  setDefaultFluid: (fluidId) => {
    set((state) => ({
      circuit: { ...state.circuit, default_fluid_id: fluidId },
    }));
  },

  loadCircuit: (circuit) => {
    set({ circuit });
  },

  clearCircuit: () => {
    set({ circuit: createEmptyCircuit() });
  },

  getComponent: (id) => {
    return get().circuit.components.find((c) => c.id === id);
  },
}));
