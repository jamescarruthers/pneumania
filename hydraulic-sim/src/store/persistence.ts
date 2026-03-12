/**
 * Circuit save/load to localStorage and file download/upload.
 */

import type { CircuitDefinition } from '../solver/types';

const STORAGE_KEY = 'hydraulic-sim-circuit';
const AUTOSAVE_KEY = 'hydraulic-sim-autosave';

export function saveToLocalStorage(circuit: CircuitDefinition): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(circuit));
  } catch (e) {
    console.warn('Failed to save to localStorage:', e);
  }
}

export function loadFromLocalStorage(): CircuitDefinition | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return null;
    return JSON.parse(json) as CircuitDefinition;
  } catch {
    return null;
  }
}

export function autoSave(circuit: CircuitDefinition): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(circuit));
  } catch {
    // Silently fail
  }
}

export function loadAutoSave(): CircuitDefinition | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    if (!json) return null;
    return JSON.parse(json) as CircuitDefinition;
  } catch {
    return null;
  }
}

export function downloadCircuit(circuit: CircuitDefinition, filename: string = 'circuit.json'): void {
  const json = JSON.stringify(circuit, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function uploadCircuit(): Promise<CircuitDefinition | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        const circuit = JSON.parse(text) as CircuitDefinition;
        resolve(circuit);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
