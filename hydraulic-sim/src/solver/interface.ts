/**
 * Solver factory — detects capabilities and returns best available solver.
 */

import type { Solver } from './types';
import { TLMSolverEngine } from './engine';
import { WebGPUSolver } from './gpu/WebGPUSolver';

export type SolverBackend = 'js' | 'webgpu' | 'wasm';

export interface SolverInfo {
  backend: SolverBackend;
  solver: Solver;
}

export async function createSolver(): Promise<SolverInfo> {
  // Try WebGPU first
  const gpuSolver = new WebGPUSolver();
  const gpuAvailable = await gpuSolver.tryInit();
  if (gpuAvailable) {
    return { backend: 'webgpu', solver: gpuSolver };
  }

  // Fall back to JS solver (WASM fallback would go here)
  return { backend: 'js', solver: new TLMSolverEngine() };
}
