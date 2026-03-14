/**
 * Solver factory — detects capabilities and returns best available solver.
 */

import type { Solver } from './types';
import { TLMSolverEngine } from './engine';
import { WebGPUSolver } from './gpu/WebGPUSolver';
import { RapierHybridSolver, ensureRapierInit } from './rapier/RapierHybridSolver';

export type SolverBackend = 'js' | 'webgpu' | 'wasm' | 'rapier';

export interface SolverInfo {
  backend: SolverBackend;
  solver: Solver;
}

export async function createSolver(preferred?: SolverBackend): Promise<SolverInfo> {
  if (preferred === 'rapier') {
    await ensureRapierInit();
    return { backend: 'rapier', solver: new RapierHybridSolver() };
  }

  if (preferred === 'js') {
    return { backend: 'js', solver: new TLMSolverEngine() };
  }

  // Try WebGPU first
  const gpuSolver = new WebGPUSolver();
  const gpuAvailable = await gpuSolver.tryInit();
  if (gpuAvailable) {
    return { backend: 'webgpu', solver: gpuSolver };
  }

  // Fall back to JS solver (WASM fallback would go here)
  return { backend: 'js', solver: new TLMSolverEngine() };
}
