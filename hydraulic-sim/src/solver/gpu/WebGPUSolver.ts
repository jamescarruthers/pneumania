/**
 * WebGPU compute shader solver.
 * Currently a stub that falls back to JS solver — GPU pipelines are set up
 * but dispatch is deferred to Phase 5 of implementation.
 */

import {
  type CircuitDefinition,
  type Solver,
  type PortState,
  type SimParams,
} from '../types';
import { TLMSolverEngine } from '../engine';

export class WebGPUSolver implements Solver {
  private device: GPUDevice | null = null;
  private fallback: TLMSolverEngine;
  private _available = false;

  constructor() {
    this.fallback = new TLMSolverEngine();
  }

  async tryInit(): Promise<boolean> {
    if (!navigator.gpu) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      this._available = true;
      return true;
    } catch {
      return false;
    }
  }

  get available(): boolean {
    return this._available;
  }

  init(circuit: CircuitDefinition): void {
    // For now, delegate to JS solver
    // Full WebGPU pipeline setup would go here
    this.fallback.init(circuit);
  }

  step(n: number): void {
    this.fallback.step(n);
  }

  getPortState(index: number): PortState {
    return this.fallback.getPortState(index);
  }

  getComponentState(id: string): Record<string, number> {
    return this.fallback.getComponentState(id);
  }

  getSimParams(): SimParams {
    return this.fallback.getSimParams();
  }

  reset(): void {
    this.fallback.reset();
  }

  dispose(): void {
    this.device?.destroy();
    this.device = null;
    this.fallback.dispose();
  }
}
