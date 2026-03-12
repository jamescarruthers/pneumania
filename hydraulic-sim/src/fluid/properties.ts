import { type FluidDef, type SimParams, R_GAS, P_ATM } from '../solver/types';

/**
 * Compute effective bulk modulus for a fluid at given pressure.
 * Dispatches based on fluid type (LIQUID vs GAS).
 */
export function effectiveBulkModulus(
  p: number,
  fluid: FluidDef,
  params: SimParams
): number {
  if (fluid.fluid_type === 'GAS') {
    // Polytropic gas: β = κ · p
    return fluid.kappa * Math.max(p, 100.0);
  }

  // Liquid with entrained air (Yu 1994 / Ruan-Burton 2006)
  const p_safe = Math.max(p, fluid.p_vapour);
  const x_air =
    fluid.x_air_0 * Math.pow(params.p_atm / p_safe, 1.0 / fluid.kappa);
  const inv_beta =
    (1.0 - x_air) / fluid.beta_base + (x_air * fluid.kappa) / p_safe;
  return 1.0 / inv_beta;
}

/**
 * Compute effective density for a fluid at given pressure.
 */
export function effectiveDensity(
  p: number,
  fluid: FluidDef,
  params: SimParams
): number {
  if (fluid.fluid_type === 'GAS') {
    // Ideal gas: ρ = M·p / (R·T)
    return (
      (fluid.molar_mass * Math.max(p, 100.0)) / (R_GAS * params.temperature)
    );
  }

  // Liquid with entrained air
  const p_safe = Math.max(p, fluid.p_vapour);
  const x_air =
    fluid.x_air_0 * Math.pow(params.p_atm / p_safe, 1.0 / fluid.kappa);
  const rho_air = 1.225 * Math.pow(p_safe / params.p_atm, 1.0 / fluid.kappa);
  return fluid.rho_base * (1.0 - x_air) + rho_air * x_air;
}

/**
 * Compute wave speed for a fluid at given pressure.
 */
export function waveSpeed(
  p: number,
  fluid: FluidDef,
  params: SimParams
): number {
  const beta = effectiveBulkModulus(p, fluid, params);
  const rho = effectiveDensity(p, fluid, params);
  return Math.sqrt(beta / rho);
}

/**
 * Compute characteristic impedance for a TLM line.
 * Zc = β / (A · wave_speed)
 */
export function characteristicImpedance(
  p: number,
  fluid: FluidDef,
  area: number,
  params: SimParams
): number {
  const beta = effectiveBulkModulus(p, fluid, params);
  const ws = waveSpeed(p, fluid, params);
  return beta / (area * ws);
}

/**
 * Smooth sign function for numerical stability near zero.
 */
export function smoothSign(x: number, eps: number = 1.0): number {
  return x / Math.sqrt(x * x + eps * eps);
}

/**
 * Orifice flow with laminar-turbulent transition.
 */
export function orificeFlow(
  dp: number,
  Cd: number,
  area: number,
  fluid: FluidDef,
  p_avg: number,
  params: SimParams
): number {
  const rho = effectiveDensity(p_avg, fluid, params);
  const nu = fluid.nu;
  const dp_transition = 100.0; // Pa

  // Turbulent flow
  const q_turb =
    Cd * area * smoothSign(dp) * Math.sqrt((2.0 * Math.abs(dp)) / rho);

  // Laminar flow (Hagen-Poiseuille equivalent)
  const D_h = Math.sqrt((4.0 * area) / Math.PI);
  const q_lam = ((Cd * area * area) * dp) / (32.0 * rho * nu * D_h);

  // Blend
  const blend = Math.min(Math.abs(dp) / dp_transition, 1.0);
  return q_lam * (1.0 - blend) + q_turb * blend;
}

/**
 * Compute TLM time delay for a line.
 */
export function lineDelay(
  length: number,
  p: number,
  fluid: FluidDef,
  params: SimParams
): number {
  const ws = waveSpeed(p, fluid, params);
  return length / ws;
}

/**
 * Compute global dt from all connections.
 */
export function computeGlobalDt(
  connections: Array<{ length: number; fluid_id: number }>,
  fluids: FluidDef[],
  params: SimParams,
  nominalPressure: number = P_ATM
): number {
  let minDelay = Infinity;
  for (const conn of connections) {
    const fluid = fluids[conn.fluid_id];
    const delay = lineDelay(conn.length, nominalPressure, fluid, params);
    if (delay < minDelay) minDelay = delay;
  }
  return minDelay > 0 && minDelay < Infinity ? minDelay : 1e-4;
}
