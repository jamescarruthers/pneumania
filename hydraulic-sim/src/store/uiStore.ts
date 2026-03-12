import { create } from 'zustand';
import type { ComponentType } from '../solver/types';

export type ToolMode = 'select' | 'place' | 'connect' | 'pan';

interface UndoEntry {
  type: string;
  data: unknown;
}

interface UIState {
  // Selection
  selectedComponentIds: Set<string>;
  selectedConnectionIds: Set<string>;

  // Tool mode
  toolMode: ToolMode;
  placingComponentType: ComponentType | null;

  // Connection in progress
  connectingFrom: { component: string; port: string } | null;

  // Camera
  cameraX: number;
  cameraY: number;
  zoom: number;
  gridSize: number;

  // Display settings
  pressureUnit: 'bar' | 'psi' | 'Pa' | 'MPa';
  flowUnit: 'L/min' | 'm3/s' | 'gal/min';
  showGrid: boolean;
  showPressureColours: boolean;
  showFlowArrows: boolean;
  showLabels: boolean;

  // Undo/redo stacks
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  // Actions
  selectComponent: (id: string, addToSelection?: boolean) => void;
  selectConnection: (id: string) => void;
  clearSelection: () => void;
  setToolMode: (mode: ToolMode) => void;
  startPlacing: (type: ComponentType) => void;
  cancelPlacing: () => void;
  startConnecting: (component: string, port: string) => void;
  cancelConnecting: () => void;
  setCamera: (x: number, y: number, zoom: number) => void;
  setPressureUnit: (unit: 'bar' | 'psi' | 'Pa' | 'MPa') => void;
  setFlowUnit: (unit: 'L/min' | 'm3/s' | 'gal/min') => void;
  toggleGrid: () => void;
  togglePressureColours: () => void;
  toggleFlowArrows: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedComponentIds: new Set(),
  selectedConnectionIds: new Set(),
  toolMode: 'select',
  placingComponentType: null,
  connectingFrom: null,
  cameraX: 0,
  cameraY: 0,
  zoom: 1,
  gridSize: 20,
  pressureUnit: 'bar',
  flowUnit: 'L/min',
  showGrid: true,
  showPressureColours: true,
  showFlowArrows: true,
  showLabels: true,
  undoStack: [],
  redoStack: [],

  selectComponent: (id, addToSelection = false) =>
    set((s) => {
      const newSet = addToSelection ? new Set(s.selectedComponentIds) : new Set<string>();
      if (addToSelection && newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { selectedComponentIds: newSet, selectedConnectionIds: new Set() };
    }),

  selectConnection: (id) =>
    set({ selectedConnectionIds: new Set([id]), selectedComponentIds: new Set() }),

  clearSelection: () =>
    set({ selectedComponentIds: new Set(), selectedConnectionIds: new Set() }),

  setToolMode: (mode) =>
    set({ toolMode: mode, placingComponentType: null, connectingFrom: null }),

  startPlacing: (type) =>
    set({ toolMode: 'place', placingComponentType: type }),

  cancelPlacing: () =>
    set({ toolMode: 'select', placingComponentType: null }),

  startConnecting: (component, port) =>
    set({ toolMode: 'connect', connectingFrom: { component, port } }),

  cancelConnecting: () =>
    set({ toolMode: 'select', connectingFrom: null }),

  setCamera: (x, y, zoom) => set({ cameraX: x, cameraY: y, zoom }),

  setPressureUnit: (unit) => set({ pressureUnit: unit }),
  setFlowUnit: (unit) => set({ flowUnit: unit }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  togglePressureColours: () => set((s) => ({ showPressureColours: !s.showPressureColours })),
  toggleFlowArrows: () => set((s) => ({ showFlowArrows: !s.showFlowArrows })),
}));
